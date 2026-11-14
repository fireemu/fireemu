//! Bounded in-memory comparison of top-k queries against full sorting and cloned versus borrowed window hashing.

use std::collections::BTreeMap;
use std::hint::black_box;
use std::time::{Duration, Instant};

use fireemu_core_database::hash::{base64, children_hash_without_priority, node_hash};
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

fn borrowed_full_sort<'a>(
    query_without_limit: &QueryParams,
    limit: Option<Limit>,
    node: &'a Node,
) -> Vec<(&'a str, &'a Node)> {
    let mut selected = query_without_limit.run(Some(node));
    match limit {
        None => {}
        Some(Limit::First(n)) => selected.truncate(n as usize),
        Some(Limit::Last(n)) => {
            let skip = selected.len().saturating_sub(n as usize);
            selected.drain(..skip);
        }
    }
    selected
}

fn selected_keys<'a>(items: &[(&'a str, &Node)]) -> Vec<&'a str> {
    items.iter().map(|(key, _)| *key).collect()
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

fn measure_query_paths(
    query: &QueryParams,
    full_sort_query: &QueryParams,
    tree: &Node,
    iterations: usize,
) -> (Duration, Duration, Duration) {
    let mut topk_samples = Vec::with_capacity(5);
    let mut borrowed_samples = Vec::with_capacity(5);
    let mut legacy_samples = Vec::with_capacity(5);
    for sample in 0..5 {
        for offset in 0..3 {
            match (sample + offset) % 3 {
                0 => topk_samples.push(elapsed_per(iterations, || {
                    black_box(query.run(Some(black_box(tree))));
                })),
                1 => borrowed_samples.push(elapsed_per(iterations, || {
                    black_box(borrowed_full_sort(
                        black_box(full_sort_query),
                        query.limit,
                        black_box(tree),
                    ));
                })),
                _ => legacy_samples.push(elapsed_per(iterations, || {
                    black_box(reference_full_sort(black_box(query), black_box(tree)));
                })),
            }
        }
    }
    (
        median(topk_samples),
        median(borrowed_samples),
        median(legacy_samples),
    )
}

fn query_benchmarks() {
    println!("query,siblings,limit,bounds,priority,iterations,topk_ns,borrowed_full_sort_ns,legacy_full_sort_ns");
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
                    let mut full_sort_query = query.clone();
                    full_sort_query.limit = None;
                    let borrowed = borrowed_full_sort(&full_sort_query, query.limit, &tree);
                    assert_eq!(
                        selected_keys(&got),
                        selected_keys(&borrowed),
                        "heap/full-sort mismatch"
                    );
                    assert_eq!(
                        selected_keys(&got),
                        selected_keys(&expected),
                        "candidate/legacy mismatch"
                    );
                    let iterations = (50_000 / size).clamp(5, 500);
                    let (topk, borrowed, legacy) =
                        measure_query_paths(&query, &full_sort_query, &tree, iterations);
                    println!(
                        "query,{size},{limit},{},{},{iterations},{},{},{}",
                        if selective { "selective" } else { "no-bounds" },
                        if string_priorities {
                            "long-string"
                        } else {
                            "number"
                        },
                        topk.as_nanos(),
                        borrowed.as_nanos(),
                        legacy.as_nanos()
                    );
                }
            }
        }
    }
}

fn window_hash_benchmark() {
    println!("window_hash,siblings,depth,iterations,borrowed_ns,clone_reference_ns");
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
            .map(|_| {
                elapsed_per(iterations, || {
                    black_box(old());
                })
            })
            .collect(),
    );
    let borrowed_ns = median(
        (0..5)
            .map(|_| {
                elapsed_per(iterations, || {
                    black_box(borrowed());
                })
            })
            .collect(),
    );
    println!(
        "window_hash,100,8,50,{},{}",
        borrowed_ns.as_nanos(),
        old_ns.as_nanos()
    );
}

// Keep the old formatted leaf allocation as part of the legacy benchmark reference.
#[allow(clippy::format_push_string)]
fn legacy_leaf_hash(value: &str) -> String {
    let mut text = String::new();
    text.push_str(&format!("string:{value}"));
    base64(&legacy_sha1(text.as_bytes()))
}

#[allow(clippy::many_single_char_names)] // RFC 3174 notation copied from the old implementation
fn legacy_sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let mut message = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());
    for block in message.chunks_exact(64) {
        let mut w = [0u32; 80];
        for (i, chunk) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

fn leaf_hash_benchmarks() {
    println!("leaf_hash,value_bytes,iterations,stream_ns,legacy_ns,stream_heap_scratch_bytes,stream_stack_buffer_bytes,legacy_heap_scratch_lower_bound_bytes");
    for value_len in [1_024, 65_536, 1_048_576] {
        let value = "x".repeat(value_len);
        let node = Node::leaf(Leaf::String(value.clone()));
        assert_eq!(node_hash(Some(&node)), legacy_leaf_hash(&value));
        let iterations = (1_000_000 / value_len).clamp(1, 1_000);
        let streamed = median(
            (0..5)
                .map(|_| {
                    elapsed_per(iterations, || {
                        black_box(node_hash(Some(black_box(&node))));
                    })
                })
                .collect(),
        );
        let legacy = median(
            (0..5)
                .map(|_| {
                    elapsed_per(iterations, || {
                        black_box(legacy_leaf_hash(black_box(&value)));
                    })
                })
                .collect(),
        );
        let preimage_len = value_len + "string:".len();
        let padded_len = (preimage_len + 9).div_ceil(64) * 64;
        println!(
            "leaf_hash,{value_len},{iterations},{},{},0,64,{}",
            streamed.as_nanos(),
            legacy.as_nanos(),
            preimage_len + padded_len
        );
    }
}

fn main() {
    query_benchmarks();
    window_hash_benchmark();
    leaf_hash_benchmarks();
}
