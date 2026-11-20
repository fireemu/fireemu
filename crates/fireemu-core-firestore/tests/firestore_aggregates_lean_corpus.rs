//! Compares batched structured aggregations over a fixed-order reference domain.

use std::collections::BTreeMap;

use fireemu_core_firestore::{
    field_path::FieldPath,
    path::DocumentPath,
    query::{Direction, FieldOp, FilterExpr, OrderClause, Query, QueryScope},
    store::{Aggregation, FirestoreState, Write, WriteOp},
    value::Value,
};
use fireemu_core_types::{
    ids::{CollectionId, DatabaseId, ProjectId},
    time::LogicalInstant,
};

fn fp(name: &str) -> FieldPath {
    FieldPath::parse(name).expect("fixture field path")
}

fn entry(text: &str) -> Option<Value> {
    match text {
        "-" => None,
        "null" => Some(Value::Null),
        "text" => Some(Value::String("nonnumeric".to_owned())),
        "nan" => Some(Value::Double(f64::NAN)),
        _ => {
            let (kind, operand) = text.split_at(1);
            Some(match kind {
                "i" => Value::Integer(operand.parse().expect("fixture integer")),
                "d" => Value::Double(f64::from_bits(operand.parse().expect("fixture float bits"))),
                _ => panic!("unknown fixture value {text}"),
            })
        }
    }
}

fn writes(data: &str) -> Vec<Write> {
    if data == "-" {
        return Vec::new();
    }
    let project = ProjectId::try_new("demo-aggregate").expect("fixture project");
    let database = DatabaseId::default_database();
    data.split(';')
        .enumerate()
        .map(|(index, text)| {
            let parts: Vec<_> = text.split(':').collect();
            let [visible, rank, x, y] = parts.as_slice() else {
                panic!("invalid fixture document");
            };
            let mut fields = BTreeMap::from([(
                "visible".to_owned(),
                Value::Boolean(visible.parse().expect("visible field")),
            )]);
            if *rank == "true" {
                fields.insert(
                    "rank".to_owned(),
                    Value::Integer(index.try_into().expect("fixture rank")),
                );
            }
            for (name, value) in [("x", x), ("y", y)] {
                if let Some(value) = entry(value) {
                    fields.insert(name.to_owned(), value);
                }
            }
            let path = DocumentPath::parse(&project, &database, &format!("sample/doc{index:02}"))
                .expect("fixture document path");
            Write {
                op: WriteOp::Set {
                    path,
                    fields,
                    update_mask: None,
                },
                precondition: None,
                transforms: Vec::new(),
            }
        })
        .collect()
}

#[test]
fn structured_aggregations_match_lean_corpus() {
    let mut rows = include_str!("fixtures/lean-firestore-aggregates.corpus").lines();
    let count = rows
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases."))
        .expect("fixture count")
        .parse::<usize>()
        .expect("numeric case count");
    assert_eq!(count, 324);
    assert_eq!(rows.clone().count(), count);

    for row in rows {
        let cols: Vec<_> = row.split('\t').collect();
        let [dataset, targets, cap, window, order, records, results] = cols.as_slice() else {
            panic!("invalid aggregation fixture row");
        };
        let label = format!("{dataset}/{targets}/{cap}/{window}/{order}");
        let mut state = FirestoreState::new();
        let writes = writes(records);
        if !writes.is_empty() {
            state
                .commit(&writes, None, LogicalInstant::from_unix_seconds(500))
                .expect("seed fixture documents");
        }
        let mut query = Query::new(QueryScope::collection(
            None,
            CollectionId::try_new("sample").expect("fixture collection"),
        ))
        .with_filter(FilterExpr::Field {
            field: fp("visible"),
            op: FieldOp::Equal,
            value: Value::Boolean(true),
        });
        if *order == "rank" {
            query = query.with_order(OrderClause {
                field: fp("rank"),
                direction: Direction::Ascending,
            });
        }
        match *window {
            "all" => {}
            "skip-take" => {
                query.offset = 1;
                query.limit = Some(2);
            }
            "empty" => query.limit = Some(0),
            _ => panic!("invalid fixture window"),
        }
        let up_to = match *cap {
            "none" => None,
            "zero" => Some(0),
            "two" => Some(2),
            _ => panic!("invalid fixture count cap"),
        };
        let mut operations = vec![Aggregation::Count { up_to }];
        match *targets {
            "count" => {}
            "x" | "xy" => {
                operations.push(Aggregation::Sum(fp("x")));
                operations.push(Aggregation::Avg(fp("x")));
                if *targets == "xy" {
                    operations.push(Aggregation::Sum(fp("y")));
                    operations.push(Aggregation::Avg(fp("y")));
                }
            }
            _ => panic!("invalid fixture aggregate target"),
        }
        let output = state
            .run_aggregation(&query, &operations, None)
            .expect("fixture aggregation");
        let expected: Vec<_> = results
            .split(',')
            .map(|result| entry(result).expect("fixture aggregate"))
            .collect();
        assert_eq!(output.len(), expected.len(), "{label}");
        for (actual, expected) in output.iter().zip(&expected) {
            match (actual, expected) {
                (Value::Double(actual), Value::Double(expected)) if expected.is_nan() => {
                    assert!(actual.is_nan(), "{label}: expected NaN, got {actual}");
                }
                (Value::Double(actual), Value::Double(expected)) => {
                    assert_eq!(actual.to_bits(), expected.to_bits(), "{label}");
                }
                _ => assert_eq!(actual, expected, "{label}"),
            }
        }
    }
}
