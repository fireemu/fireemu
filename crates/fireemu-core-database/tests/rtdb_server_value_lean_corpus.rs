//! Replays Lean's RTDB timestamp and increment reference.

use fireemu_core_database::server_value::{has_server_value, resolve};
use fireemu_core_database::{ErrorKind, Json, Limits, Node, Number, Path, ServerValueContext};

const CORPUS: &str = include_str!("fixtures/lean-rtdb-server-value.corpus");

fn double(bits: u64) -> Json {
    Json::Number(Number::from_f64(f64::from_bits(bits)).expect("finite double"))
}

fn timestamp() -> Json {
    Json::object([(".sv", Json::string("timestamp"))])
}

fn increment(delta: Json) -> Json {
    Json::object([(".sv", Json::object([("increment", delta)]))])
}

fn operation(name: &str) -> Json {
    match name {
        "stamp" => timestamp(),
        "plus" => increment(Json::int(7)),
        "minus" => increment(Json::int(-8)),
        "float" => increment(double(0xbfe0_0000_0000_0000)),
        "overflowFloat" => increment(double(f64::MAX.to_bits())),
        "negativeFloat" => increment(double((-f64::MAX).to_bits())),
        "negativeZero" => increment(double((-0.0_f64).to_bits())),
        "badOp" => increment(Json::string("notNumeric")),
        "extra" => Json::object([(".sv", Json::string("timestamp")), ("extra", Json::Null)]),
        _ => panic!("unknown operation {name:?}"),
    }
}

fn existing(name: &str) -> Json {
    match name {
        "absent" => Json::Null,
        "int" => Json::int(11),
        "text" => Json::string("notNumeric"),
        "high" => Json::int(i64::MAX),
        "low" => Json::int(i64::MIN),
        "float" => double(f64::MAX.to_bits()),
        "negFloat" => double((-f64::MAX).to_bits()),
        "negativeZero" => double((-0.0_f64).to_bits()),
        _ => panic!("unknown stored value {name:?}"),
    }
}

fn expected_number(field: &str) -> Json {
    let (kind, payload) = field.split_once(':').expect("number kind and payload");
    match kind {
        "i" => Json::int(payload.parse().expect("i64")),
        "d" => double(payload.parse().expect("IEEE 754 bits")),
        _ => panic!("unknown numeric kind {kind:?}"),
    }
}

fn stored(slot: &str, n: Json) -> Json {
    match slot {
        "root" | "value" => n,
        "object" => Json::object([("x", n), ("y", Json::int(8))]),
        "array" => Json::Array(vec![Json::int(8), n]),
        "priority" => Json::object([(".value", Json::int(2)), (".priority", n)]),
        _ => panic!("unknown slot {slot:?}"),
    }
}

fn at_slot(slot: &str, operation: Json, value: (&'static str, Json)) -> Json {
    match slot {
        "root" => operation,
        "object" => Json::object([("x", operation), ("y", Json::int(1))]),
        "array" => Json::Array(vec![Json::int(1), operation]),
        "value" => Json::object([(".value", operation), (".priority", Json::int(9))]),
        "priority" => Json::object([value, (".priority", operation)]),
        _ => panic!("unknown slot {slot:?}"),
    }
}

#[test]
fn lean_server_values_agree_with_core() {
    let limits = Limits::default();
    let root = Path::parse("", &limits).unwrap();
    assert_eq!(CORPUS.lines().count(), 720);
    for line in CORPUS.lines() {
        let fields: Vec<_> = line.split('\t').collect();
        let [op, before, slot, millis, expected] = fields.as_slice() else {
            panic!("malformed corpus row {line:?}");
        };
        let now_millis = millis.parse().expect("i64");
        let request = at_slot(slot, operation(op), (".sv", Json::string("timestamp")));
        // Build the stored node through the parser so that its embedded numeric priority is widened.
        let old_value = Node::from_json(&stored(slot, existing(before)), &root, &limits).unwrap();
        assert!(has_server_value(&request), "{line:?}");
        let actual = resolve(
            &request,
            old_value.as_ref(),
            ServerValueContext { now_millis },
        );
        if *expected == "error" {
            assert_eq!(
                actual.unwrap_err().kind,
                ErrorKind::InvalidServerValue,
                "{line:?}"
            );
        } else {
            let expected = at_slot(
                slot,
                expected_number(expected),
                (".value", Json::int(now_millis)),
            );
            let actual = actual.expect("valid server value");
            assert!(
                actual.same_form(&expected),
                "{line:?}: expected {expected:?}, got {actual:?}"
            );
            assert!(!has_server_value(&actual), "{line:?}");
        }
    }
}
