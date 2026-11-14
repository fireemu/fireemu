//! Bounded in-memory comparison of top-k queries against full sorting and cloned versus borrowed window hashing.

use std::collections::BTreeMap;
use std::hint::black_box;
use std::time::{Duration, Instant};

use fireemu_core_database::hash::{children_hash_without_priority, node_hash};
use fireemu_core_database::key::name_compare;
use fireemu_core_database::{
    Bound, BoundKey, Content, Json, Leaf, Limit, Node, Number, OrderBy, Priority, QueryParams,
};

fn priority_label(index: usize) -> String {
    format!("priority-with-a-long-shared-prefix-{index:05}")
}

fn flat_tree(size: usize, string_priorities: bool) -> Node {
    let children = (0..size)
        .map(|index| {
            let key = format!("child-{index:05}");
            let number = Number::Int(i64::try_from(index % 100).unwrap());
            let value = Node {
                content: Content::Leaf(Leaf::Number(number)),
                priority: Some(Box::new(if string_priorities {
                    Priority::String(priority_label(index % 100))
                } else {
                    Priority::Number(number)
                })),
            };
            (key, value)
        })
        .collect();
    Node {
        content: Content::Children(children),
        priority: None,
    }
}

fn deep_leaf(depth: usize, value: &str) -> Node {
    let mut node = Node::leaf(Leaf::String(value.to_owned()));
    for index in 0..depth {
        node = Node {
            content: Content::Children(BTreeMap::from([(format!("level-{index}"), node)])),
            priority: None,
        };
    }
    node
}

fn legacy_priority(node: &Node) -> Option<Leaf> {
    node.priority.as_deref().map(Priority::as_leaf)
}

fn legacy_bound(value: &Json) -> Option<Leaf> {
    match value {
        Json::Bool(value) => Some(Leaf::Bool(*value)),
        Json::Number(value) => Some(Leaf::Number(*value)),
        Json::String(value) => Some(Leaf::String(value.clone())),
        Json::Null | Json::Array(_) | Json::Object(_) => None,
    }
}

fn legacy_value_cmp(left: Option<&Leaf>, right: Option<&Leaf>) -> std::cmp::Ordering {
    match (left, right) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(_), None) => std::cmp::Ordering::Greater,
        (Some(left), Some(right)) => left.value_cmp(right),
    }
}

fn legacy_compare_children(
    left_key: &str,
    left: &Node,
    right_key: &str,
    right: &Node,
) -> std::cmp::Ordering {
    legacy_value_cmp(
        legacy_priority(left).as_ref(),
        legacy_priority(right).as_ref(),
    )
    .then_with(|| name_compare(left_key, right_key))
}

fn legacy_compare_to_bound(key: &str, child: &Node, bound: &Bound) -> std::cmp::Ordering {
    legacy_value_cmp(
        legacy_priority(child).as_ref(),
        legacy_bound(&bound.value).as_ref(),
    )
    .then_with(|| match &bound.key {
        BoundKey::Min => std::cmp::Ordering::Greater,
        BoundKey::Max => std::cmp::Ordering::Less,
        BoundKey::Name(name) => name_compare(key, name),
    })
}

fn legacy_in_range(query: &QueryParams, key: &str, child: &Node) -> bool {
    let after_start = query.start.as_ref().is_none_or(|bound| {
        let ordering = legacy_compare_to_bound(key, child, bound);
        ordering == std::cmp::Ordering::Greater
            || (ordering == std::cmp::Ordering::Equal && bound.inclusive)
    });
    let before_end = query.end.as_ref().is_none_or(|bound| {
        let ordering = legacy_compare_to_bound(key, child, bound);
        ordering == std::cmp::Ordering::Less
            || (ordering == std::cmp::Ordering::Equal && bound.inclusive)
    });
    after_start && before_end
}

fn reference_full_sort<'a>(query: &QueryParams, node: &'a Node) -> Vec<(&'a str, &'a Node)> {
    let Some(Content::Children(children)) = Some(&node.content) else {
        return Vec::new();
    };
    let mut selected: Vec<_> = children
        .iter()
        .map(|(key, child)| (key.as_str(), child))
        .filter(|(key, child)| legacy_in_range(query, key, child))
        .collect();
    selected.sort_by(|(ka, a), (kb, b)| legacy_compare_children(ka, a, kb, b));
    match query.limit {
        None => {}
        Some(Limit::First(n)) => selected.truncate(n as usize),
        Some(Limit::Last(n)) => {
            let skip = selected.len().saturating_sub(n as usize);
            selected.drain(..skip);
        }
    }
    selected
}

