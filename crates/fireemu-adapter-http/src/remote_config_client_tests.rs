//! The client data plane against RC-CLOSURE-B's recorded answers (both passes, sanitised in
//! conformance/remote-config-web): bodies byte for byte, the tag's form and relations, the frames.

use proptest::prelude::*;
use serde_json::{json, Value};

use super::{
    atom_holds, client_route, condition_holds, etag, fetch, frame, last_known, micro_percentile,
    ClientAction,
};
use crate::remote_config::{TemplateStore, WriteMode};
use fireemu_core_types::time::LogicalInstant;

const PROJECT: &str = "demo-web";

/// The pass's client template v1 (program.mjs `template("v1", runId)`).
fn template(label: &str, description: &str) -> Value {
    let leaf = |value: &str, kind: &str, conditional: &[(&str, &str)]| {
        let mut leaf = json!({"defaultValue": {"value": value}, "valueType": kind});
        if !conditional.is_empty() {
            leaf["conditionalValues"] = conditional
                .iter()
                .map(|(c, v)| ((*c).to_owned(), json!({ "value": v })))
                .collect::<serde_json::Map<_, _>>()
                .into();
        }
        leaf
    };
    json!({
        "version": {"description": description},
        "conditions": [
            {"name": "fireemu_premium", "expression": "app.customSignal['fireemu_tier'].exactlyMatches(['premium'])"},
            {"name": "fireemu_level", "expression": "app.customSignal['fireemu_level'] >= 5"},
            {"name": "fireemu_half", "expression": "percent('fireemu_seed') <= 50"}
        ],
        "parameters": {
            "fireemu_message": leaf(&format!("{label}-default"), "STRING", &[("fireemu_premium", &format!("{label}-premium")), ("fireemu_half", &format!("{label}-half"))]),
            "fireemu_limit": leaf("10", "NUMBER", &[("fireemu_level", "20")]),
            "fireemu_enabled": leaf("false", "BOOLEAN", &[("fireemu_premium", "true")]),
            "fireemu_payload": leaf("{\"synthetic\":true}", "JSON", &[]),
            "fireemu_inapp": {"defaultValue": {"useInAppDefault": true}}
        }
    })
}

fn published(store: &TemplateStore, label: &str, description: &str) {
    store
        .write(
            WriteMode::Publish,
            Some("*"),
            template(label, description),
            LogicalInstant::from_unix_seconds(1_764_000_000),
        )
        .unwrap();
}

fn request(tier: &str, level: &str, instance: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "sdk_version": "12.18.0",
        "app_instance_id": instance,
        "app_instance_id_token": "TOKEN_1",
        "app_id": "1:PROJECT_NUMBER:web:APP",
        "language_code": "en-US",
        "custom_signals": {"fireemu_tier": tier, "fireemu_level": level}
    }))
    .unwrap()
}

/// An installation id whose seeded percentile is above 50 (falls through to the default).
fn outside_half() -> String {
    (0..1000)
        .map(|n| format!("cAAAAAAAAAAAAAAAAAA{n:03}"))
        .find(|id| micro_percentile(Some("fireemu_seed"), id) > 50_000_000)
        .unwrap()
}

fn inside_half() -> String {
    (0..1000)
        .map(|n| format!("cBBBBBBBBBBBBBBBBBB{n:03}"))
        .find(|id| micro_percentile(Some("fireemu_seed"), id) <= 50_000_000)
        .unwrap()
}

#[test]
fn routes_are_the_two_recorded_paths_only() {
    assert_eq!(
        client_route("/v1/projects/p/namespaces/firebase:fetch"),
        Some(("p", ClientAction::Fetch))
    );
    assert_eq!(
        client_route("/v1/projects/p/namespaces/firebase:streamFetchInvalidations"),
        Some(("p", ClientAction::Stream))
    );
    for path in [
        "/v1/projects/p/namespaces/firebase-server:fetch",
        "/v1/projects/p/namespaces/firebase:fetchx",
        "/v1/projects/p/remoteConfig",
        "/v1/projects//namespaces/firebase:fetch",
        "/v2/projects/p/namespaces/firebase:fetch",
    ] {
        assert_eq!(client_route(path), None, "{path}");
    }
}

