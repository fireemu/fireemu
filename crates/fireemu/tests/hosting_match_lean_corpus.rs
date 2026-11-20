//! Replays a Lean reference for a subset of Hosting's ordered matching policies.

use serde_json::Value;
use std::collections::BTreeSet;

#[path = "../src/hosting/matcher.rs"]
#[allow(dead_code)] // The module also serves deploy-ignore and route behaviors outside this replay.
mod matcher;

const CORPUS: &str = include_str!("fixtures/lean-hosting-match.corpus");

fn config(text: &str) -> Value {
    let pieces: Vec<_> = text.split('|').collect();
    let [glob, source, regex] = pieces.as_slice() else {
        panic!("invalid rule: {text}");
    };
    let mut rule = serde_json::json!({"glob": glob, "source": source});
    if !regex.is_empty() {
        rule["regex"] = Value::String(format!("^{}$", regex::escape(regex)));
    }
    rule
}

#[test]
fn hosting_rule_order_and_matching_agree_with_lean() {
    let mut lines = CORPUS.lines();
    assert_eq!(lines.next(), Some("# 342 cases."));
    let mut seen = BTreeSet::new();
    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        let [id, profile, path, specs, expected, first] = fields.as_slice() else {
            panic!("invalid row: {line}");
        };
        assert!(seen.insert(*id), "duplicate row {id}");
        let check = match *profile {
            "strict" => matcher::matches_production,
            "emu" => matcher::matches,
            _ => panic!("unknown profile {profile}"),
        };
        let matched: Vec<_> = specs
            .split(';')
            .map(|rule| check(&config(rule), path))
            .collect();
        let expected: Vec<_> = expected
            .split(',')
            .map(|tag| match tag {
                "1" => true,
                "0" => false,
                _ => panic!("unknown verdict {tag}"),
            })
            .collect();
        assert_eq!(matched, expected, "{id}");
        let first = (*first != "-").then(|| first.parse().expect("index"));
        assert_eq!(matched.iter().position(|&yes| yes), first, "{id}");
    }
    assert_eq!(seen.len(), 342);
}
