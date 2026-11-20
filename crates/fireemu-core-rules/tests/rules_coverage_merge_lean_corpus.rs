//! Replays the Lean summary algebra through the public Rules coverage accumulator.

use fireemu_core_rules::ast::Span;
use fireemu_core_rules::coverage::{Coverage, ExprValue};

const CORPUS: &str = include_str!("fixtures/lean-rules-coverage-merge.corpus");
const MAIN: Span = Span {
    line: 1,
    column: 1,
    offset: 0,
};
const OTHER: Span = Span {
    line: 2,
    column: 1,
    offset: 8,
};
const MAIN_END: usize = 4;
const OTHER_END: usize = 10;

fn batch(text: &str) -> Coverage {
    let mut coverage = Coverage::default();
    for value in text.split(',').filter(|part| !part.is_empty()) {
        coverage.record(
            MAIN,
            MAIN_END,
            ExprValue::Int(value.parse().expect("fixture input")),
        );
    }
    coverage
}

fn merged(mut left: Coverage, right: &Coverage) -> Coverage {
    left.merge(right);
    left
}

fn check(coverage: &Coverage, kept: &str, omitted: &str, row: &str) {
    let kept: Vec<_> = kept
        .split(',')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let (key, count) = part.split_once(':').expect("fixture witness");
            (
                ExprValue::Int(key.parse().expect("fixture key")),
                count.parse::<u64>().expect("fixture count"),
            )
        })
        .collect();
    let entries = coverage.trace_entries();
    let entry = entries
        .iter()
        .find(|entry| entry.span == MAIN && entry.end == MAIN_END);
    if kept.is_empty() {
        assert!(entry.is_none(), "{row}");
    } else {
        let entry = entry.expect("expression recorded");
        assert_eq!(entry.values, kept, "{row}");
        assert_eq!(
            entry.omitted,
            omitted.parse::<u64>().expect("fixture omitted"),
            "{row}"
        );
    }
    assert_eq!(
        coverage.omitted_at(MAIN, MAIN_END),
        omitted.parse::<u64>().expect("fixture omitted"),
        "{row}"
    );
    assert_eq!(entries.len(), if kept.is_empty() { 1 } else { 2 }, "{row}");
    let other = entries
        .iter()
        .find(|entry| entry.span == OTHER && entry.end == OTHER_END)
        .expect("separate expression is recorded");
    assert_eq!(other.values, [(ExprValue::Int(900), 1)], "{row}");
    assert_eq!(other.omitted, 0, "{row}");
}

#[test]
fn coverage_results_match_the_lean_model_for_both_associations() {
    let mut rows = CORPUS.lines();
    assert_eq!(rows.next(), Some("# 125 cases"));
    assert_eq!(rows.clone().count(), 125);
    for row in rows {
        let fields: Vec<_> = row.split('\t').collect();
        let [_, _, _, left, middle, right, left_kept, left_omitted, right_kept, right_omitted] =
            fields.as_slice()
        else {
            panic!("invalid fixture row: {row}");
        };
        let mut a = batch(left);
        let b = batch(middle);
        let c = batch(right);
        a.record(OTHER, OTHER_END, ExprValue::Int(900));
        let left_first = merged(merged(a.clone(), &b), &c);
        let right_first = merged(a, &merged(b, &c));
        check(&left_first, left_kept, left_omitted, row);
        check(&right_first, right_kept, right_omitted, row);
    }
}

#[test]
fn aggregate_counts_saturate_for_kept_and_omitted_values() {
    let mut coverage = Coverage::default();
    for value in 0..=64 {
        coverage.record(MAIN, MAIN_END, ExprValue::Int(value));
    }
    // Doubling through merge reaches the saturation boundary without replaying 2^64 events.
    for _ in 0..64 {
        coverage.merge(&coverage.clone());
    }
    let entries = coverage.trace_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].values.len(), 64);
    assert_eq!(entries[0].omitted, u64::MAX);
    assert!(entries[0]
        .values
        .iter()
        .all(|(_, count)| *count == u64::MAX));
}
