//! Replays the Lean Firestore Value representation model at the gRPC adapter boundary.

use std::collections::HashMap;

use fireemu_adapter_grpc::decode::{decode_value, DecodeError};
use fireemu_adapter_grpc::encode::encode_value;
use fireemu_core_firestore::value::Value;
use fireemu_proto_firestore::google::firestore::v1::{self as pb, value::ValueType as Wire};

const CASES: &str = include_str!("fixtures/lean-firestore-proto-values.corpus");

fn wire(value: Wire) -> pb::Value {
    pb::Value {
        value_type: Some(value),
    }
}

fn scalar(case: &str) -> pb::Value {
    match case {
        "missing" => pb::Value { value_type: None },
        "reference_expression" => wire(Wire::FieldReferenceValue("a".into())),
        "null" => wire(Wire::NullValue(0)),
        "unknown_null" => wire(Wire::NullValue(97)),
        "boolean" => wire(Wire::BooleanValue(true)),
        "integer" => wire(Wire::IntegerValue(i64::MIN)),
        "minus_zero" => wire(Wire::DoubleValue(-0.0)),
        "nan_payload" => wire(Wire::DoubleValue(f64::from_bits(0xfff8_0000_0000_0021))),
        "string" => wire(Wire::StringValue("表🙂".into())),
        "bytes" => wire(Wire::BytesValue(vec![0, 128, 255])),
        "reference" => wire(Wire::ReferenceValue(
            "projects/demo-app/databases/(default)/documents/docs/a".into(),
        )),
        _ => panic!("unknown scalar {case}"),
    }
}

fn vector_fields(marker: &str, payload: &str, extra: &str) -> pb::Value {
    let mut fields = HashMap::new();
    let tag = match marker {
        "absent" => None,
        "exact" => Some(Wire::StringValue("__vector__".into())),
        "other" => Some(Wire::StringValue("__other__".into())),
        "integer" => Some(Wire::IntegerValue(1)),
        _ => panic!("unknown marker {marker}"),
    };
    if let Some(tag) = tag {
        fields.insert("__type__".to_owned(), wire(tag));
    }
    let array = |items| Wire::ArrayValue(pb::ArrayValue { values: items });
    let payload = match payload {
        "empty" => array(vec![]),
        "doubles" => array(vec![
            wire(Wire::DoubleValue(-0.0)),
            wire(Wire::DoubleValue(0.5)),
        ]),
        "mixed" => array(vec![
            wire(Wire::IntegerValue(9_007_199_254_740_993)),
            wire(Wire::DoubleValue(-0.0)),
        ]),
        "bad" => array(vec![wire(Wire::BooleanValue(true))]),
        "scalar" => Wire::IntegerValue(1),
        _ => panic!("unknown payload {payload}"),
    };
    fields.insert("value".into(), wire(payload));
    match extra {
        "absent" => {}
        "ordinary" => {
            fields.insert("extra".into(), wire(Wire::BooleanValue(false)));
        }
        "name" => {
            fields.insert(
                "__name__".into(),
                wire(Wire::StringValue("reserved".into())),
            );
        }
        _ => panic!("unknown additional key {extra}"),
    }
    wire(Wire::MapValue(pb::MapValue { fields }))
}

fn expected_error(label: &str) -> DecodeError {
    use DecodeError::{
        InvalidFieldPath, InvalidStoredFieldName, InvalidValue, Refused, Unsupported,
    };
    match label {
        "missing" => InvalidValue("value without value_type".into()),
        "unsupported" => {
            Unsupported("pipeline expression values are not accepted in Core queries".into())
        }
        "negative_nanos" => InvalidValue("negative timestamp nanos".into()),
        "range_nanos" => InvalidValue("timestamp: NanosOutOfRange".into()),
        "range_seconds" => InvalidValue("timestamp: SecondsOutOfRange".into()),
        "bad_geo" => InvalidValue("geo point out of range".into()),
        "depth" => InvalidValue("FS-LIMIT-NESTED-MAP-ARRAY-DEPTH has maximum 20, got 21".into()),
        "bad_vector" => InvalidValue("vector element is not a number".into()),
        "reserved_name" => InvalidFieldPath("field name __name__ is reserved".into()),
        "integer_type" => Refused("Field __type__ must be a string; founds LONG.".into()),
        "reserved_type" => InvalidStoredFieldName("field name '__type__' is reserved.".into()),
        _ => panic!("unknown diagnostic {label}"),
    }
}

