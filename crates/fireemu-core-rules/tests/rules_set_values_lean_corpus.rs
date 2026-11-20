//! Replays the Lean model of concrete Rules scalar set operations.

use std::collections::BTreeMap;

use fireemu_core_rules::eval::{evaluate_request, Decision, Method, RequestContext, RulesService};
use fireemu_core_rules::runtime::LoadedRules;
use fireemu_core_rules::value::RulesValue;

const CORPUS: &str = include_str!("fixtures/lean-rules-set-values.corpus");

fn scalar(text: &str) -> RulesValue {
    match text {
        "negzero" => RulesValue::Float(-0.0),
        "nan" => RulesValue::Float(f64::NAN),
        "null" => RulesValue::Null,
        "true" => RulesValue::Bool(true),
        "false" => RulesValue::Bool(false),
        _ => {
            let (kind, value) = text.split_once(':').expect("fixture scalar");
            match kind {
                "i" => RulesValue::Int(value.parse().expect("fixture integer")),
                "f" => RulesValue::Float(value.parse::<f64>().expect("fixture half-units") / 2.0),
                "s" => RulesValue::String(value.to_owned()),
                other => panic!("unknown type {other}"),
            }
        }
    }
}

fn list(text: &str) -> RulesValue {
    RulesValue::List(if text == "-" {
        Vec::new()
    } else {
        text.split(',').map(scalar).collect()
    })
}

#[test]
fn scalar_set_operations_match_the_lean_model() {
    let mut rows = CORPUS.lines();
    assert_eq!(rows.next(), Some("# 50 cases"));
    assert_eq!(rows.clone().count(), 50);
    for row in rows {
        let fields: Vec<_> = row.split('\t').collect();
        let [a_family, b_family, size, a, b, probe, a_size, b_size, union, intersection, difference, member, all, any, only] =
            fields.as_slice()
        else {
            panic!("invalid fixture row: {row}");
        };
        let context = RequestContext {
            service: RulesService::Firestore,
            method: Method::Get,
            path: "/databases/(default)/documents/items/subject".into(),
            auth: None,
            resource: Some(RulesValue::Map(BTreeMap::from([(
                "data".into(),
                RulesValue::Map(BTreeMap::from([
                    ("lhs".into(), list(a)),
                    ("rhs".into(), list(b)),
                    ("probe".into(), scalar(probe)),
                ])),
            )]))),
            request_resource: None,
            time_unix_nanos: 0,
            abstract_path: false,
            request_query: None,
        };
        let source = format!(
            "rules_version = '2'; service cloud.firestore {{
                match /databases/{{db}}/documents/items/{{id}} {{
                    function matchesCase() {{
                        let a = resource.data.lhs.toSet();
                        let b = resource.data.rhs.toSet();
                        return a.size() == {a_size} && b.size() == {b_size}
                            && a.union(b).size() == {union}
                            && a.intersection(b).size() == {intersection}
                            && a.difference(b).size() == {difference}
                            && (resource.data.probe in a) == {member}
                            && a.hasAll(b) == {all} && a.hasAny(b) == {any}
                            && a.hasOnly(b) == {only};
                    }}
                    allow get: if matchesCase();
                }}
            }}"
        );
        let loaded = LoadedRules::from_source(&source).expect("valid set rule");
        let report = evaluate_request(loaded.ruleset.as_deref().expect("loaded ruleset"), &context);
        assert_eq!(
            report.decision,
            Decision::Allow,
            "{a_family}, {b_family}, {size}: {source}"
        );
    }
}
