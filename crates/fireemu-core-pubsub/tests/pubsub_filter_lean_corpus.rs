//! Replays the Lean attribute semantics through the public filter parser and matcher.

use fireemu_core_pubsub::{Code, Filter};
use std::collections::BTreeMap;

const CORPUS: &str = include_str!("fixtures/lean-pubsub-filter.corpus");

fn attribute(category: &str) -> Option<&'static str> {
    match category {
        "absent" => None,
        "empty" => Some(""),
        "blue" => Some("blue"),
        "prefix" => Some("blue-1"),
        "case" => Some("Blue"),
        "unicode" => Some("日本"),
        "quoted" => Some("a\"b\\c"),
        _ => panic!("unknown attribute category: {category}"),
    }
}

fn code_points(text: &str) -> String {
    if text == "-" {
        return String::new();
    }
    text.split(',')
        .map(|point| char::from_u32(point.parse().unwrap()).unwrap())
        .collect()
}

#[test]
fn replay_filter_semantics_and_wire_examples() {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(count, 741);
    assert_eq!(lines.clone().count(), count);
    for line in lines {
        let row = line.split('\t').collect::<Vec<_>>();
        let [left, right, _, matched, wire] = row.as_slice() else {
            panic!("malformed filter row: {line}");
        };
        let wire = code_points(wire);
        let parsed = Filter::parse(&wire);
        if *matched == "invalid" || *matched == "size" {
            let error = parsed.unwrap_err();
            assert_eq!(error.code(), Code::InvalidArgument);
            if *matched == "size" {
                assert_eq!(error.message(), "filter exceeds 256 bytes");
            }
            continue;
        }
        let attrs = [("a", attribute(left)), ("b.with.dot", attribute(right))]
            .into_iter()
            .filter_map(|(key, value)| Some((key.to_owned(), value?.to_owned())))
            .collect::<BTreeMap<_, _>>();
        let parsed = parsed.unwrap();
        assert_eq!(
            parsed.as_str(),
            if wire.trim().is_empty() { "" } else { &wire }
        );
        assert_eq!(parsed.matches(&attrs), *matched == "yes", "{line}");
    }
}
