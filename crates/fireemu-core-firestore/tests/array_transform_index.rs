//! Indexed array transforms preserve the order and stored representations of values.

use std::collections::BTreeMap;

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_firestore::store::{
    FieldTransform, FirestoreState, TransformKind, Write, WriteOp,
};
use fireemu_core_firestore::value::{Timestamp, Value};
use fireemu_core_types::ids::{DatabaseId, ProjectId};
use fireemu_core_types::time::LogicalInstant;

fn nested(seconds: i64, nanos: u32) -> Value {
    Value::Map(BTreeMap::from([(
        "t".into(),
        Value::Timestamp(Timestamp::new(seconds, nanos).unwrap()),
    )]))
}

fn apply(initial: Vec<Value>, operation: TransformKind) -> Vec<Value> {
    let path = DocumentPath::parse(
        &ProjectId::try_new("demo-transform").unwrap(),
        &DatabaseId::default_database(),
        "items/test",
    )
    .unwrap();
    let mut store = FirestoreState::new();
    store
        .commit(
            &[Write {
                op: WriteOp::Set {
                    path: path.clone(),
                    fields: BTreeMap::from([("values".into(), Value::Array(initial))]),
                    update_mask: None,
                },
                precondition: None,
                transforms: Vec::new(),
            }],
            None,
            LogicalInstant::from_unix_seconds(1),
        )
        .unwrap();
    let result = store
        .commit(
            &[Write {
                op: WriteOp::Set {
                    path: path.clone(),
                    fields: BTreeMap::new(),
                    update_mask: Some(Vec::new()),
                },
                precondition: None,
                transforms: vec![FieldTransform {
                    field: FieldPath::parse("values").unwrap(),
                    kind: operation,
                }],
            }],
            None,
            LogicalInstant::from_unix_seconds(2),
        )
        .unwrap();
    assert_eq!(result.write_results[0].transform_results, [Value::Null]);
    let Value::Array(values) = &store.get(&path).unwrap().fields["values"] else {
        panic!("expected stored values array");
    };
    values.clone()
}

fn input() -> Vec<Value> {
    let mut initial = vec![Value::Integer(1), Value::Double(1.0)];
    initial.extend((0..128).map(|seconds| nested(seconds, 456)));
    initial
}

fn assert_stored(actual: &[Value], expected: &[Value]) {
    assert_eq!(actual.len(), expected.len());
    for (i, (a, b)) in actual.iter().zip(expected).enumerate() {
        assert!(a.stored_eq(b), "at {i}: {a:?} != {b:?}");
    }
}

#[test]
fn indexed_union_keeps_old_duplicates_and_first_new_representation() {
    let mut operands: Vec<_> = (64..160).map(|seconds| nested(seconds, 999)).collect();
    operands.extend([Value::Double(1.0), Value::Double(-0.0), Value::Integer(0)]);
    let mut expected: Vec<_> = input();
    expected.iter_mut().for_each(Value::normalize_for_storage);
    expected.extend((128..160).map(|seconds| nested(seconds, 0)));
    expected.push(Value::Double(-0.0));
    assert_stored(
        &apply(input(), TransformKind::AppendMissingElements(operands)),
        &expected,
    );
}

#[test]
fn indexed_removal_discards_all_equal_values_without_reordering_survivors() {
    let mut operands: Vec<_> = (16..144)
        .step_by(2)
        .map(|seconds| nested(seconds, 999))
        .collect();
    operands.push(Value::Double(1.0));
    let expected: Vec<_> = (0..128)
        .filter(|seconds| *seconds < 16 || seconds % 2 != 0)
        .map(|seconds| nested(seconds, 0))
        .collect();
    assert_stored(
        &apply(input(), TransformKind::RemoveAllFromArray(operands)),
        &expected,
    );
}
