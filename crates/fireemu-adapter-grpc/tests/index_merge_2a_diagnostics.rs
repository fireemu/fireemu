//! Observation 2a diagnostics for `RunQuery` and adjacent routes.

use std::sync::{Arc, Mutex};

use fireemu_core_firestore::index::{IndexSet, IndexValidationPolicy, PlanningContext};
use fireemu_core_session::clock::VirtualClock;
use fireemu_core_types::edition::{FirestoreApiMode, FirestoreEdition};
use fireemu_core_types::time::LogicalInstant;
use serde_json::{json, Value};

use fireemu_adapter_grpc::gateway::Gateway;
use fireemu_adapter_grpc::local::LocalBackend;
use fireemu_adapter_grpc::rest::{json_syntax::KeyOrder, RestRequest, RestState};

fn state(edition: FirestoreEdition, policy: IndexValidationPolicy) -> RestState {
    let gateway = Gateway {
        enforce_limits: policy.production_rules(),
        ctx: PlanningContext {
            edition,
            api_mode: FirestoreApiMode::Native,
            policy,
        },
        indexes: IndexSet::default(),
    };
    let clock = Arc::new(Mutex::new(VirtualClock::new(
        LogicalInstant::from_unix_seconds(1_788_004_860),
    )));
    let local = Arc::new(LocalBackend::new(gateway.clone(), clock, 7));
    RestState {
        local,
        gateway: Arc::new(gateway),
        rules: None,
        app_check: None,
        control_token: None,
    }
}

fn post(state: &RestState, action: &str, body: Value) -> Value {
    let response = state.handle(&RestRequest {
        method: "POST".to_owned(),
        path: format!("/v1/projects/demo-app/databases/(default)/documents:{action}"),
        query: String::new(),
        authorization: Some("Bearer owner".to_owned()),
        origin: None,
        remote_peer: false,
        browser_metadata: false,
        app_check: Vec::new(),
        body,
        batch_field_order: Vec::new(),
        key_order: KeyOrder::default(),
    });
    assert_eq!(response.status, 400, "{action}: {}", response.body);
    response.body
}

#[test]
fn recorded_diagnostics_keep_other_actions_editions_and_profiles() {
    let table = include_str!("fixtures/index-merge-obs2-diagnostics.tsv");
    let across_range = "9999-12-31T23:59:59-00:01";
    for row in table.lines().skip(1) {
        let fields: Vec<_> = row.split('\t').collect();
        let [edition, profile, action, shape] = fields.as_slice() else {
            panic!("bad row: {row}")
        };
        let standard = *edition == "standard";
        let strict = *profile == "strict";
        let state = state(
            if standard {
                FirestoreEdition::Standard
            } else {
                FirestoreEdition::Enterprise
            },
            if strict {
                IndexValidationPolicy::Production
            } else {
                IndexValidationPolicy::Emulator
            },
        );
        let mut query = json!({"from": [{"collectionId": "observations"}]});
        let order = |direction| json!({"field": {"fieldPath": "__name__"}, "direction": direction});
        match *shape {
            "filterOffset" => {
                query["where"] = json!({"fieldFilter": {
                    "field": {"fieldPath": "t"}, "op": "EQUAL", "value": {"timestampValue": across_range},
                }});
            }
            "duplicateKey" => query["orderBy"] = json!([order("DESCENDING"), order("ASCENDING")]),
            "reverseKey" => query["orderBy"] = json!([order("ASCENDING"), order("DESCENDING")]),
            "readTimeOffset" => {}
            _ => panic!("bad shape: {row}"),
        }
        let regular = *action == "runQuery";
        let mut body = if regular {
            json!({"structuredQuery": query})
        } else {
            json!({"structuredAggregationQuery": {"structuredQuery": query, "aggregations": [{"count":{}, "alias":"n"}]}})
        };
        if *shape == "readTimeOffset" {
            body["readTime"] = json!(across_range);
        }
        let response = post(&state, action, body);
        let message = response[0]["error"]["message"]
            .as_str()
            .or_else(|| response["error"]["message"].as_str())
            .unwrap();
        if matches!(*shape, "duplicateKey" | "reverseKey") {
            let key_order_message = (regular && standard && *shape == "duplicateKey") || !strict;
            let expected = if key_order_message {
                "more fields after the key"
            } else {
                "duplicate fields"
            };
            assert!(message.contains(expected), "{row}: {message}");
        } else {
            assert_eq!(
                message.contains("Timestamp value exceeds limits"),
                regular && standard && strict && *shape == "filterOffset",
                "{row}: {message}",
            );
        }
    }
}

#[test]
fn standard_strict_equality_checks_each_recorded_timestamp_bound() {
    let state = state(
        FirestoreEdition::Standard,
        IndexValidationPolicy::Production,
    );
    for timestamp in ["0001-01-01T00:00:00+00:01", "0000-01-01T00:00:00+00:01"] {
        let response = post(
            &state,
            "runQuery",
            json!({"structuredQuery": {
                "from": [{"collectionId": "observations"}],
                "where": {"fieldFilter": {"field": {"fieldPath": "t"}, "op": "EQUAL", "value": {"timestampValue": timestamp}}},
            }}),
        );
        assert!(
            response
                .to_string()
                .contains("Timestamp value exceeds limits"),
            "{response}"
        );
    }
}
