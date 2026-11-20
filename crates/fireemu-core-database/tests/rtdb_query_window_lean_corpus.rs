//! Replays Lean's RTDB query boundary and limit reference.

use fireemu_core_database::{
    Content, Json, Leaf, Limits, Node, Number, OrderBy, Path, Priority, QueryParams,
};

const CORPUS: &str = include_str!("fixtures/lean-rtdb-query-window.corpus");

fn number(n: i64) -> Node {
    Node::leaf(Leaf::Number(Number::Int(n)))
}

fn priority(n: i64) -> Priority {
    Priority::Number(Number::Int(n))
}

fn fixture() -> Node {
    let scored_child = || Node {
        content: Content::Children([("score".to_owned(), number(2))].into()),
        priority: None,
    };
    let rows = [
        ("1", number(2).with_priority(Some(priority(2)))),
        ("01", number(2).with_priority(Some(priority(2)))),
        ("2", number(1)),
        ("10", Node::leaf(Leaf::Bool(false))),
        (
            "a",
            Node::leaf(Leaf::Bool(true)).with_priority(Some(priority(1))),
        ),
        (
            "z",
            Node::leaf(Leaf::String("str".into()))
                .with_priority(Some(Priority::String("p".into()))),
        ),
        ("\u{10000}", scored_child().with_priority(Some(priority(3)))),
        ("\u{e000}", scored_child()),
    ];
    Node {
        content: Content::Children(
            rows.into_iter()
                .map(|(name, value)| (name.into(), value))
                .collect(),
        ),
        priority: None,
    }
}

fn query(order: &str, bounds: &str, limit: &str) -> QueryParams {
    let mut query = QueryParams::ordered_by(match order {
        "key" => OrderBy::Key,
        "value" => OrderBy::Value,
        "priority" => OrderBy::Priority,
        "child" => OrderBy::Child(Path::parse("score", &Limits::default()).unwrap()),
        _ => panic!("unknown order {order:?}"),
    });
    let by_key = order == "key";
    let (middle, later) = if by_key {
        (Json::string("01"), Json::string("a"))
    } else {
        (Json::int(2), Json::int(3))
    };
    query = match bounds {
        "none" => query,
        "lowerClosed" => query.start_at(middle, None),
        "lowerOpen" => query.start_after(middle, None),
        "upperClosed" => query.end_at(middle, None),
        "upperOpen" => query.end_before(middle, None),
        "namedSpan" if by_key => query.start_at(middle, None).end_before(later, None),
        "namedSpan" => query
            .start_at(middle.clone(), Some("01"))
            .end_before(middle, Some("\u{10000}")),
        "equal" => query.equal_to(middle, None),
        "reverse" => query.start_at(later, None).end_at(middle, None),
        _ => panic!("unknown bounds {bounds:?}"),
    };
    match limit {
        "none" => query,
        "firstZero" => query.limit_to_first(0),
        "firstTwo" => query.limit_to_first(2),
        "lastTwo" => query.limit_to_last(2),
        "lastAll" => query.limit_to_last(20),
        _ => panic!("unknown limit {limit:?}"),
    }
}

#[test]
fn lean_query_windows_agree_with_core() {
    let root = fixture();
    assert_eq!(CORPUS.lines().count(), 160);
    for line in CORPUS.lines() {
        let fields: Vec<_> = line.split('\t').collect();
        let [order, bounds, limit, expected] = fields.as_slice() else {
            panic!("malformed corpus row {line:?}");
        };
        let query = query(order, bounds, limit);
        query.validate().expect("valid corpus query");
        assert_eq!(
            query
                .run(Some(&root))
                .iter()
                .map(|&(key, _)| key)
                .collect::<Vec<_>>()
                .join(","),
            if *expected == "-" { "" } else { *expected },
            "{line:?}",
        );
        assert!(query.run(None).is_empty());
        assert!(query.run(Some(&number(2))).is_empty());
    }
}
