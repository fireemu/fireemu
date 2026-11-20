//! Replays concrete UTF-16 index and slicing semantics through Rules compilation and evaluation.

use std::fmt::Write as _;

use fireemu_core_rules::ast::LoneSurrogates;
use fireemu_core_rules::coverage::ExprValue;
use fireemu_core_rules::eval::{
    evaluate_request_traced, Decision, DenyReason, Method, RequestContext, RulesService,
};
use fireemu_core_rules::runtime::LoadedRules;

const CORPUS: &str = include_str!("fixtures/lean-rules-utf16-slices.corpus");

fn units(csv: &str) -> Vec<u16> {
    if csv.is_empty() {
        return Vec::new();
    }
    csv.split(',')
        .map(|u| u.parse().expect("UTF-16 unit"))
        .collect()
}

fn literal(units: &[u16]) -> String {
    let mut text = String::from("\"");
    for unit in units {
        write!(&mut text, "\\u{unit:04x}").expect("writing to a string");
    }
    text.push('"');
    text
}

fn check_row(row: &str, context: &RequestContext) {
    let columns: Vec<_> = row.split('\t').collect();
    let [profile, _, operation, _, lo, hi, input, outcome] = columns.as_slice() else {
        panic!("invalid fixture row: {row}");
    };
    let mode = match *profile {
        "production" => LoneSurrogates::Production,
        "official" => LoneSurrogates::Official,
        other => panic!("unknown profile {other}"),
    };
    let input = literal(&units(input));
    let selected = match *operation {
        "index" => format!("{input}[{lo}]"),
        "slice" => format!("{input}[{lo}:{hi}]"),
        other => panic!("unknown operation {other}"),
    };
    let (condition, error) = if let Some(raw) = outcome.strip_prefix("text:") {
        let expected = units(raw);
        (
            format!(
                "{selected} == {} && {selected}.size() == {}",
                literal(&expected),
                expected.len()
            ),
            None,
        )
    } else if let Some(raw) = outcome.strip_prefix("fragment:") {
        let unit = raw.parse::<u16>().expect("fragment UTF-16 unit");
        let (pair, index) = match unit {
            0xd800..=0xdbff => ([unit, 0xdc00], 0),
            0xdc00..=0xdfff => ([0xd800, unit], 1),
            _ => panic!("invalid fragment {unit}"),
        };
        (
            format!(
                "{selected} == {}[{index}] && {selected} != {} && {selected} != {} && {selected}.size() == 1",
                literal(&pair),
                literal(&[unit]),
                literal(&[0xfffd])
            ),
            None,
        )
    } else {
        let message = match *outcome {
            "invalidIndex" => "string index out of range".to_owned(),
            "invalidRange" => format!("range index [{lo}:{hi}] is out of range"),
            "cutPair" => "a range cuts a surrogate pair".to_owned(),
            other => panic!("unknown outcome {other}"),
        };
        (format!("!({selected} == \"\")"), Some(message))
    };
    let source = format!(
        "service cloud.firestore {{ match /databases/{{db}}/documents/items/{{id}} {{ allow get: if {condition}; }} }}"
    );
    let loaded = LoadedRules::from_source(&source)
        .unwrap_or_else(|error| panic!("{row}: {source}: {error:?}"))
        .with_lone_surrogates(mode);
    let (report, coverage) = evaluate_request_traced(
        loaded.ruleset.as_deref().expect("loaded ruleset"),
        context,
        None,
    );
    if let Some(error) = error {
        assert_eq!(
            report.decision,
            Decision::Deny(DenyReason::NoMatchingAllow),
            "{row}"
        );
        assert!(
            coverage.entries().iter().flat_map(|entry| &entry.values).any(
                |(value, _)| matches!(value, ExprValue::Undefined(cause) if cause.message == error)
            ),
            "{row}: {source}: {coverage:?}"
        );
    } else {
        assert_eq!(report.decision, Decision::Allow, "{row}: {source}");
    }
}

#[test]
fn concrete_utf16_selections_match_the_lean_model() {
    let mut rows = CORPUS.lines();
    assert_eq!(rows.next(), Some("# 384 cases"));
    assert_eq!(rows.clone().count(), 384);
    let context = RequestContext {
        service: RulesService::Firestore,
        method: Method::Get,
        path: "/databases/(default)/documents/items/example".into(),
        auth: None,
        resource: None,
        request_resource: None,
        request_query: None,
        time_unix_nanos: 0,
        abstract_path: false,
    };
    for row in rows {
        check_row(row, &context);
    }
}
