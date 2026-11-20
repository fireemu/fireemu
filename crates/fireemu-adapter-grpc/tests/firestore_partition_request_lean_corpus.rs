//! Replays shape and refusal precedence for canonical partition queries.

use fireemu_adapter_grpc::partition::check_query;
use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::query::{Cursor, Direction, OrderClause, Query, QueryScope};
use fireemu_core_types::ids::CollectionId;

const CORPUS: &str = include_str!("fixtures/lean-firestore-partition-request.corpus");

fn flag(cell: &str) -> bool {
    match cell {
        "on" => true,
        "off" => false,
        _ => panic!("invalid fixture flag {cell}"),
    }
}

#[test]
fn canonical_partition_shape_matches_lean() {
    let mut rows = CORPUS.lines();
    assert_eq!(
        rows.next(),
        Some("# scope|strict|limit|offset|projection|start|finish|ordered|result")
    );
    assert_eq!(rows.clone().count(), 512);
    for row in rows {
        let [scope, strict, limit, offset, projection, start, finish, ordered, expected]: [&str;
            9] = row.split('|').collect::<Vec<_>>().try_into().unwrap();
        let id = || CollectionId::try_new("items").unwrap();
        let scope = match scope {
            "collection" => QueryScope::collection(None, id()),
            "group" => QueryScope::collection_group(id()),
            "kindless" => QueryScope::KindlessAllDescendants { parent: None },
            "children" => QueryScope::KindlessChildren { parent: None },
            _ => panic!("invalid fixture scope {scope}"),
        };
        let cursor = || Cursor {
            values: Vec::new(),
            before: false,
        };
        let query = Query {
            scope,
            filter: None,
            order_by: if flag(ordered) {
                vec![OrderClause {
                    field: FieldPath::parse("__name__").unwrap(),
                    direction: Direction::Ascending,
                }]
            } else {
                Vec::new()
            },
            start_at: flag(start).then(cursor),
            end_at: flag(finish).then(cursor),
            offset: u32::from(flag(offset)),
            limit: flag(limit).then_some(1),
            projection: flag(projection).then(Vec::new),
            find_nearest: None,
            production_refusals: flag(strict),
        };
        let expected = match expected {
            "split" => Ok(true),
            "no-split" => Ok(false),
            message => Err(message),
        };
        assert_eq!(check_query(&query), expected, "{row}");
    }
}
