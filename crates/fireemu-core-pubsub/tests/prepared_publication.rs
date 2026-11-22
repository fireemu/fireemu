//! Admission and project ownership checks for the public broker API.

use std::collections::BTreeMap;

use fireemu_core_pubsub::subscription::DEFAULT_ACK_DEADLINE_SECONDS;
use fireemu_core_pubsub::{
    Code, Filter, PubSubState, PubsubMessage, PushConfig, SubscriptionConfig, SubscriptionName,
    TopicName,
};
use fireemu_core_types::time::LogicalInstant;

const NOW: LogicalInstant = LogicalInstant::from_unix_seconds(100);

fn subscribe(state: &mut PubSubState, id: &str, topic: &TopicName) -> SubscriptionName {
    let name = SubscriptionName::new("consumer-project", id).unwrap();
    state
        .create_subscription(SubscriptionConfig {
            name: name.clone(),
            topic: topic.clone(),
            ack_deadline_seconds: DEFAULT_ACK_DEADLINE_SECONDS,
            labels: BTreeMap::new(),
            expiration_policy: None,
            retain_acked_messages: false,
            message_retention_duration: None,
            enable_message_ordering: false,
            filter: Filter::always(),
            dead_letter_policy: None,
            retry_policy: None,
            push_config: PushConfig::default(),
        })
        .unwrap();
    name
}

fn broker() -> (PubSubState, TopicName, SubscriptionName) {
    let mut state = PubSubState::new(17);
    let topic = TopicName::new("source-project", "events").unwrap();
    state.create_topic(topic.clone(), BTreeMap::new()).unwrap();
    let subscription = subscribe(&mut state, "events-sub", &topic);
    (state, topic, subscription)
}

fn message(data: &[u8]) -> PubsubMessage {
    PubsubMessage {
        data: data.to_vec(),
        ..PubsubMessage::default()
    }
}

#[test]
fn a_competing_publication_rejects_the_stale_preparation_without_enqueuing_it() {
    let (mut state, topic, subscription) = broker();
    let prepared = state
        .prepare_publish(&topic, vec![message(b"prepared")], NOW)
        .unwrap();
    let committed = state.publish(&topic, vec![message(b"other")], NOW).unwrap();
    let error = state.commit_prepared(prepared, NOW).unwrap_err();
    assert_eq!(error.code(), Code::FailedPrecondition);
    let messages = state.pull(&subscription, 10, NOW).unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].message.message.data, b"other");
    assert_eq!(messages[0].message.message_id, committed[0]);
}

#[test]
fn a_new_subscription_invalidates_the_preparation_without_delivery() {
    let (mut state, topic, original) = broker();
    let prepared = state
        .prepare_publish(&topic, vec![message(b"prepared")], NOW)
        .unwrap();
    let added = subscribe(&mut state, "added-sub", &topic);
    let error = state.commit_prepared(prepared, NOW).unwrap_err();
    assert_eq!(error.code(), Code::FailedPrecondition);
    assert!(state.pull(&original, 10, NOW).unwrap().is_empty());
    assert!(state.pull(&added, 10, NOW).unwrap().is_empty());
}

#[test]
fn recreating_a_topic_invalidates_prepared_work_even_without_subscriptions() {
    let mut state = PubSubState::new(17);
    let topic = TopicName::new("source-project", "events").unwrap();
    state.create_topic(topic.clone(), BTreeMap::new()).unwrap();
    let prepared = state
        .prepare_publish(&topic, vec![message(b"prepared")], NOW)
        .unwrap();
    state.delete_topic(&topic).unwrap();
    state.create_topic(topic.clone(), BTreeMap::new()).unwrap();

    assert_eq!(
        state.commit_prepared(prepared, NOW).unwrap_err().code(),
        Code::FailedPrecondition
    );
    assert_eq!(
        state.publish(&topic, vec![message(b"fresh")], NOW).unwrap(),
        [fireemu_core_pubsub::pubsub_message_id(1)]
    );
}

#[test]
fn replacing_an_empty_snapshot_with_an_equal_length_name_invalidates_prepared_work() {
    let (mut state, topic, subscription) = broker();
    let before = "projects/consumer-project/snapshots/old";
    let after = "projects/consumer-project/snapshots/new";
    state
        .create_snapshot(before, &subscription, BTreeMap::new(), NOW)
        .unwrap();
    let prepared = state
        .prepare_publish(&topic, vec![message(b"prepared")], NOW)
        .unwrap();
    state.delete_snapshot(before, NOW).unwrap();
    state
        .create_snapshot(after, &subscription, BTreeMap::new(), NOW)
        .unwrap();

    assert_eq!(
        state.commit_prepared(prepared, NOW).unwrap_err().code(),
        Code::FailedPrecondition
    );
    assert_eq!(state.list_topic_snapshots(&topic, NOW).unwrap(), [after]);
    assert!(state.pull(&subscription, 10, NOW).unwrap().is_empty());
}

#[test]
fn snapshot_retention_on_another_topic_invalidates_the_shared_budget_admission() {
    let (mut state, topic, subscription) = broker();
    let other_topic = TopicName::new("source-project", "other-events").unwrap();
    state
        .create_topic(other_topic.clone(), BTreeMap::new())
        .unwrap();
    let other_subscription = subscribe(&mut state, "other-sub", &other_topic);
    let prepared = state
        .prepare_publish(&topic, vec![message(b"prepared")], NOW)
        .unwrap();
    let snapshot = "projects/consumer-project/snapshots/unrelated";
    state
        .create_snapshot(snapshot, &other_subscription, BTreeMap::new(), NOW)
        .unwrap();

    assert_eq!(
        state.commit_prepared(prepared, NOW).unwrap_err().code(),
        Code::FailedPrecondition
    );
    assert!(state.list_topic_snapshots(&topic, NOW).unwrap().is_empty());
    assert_eq!(
        state.list_topic_snapshots(&other_topic, NOW).unwrap(),
        [snapshot]
    );
    assert!(state.pull(&subscription, 10, NOW).unwrap().is_empty());
}

#[test]
fn snapshot_owner_must_match_the_subscription_project_even_for_cross_project_topics() {
    let (mut state, topic, subscription) = broker();
    let owned = "projects/consumer-project/snapshots/owned";
    state
        .create_snapshot(owned, &subscription, BTreeMap::new(), NOW)
        .unwrap();
    for project in ["source-project", "other-project"] {
        let wrong = format!("projects/{project}/snapshots/foreign");
        let error = state
            .create_snapshot(&wrong, &subscription, BTreeMap::new(), NOW)
            .unwrap_err();
        assert_eq!(error.code(), Code::InvalidArgument);
        assert_eq!(
            state.get_snapshot(&wrong, NOW).unwrap_err().code(),
            Code::NotFound
        );
        assert!(state.list_snapshots(project, NOW).is_empty());
    }
    assert_eq!(state.list_topic_snapshots(&topic, NOW).unwrap(), [owned]);
    assert_eq!(state.list_snapshots("consumer-project", NOW).len(), 1);
}
