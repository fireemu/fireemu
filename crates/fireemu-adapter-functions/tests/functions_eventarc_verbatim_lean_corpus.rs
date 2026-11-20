//! Replays the Eventarc sentinel channel's admission and attribute projection.

use fireemu_adapter_functions::eventarc::{accept_verbatim, missing_type};
use serde_json::{json, Value};

const CORPUS: &str = include_str!("fixtures/lean-functions-eventarc-verbatim.corpus");
const TYPE_REQUIRED: &str = "CloudEvent 'type' is required.";

fn scalar(shape: &str, example: &str) -> Option<Value> {
    match shape {
        "absent" => None,
        "null" => Some(Value::Null),
        "false" => Some(json!(false)),
        "true" => Some(json!(true)),
        "zero" => Some(json!(0)),
        "negative-zero" => Some(json!(-0.0)),
        "nonzero" => Some(json!(-1)),
        "empty" => Some(json!("")),
        "text" => Some(json!(example)),
        "array" => Some(json!([])),
        "object" => Some(json!({})),
        _ => panic!("unknown scalar fixture: {shape}"),
    }
}

fn nested(shape: &str) -> Option<Value> {
    match shape {
        "absent" => None,
        "plain" => Some(json!("plain")),
        "string" => Some(json!({"ceString":"string","ceTimestamp":"ignored"})),
        "timestamp" => Some(json!({"ceTimestamp":"timestamp"})),
        "malformed" => Some(json!({"ceString":false,"ceTimestamp":"ignored"})),
        "null" => Some(Value::Null),
        _ => panic!("unknown nested fixture: {shape}"),
    }
}

#[test]
fn sentinel_admission_and_projection_follow_lean() {
    let mut lines = CORPUS.lines();
    assert!(lines.next().unwrap().starts_with("# type|"));
    assert_eq!(lines.clone().count(), 726);
    for line in lines {
        let [kind, top, extra, allows, verbatim_type, projected, combined]: [&str; 7] =
            line.split('|').collect::<Vec<_>>().try_into().unwrap();
        let mut event = json!({"id":"event","data":{"n":[0,1]}});
        if let Some(value) = scalar(kind, "alert") {
            event["type"] = value;
        }
        if let Some(value) = scalar(top, "top") {
            event["probe"] = value;
        }
        if let Some(value) = nested(extra) {
            event["attributes"] = json!({"probe": value});
        }
        let refusal = missing_type(&event);
        assert_eq!(
            refusal.as_deref(),
            (allows == "false").then_some(TYPE_REQUIRED),
            "{line}"
        );
        let converted = accept_verbatim(&event);
        assert_eq!(
            converted.as_ref().ok().map(|r| r.event_type.as_str()),
            verbatim_type.strip_prefix('+'),
            "{line}"
        );
        if let Ok(result) = &converted {
            assert_eq!(result.event, event, "{line}");
            assert_eq!(result.raw_data, None, "{line}");
            assert_eq!(
                result.attributes.get("probe").map(String::as_str),
                projected.strip_prefix('+'),
                "{line}"
            );
        } else {
            assert_eq!(converted.as_ref().unwrap_err(), TYPE_REQUIRED, "{line}");
        }
        let combined_type = refusal.is_none().then_some(converted).and_then(Result::ok);
        assert_eq!(
            combined_type.as_ref().map(|r| r.event_type.as_str()),
            combined.strip_prefix('+'),
            "{line}"
        );
    }
}
