//! Replays snapshot lifetime and expiration through the broker's public API.

use fireemu_core_pubsub::{
    Filter, PubSubState, PubsubMessage, PushConfig, SubscriptionConfig, SubscriptionName, TopicName,
};
use fireemu_core_types::time::LogicalInstant;
use std::collections::BTreeMap;

const CORPUS: &str = include_str!("fixtures/lean-pubsub-snapshot-lifetime.corpus");
const NAME: &str = "projects/p/snapshots/snapshot-1";

fn publish(state: &mut PubSubState, topic: &TopicName, at: LogicalInstant) {
    state
        .publish(
            topic,
            vec![PubsubMessage {
                data: vec![1],
                ..PubsubMessage::default()
            }],
            at,
        )
        .unwrap();
}

fn ack_one(state: &mut PubSubState, source: &SubscriptionName, at: LogicalInstant) {
    let message = state.pull(source, 1, at).unwrap().pop().unwrap();
    assert_eq!(state.acknowledge(source, &[message.ack_id]).unwrap(), 1);
}

fn setup(backlog: &str) -> (PubSubState, TopicName, SubscriptionName) {
    let mut state = PubSubState::new(1);
    let topic = TopicName::new("p", "events").unwrap();
    state.create_topic(topic.clone(), BTreeMap::new()).unwrap();
    let source = SubscriptionName::new("p", "source").unwrap();
    state
        .create_subscription(SubscriptionConfig {
            name: source.clone(),
            topic: topic.clone(),
            ack_deadline_seconds: 10,
            labels: BTreeMap::new(),
            expiration_policy: None,
            retain_acked_messages: matches!(backlog, "retained-acked" | "mixed"),
            message_retention_duration: None,
            enable_message_ordering: false,
            filter: Filter::always(),
            dead_letter_policy: None,
            retry_policy: None,
            push_config: PushConfig::default(),
        })
        .unwrap();
    (state, topic, source)
}

#[test]
fn snapshot_lifetime_and_visibility_follow_lean() {
    let mut lines = CORPUS.lines();
    assert!(lines.next().unwrap().starts_with("# age class|"));
    assert_eq!(lines.clone().count(), 120);
    for line in lines {
        let [_, age, backlog, now_ns, _, lookup_at, expiry, visible]: [&str; 8] =
            line.split('|').collect::<Vec<_>>().try_into().unwrap();
        let now = now_ns.parse::<i128>().unwrap();
        let now_at = LogicalInstant::from_nanos(now);
        let previous = LogicalInstant::from_nanos(now - age.parse::<i128>().unwrap());
        let (mut state, topic, source) = setup(backlog);
        if backlog != "empty" {
            publish(&mut state, &topic, previous);
            if backlog != "pending" {
                ack_one(&mut state, &source, previous);
            }
            if backlog == "mixed" {
                publish(&mut state, &topic, LogicalInstant::from_nanos(now - 1));
            }
        }

        let created = state.create_snapshot("", &source, BTreeMap::new(), now_at);
        if expiry == "-" {
            let error = created.unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("snapshot lifetime must be at least 3600 seconds"),
                "{line}"
            );
            assert!(state.list_snapshots("p", now_at).is_empty(), "{line}");
            ack_one(&mut state, &source, previous);
            let retry = state
                .create_snapshot("", &source, BTreeMap::new(), now_at)
                .unwrap();
            assert_eq!(retry.name, NAME, "{line}");
            continue;
        }

        let created = created.unwrap_or_else(|error| panic!("{line}: {error}"));
        assert_eq!(created.name, NAME, "{line}");
        assert_eq!(created.created_at, now_at, "{line}");
        assert_eq!(
            created.expire_at.as_nanos(),
            expiry.parse::<i128>().unwrap(),
            "{line}"
        );
        let unacked = usize::from(matches!(backlog, "pending" | "mixed"));
        assert_eq!(created.unacknowledged_message_ids.len(), unacked, "{line}");
        if backlog == "retained-acked" {
            assert_eq!(created.retained_message_ids.len(), 1, "{line}");
        }

        let lookup_at = LogicalInstant::from_nanos(lookup_at.parse::<i128>().unwrap());
        let found = state.get_snapshot(NAME, lookup_at);
        assert_eq!(found.is_ok(), visible == "true", "{line}");
        assert_eq!(
            state.list_snapshots("p", lookup_at).len(),
            usize::from(visible == "true"),
            "{line}"
        );
    }
}