fn elapsed_per(iterations: usize, mut run: impl FnMut()) -> Duration {
    let start = Instant::now();
    for _ in 0..iterations {
        run();
    }
    start.elapsed() / u32::try_from(iterations).unwrap()
}

fn median(mut values: Vec<Duration>) -> Duration {
    values.sort_unstable();
    values[values.len() / 2]
}

fn query_benchmarks() {
    for size in [100, 1_000, 10_000] {
        for string_priorities in [false, true] {
            let tree = flat_tree(size, string_priorities);
            for limit in [1, 10, 100, u32::MAX] {
                for selective in [false, true] {
                    let query = if selective {
                        let lower = if string_priorities {
                            Json::string(priority_label(45))
                        } else {
                            Json::int(45)
                        };
                        let upper = if string_priorities {
                            Json::string(priority_label(55))
                        } else {
                            Json::int(55)
                        };
                        QueryParams::ordered_by(OrderBy::Priority)
                            .start_at(lower, None)
                            .end_at(upper, None)
                    } else {
                        QueryParams::ordered_by(OrderBy::Priority)
                    }
                    .limit_to_first(limit);
                    let expected = reference_full_sort(&query, &tree);
                    let got = query.run(Some(&tree));
                    assert_eq!(
                        got.iter().map(|(key, _)| *key).collect::<Vec<_>>(),
                        expected.iter().map(|(key, _)| *key).collect::<Vec<_>>()
                    );
                    let iterations = (50_000 / size).clamp(5, 500);
                    let candidate = median(
                        (0..5)
                            .map(|_| {
                                elapsed_per(iterations, || {
                                    black_box(query.run(Some(black_box(&tree))));
                                })
                            })
                            .collect(),
                    );
                    let baseline = median(
                        (0..5)
                            .map(|_| {
                                elapsed_per(iterations, || {
                                    black_box(reference_full_sort(&query, black_box(&tree)));
                                })
                            })
                            .collect(),
                    );
                    println!(
                        "query,{size},{limit},{},{},{iterations},{},{}",
                        if selective { "selective" } else { "no-bounds" },
                        if string_priorities {
                            "long-string"
                        } else {
                            "number"
                        },
                        candidate.as_nanos(),
                        baseline.as_nanos()
                    );
                }
            }
        }
    }
}

fn window_hash_benchmark() {
    let tree = Node {
        content: Content::Children(
            (0..100)
                .map(|index| (format!("child-{index:03}"), deep_leaf(8, "deep 😀 value")))
                .collect(),
        ),
        priority: None,
    };
    let selected: Vec<_> = match &tree.content {
        Content::Children(children) => children
            .iter()
            .map(|(key, child)| (key.as_str(), child))
            .collect(),
        Content::Leaf(_) => unreachable!(),
    };
    let old = || {
        node_hash(Some(&Node {
            content: Content::Children(
                selected
                    .iter()
                    .map(|(key, child)| ((*key).to_owned(), (*child).clone()))
                    .collect(),
            ),
            priority: None,
        }))
    };
    let borrowed = || children_hash_without_priority(selected.clone());
    assert_eq!(old(), borrowed());
    let iterations = 50;
    let old_ns = median(
        (0..5)
            .map(|_| elapsed_per(iterations, || {
                black_box(old());
            }))
            .collect(),
    );
    let borrowed_ns = median(
        (0..5)
            .map(|_| elapsed_per(iterations, || {
                black_box(borrowed());
            }))
            .collect(),
    );
    println!(
        "window_hash,100,100,deep,none,50,{},{}",
        borrowed_ns.as_nanos(),
        old_ns.as_nanos()
    );
}

fn main() {
    println!("kind,siblings,limit,bounds,priority,iterations,candidate_ns,full_sort_ns");
    query_benchmarks();
    window_hash_benchmark();
}
