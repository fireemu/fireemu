//! Replay the Lean cursor-order specification through the public query and store APIs.

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_firestore::query::{
    Cursor, Direction, FieldOp, FilterExpr, OrderClause, Query, QueryError, QueryScope,
};
use fireemu_core_firestore::store::{FirestoreState, Write, WriteOp};
use fireemu_core_firestore::value::Value;
use fireemu_core_types::ids::{CollectionId, DatabaseId, ProjectId};
use fireemu_core_types::time::LogicalInstant;
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-cursor-order.corpus");
const PATHS: [&str; 6] = [
    "p/a/items/z",
    "p/a!/items/z",
    "items/a",
    "items/b",
    "items/c",
    "items/d",
];

fn path(relative: &str) -> DocumentPath {
    DocumentPath::parse(
        &ProjectId::try_new("demo-app").unwrap(),
        &DatabaseId::default_database(),
        relative,
    )
    .unwrap()
}

fn database(numbers: [i64; 4]) -> FirestoreState {
    let rows = [
        (Some(Value::Integer(numbers[0])), 1, 1),
        (Some(Value::Integer(numbers[1])), 1, 1),
        (Some(Value::String("x".into())), 0, 1),
        (None, 0, 2),
        (Some(Value::Null), -1, 0),
        (Some(Value::Integer(numbers[2])), numbers[3], 0),
    ];
    let writes: Vec<_> = PATHS
        .iter()
        .zip(rows)
        .map(|(p, (a, b, c))| {
            let mut fields = std::collections::BTreeMap::from([
                ("b".into(), Value::Integer(b)),
                ("c".into(), Value::Integer(c)),
            ]);
            if let Some(a) = a {
                fields.insert("a".into(), a);
            }
            Write {
                op: WriteOp::Set {
                    path: path(p),
                    fields,
                    update_mask: None,
                },
                precondition: None,
                transforms: vec![],
            }
        })
        .collect();
    let mut db = FirestoreState::new();
    db.commit(&writes, None, LogicalInstant::UNIX_EPOCH)
        .unwrap();
    db
}

fn field(id: &str) -> FieldPath {
    FieldPath::parse(match id {
        "0" => "__name__",
        "1" => "a",
        "2" => "b",
        "3" => "c",
        _ => panic!("field {id}"),
    })
    .unwrap()
}

fn order(text: &str) -> Vec<OrderClause> {
    text.split_terminator(',')
        .map(|s| {
            let (id, sign) = s.split_at(1);
            OrderClause {
                field: field(id),
                direction: match sign {
                    "+" => Direction::Ascending,
                    "-" => Direction::Descending,
                    _ => panic!("sign {sign}"),
                },
            }
        })
        .collect()
}

fn values(text: &str) -> Vec<Value> {
    text.split_terminator(',')
        .map(|s| match s {
            "null" => Value::Null,
            "x" => Value::String(s.into()),
            _ => s.strip_prefix('@').map_or_else(
                || Value::Integer(s.parse().unwrap()),
                |r| Value::Reference(r.into()),
            ),
        })
        .collect()
}

fn query(clauses: Vec<OrderClause>) -> Query {
    let mut q = Query::new(QueryScope::collection_group(
        CollectionId::try_new("items").unwrap(),
    ));
    q.order_by = clauses;
    q
}

fn refusal(result: Result<Query, QueryError>) -> &'static str {
    match result {
        Ok(_) => "ok",
        Err(QueryError::DuplicateOrderField { .. }) => "duplicate",
        Err(QueryError::OrderAfterDocumentName) => "afterName",
        Err(QueryError::CursorArityMismatch { .. }) => "arity",
        Err(e) => panic!("unexpected refusal {e:?}"),
    }
}

fn results(db: &FirestoreState, q: &Query) -> Vec<String> {
    db.run_query(q, Some(db.current_version()))
        .unwrap()
        .into_iter()
        .map(|d| d.path.relative())
        .collect()
}

fn bounded(q: &Query, cursor: Cursor, start: bool) -> Query {
    let mut q = q.clone();
    if start {
        q.start_at = Some(cursor);
    } else {
        q.end_at = Some(cursor);
    }
    q
}

#[test]
fn replay_cursor_order_corpus() {
    let db = database([2, 2, 2, 2]);
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .strip_suffix(" cases.")
        .unwrap()
        .parse()
        .unwrap();
    assert!(count >= 200);
    assert_eq!(lines.clone().count(), count);
    for line in lines {
        let parts: Vec<_> = line.split('|').collect();
        let [explicit, ineq, effective, bound, position, prod, emu, expected]: [&str; 8] =
            parts.try_into().unwrap();
        let mut q = query(order(explicit));
        if !ineq.is_empty() {
            q.filter = Some(FilterExpr::And(
                ineq.split(',')
                    .rev()
                    .map(|f| FilterExpr::Field {
                        field: field(f),
                        op: FieldOp::GreaterThan,
                        value: Value::Integer(-1),
                    })
                    .collect(),
            ));
        }
        assert_eq!(q.effective_order_by(), order(effective), "{line}");
        let (start, before) = match bound {
            "SA" => (true, true),
            "SX" => (true, false),
            "EA" => (false, false),
            "EX" => (false, true),
            _ => panic!("{line}"),
        };
        let q = bounded(
            &q,
            Cursor {
                values: values(position),
                before,
            },
            start,
        );
        assert_eq!(refusal(q.canonicalize()), prod, "{line}");
        let canonical = q.canonicalize_emulator();
        assert_eq!(refusal(canonical.clone()), emu, "{line}");
        let Ok(q) = canonical else {
            assert_eq!(expected, "!");
            continue;
        };
        let rows: Vec<_> = expected
            .split_terminator(';')
            .map(|s| s.split_once('=').unwrap())
            .collect();
        let paths: Vec<_> = rows.iter().map(|(p, _)| *p).collect();
        assert_eq!(results(&db, &q), paths, "{line}");
        for p in PATHS {
            let expected = rows
                .iter()
                .find(|(name, _)| *name == p)
                .map(|(_, vs)| Cursor {
                    values: values(vs),
                    before: false,
                });
            assert_eq!(
                db.cursor_after_document(&q, Some(db.current_version()), &path(p))
                    .unwrap(),
                expected,
                "{p}: {line}"
            );
        }
    }
}

