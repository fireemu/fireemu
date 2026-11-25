//! The client data plane against RC-CLOSURE-B's recorded answers (both passes, sanitised in
//! conformance/remote-config-web): bodies byte for byte, the tag's form and relations, the frames.

use proptest::prelude::*;
use serde_json::{json, Value};

use super::{
    client_route, etag, fetch, frame, java_hash, last_known, micro_percentile, ClientAction,
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
fn the_hash_is_java_string_hash_code() {
    // Java: "".hashCode() == 0, "a".hashCode() == 97, "ab" == 3105, and the recorded relation
    // of production's tags: one more in the last digit before a final character adds 31.
    assert_eq!(java_hash(""), 0);
    assert_eq!(java_hash("a"), 97);
    assert_eq!(java_hash("ab"), 3105);
    assert_eq!(java_hash("x49\n").wrapping_sub(java_hash("x48\n")), 31);
    assert_eq!(java_hash("x50\n").wrapping_sub(java_hash("x49\n")), 682);
    let empty = std::collections::BTreeMap::new();
    assert!(etag("p", 3, &empty).starts_with("etag-p-firebase-fetch-"));
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
