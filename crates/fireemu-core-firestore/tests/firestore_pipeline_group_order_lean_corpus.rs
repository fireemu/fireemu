//! Replays first representatives and the order of blocking Pipeline stages.

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::pipeline_exec::{
    execute_in, Accumulator, AccumulatorKind, Expr, Row, Stage, Unrecorded,
};
use fireemu_core_firestore::value::Value;
use std::collections::BTreeMap;

const ALIASES: [&str; 2] = ["a", "b"];

fn cell(label: &str) -> Option<Value> {
    Some(match label {
        "missing" => return None,
        "null" => Value::Null,
        "i0" => Value::Integer(0),
        "d0" => Value::Double(0.0),
        "dn0" => Value::Double(-0.0),
        "i1" => Value::Integer(1),
        "d1" => Value::Double(1.0),
        "i2" => Value::Integer(2),
        "nanA" => Value::Double(f64::from_bits(0x7ff8_0000_0000_0001)),
        "nanB" => Value::Double(f64::from_bits(0xfff8_0000_0000_0020)),
        "nestI" => nested(Value::Integer(1)),
        "nestD" => nested(Value::Double(1.0)),
        "nest2" => nested(Value::Integer(2)),
        _ => panic!("unexpected cell {label}"),
    })
}

fn nested(value: Value) -> Value {
    Value::Map(BTreeMap::from([(
        "items".into(),
        Value::Array(vec![value]),
    )]))
}

fn fields(raw: &str) -> BTreeMap<String, Value> {
    if raw == "_" {
        return BTreeMap::new();
    }
    ALIASES
        .iter()
        .zip(raw.split(','))
        .filter_map(|(alias, label)| Some(((*alias).into(), cell(label)?)))
        .collect()
}

fn assert_exact(actual: &Value, expected: &Value, label: &str) {
    match (actual, expected) {
        (Value::Double(a), Value::Double(e)) => assert_eq!(a.to_bits(), e.to_bits(), "{label}"),
        (Value::Array(a), Value::Array(e)) => {
            assert_eq!(a.len(), e.len(), "{label}");
            for (a, e) in a.iter().zip(e) {
                assert_exact(a, e, label);
            }
        }
        (Value::Map(a), Value::Map(e)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                e.keys().collect::<Vec<_>>(),
                "{label}"
            );
            for (k, value) in a {
                assert_exact(value, &e[k], label);
            }
        }
        _ => assert!(
            actual.stored_eq(expected),
            "{label}: {actual:?} != {expected:?}"
        ),
    }
}

fn rows(input: &str) -> impl Iterator<Item = &str> {
    input.split(';').filter(|value| *value != "-")
}

fn stage(tag: &str, arity: usize) -> Stage {
    let aliases = ALIASES[..arity]
        .iter()
        .map(|alias| {
            (
                (*alias).into(),
                Expr::Field(FieldPath::parse(alias).unwrap()),
            )
        })
        .collect();
    if tag == "distinct" {
        Stage::Distinct(aliases)
    } else {
        Stage::Aggregate {
            groups: aliases,
            accumulators: vec![(
                "count".into(),
                Accumulator {
                    kind: AccumulatorKind::CountAll,
                    argument: None,
                },
            )],
        }
    }
}

#[test]
fn blocking_stages_keep_first_exact_keys_and_input_order() {
    let mut corpus = include_str!("fixtures/lean-firestore-pipeline-group-order.corpus").lines();
    assert_eq!(
        corpus.next(),
        Some("# stage|input|family|arity|rows|results")
    );
    assert_eq!(corpus.clone().count(), 90);
    for line in corpus {
        let columns: Vec<_> = line.split('|').collect();
        let [tag, _, _, arity, input, results] = columns.as_slice() else {
            panic!("unexpected corpus row {line}");
        };
        let op = stage(tag, arity.parse().unwrap());
        let input: Vec<_> = rows(input).map(|raw| Row::derived(fields(raw))).collect();
        let expected: Vec<_> = rows(results)
            .map(|row| match row.split_once(':') {
                Some((raw, count)) => {
                    let mut output = fields(raw);
                    output.insert("count".into(), Value::Integer(count.parse().unwrap()));
                    output
                }
                None => fields(row),
            })
            .collect();
        for profile in [Unrecorded::Refuse, Unrecorded::OfficialEmulator] {
            let actual = execute_in(vec![op.clone()], input.clone(), profile).unwrap();
            assert_eq!(actual.len(), expected.len(), "{line}");
            for (actual, expected) in actual.iter().zip(&expected) {
                assert_eq!(actual.len(), expected.len(), "{line}");
                for (key, value) in expected {
                    assert_exact(&actual[key], value, line);
                }
            }
        }
    }
}
