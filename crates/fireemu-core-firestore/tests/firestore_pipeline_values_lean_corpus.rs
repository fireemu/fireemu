//! Replays the Lean comparison and membership reference through the Pipeline evaluator.

use std::collections::BTreeMap;

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::pipeline_exec::{values_equal, Eval, Expr, Placement, Row, Unrecorded};
use fireemu_core_firestore::value::Value;

const CASES: &str = include_str!("fixtures/lean-firestore-pipeline-values.corpus");

fn parse_value(label: &str) -> Option<Value> {
    let value = match label {
        "missing" => return None,
        "null" => Value::Null,
        "false" => Value::Boolean(false),
        "true" => Value::Boolean(true),
        "text" => Value::String("1".into()),
        "text2" => Value::String("2".into()),
        "nanA" => Value::Double(f64::from_bits(0x7ff8_0000_0000_0001)),
        "nanB" => Value::Double(f64::from_bits(0xfff8_0000_0000_0020)),
        "negInf" => Value::Double(f64::NEG_INFINITY),
        "posInf" => Value::Double(f64::INFINITY),
        _ => match label.as_bytes().split_first() {
            Some((b'i', _)) => Value::Integer(label[1..].parse().unwrap()),
            Some((b'd', _)) => Value::Double(label[1..].parse().unwrap()),
            _ => panic!("unexpected corpus value {label}"),
        },
    };
    Some(value)
}

fn expression(value: Option<Value>) -> Expr {
    value.map_or_else(
        || Expr::Field(FieldPath::parse("missing").unwrap()),
        Expr::Constant,
    )
}

fn comparison(left: &str, right: &str) -> Vec<Expr> {
    vec![
        expression(parse_value(left)),
        expression(parse_value(right)),
    ]
}

fn membership(function: &str, wanted: &str, items: &str) -> Vec<Expr> {
    let wanted = expression(parse_value(wanted));
    let elements = items
        .split(',')
        .filter(|label| *label != "-")
        .map(|label| parse_value(label).expect("array elements have a value"))
        .collect();
    let array = Expr::Constant(Value::Array(elements));
    if function == "array_contains" {
        vec![array, wanted]
    } else {
        vec![wanted, array]
    }
}

#[test]
fn replay_comparison_and_membership() {
    let mut cases = CASES.lines();
    assert_eq!(
        cases.next(),
        Some("# KIND OP LEFT RIGHT EXPECTED, tab separated")
    );
    let row = Row::derived(BTreeMap::new());
    let mut counts = (0, 0);
    for entry in cases {
        let columns = entry.split('\t').collect::<Vec<_>>();
        let [kind, op, left, right, answer] = columns.as_slice() else {
            panic!("bad corpus row {entry}");
        };
        let expected = answer.parse::<bool>().unwrap();
        let args = match *kind {
            "compare" => {
                counts.0 += 1;
                if let ("equal", Some(a), Some(b)) = (*op, parse_value(left), parse_value(right)) {
                    assert_eq!(values_equal(&a, &b), expected, "{entry}");
                    assert_eq!(a.canonical_cmp(&b).is_eq(), expected, "{entry}");
                }
                comparison(left, right)
            }
            "membership" => {
                counts.1 += 1;
                membership(op, left, right)
            }
            _ => panic!("bad corpus row {entry}"),
        };
        let call = Expr::call(op, args, Placement::Value).unwrap();
        for profile in [Unrecorded::Refuse, Unrecorded::OfficialEmulator] {
            assert_eq!(
                call.eval_in(&row, profile),
                Eval::Value(Value::Boolean(expected)),
                "{profile:?}: {entry}"
            );
        }
    }
    assert_eq!(counts, (2646, 504));
}
