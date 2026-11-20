//! Replay the Lean contract for Realtime Database node hash preimages.

use std::collections::BTreeMap;

use fireemu_core_database::hash::{children_hash_without_priority, etag, node_hash};
use fireemu_core_database::{Content, Leaf, Node, Number, Priority};

const CORPUS: &str = include_str!("fixtures/lean-rtdb-node-hash.corpus");

fn leaf(name: &str) -> Leaf {
    match name {
        "false" => Leaf::Bool(false),
        "true" => Leaf::Bool(true),
        "text" => Leaf::String("a:𐀀😀é".into()),
        "zero" => Leaf::Number(Number::Double(0.0)),
        "minusZero" => Leaf::Number(Number::Double(-0.0)),
        "rounded" => Leaf::Number(Number::Int(9_007_199_254_740_993)),
        "finiteMax" => Leaf::Number(Number::Double(f64::MAX)),
        _ => panic!("unknown payload {name:?}"),
    }
}

fn priority(name: &str) -> Option<Priority> {
    match name {
        "none" => None,
        "numeric" => Some(Priority::Number(Number::Int(7))),
        "text" => Some(Priority::String(":parent:é".into())),
        _ => panic!("unknown priority {name:?}"),
    }
}

fn sample_children(value: Leaf) -> BTreeMap<String, Node> {
    let nested = Node {
        content: Content::Children(BTreeMap::from([(
            "in".into(),
            Node::leaf(Leaf::String("x".repeat(65))),
        )])),
        priority: Some(Box::new(Priority::String("é".into()))),
    };
    BTreeMap::from([
        ("\u{e000}".into(), Node::leaf(Leaf::Bool(false))),
        ("z".into(), nested),
        (
            "2".into(),
            Node::leaf(Leaf::Bool(true)).with_priority(Some(Priority::Number(Number::Int(-3)))),
        ),
        ("𐀀".into(), Node::leaf(Leaf::String("café".into()))),
        ("01".into(), Node::leaf(value)),
    ])
}

#[test]
fn replay_lean_node_hash() {
    assert_eq!(CORPUS.lines().count(), 84);
    for line in CORPUS.lines() {
        let fields: Vec<_> = line.split('\t').collect();
        let [shape, p, v, expected] = fields.as_slice() else {
            panic!("malformed corpus row {line:?}");
        };
        let value = leaf(v);
        let priority = priority(p);
        let actual = match *shape {
            "leaf" => {
                let node = Node::leaf(value).with_priority(priority);
                assert_eq!(etag(Some(&node)), *expected, "{line:?}");
                node_hash(Some(&node))
            }
            "parent" => {
                let node = Node {
                    content: Content::Children(sample_children(value)),
                    priority: priority.map(Box::new),
                };
                node_hash(Some(&node))
            }
            "selection" => {
                let children = sample_children(value);
                children_hash_without_priority(
                    children
                        .iter()
                        .rev()
                        .map(|(key, node)| (key.as_str(), node))
                        .collect(),
                )
            }
            "empty" => {
                assert_eq!(etag(None), "null_etag");
                assert!(children_hash_without_priority(Vec::new()).is_empty());
                node_hash(None)
            }
            _ => panic!("unknown node shape {shape:?}"),
        };
        assert_eq!(
            actual,
            if *expected == "-" { "" } else { *expected },
            "{line:?}"
        );
    }
}