#[test]
fn the_first_fetch_answers_the_recorded_update_body() {
    let store = TemplateStore::default();
    published(&store, "v1", "fireemu rc-closure-b RUN_ID v1");
    let reply = fetch(
        &store.current(),
        PROJECT,
        Some("*"),
        &request("premium", "7", &outside_half()),
    );
    assert_eq!(reply.status, 200);
    // Pass 1 n=2, byte for byte (version 1 here, 47 there).
    assert_eq!(
        String::from_utf8(reply.body).unwrap(),
        "{\n  \"entries\": {\n    \"fireemu_enabled\": \"true\",\n    \"fireemu_limit\": \"20\",\n    \"fireemu_message\": \"v1-premium\",\n    \"fireemu_payload\": \"{\\\"synthetic\\\":true}\"\n  },\n  \"state\": \"UPDATE\",\n  \"templateVersion\": \"1\"\n}\n"
    );
    let tag = reply.etag.unwrap();
    let number = tag.strip_prefix("etag-demo-web-firebase-fetch-").unwrap();
    assert!(number.parse::<i32>().is_ok(), "{tag}");
}

#[test]
fn signals_and_the_installation_choose_the_first_matching_condition() {
    let store = TemplateStore::default();
    published(&store, "v1", "d");
    let body = |tier: &str, level: &str, instance: &str| -> Value {
        serde_json::from_slice(
            &fetch(
                &store.current(),
                PROJECT,
                Some("*"),
                &request(tier, level, instance),
            )
            .body,
        )
        .unwrap()
    };
    // Pass 1 two (basic, 3): the default values.
    let two = body("basic", "3", &outside_half());
    assert_eq!(two["entries"]["fireemu_message"], "v1-default");
    assert_eq!(two["entries"]["fireemu_limit"], "10");
    assert_eq!(two["entries"]["fireemu_enabled"], "false");
    // Pass 2 two (basic, 3, an installation inside the seeded half): the percent value.
    assert_eq!(
        body("basic", "3", &inside_half())["entries"]["fireemu_message"],
        "v1-half"
    );
    // Premium comes first in the condition order, inside the half as well.
    assert_eq!(
        body("premium", "3", &inside_half())["entries"]["fireemu_message"],
        "v1-premium"
    );
    // The in-app default is left out of the entries.
    assert!(two["entries"].get("fireemu_inapp").is_none());
    // A missing signal does not match.
    let none: Value = serde_json::from_slice(
        &fetch(
            &store.current(),
            PROJECT,
            Some("*"),
            br#"{"app_instance_id":"x"}"#,
        )
        .body,
    )
    .unwrap();
    assert_eq!(none["entries"]["fireemu_limit"], "10");
}

#[test]
fn the_current_tag_answers_no_change_with_the_same_tag() {
    let store = TemplateStore::default();
    published(&store, "v1", "d");
    let instance = outside_half();
    let first = fetch(
        &store.current(),
        PROJECT,
        Some("*"),
        &request("premium", "7", &instance),
    );
    let tag = first.etag.clone().unwrap();
    let again = fetch(
        &store.current(),
        PROJECT,
        Some(&tag),
        &request("premium", "7", &instance),
    );
    assert_eq!(
        String::from_utf8(again.body).unwrap(),
        "{\n  \"state\": \"NO_CHANGE\",\n  \"templateVersion\": \"1\"\n}\n"
    );
    assert_eq!(again.etag.as_deref(), Some(tag.as_str()));
    // Other signals give other entries, so another tag (pass 1: one and two differ).
    let other = fetch(
        &store.current(),
        PROJECT,
        Some(&tag),
        &request("basic", "3", &instance),
    );
    assert_ne!(other.etag.unwrap(), tag);
}

#[test]
fn every_publication_changes_the_tag_even_with_equal_entries() {
    let store = TemplateStore::default();
    let instance = outside_half();
    let mut tags = Vec::new();
    // r1 changed, r2 metadata only, r3 same content: three versions, entries equal for r2 and r3.
    for (label, description) in [("v1", "a"), ("v2", "b"), ("v2", "c"), ("v2", "c")] {
        published(&store, label, description);
        let reply = fetch(
            &store.current(),
            PROJECT,
            Some("*"),
            &request("premium", "7", &instance),
        );
        let body: Value = serde_json::from_slice(&reply.body).unwrap();
        assert_eq!(body["state"], "UPDATE");
        tags.push(reply.etag.unwrap());
    }
    let distinct: std::collections::BTreeSet<_> = tags.iter().collect();
    assert_eq!(distinct.len(), 4, "{tags:?}");
}

