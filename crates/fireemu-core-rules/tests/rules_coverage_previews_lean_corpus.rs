//! Replays maximal UTF-8 previews and their tags through Rules coverage.

use fireemu_core_rules::ast::Span;
use fireemu_core_rules::coverage::{Coverage, ExprValue, UndefinedCause};
use fireemu_core_rules::value::RulesValue;

const CORPUS: &str = include_str!("fixtures/lean-rules-coverage-previews.corpus");

fn observed(kind: &str, text: String, is_truncated: bool) -> ExprValue {
    let cause = |message| UndefinedCause {
        span: Span {
            offset: 17,
            ..Span::default()
        },
        end: 24,
        message,
    };
    match (kind, is_truncated) {
        ("value", false) => ExprValue::String(text),
        ("value", true) => ExprValue::TruncatedString(text),
        ("cause", false) => ExprValue::Undefined(cause(text)),
        ("cause", true) => ExprValue::TruncatedUndefined(cause(text)),
        _ => panic!("invalid kind {kind}"),
    }
}

fn check_row(row: &str) {
    let columns: Vec<_> = row.split('\t').collect();
    let [width, _, kind, pretag, prefix, kept, bytes, tag] = columns.as_slice() else {
        panic!("invalid fixture row: {row}");
    };
    let scalar = match *width {
        "ascii" => 'Y',
        "two" => 'é',
        "three" => '漢',
        "four" => '🔥',
        _ => panic!("invalid width {width}"),
    };
    let original = format!(
        "{}{scalar}Z",
        "x".repeat(prefix.parse().expect("ASCII count"))
    );
    let retained: String = original
        .chars()
        .take(kept.parse().expect("retained characters"))
        .collect();
    assert_eq!(retained.len(), bytes.parse::<usize>().expect("byte count"));
    let tag = tag.parse::<bool>().expect("result tag");
    let preview = observed(kind, retained.clone(), tag);
    let pretruncated = *pretag == "truncated";
    if *kind == "value" && !pretruncated {
        assert_eq!(
            ExprValue::of(&RulesValue::String(original.clone())),
            preview
        );
    }

    let location = Span::default();
    let end = 1;
    let mut coverage = Coverage::default();
    coverage.record(
        location,
        end,
        observed(kind, original.clone(), pretruncated),
    );
    let mut expected = vec![(preview.clone(), 1)];
    if tag {
        if retained.len() < original.len() {
            coverage.record(
                location,
                end,
                observed(kind, format!("{original}other"), pretruncated),
            );
            expected[0].1 += 1;
        }
        coverage.record(location, end, observed(kind, retained.clone(), false));
        expected.push((observed(kind, retained, false), 1));
    }
    assert_eq!(coverage.entries()[0].values, expected, "{row}");
}

#[test]
fn longest_representable_previews_follow_the_lean_model() {
    let mut lines = CORPUS.lines();
    assert_eq!(lines.next(), Some("# 48 cases"));
    assert_eq!(lines.clone().count(), 48);
    for row in lines {
        check_row(row);
    }
}
