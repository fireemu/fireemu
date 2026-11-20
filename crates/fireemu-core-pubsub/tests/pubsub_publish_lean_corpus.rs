//! Replays the Lean publish admission boundary and the first diagnostic category.

use fireemu_core_pubsub::{Code, PubsubMessage};
use std::collections::BTreeMap;

const CORPUS: &str = include_str!("fixtures/lean-pubsub-publish.corpus");

fn attributes(preset: &str) -> BTreeMap<String, String> {
    let pair = |key: String, value: String| [(key, value)].into();
    match preset {
        "none" => BTreeMap::new(),
        "single" => pair("a".into(), String::new()),
        "hundred" | "hundred-one" => {
            let count = if preset == "hundred" { 100 } else { 101 };
            (0..count)
                .map(|n| (format!("k{n}"), String::new()))
                .collect()
        }
        "empty-key" => pair(String::new(), String::new()),
        "key-max" => pair("k".repeat(256), String::new()),
        "key-over" => pair("k".repeat(257), String::new()),
        "value-max" => pair("a".into(), "v".repeat(1024)),
        "value-over" => pair("a".into(), "v".repeat(1025)),
        "unicode-key-max" => pair("é".repeat(128), String::new()),
        "unicode-key-over" => pair(format!("{}k", "é".repeat(128)), String::new()),
        "unicode-value-max" => pair("a".into(), "é".repeat(512)),
        "unicode-value-over" => pair("a".into(), format!("{}v", "é".repeat(512))),
        "reserved" => pair("goog-x".into(), String::new()),
        "mixed-prefix" => pair("Goog-x".into(), String::new()),
        "nul-key" => pair("a\0".into(), String::new()),
        "nul-value" => pair("a".into(), "v\0".into()),
        "long-both" => pair("k".repeat(257), "v".repeat(1025)),
        "first-error" => [("z".into(), "v".repeat(1025)), ("a".into(), "\0".into())].into(),
        _ => panic!("unknown attribute preset {preset}"),
    }
}

fn ordering(preset: &str) -> String {
    match preset {
        "none" => String::new(),
        "one" => "o".into(),
        "max" => "é".repeat(512),
        "over" => format!("{}o", "é".repeat(512)),
        "nul" => "o\0".into(),
        "long-nul" => format!("{}\0", "é".repeat(512)),
        _ => panic!("unknown ordering preset {preset}"),
    }
}

#[test]
fn replay_publish_admission() {
    let mut rows = CORPUS.lines();
    assert_eq!(rows.next(), Some("# 570"));
    assert_eq!(rows.clone().count(), 570);
    for line in rows {
        let row: Vec<_> = line.split('\t').collect();
        let [_, attrs, order, data, issue] = row.as_slice() else {
            panic!("malformed publish row: {line}");
        };
        let result = PubsubMessage {
            data: vec![0; data.parse().unwrap()],
            attributes: attributes(attrs),
            ordering_key: ordering(order),
        }
        .validate();
        let fragment = match *issue {
            "ok" => {
                assert!(result.is_ok(), "{line}: {result:?}");
                continue;
            }
            "empty" => "One or more messages in the publish request is empty.",
            "dataSize" => "message data exceeds 10000000 bytes",
            "count" => "There are too many attributes in the request.",
            "keyInvalid" => "The request contains an attribute key that is not valid",
            "keySize" => "has a key that is too large.",
            "valueSize" => "has a value that is too large.",
            "keyNul" | "valueNul" => "contains a NUL byte",
            "totalSize" => "message total size exceeds 10000000 bytes",
            "orderingSize" => "An ordering key in the request is too long.",
            "orderingNul" => "ordering key contains a NUL byte",
            _ => panic!("unknown publish error {issue}"),
        };
        let error = result.unwrap_err();
        assert_eq!(error.code(), Code::InvalidArgument, "{line}");
        assert!(error.message().contains(fragment), "{line}: {error}");
        match *issue {
            "keyNul" => assert!(error.message().starts_with("attribute key "), "{line}"),
            "valueNul" => assert!(error.message().starts_with("attribute value "), "{line}"),
            _ => {}
        }
    }
}