#[test]
fn before_any_publication_the_answer_is_no_template() {
    let store = TemplateStore::default();
    let reply = fetch(
        &store.current(),
        PROJECT,
        Some("*"),
        &request("premium", "7", "x"),
    );
    assert_eq!(
        String::from_utf8(reply.body).unwrap(),
        "{\n  \"state\": \"NO_TEMPLATE\"\n}\n"
    );
    let bad = fetch(&store.current(), PROJECT, None, b"not json");
    assert_eq!(bad.status, 400);
}

#[test]
fn frames_are_the_recorded_bytes() {
    // Pass 1 n=4: the first chunk is 43 bytes, every later one 45.
    assert_eq!(
        frame(true, 48),
        b"[{\n  \"latestTemplateVersionNumber\": \"48\"\n}\n".to_vec()
    );
    assert_eq!(frame(true, 48).len(), 43);
    assert_eq!(
        frame(false, 49),
        b",\r\n{\n  \"latestTemplateVersionNumber\": \"49\"\n}\n".to_vec()
    );
    assert_eq!(frame(false, 49).len(), 45);
    assert_eq!(last_known(br#"{"lastKnownVersionNumber":"47"}"#), 47);
    assert_eq!(last_known(br#"{"lastKnownVersionNumber":47}"#), 47);
    assert_eq!(last_known(b"{}"), 0);
    assert_eq!(last_known(b"x"), 0);
}

#[test]
fn different_evaluated_values_do_not_reuse_the_old_java_hash_collision() {
    let store = TemplateStore::default();
    let mut document = template("v1", "d");
    document["parameters"]
        .as_object_mut()
        .unwrap()
        .remove("fireemu_enabled");
    document["parameters"]["fireemu_message"] = json!({
        "defaultValue": {"value": "Aa"},
        "conditionalValues": {"fireemu_premium": {"value": "BB"}}
    });
    store
        .write(
            WriteMode::Publish,
            Some("*"),
            document,
            LogicalInstant::from_unix_seconds(1_764_000_000),
        )
        .unwrap();

    let instance = outside_half();
    let current = store.current();
    let first = fetch(
        &current,
        PROJECT,
        Some("*"),
        &request("basic", "7", &instance),
    );
    let second = fetch(
        &current,
        PROJECT,
        first.etag.as_deref(),
        &request("premium", "7", &instance),
    );

    assert_ne!(second.etag, first.etag);
    let body: Value = serde_json::from_slice(&second.body).unwrap();
    assert_eq!(body["state"], "UPDATE");
    assert_eq!(body["entries"]["fireemu_message"], "BB");
}

#[test]
fn the_fetch_tag_uses_a_deterministic_signed_number() {
    let empty = std::collections::BTreeMap::new();
    let tag = etag("p", 3, &empty);
    assert!(tag
        .strip_prefix("etag-p-firebase-fetch-")
        .unwrap()
        .parse::<i32>()
        .is_ok());
    assert_eq!(tag, etag("p", 3, &empty));
    assert_ne!(tag, etag("p", 4, &empty));
}

proptest! {
    #[test]
    fn percentiles_stay_in_range_and_depend_on_the_seed(id in "[A-Za-z0-9_-]{22}", seed in "[a-z_]{1,12}") {
        let at = micro_percentile(Some(&seed), &id);
        prop_assert!(at < 100_000_000);
        prop_assert_eq!(micro_percentile(Some(""), &id), micro_percentile(None, &id));
    }

    #[test]
    fn fetch_never_panics_and_answers_json(body in proptest::collection::vec(any::<u8>(), 0..200)) {
        let store = TemplateStore::default();
        published(&store, "v1", "d");
        let reply = fetch(&store.current(), PROJECT, None, &body);
        prop_assert!(serde_json::from_slice::<Value>(&reply.body).is_ok());
    }
}

#[test]
fn percent_atoms_hold_at_their_boundaries() {
    let id = "cAAAAAAAAAAAAAAAAAAAAA";
    let at = micro_percentile(Some("s"), id);
    let signals = serde_json::Map::new();
    let percent = |operator: &str, micro: u64| json!({"percent": {"percentOperator": operator, "microPercent": micro, "seed": "s"}});
    assert!(atom_holds(&percent("LESS_OR_EQUAL", at), &signals, id));
    assert!(!atom_holds(&percent("LESS_OR_EQUAL", at - 1), &signals, id));
    assert!(!atom_holds(&percent("GREATER_THAN", at), &signals, id));
    assert!(atom_holds(&percent("GREATER_THAN", at - 1), &signals, id));
    let between = |lower: u64, upper: u64| {
        json!({"percent": {"percentOperator": "BETWEEN", "seed": "s", "microPercentRange": {
            "microPercentLowerBound": lower, "microPercentUpperBound": upper}}})
    };
    assert!(atom_holds(&between(at - 1, at), &signals, id));
    assert!(!atom_holds(&between(at, at + 1), &signals, id));
    assert!(!atom_holds(&between(at - 2, at - 1), &signals, id));
    assert!(!atom_holds(
        &json!({"percent": {"percentOperator": "OTHER"}}),
        &signals,
        id
    ));
    assert!(!atom_holds(&json!({}), &signals, id));
}

#[test]
fn custom_signals_compare_by_their_operator_and_type() {
    let signals: serde_json::Map<String, Value> =
        serde_json::from_value(json!({"n": 5, "s": "5", "b": true, "x": "abc", "o": {}})).unwrap();
    let atom = |operator: &str, key: &str, target: &str| {
        json!({"customSignal": {"customSignalOperator": operator, "customSignalKey": key,
            "targetCustomSignalValues": [target]}})
    };
    for (operator, key, target, holds) in [
        ("NUMERIC_GREATER_EQUAL", "n", "5", true),
        ("NUMERIC_GREATER_EQUAL", "n", "6", false),
        ("NUMERIC_GREATER_THAN", "s", "5", false),
        ("NUMERIC_GREATER_THAN", "s", "4", true),
        ("NUMERIC_LESS_EQUAL", "n", "5", true),
        ("NUMERIC_LESS_EQUAL", "n", "4", false),
        ("NUMERIC_LESS_THAN", "n", "5", false),
        ("NUMERIC_LESS_THAN", "n", "6", true),
        ("NUMERIC_EQUAL", "n", "5", true),
        ("NUMERIC_EQUAL", "n", "5.5", false),
        ("NUMERIC_NOT_EQUAL", "n", "5", false),
        ("NUMERIC_NOT_EQUAL", "n", "6", true),
        ("NUMERIC_GREATER_EQUAL", "n", "five", false),
        ("NUMERIC_GREATER_EQUAL", "x", "1", false),
        ("STRING_EXACTLY_MATCHES", "b", "true", true),
        ("STRING_EXACTLY_MATCHES", "x", "ab", false),
        ("STRING_CONTAINS", "x", "b", true),
        ("STRING_CONTAINS", "x", "d", false),
        ("STRING_DOES_NOT_CONTAIN", "x", "d", true),
        ("STRING_DOES_NOT_CONTAIN", "x", "a", false),
        ("STRING_EXACTLY_MATCHES", "o", "{}", false),
        ("STRING_EXACTLY_MATCHES", "missing", "x", false),
        ("SEMANTIC_VERSION_EQUAL", "s", "5", false),
    ] {
        assert_eq!(
            atom_holds(&atom(operator, key, target), &signals, "id"),
            holds,
            "{operator} {key} {target}"
        );
    }
    // A condition holds only when every atom of its chain does, and unknown forms never hold.
    assert!(condition_holds(
        "app.customSignal['n'] >= 5 && app.customSignal['x'].exactlyMatches(['abc'])",
        &signals,
        "id"
    ));
    assert!(!condition_holds(
        "app.customSignal['n'] >= 5 && app.customSignal['x'].exactlyMatches(['ab'])",
        &signals,
        "id"
    ));
    assert!(!condition_holds("device.os == 'ios'", &signals, "id"));
    assert!(!condition_holds("", &signals, "id"));
}

#[test]
fn several_targets_and_nearly_equal_numbers() {
    let signals: serde_json::Map<String, Value> =
        serde_json::from_value(json!({"x": "abc", "one": "1", "zero": "0"})).unwrap();
    let atom = |operator: &str, key: &str, targets: &[&str]| {
        json!({"customSignal": {"customSignalOperator": operator, "customSignalKey": key,
            "targetCustomSignalValues": targets}})
    };
    // Any target is enough to contain; one contained target is enough to refuse "does not contain".
    assert!(atom_holds(
        &atom("STRING_CONTAINS", "x", &["b", "zz"]),
        &signals,
        "id"
    ));
    assert!(!atom_holds(
        &atom("STRING_DOES_NOT_CONTAIN", "x", &["zz", "b"]),
        &signals,
        "id"
    ));
    // A difference at either magnitude must survive numeric equality.
    for (key, next) in [
        ("one", "1.0000000000000002"),
        ("zero", "0.0000000000000001"),
    ] {
        assert!(!atom_holds(
            &atom("NUMERIC_EQUAL", key, &[next]),
            &signals,
            "id"
        ));
        assert!(atom_holds(
            &atom("NUMERIC_NOT_EQUAL", key, &[next]),
            &signals,
            "id"
        ));
    }
}

/// Every combination of the PICT table (`remote_config_testdata/client_fetch_pict.tsv`, with the
/// recorded passes' rows as seeds) against the rules the passes showed.
#[test]
fn pict_rows_follow_the_recorded_rules() {
    let table = include_str!("remote_config_testdata/client_fetch_pict.tsv");
    let mut rows = table.lines();
    assert_eq!(rows.next(), Some("Tier\tLevel\tPercentile\tTag\tPublished"));
    let mut seen = 0;
    for row in rows {
        let [tier, level, percentile, tag, published] = row.split('\t').collect::<Vec<_>>()[..]
        else {
            panic!("{row}");
        };
        seen += 1;
        let store = TemplateStore::default();
        if published == "yes" {
            published_template(&store);
        }
        let instance = if percentile == "inside" {
            inside_half()
        } else {
            outside_half()
        };
        let mut signals = serde_json::Map::new();
        if tier != "absent" {
            signals.insert("fireemu_tier".into(), json!(tier));
        }
        if level != "absent" {
            signals.insert("fireemu_level".into(), json!(level));
        }
        let body =
            serde_json::to_vec(&json!({"app_instance_id": instance, "custom_signals": signals}))
                .unwrap();
        let first = fetch(&store.current(), PROJECT, Some("*"), &body);
        let current = first.etag.clone().unwrap();
        let if_none_match = match tag {
            "star" => Some("*".to_owned()),
            "current" => Some(current.clone()),
            "stale" => Some("etag-demo-web-firebase-fetch-1".to_owned()),
            _ => None,
        };
        let reply = fetch(&store.current(), PROJECT, if_none_match.as_deref(), &body);
        let answer: Value = serde_json::from_slice(&reply.body).unwrap();
        assert_eq!(reply.etag.as_deref(), Some(current.as_str()), "{row}");
        if published == "no" {
            assert_eq!(answer, json!({"state": "NO_TEMPLATE"}), "{row}");
            continue;
        }
        if tag == "current" {
            assert_eq!(
                answer,
                json!({"state": "NO_CHANGE", "templateVersion": "1"}),
                "{row}"
            );
            continue;
        }
        let premium = tier == "premium";
        let message = if premium {
            "v1-premium"
        } else if percentile == "inside" {
            "v1-half"
        } else {
            "v1-default"
        };
        let high = level.parse::<f64>().is_ok_and(|n| n >= 5.0);
        assert_eq!(
            answer["entries"],
            json!({
                "fireemu_enabled": if premium { "true" } else { "false" },
                "fireemu_limit": if high { "20" } else { "10" },
                "fireemu_message": message,
                "fireemu_payload": "{\"synthetic\":true}"
            }),
            "{row}"
        );
        assert_eq!(answer["state"], "UPDATE", "{row}");
    }
    assert!(seen >= 20);
}

fn published_template(store: &TemplateStore) {
    published(store, "v1", "d");
}

fn compressed(bytes: &[u8]) -> Vec<u8> {
    use std::io::Write as _;
    let mut stream = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    stream.write_all(bytes).unwrap();
    stream.finish().unwrap()
}

#[test]
fn native_sdk_wire_cases_cover_aliases_encoding_fields_and_both_routes() {
    use super::{client_project, fetch_encoded, stream_version};

    let store = TemplateStore::default();
    published(&store, "live", "native SDK request fixture");
    for line in include_str!("native_payload_pict.tsv").lines().skip(1) {
        let parts: Vec<_> = line.trim_end_matches('\r').split('\t').collect();
        let [platform, route, encoding, action] = parts.as_slice() else {
            panic!("bad native route manifest row: {line}");
        };
        let target = match *route {
            "ID" => PROJECT,
            "number" => "100000000004",
            "foreign" => "100000000005",
            _ => panic!("bad route"),
        };
        assert_eq!(
            client_project(target, PROJECT, Some(100_000_000_004)),
            *route != "foreign"
        );
        assert_eq!(client_project(target, PROJECT, None), *route == "ID");
        let body = match (*platform, *action) {
            ("web", "fetch") => br#"{"custom_signals":{"fireemu_tier":"premium"}}"#.as_slice(),
            ("android", "fetch") => br#"{"appId":"1:100000000004:android:aa01","packageName":"com.example.android","customSignals":{"fireemu_tier":"premium"}}"#.as_slice(),
            ("apple", "fetch") => br#"{app_id:'1:100000000004:ios:aa02',package_name:'com.example.ios',custom_signals:{"fireemu_tier":'premium'}}"#.as_slice(),
            ("apple", "realtime") => b"{lastKnownVersionNumber:'21'}".as_slice(),
            ("web" | "android", "realtime") => br#"{"lastKnownVersionNumber":"21"}"#.as_slice(),
            ("malformed", _) => b"{",
            _ => panic!("bad fixture form"),
        };
        let wire = if *encoding == "gzip" {
            compressed(body)
        } else {
            body.to_vec()
        };
        if !client_project(target, PROJECT, Some(100_000_000_004)) {
            continue;
        }
        let good = *encoding != "other" && (*platform != "apple" || *encoding == "gzip");
        if *action == "fetch" {
            let res = fetch_encoded(&store.current(), PROJECT, None, &wire, Some(encoding), 1024);
            let answer: Value = serde_json::from_slice(&res.body).unwrap();
            if good && *platform != "malformed" {
                assert_eq!(res.status, 200, "{line}");
                assert_eq!(
                    answer["entries"]["fireemu_message"], "live-premium",
                    "{line}"
                );
            } else {
                assert_eq!(res.status, 400, "{line}");
            }
        } else {
            let res = stream_version(&wire, Some(encoding), 1024);
            if good && *platform != "malformed" {
                assert_eq!(res, Ok(21), "{line}");
            } else if *encoding == "identity" {
                assert_eq!(res, Ok(0), "{line}");
            } else {
                assert!(res.is_err(), "{line}");
            }
        }
    }
}

#[test]
fn native_gzip_bounds_corruption_and_pseudo_json_nesting() {
    use super::{fetch_encoded, stream_version, PayloadError};

    let store = TemplateStore::default();
    published(&store, "live", "bounded native SDK body");
    let oversized = compressed(&[b' '; 1025]);
    let mut exact_limit = vec![b' '; 1024];
    exact_limit[..2].copy_from_slice(b"{}");
    assert_eq!(
        stream_version(&compressed(&exact_limit), Some("gzip"), 1024),
        Ok(0)
    );
    assert_eq!(
        stream_version(&oversized, Some("gzip"), 1024),
        Err(PayloadError::TooLarge)
    );
    assert_eq!(
        fetch_encoded(
            &store.current(),
            PROJECT,
            None,
            &oversized,
            Some("gzip"),
            1024
        )
        .status,
        413
    );
    let truncated = &compressed(b"{lastKnownVersionNumber:'21'}")[..10];
    assert_eq!(
        stream_version(truncated, Some("gzip"), 1024),
        Err(PayloadError::Malformed)
    );
    let nested = format!("{{custom_signals:{}'x'{}}}", "[".repeat(33), "]".repeat(33));
    assert_eq!(
        stream_version(&compressed(nested.as_bytes()), Some("gzip"), 1024),
        Err(PayloadError::Malformed)
    );
    let quoted_braces = format!(
        "{{unused:'{}',lastKnownVersionNumber:'21'}}",
        "[".repeat(40)
    );
    assert_eq!(
        stream_version(&compressed(quoted_braces.as_bytes()), Some("gzip"), 1024),
        Ok(21)
    );
    assert!(!super::client_project(
        "0100000000004",
        PROJECT,
        Some(100_000_000_004)
    ));
}

#[test]
fn only_nonempty_native_package_names_appear_in_update() {
    let store = TemplateStore::default();
    published(&store, "live", "native package field");
    for (platform, package, expected) in [
        ("web", "com.example.web", None),
        ("android", "", None),
        ("ios", "com.example.apple", Some("com.example.apple")),
    ] {
        let request = json!({
            "app_id": format!("1:100000000004:{platform}:aa01"),
            "package_name": package,
        });
        let body = serde_json::to_vec(&request).unwrap();
        let reply = fetch(&store.current(), PROJECT, None, &body);
        assert_eq!(reply.status, 200);
        let answer: Value = serde_json::from_slice(&reply.body).unwrap();
        assert_eq!(answer.get("appName").and_then(Value::as_str), expected);
    }
}
