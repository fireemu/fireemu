//! Replays lexical declaration resolution through parsed Rules and the evaluator.

use fireemu_core_rules::coverage::ExprValue;
use fireemu_core_rules::eval::{
    evaluate_request_traced, Decision, DenyReason, Method, RequestContext, RulesService,
};
use fireemu_core_rules::runtime::LoadedRules;

const CORPUS: &str = include_str!("fixtures/lean-rules-lexical-functions.corpus");

fn declarations(shape: &str, base: i64) -> String {
    match shape {
        "absent" => String::new(),
        "single" => format!("function pick() {{ return {base}; }}"),
        "duplicate" => format!(
            "function pick() {{ return {base}; }} function pick() {{ return {}; }}",
            base + 1
        ),
        "other" => format!("function unrelated() {{ return {base}; }}"),
        _ => panic!("invalid shape {shape}"),
    }
}

fn check(row: &str, context: &RequestContext) {
    let columns: Vec<_> = row.split('\t').collect();
    let [outer, inner, call, sibling, expected] = columns.as_slice() else {
        panic!("invalid fixture row: {row}");
    };
    let sibling = match *sibling {
        "present" => "match /shadow/{id} { function pick() { return 30; } }",
        "absent" => "",
        _ => panic!("invalid sibling {sibling}"),
    };
    let callee = match *call {
        "direct" => "pick",
        "wrapper" => "wrapper",
        _ => panic!("invalid call {call}"),
    };
    let missing = *expected == "missing";
    let compared = if missing || *expected == "duplicate" {
        "0"
    } else {
        *expected
    };
    let source = format!(
        "service cloud.firestore {{
            match /databases/{{db}}/documents {{
                function wrapper() {{ return pick(); }}
                {} {sibling}
                match /items/{{id}} {{
                    {}
                    allow get: if {callee}() == {compared};
                }}
            }}
        }}",
        declarations(outer, 10),
        declarations(inner, 20)
    );
    let result = LoadedRules::from_source(&source);
    if *expected == "duplicate" {
        let Err(error) = result else {
            panic!("duplicate name accepted: {row}");
        };
        assert_eq!(error.message, "Function pick is already defined.", "{row}");
        return;
    }
    let rules = result.unwrap_or_else(|error| panic!("{row}: {error:?}"));
    let (report, coverage) =
        evaluate_request_traced(rules.ruleset.as_deref().unwrap(), context, None);
    if missing {
        assert_eq!(
            report.decision,
            Decision::Deny(DenyReason::NoMatchingAllow),
            "{row}"
        );
        assert!(coverage.entries().iter().flat_map(|entry| &entry.values).any(
            |(value, _)| matches!(value, ExprValue::Undefined(cause) if cause.message == "unknown function pick")
        ), "{row}: {coverage:?}");
    } else {
        assert_eq!(report.decision, Decision::Allow, "{row}");
    }
}

#[test]
fn lexical_function_selection_follows_lean() {
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
    let mut lines = CORPUS.lines();
    assert_eq!(lines.next(), Some("# 64 cases"));
    assert_eq!(lines.clone().count(), 64);
    for row in lines {
        check(row, &context);
    }
}