fn check_roundtrip(input: &pb::Value, result: &str, entry: &str) {
    let decoded = decode_value(input);
    match result {
        "same" => {
            let encoded = encode_value(&decoded.unwrap());
            match (&input.value_type, &encoded.value_type) {
                (Some(Wire::DoubleValue(before)), Some(Wire::DoubleValue(after))) => {
                    assert_eq!(before.to_bits(), after.to_bits(), "{entry}");
                }
                _ => assert_eq!(&encoded, input, "{entry}"),
            }
        }
        "null" => {
            assert_eq!(decoded.unwrap(), Value::Null, "{entry}");
            assert_eq!(
                encode_value(&Value::Null),
                wire(Wire::NullValue(0)),
                "{entry}"
            );
        }
        "map" => {
            let decoded = decoded.unwrap();
            assert!(matches!(decoded, Value::Map(_)), "{entry}");
            assert_eq!(&encode_value(&decoded), input, "{entry}");
        }
        error => assert_eq!(decoded, Err(expected_error(error)), "{entry}"),
    }
}

fn check_vector(input: &pb::Value, result: &str, output_bits: &str, entry: &str) {
    if result != "vector" {
        assert_eq!(output_bits, "-", "{entry}");
        check_roundtrip(input, result, entry);
        return;
    }
    let expected = output_bits
        .split(',')
        .filter(|part| *part != "-")
        .map(|part| part.parse::<u64>().unwrap())
        .collect::<Vec<_>>();
    let decoded = decode_value(input).unwrap();
    let Value::Vector(values) = &decoded else {
        panic!("not a decoded vector: {entry}");
    };
    assert_eq!(
        values
            .iter()
            .map(|value| value.to_bits())
            .collect::<Vec<_>>(),
        expected,
        "{entry}"
    );
    let Some(Wire::MapValue(map)) = encode_value(&decoded).value_type else {
        panic!("vector did not encode to its sentinel map");
    };
    assert_eq!(map.fields.len(), 2, "{entry}");
    assert_eq!(
        map.fields["__type__"],
        wire(Wire::StringValue("__vector__".into())),
        "{entry}"
    );
    let Some(Wire::ArrayValue(encoded)) = &map.fields["value"].value_type else {
        panic!("vector components did not encode to an array: {entry}");
    };
    let encoded_bits = encoded
        .values
        .iter()
        .map(|message| {
            let Some(Wire::DoubleValue(value)) = message.value_type else {
                panic!("encoded vector component is not a double: {entry}");
            };
            value.to_bits()
        })
        .collect::<Vec<_>>();
    assert_eq!(encoded_bits, expected, "{entry}");
}

fn container(outer: &str, leaf: &str, depth: usize) -> pb::Value {
    let mut message = if leaf == "vector" {
        vector_fields("exact", "doubles", "absent")
    } else {
        scalar("null")
    };
    for level in 0..depth {
        message = if outer == "array" || (outer == "alternating" && level % 2 == 0) {
            wire(Wire::ArrayValue(pb::ArrayValue {
                values: vec![message],
            }))
        } else {
            wire(Wire::MapValue(pb::MapValue {
                fields: HashMap::from([("a".into(), message)]),
            }))
        };
    }
    message
}

#[test]
fn replay_proto_values() {
    let mut cases = CASES.lines();
    assert_eq!(cases.next(), Some("# KIND INPUTS EXPECTED, tab separated"));
    let mut counts = [0; 5];
    for entry in cases {
        match entry.split('\t').collect::<Vec<_>>().as_slice() {
            ["scalar", input, result] => {
                check_roundtrip(&scalar(input), result, entry);
                counts[0] += 1;
            }
            ["vector", marker, payload, extra, result, bits] => {
                check_vector(&vector_fields(marker, payload, extra), result, bits, entry);
                counts[1] += 1;
            }
            ["timestamp", seconds, nanos, result] => {
                let input = wire(Wire::TimestampValue(prost_types::Timestamp {
                    seconds: seconds.parse().unwrap(),
                    nanos: nanos.parse().unwrap(),
                }));
                check_roundtrip(&input, result, entry);
                counts[2] += 1;
            }
            ["geo", latitude, longitude, result] => {
                let input = wire(Wire::GeoPointValue(
                    fireemu_proto_firestore::google::r#type::LatLng {
                        latitude: latitude.parse().unwrap(),
                        longitude: longitude.parse().unwrap(),
                    },
                ));
                check_roundtrip(&input, result, entry);
                counts[3] += 1;
            }
            ["container", outer, leaf, depth, result] => {
                check_roundtrip(
                    &container(outer, leaf, depth.parse().unwrap()),
                    result,
                    entry,
                );
                counts[4] += 1;
            }
            _ => panic!("bad corpus row {entry}"),
        }
    }
    assert_eq!(counts, [11, 60, 25, 36, 30]);
}
