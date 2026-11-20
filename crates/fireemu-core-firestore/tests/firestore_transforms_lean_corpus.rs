//! Replays transform values and reports through atomic Firestore commits.

use std::collections::BTreeMap;

use fireemu_core_firestore::{
    field_path::FieldPath,
    path::DocumentPath,
    store::{FieldTransform, FirestoreError, FirestoreState, TransformKind, Write, WriteOp},
    value::{Timestamp, Value},
};
use fireemu_core_types::{
    ids::{DatabaseId, ProjectId},
    time::LogicalInstant,
};

fn value(text: &str) -> Value {
    if let Some(array) = text
        .strip_prefix('[')
        .and_then(|contents| contents.strip_suffix(']'))
    {
        return Value::Array(if array.is_empty() {
            Vec::new()
        } else {
            array.split(',').map(value).collect()
        });
    }
    match text {
        "text" => Value::String("nonnumeric".to_owned()),
        "nzero" => Value::Double(-0.0),
        "nan" => Value::Double(f64::NAN),
        "posinf" => Value::Double(f64::INFINITY),
        "neginf" => Value::Double(f64::NEG_INFINITY),
        _ => {
            let (kind, operand) = text.split_at(1);
            match kind {
                "i" => Value::Integer(operand.parse().expect("integer fixture")),
                "d" => Value::Double(operand.parse::<f64>().expect("half-unit fixture") / 2.0),
                "t" => Value::Timestamp(
                    Timestamp::new(500, operand.parse().expect("nanosecond fixture"))
                        .expect("fixture timestamp"),
                ),
                _ => panic!("unknown fixture value {text}"),
            }
        }
    }
}

fn array(value: Value) -> Vec<Value> {
    let Value::Array(items) = value else {
        panic!("fixture array operand");
    };
    items
}

fn same_value(actual: &Value, expected: &Value, label: &str) {
    match (actual, expected) {
        (Value::Double(actual), Value::Double(expected)) if expected.is_nan() => {
            assert!(actual.is_nan(), "{label}: expected NaN, got {actual}");
        }
        (Value::Double(actual), Value::Double(expected)) => {
            assert_eq!(actual.to_bits(), expected.to_bits(), "{label}");
        }
        (Value::Array(actual), Value::Array(expected)) => {
            assert_eq!(actual.len(), expected.len(), "{label}");
            for (actual, expected) in actual.iter().zip(expected) {
                same_value(actual, expected, label);
            }
        }
        _ => assert_eq!(actual, expected, "{label}"),
    }
}

fn fields(initial: &str) -> BTreeMap<String, Value> {
    let mut fields = BTreeMap::from([("frame".to_owned(), Value::Integer(1))]);
    if initial != "-" {
        fields.insert("target".to_owned(), value(initial));
    }
    fields
}

fn transform_kind(operation: &str, operand: &str) -> TransformKind {
    let operand = value(operand);
    match operation {
        "increment" => TransformKind::Increment(operand),
        "maximum" => TransformKind::Maximum(operand),
        "minimum" => TransformKind::Minimum(operand),
        "union" => TransformKind::AppendMissingElements(array(operand)),
        "remove" => TransformKind::RemoveAllFromArray(array(operand)),
        _ => panic!("unknown transform operation"),
    }
}

#[test]
fn commit_transforms_match_lean_corpus() {
    let mut rows = include_str!("fixtures/lean-firestore-transforms.corpus").lines();
    let count = rows
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases."))
        .expect("fixture count")
        .parse::<usize>()
        .expect("numeric case count");
    assert_eq!(count, 732);
    assert_eq!(rows.clone().count(), count);

    let project = ProjectId::try_new("demo-transforms").expect("fixture project");
    let database = DatabaseId::default_database();
    let path = DocumentPath::parse(&project, &database, "sample/document").expect("fixture path");
    let target = FieldPath::parse("target").expect("fixture target");
    let frame = FieldPath::parse("frame").expect("fixture frame");
    for row in rows {
        let columns: Vec<_> = row.split('\t').collect();
        let [family, operation, _, _, origin, start, operand, expected] = columns.as_slice() else {
            panic!("invalid transform fixture row");
        };
        let kind = transform_kind(operation, operand);
        let prior = *origin == "prior";
        let mut state = FirestoreState::new();
        state
            .commit(
                &[Write {
                    op: WriteOp::Set {
                        path: path.clone(),
                        fields: fields(if prior { start } else { "i99" }),
                        update_mask: None,
                    },
                    precondition: None,
                    transforms: Vec::new(),
                }],
                None,
                LogicalInstant::from_unix_seconds(500),
            )
            .expect("seed fixture document");
        let before = state.get(&path).expect("fixture state").clone();
        let before_version = state.current_version();
        let result = state.commit(
            &[Write {
                op: WriteOp::Set {
                    path: path.clone(),
                    fields: if prior {
                        BTreeMap::new()
                    } else {
                        fields(start)
                    },
                    update_mask: prior.then(Vec::new),
                },
                precondition: None,
                transforms: vec![
                    FieldTransform {
                        field: frame.clone(),
                        kind: TransformKind::Increment(Value::Integer(1)),
                    },
                    FieldTransform {
                        field: target.clone(),
                        kind,
                    },
                ],
            }],
            None,
            LogicalInstant::from_unix_seconds(501),
        );

        if *expected == "error" {
            let expected_message = if *operation == "increment" {
                "Input must be a number."
            } else {
                "maximum / minimum operand must be numeric"
            };
            assert_eq!(
                result.expect_err("fixture expects atomic rejection"),
                FirestoreError::InvalidArgument(expected_message.to_owned()),
                "{row}"
            );
            assert_eq!(state.current_version(), before_version, "{row}");
            let after = &state.get(&path).expect("document survives").fields;
            assert_eq!(after.len(), before.fields.len(), "{row}");
            for (field, expected) in &before.fields {
                same_value(&after[field], expected, row);
            }
            continue;
        }
        let committed = result.expect("fixture expects committed transform");
        let document = state.get(&path).expect("stored target");
        let expected = value(expected);
        let results = &committed.write_results[0].transform_results;
        assert_eq!(results.len(), 2, "{row}");
        assert_eq!(results[0], Value::Integer(2), "{row}");
        assert_eq!(document.fields["frame"], Value::Integer(2), "{row}");
        if *family == "array" {
            assert_eq!(results[1], Value::Null, "{row}");
        } else {
            same_value(&results[1], &expected, row);
        }
        same_value(&document.fields["target"], &expected, row);
    }
}
