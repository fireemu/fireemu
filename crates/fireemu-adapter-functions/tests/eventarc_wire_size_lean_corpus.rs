//! Replays independent protobuf size predictions from the Eventarc Lean model.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use fireemu_adapter_functions::{
    eventarc_channels::ChannelStore,
    eventarc_strict::{
        evaluate, field_len, route, varint_len, Input, Outcome, World, CLOUD_EVENT_TYPE_URL,
    },
};
use serde_json::{json, Value};

const CHANNEL: &str = "projects/demo/locations/us-central1/channels/c";

fn event(id: &str, data: &str, bytes: usize) -> Value {
    let mut value = json!({
        "@type": CLOUD_EVENT_TYPE_URL,
        "id": id,
        "source": "s",
        "specVersion": "1.0",
        "type": "t",
        "attributes": {"datacontenttype": {"ceString": "application/json"}},
    });
    match data {
        "ascii" => value["textData"] = json!(format!("\"{}\"", "a".repeat(bytes - 2))),
        "unicode" => value["textData"] = json!(format!("\"é{}\"", "a".repeat(bytes - 4))),
        "binary" => value["binaryData"] = json!(STANDARD.encode(vec![0xb3; bytes])),
        _ => panic!("unknown representation {data}"),
    }
    value
}

fn replay_publish(fields: &[&str], line: &str) {
    let ["p", data, _, peers, payload, expected, request_size] = fields else {
        panic!("invalid publish row {line}")
    };
    let payload = payload.parse().unwrap();
    let peers = match *peers {
        "none" => 0,
        "one" => 1,
        "at-limit" => 99,
        "full" => 100,
        _ => panic!("invalid peer case {peers}"),
    };
    let mut events = vec![event("main", data, payload)];
    events.extend((0..peers).map(|index| event(&format!("p{index:03}"), "ascii", 2)));
    let body = json!({"events": events}).to_string();
    let route = route(
        "POST",
        "/v1/projects/demo/locations/us-central1/channels/c:publishEvents",
    )
    .unwrap();
    let channels = ChannelStore::default();
    let world = World {
        project: "demo",
        request_id: "0123456789abcdef",
        declared_channel: &|name| name == CHANNEL,
        declared_in: &|_, _| Vec::new(),
        channels: &channels,
        now: 1_791_000_000_000_000_000,
    };
    let outcome = evaluate(
        &Input {
            route: &route,
            query: None,
            bearer: Some("ya29.local-test"),
            body: body.as_bytes(),
        },
        &world,
    );
    if *expected == "deliver" {
        let Outcome::Deliver {
            channel,
            events: delivered,
        } = outcome
        else {
            panic!("{line}: expected delivery, got {outcome:?}")
        };
        assert_eq!(channel, CHANNEL, "{line}");
        assert_eq!(delivered, events, "{line}");
    } else {
        let Outcome::Answer(answer) = outcome else {
            panic!("{line}: expected an error response")
        };
        assert_eq!(answer.status, 400, "{line}");
        let (status, message) = match *expected {
            "event-count" => ("OUT_OF_RANGE", "Too many events.".to_owned()),
            "event-size" => (
                "INVALID_ARGUMENT",
                format!("The event size ({request_size} bytes) is too large. The maximum size is 524288 bytes."),
            ),
            "binary" => (
                "INVALID_ARGUMENT",
                "The provided data needs to be in text format. Please set \u{60}text_data\u{60} in the CloudEvent.".to_owned(),
            ),
            _ => panic!("unknown outcome {expected}"),
        };
        assert_eq!(
            answer.body["error"]["status"].as_str(),
            Some(status),
            "{line}"
        );
        assert_eq!(
            answer.body["error"]["message"].as_str(),
            Some(message.as_str()),
            "{line}"
        );
        if *expected == "event-size" {
            assert_eq!(
                answer.body["error"]["details"][0]["fieldViolations"][0]["field"].as_str(),
                Some("events[0]"),
                "{line}"
            );
        }
    }
}

#[test]
fn eventarc_wire_size_agrees_with_the_lean_reference() {
    let mut lines = include_str!("fixtures/lean-eventarc-wire-size.corpus").lines();
    assert_eq!(
        lines.next(),
        Some("# Eventarc protobuf wire lengths and publish outcomes")
    );
    let mut counts = [0; 3];
    for line in lines {
        let fields: Vec<_> = line.split('|').collect();
        match fields.as_slice() {
            ["v", input, expected] => {
                assert_eq!(
                    varint_len(input.parse().unwrap()),
                    expected.parse::<usize>().unwrap(),
                    "{line}"
                );
                counts[0] += 1;
            }
            ["f", input, expected] => {
                assert_eq!(
                    field_len(input.parse().unwrap()),
                    expected.parse::<usize>().unwrap(),
                    "{line}"
                );
                counts[1] += 1;
            }
            ["p", ..] => {
                replay_publish(&fields, line);
                counts[2] += 1;
            }
            _ => panic!("invalid corpus row {line}"),
        }
    }
    assert_eq!(counts, [30, 10, 48]);
}
