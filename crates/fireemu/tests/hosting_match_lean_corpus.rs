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
        let rules: Vec<_> = specs.split(';').map(config).collect();
        let matched: Vec<_> = rules.iter().map(|rule| check(rule, path)).collect();
        let prepared_path = matcher::MatchPath::new(path);
        let prepared: Vec<_> = rules
            .iter()
            .map(|rule| {
                matcher::RuleMatcher::prepare(rule).matches(&prepared_path, *profile == "strict")
            })
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
        assert_eq!(prepared, expected, "{id} prepared");
        let first = (*first != "-").then(|| first.parse().expect("index"));
        assert_eq!(matched.iter().position(|&yes| yes), first, "{id}");
    }
    assert_eq!(seen.len(), 342);
}

#[test]
fn preparing_hosting_rules_preserves_pattern_matching() {
    let mut rows = include_str!("fixtures/hosting-prepared-matcher.tsv").lines();
    assert_eq!(rows.next(), Some("Source\tPattern\tPath\tProfile"));
    for row in rows {
        let columns: Vec<_> = row.split('\t').collect();
        let [source, pattern, path, profile] = columns.as_slice() else {
            panic!("invalid matcher row: {row}");
        };
        let pattern = match (*source, *pattern) {
            ("regex", "literal") => "^/a/é$",
            ("regex", "class") => r"(?i)^/[a-z]+/a$",
            ("regex", "star") => "^/a/.*$",
            ("regex", "invalid") => "[",
            (_, "literal") => "/a/a",
            (_, "class") => "/a/[a-z]",
            (_, "star") => "/a/*",
            (_, "globstar") => "/**/a/**/*",
            (_, "brace") => "/a/{é,.hidden}",
            (_, "escaped") => r"/a/\.hidden",
            (_, "extglob") => "/a/@(a|é)",
            (_, "comment") => "#/a/*",
            (_, "negated") => "!/a/*",
            _ => panic!("invalid matcher fixture pattern: {row}"),
        };
        let path = match *path {
            "root" => "/",
            "ascii" => "/a/a",
            "dot" => "/a/.hidden",
            "slash_runs" => "//a///.hidden//",
            "trailing" => "/a/",
            "unicode" => "/a/é",
            "deep" => "/d/a/b/c/d/e/f/g/h/i/j/k/l/m/n",
            _ => panic!("invalid matcher fixture path: {row}"),
        };
        let mut rule = serde_json::json!({});
        rule[*source] = pattern.into();
        let strict = *profile == "strict";
        let expected = if strict {
            matcher::matches_production(&rule, path)
        } else {
            matcher::matches(&rule, path)
        };
        let prepared = matcher::RuleMatcher::prepare(&rule);
        assert_eq!(
            prepared.matches(&matcher::MatchPath::new(path), strict),
            expected,
            "{row}"
        );
    }
}
