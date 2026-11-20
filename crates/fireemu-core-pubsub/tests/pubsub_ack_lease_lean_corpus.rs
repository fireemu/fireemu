//! Differential replay of one-message lease and dead-letter traces.

use fireemu_core_pubsub::{
    DeadLetterPolicy, DeliveryTimes, Filter, PubsubMessage, PushConfig, RetryPolicy, StoredMessage,
    SubscriptionConfig, SubscriptionName, SubscriptionState, TopicName,
};
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};
use std::collections::BTreeMap;

const CORPUS: &str = include_str!("fixtures/lean-pubsub-ack-lease.corpus");

fn make_subscription(mode: &str, policy: &str, scenario: &str) -> SubscriptionState {
    let mut state = SubscriptionState::new(SubscriptionConfig {
        name: SubscriptionName::new("p", "sub").unwrap(),
        topic: TopicName::new("p", "topic").unwrap(),
        ack_deadline_seconds: 10,
        labels: BTreeMap::new(),
        expiration_policy: None,
        retain_acked_messages: false,
        message_retention_duration: None,
        enable_message_ordering: false,
        filter: Filter::always(),
        dead_letter_policy: (scenario == "forward").then(|| DeadLetterPolicy {
            dead_letter_topic: TopicName::new("p", "dead").unwrap(),
            max_delivery_attempts: 5,
        }),
        retry_policy: (policy == "bounded").then(|| RetryPolicy {
            minimum_backoff: LogicalDuration::from_seconds(2),
            maximum_backoff: LogicalDuration::from_seconds(8),
        }),
        push_config: PushConfig {
            push_endpoint: if mode == "push" {
                "local".into()
            } else {
                String::new()
            },
            attributes: BTreeMap::new(),
        },
    });
    if policy == "push-min" {
        state.set_push_minimum_redelivery_interval(LogicalDuration::from_seconds(3));
    }
    state
        .enqueue(
            StoredMessage {
                message_id: "message".into(),
                publish_time: LogicalInstant::UNIX_EPOCH,
                message: PubsubMessage {
                    data: vec![1],
                    ..PubsubMessage::default()
                },
            },
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();
    state
}

fn at(logical: &str, delivery: &str) -> DeliveryTimes {
    DeliveryTimes::new(
        LogicalInstant::from_unix_seconds(logical.parse().unwrap()),
        LogicalInstant::from_unix_seconds(delivery.parse().unwrap()),
    )
}

fn pull(state: &mut SubscriptionState, serial: &mut u32, max: &str, now: DeliveryTimes) -> String {
    let outcome = state.pull(max.parse().unwrap(), now, || {
        *serial += 1;
        serial.to_string()
    });
    match (
        outcome.received.as_slice(),
        outcome.dead_lettered.as_slice(),
    ) {
        ([], []) => "-".into(),
        ([], [forwarded]) => {
            assert_eq!(forwarded.message_id, "message");
            "forward".into()
        }
        ([item], []) => {
            assert_eq!(item.message.message_id, "message");
            format!("pull:{}:{}", item.ack_id, item.delivery_attempt)
        }
        _ => panic!("one-message model returned multiple outputs"),
    }
}

#[test]
fn replay_ack_lease_and_attempts() {
    let mut rows = CORPUS.lines();
    let count: usize = rows
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(rows.clone().count(), count);
    assert_eq!(count, 624);
    let mut sub = None;
    let mut serial = 0;
    let mut traces = 0;
    for row in rows {
        let fields: Vec<_> = row.split('\t').collect();
        if let ["trace", mode, backoff, _, family] = fields.as_slice() {
            sub = Some(make_subscription(mode, backoff, family));
            serial = 0;
            traces += 1;
            continue;
        }
        let [op, logical, delivery, first, second, expected, cursor, outstanding, pending, unacked] =
            fields.as_slice()
        else {
            panic!("malformed lease row: {row}");
        };
        let state = sub.as_mut().unwrap();
        let result = match *op {
            "pull" => pull(state, &mut serial, first, at(logical, delivery)),
            "expire" => {
                state.expire_deadlines(at(logical, delivery));
                "-".into()
            }
            "modify" => {
                state.modify_ack_deadline(first, second.parse().unwrap(), at(logical, delivery));
                "-".into()
            }
            "ack" => format!(
                "ack:{}",
                state.acknowledge(&[(*first).into(), (*first).into()])
            ),
            "complete" => format!("complete:{}", state.complete_forward(first)),
            _ => panic!("unknown lease operation: {op}"),
        };
        assert_eq!(result, *expected, "{row}");
        let next = state.next_available_at().map(LogicalInstant::as_nanos);
        let expected_at = (*cursor != "-").then(|| cursor.parse::<i128>().unwrap() * 1_000_000_000);
        assert_eq!(next, expected_at, "{row}");
        assert_eq!(
            state.outstanding_count(),
            outstanding.parse::<usize>().unwrap(),
            "{row}"
        );
        assert_eq!(
            state.pending_forwards().len(),
            pending.parse::<usize>().unwrap(),
            "{row}"
        );
        assert_eq!(
            state.retention_accounting().0,
            unacked.parse::<usize>().unwrap(),
            "{row}"
        );
    }
    assert_eq!(traces, 48);
}
