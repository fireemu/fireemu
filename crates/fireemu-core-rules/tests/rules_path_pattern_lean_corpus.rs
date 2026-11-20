//! Replays concrete path matching and bindings through the Rules loader and evaluator.

use fireemu_core_rules::eval::{
    evaluate_request, Decision, DenyReason, Method, RequestContext, RulesService,
};
use fireemu_core_rules::runtime::LoadedRules;

const CORPUS: &str = include_str!("fixtures/lean-rules-path-pattern.corpus");

fn source(version: &str, layout: &str, condition: &str) -> String {
    let path = match layout {
        "single" => format!("match /items/{{id}} {{ allow get: if {condition}; }}"),
        "nested" => format!(
            "match /items/{{id}} {{ match /notes/{{note}} {{ allow get: if {condition}; }} }}"
        ),
        "trailing" => format!("match /items/{{id}}/{{rest=**}} {{ allow get: if {condition}; }}"),
        "leading" => format!("match /{{rest=**}}/items/{{id}} {{ allow get: if {condition}; }}"),
        other => panic!("invalid match layout {other}"),
    };
    let version = match version {
        "one" => "1",
        "two" => "2",
        other => panic!("invalid rules version {other}"),
    };
    format!(
        "rules_version = '{version}'; service cloud.firestore {{ match /databases/{{database}}/documents {{ {path} }} }}"
    )
}

fn decision(loaded: &LoadedRules, context: &RequestContext) -> Decision {
    evaluate_request(loaded.ruleset.as_deref().expect("loaded ruleset"), context).decision
}

#[test]
fn concrete_path_matching_and_captures_match_the_lean_model() {
    let mut rows = CORPUS.lines();
    assert_eq!(rows.next(), Some("# 72 cases"));
    assert_eq!(rows.clone().count(), 72);
    for row in rows {
        let fields: Vec<_> = row.split('\t').collect();
        let [version, layout, _, path, verdict, id, note, rest] = fields.as_slice() else {
            panic!("invalid fixture row: {row}");
        };
        let pattern = source(version, layout, "true");
        let loaded = LoadedRules::from_source(&pattern);
        if *verdict == "reject" {
            assert_eq!(
                loaded.expect_err(row).message,
                "in rules_version 1 a recursive wildcard must be the final path segment",
                "{row}"
            );
            continue;
        }
        let loaded = loaded.expect(row);
        let context = RequestContext {
            service: RulesService::Firestore,
            method: Method::Get,
            path: format!("/databases/(default)/documents{path}"),
            auth: None,
            resource: None,
            request_resource: None,
            time_unix_nanos: 0,
            abstract_path: false,
            request_query: None,
        };
        let expected = match *verdict {
            "match" => true,
            "miss" => false,
            other => panic!("invalid verdict {other}"),
        };
        let matched = match decision(&loaded, &context) {
            Decision::Allow => true,
            Decision::Deny(DenyReason::NoMatchingRule | DenyReason::NoMatchingAllow) => false,
            other @ Decision::Deny(_) => panic!("unexpected match decision for {row}: {other:?}"),
        };
        assert_eq!(matched, expected, "{row}");
        if expected {
            let mut conditions = vec![format!("id == '{id}'")];
            if *note != "-" {
                conditions.push(format!("note == '{note}'"));
            }
            if *rest != "-" {
                conditions.push(format!("rest == path('{rest}')"));
            }
            let check = source(version, layout, &conditions.join(" && "));
            let loaded = LoadedRules::from_source(&check).expect(row);
            assert_eq!(decision(&loaded, &context), Decision::Allow, "{row}");
        }
    }
}
