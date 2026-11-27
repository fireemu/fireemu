//! Replays the Lean App Check header and debug-token text contracts.

use fireemu_core_app_check::header::collect_values;
use fireemu_core_app_check::{
    canonical_debug_token, classify_app_check_header, HeaderClassification,
};

const CORPUS: &str = include_str!("../fixtures/lean-app-check-admission.corpus");

fn header_value(tag: &str) -> String {
    match tag {
        "good" => "a.b+/=-!".into(),
        "empty" => String::new(),
        "limit" => "z".repeat(16_384),
        "oversized" => "z".repeat(16_385),
        "unicode" => "é".into(),
        "comma" => "a,b".into(),
        "space" => "a b".into(),
        "control" => "a\tb".into(),
        _ => panic!("unknown value {tag}"),
    }
}

fn check_header(name: &str, count: &str, value: &str, expected: &str, line: &str) {
    let name = match name {
        "canonical" => "x-firebase-appcheck",
        "mixed" => "X-FiReBaSe-AppCheck",
        "other" => "x-firebase-app-check",
        _ => panic!("unknown header name {name}"),
    };
    let value = header_value(value);
    let mut fields = vec![("authorization", "ignored")];
    match count {
        "none" => (),
        "one" => fields.push((name, value.as_str())),
        "two" => fields.extend([(name, value.as_str()), (name, "another")]),
        _ => panic!("unknown count {count}"),
    }
    let values = collect_values(fields);
    let actual = classify_app_check_header(&values);
    let expected = match expected {
        "missing" => HeaderClassification::Missing,
        "malformed" => HeaderClassification::Malformed,
        "present" => HeaderClassification::Present(value),
        _ => panic!("unknown outcome {expected}"),
    };
    assert_eq!(actual, expected, "{line}");
}

#[test]
fn app_check_admission_matches_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let declared = lines
        .next()
        .unwrap()
        .strip_prefix("# cases ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert_eq!(declared, lines.clone().count());
    assert_eq!(declared, 192);
    for line in lines {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        match fields.as_slice() {
            ["header", name, count, value, expected] => {
                check_header(name, count, value, expected, line);
            }
            ["uuid", _, _, _, _, value, expected] => {
                let actual = canonical_debug_token(value);
                let canonical = (*expected != "-").then_some(*expected);
                assert_eq!(actual.as_deref(), canonical, "{line}");
                if let Some(actual) = actual {
                    assert_eq!(
                        canonical_debug_token(&actual).as_deref(),
                        canonical,
                        "{line}"
                    );
                }
            }
            _ => panic!("malformed case {line}"),
        }
    }
}
