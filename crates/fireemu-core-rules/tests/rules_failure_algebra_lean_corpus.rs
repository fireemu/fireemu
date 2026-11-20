//! Replays the Lean model of ordered boolean evaluation against concrete Firestore rules.

use fireemu_core_rules::eval::{
    evaluate_request, Decision, DenyReason, Method, RequestContext, RulesService,
};
use fireemu_core_rules::runtime::LoadedRules;

const CORPUS: &str = include_str!("fixtures/lean-rules-failure-algebra.corpus");

fn operand(name: &str) -> &str {
    match name {
        "true" | "false" => name,
        "missing" => "resource.data.flag == true",
        "fault" => "1 / 0 == 0",
        "unsupported" => "exists(/databases/$(database)/documents/items/dependency)",
        other => panic!("invalid operand {other}"),
    }
}

#[test]
fn ordered_boolean_chains_match_the_lean_model() {
    let mut rows = CORPUS.lines();
    assert_eq!(rows.next(), Some("# 250 cases"));
    assert_eq!(rows.clone().count(), 250);
    for row in rows {
        let fields: Vec<_> = row.split('\t').collect();
        let [operation, first, second, third, outcome, negated_outcome, read_missing] =
            fields.as_slice()
        else {
            panic!("invalid fixture row: {row}");
        };
        let operator = match *operation {
            "and" => "&&",
            "or" => "||",
            other => panic!("invalid operator {other}"),
        };
        let expression = [*first, *second, *third]
            .map(operand)
            .join(&format!(" {operator} "));
        let context = RequestContext {
            service: RulesService::Firestore,
            method: Method::Get,
            path: "/databases/(default)/documents/items/subject".into(),
            auth: None,
            resource: None,
            request_resource: None,
            time_unix_nanos: 0,
            abstract_path: false,
            request_query: None,
        };
        for (expression, expected) in [
            (&expression, outcome),
            (&format!("!({expression})"), negated_outcome),
        ] {
            let source = format!(
                "service cloud.firestore {{ match /databases/{{database}}/documents/items/{{id}} {{ allow get: if {expression}; }} }}"
            );
            let loaded = LoadedRules::from_source(&source).unwrap_or_else(|error| {
                panic!("could not load {row}: {error:?}");
            });
            let report =
                evaluate_request(loaded.ruleset.as_deref().expect("loaded ruleset"), &context);
            let actual = match report.decision {
                Decision::Allow => "allow",
                Decision::Deny(DenyReason::NoMatchingAllow) => "deny",
                Decision::Deny(DenyReason::Unsupported(message)) => {
                    assert_eq!(
                        message,
                        "get()/exists()/getAfter() document access is not available for this request",
                        "{row}"
                    );
                    "unsupported"
                }
                other => panic!("unexpected decision for {row}: {other:?}"),
            };
            assert_eq!(actual, *expected, "{expression}; {row}");
            assert_eq!(
                report.absent_resource_used,
                read_missing.parse::<bool>().expect("fixture boolean"),
                "{row}"
            );
        }
    }
}