#[test]
fn duplicate_orders_and_orders_after_name_retain_their_raw_clauses() {
    let duplicate = query(order("1+,1-"));
    assert_eq!(duplicate.effective_order_by(), order("1+,1-,0-"));
    assert_eq!(refusal(duplicate.canonicalize()), "duplicate");
    assert_eq!(refusal(duplicate.canonicalize_emulator()), "ok");
    let repeated_name = query(order("0-,0+"));
    assert_eq!(repeated_name.effective_order_by(), order("0-,0+"));
    assert_eq!(refusal(repeated_name.canonicalize()), "duplicate");
    assert_eq!(refusal(repeated_name.canonicalize_emulator()), "afterName");
    let early = query(order("0+,1-"));
    assert_eq!(early.effective_order_by(), order("0+,1-"));
    assert_eq!(refusal(early.canonicalize_emulator()), "afterName");
}

#[test]
fn a_full_document_cursor_can_exceed_the_production_explicit_arity() {
    let db = database([2, 2, 2, 2]);
    let q = query(vec![]);
    let cursor = db
        .cursor_after_document(&q, None, &path(PATHS[0]))
        .unwrap()
        .unwrap();
    let paged = bounded(&q, cursor, true);
    assert_eq!(refusal(paged.canonicalize()), "arity");
    assert_eq!(refusal(paged.canonicalize_emulator()), "ok");
}

proptest! {
    #[test]
    fn ordering_and_cursor_laws(
        numbers in prop::array::uniform4(-3i64..4),
        dirs in prop::collection::vec(any::<bool>(),0..=3),
        explicit_name in any::<bool>(), name_desc in any::<bool>(),
        pivot in any::<usize>(), length in any::<usize>(),
    ) {
        let db = database(numbers);
        let mut clauses: Vec<_> = dirs
            .iter()
            .enumerate()
            .map(|(i, &descending)| OrderClause {
                field: field(&(i + 1).to_string()),
                direction: if descending {
                    Direction::Descending
                } else {
                    Direction::Ascending
                },
            })
            .collect();
        if explicit_name {
            clauses.push(OrderClause {
                field: field("0"),
                direction: if name_desc {
                    Direction::Descending
                } else {
                    Direction::Ascending
                },
            });
        }
        let q = query(clauses);
        let effective = q.effective_order_by();
        let last = effective.last().unwrap();
        prop_assert!(last.field.is_document_name());
        prop_assert_eq!(
            last.direction,
            q.order_by
                .last()
                .map_or(Direction::Ascending, |c| c.direction)
        );
        let distinct: std::collections::BTreeSet<_> = effective.iter().map(|c| &c.field).collect();
        prop_assert_eq!(distinct.len(), effective.len());
        let sorted = results(&db, &q);
        let mut reversed = query(effective.clone());
        for c in &mut reversed.order_by {
            c.direction = match c.direction {
                Direction::Ascending => Direction::Descending,
                Direction::Descending => Direction::Ascending,
            };
        }
        prop_assert_eq!(
            results(&db, &reversed),
            sorted.iter().rev().cloned().collect::<Vec<_>>()
        );
        for (i, p) in sorted.iter().enumerate() {
            let full = db
                .cursor_after_document(&q, None, &path(p))
                .unwrap()
                .unwrap();
            prop_assert!(!full.before);
            prop_assert_eq!(full.values.len(), effective.len());
            let after = results(&db, &bounded(&q, full.clone(), true));
            prop_assert_eq!(after.as_slice(), &sorted[i + 1..]);
            let at = results(
                &db,
                &bounded(
                    &q,
                    Cursor {
                        before: true,
                        ..full
                    },
                    true,
                ),
            );
            prop_assert_eq!(at.as_slice(), &sorted[i..]);
        }
        let p = &sorted[pivot % sorted.len()];
        let mut cursor = db
            .cursor_after_document(&q, None, &path(p))
            .unwrap()
            .unwrap();
        let n = length % (effective.len() + 1);
        cursor.values.truncate(n);
        // Preserve eligibility: dropping order clauses can bring missing-field documents back.
        let prefix = query(effective[..n].to_vec());
        for before in [true, false] {
            cursor.before = before;
            let start = results(&db, &bounded(&q, cursor.clone(), true));
            let end = results(&db, &bounded(&q, cursor.clone(), false));
            let prefix_start = results(&db, &bounded(&prefix, cursor.clone(), true));
            for doc in &sorted {
                prop_assert_eq!(start.contains(doc), !end.contains(doc));
                prop_assert_eq!(start.contains(doc), prefix_start.contains(doc));
            }
        }
    }
}
