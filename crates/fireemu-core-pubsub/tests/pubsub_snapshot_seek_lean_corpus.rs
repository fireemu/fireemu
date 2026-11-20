//! Replays snapshot reconciliation, deadline-token invalidation and retained ID boundaries.

use fireemu_core_pubsub::{
    Filter, PubsubMessage, PushConfig, StoredMessage, SubscriptionConfig, SubscriptionName,
    SubscriptionState, TopicName,
};
use fireemu_core_types::time::LogicalInstant;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

const CORPUS: &str = include_str!("fixtures/lean-pubsub-snapshot-seek.corpus");

fn message(id: &str, time: i64, keep: bool) -> StoredMessage {
    StoredMessage {
        message_id: id.to_owned(),
        publish_time: LogicalInstant::from_unix_seconds(time),
        message: PubsubMessage {
            data: id.as_bytes().to_vec(),
            attributes: BTreeMap::from([(
                "shape".to_owned(),
                if keep { "keep" } else { "drop" }.to_owned(),
            )]),
            ..PubsubMessage::default()
        },
    }
}

fn setup(filter: Filter) -> SubscriptionState {
    SubscriptionState::new(SubscriptionConfig {
        name: SubscriptionName::new("p", "target").unwrap(),
        topic: TopicName::new("p", "events").unwrap(),
        ack_deadline_seconds: 10,
        labels: BTreeMap::new(),
        expiration_policy: None,
        retain_acked_messages: true,
        message_retention_duration: None,
        enable_message_ordering: false,
        filter,
        dead_letter_policy: None,
        retry_policy: None,
        push_config: PushConfig::default(),
    })
}

#[test]
fn snapshot_seek_reconciles_order_and_invalidates_old_tokens() {
    let mut rows = CORPUS.lines();
    assert!(rows.next().unwrap().starts_with("# target membership|"));
    assert_eq!(rows.clone().count(), 108);
    for row in rows {
        let [members, mask, filter, published, expected]: [&str; 5] =
            row.split('|').collect::<Vec<_>>().try_into().unwrap();
        let filter = match filter {
            "all" => Filter::always(),
            "keep" => Filter::parse("attributes.shape = \"keep\"").unwrap(),
            "reject" => Filter::parse("attributes.shape = \"neither\"").unwrap(),
            _ => panic!("{row}"),
        };
        let mask = mask.parse::<usize>().unwrap();
        let captured = [
            Arc::new(message("a", 10, true)),
            Arc::new(message("b", 8, false)),
        ];
        let retained: BTreeSet<_> = captured
            .iter()
            .map(|item| item.message_id.clone())
            .collect();
        let pending: BTreeSet<_> = captured
            .iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) != 0)
            .map(|(_, item)| item.message_id.clone())
            .collect();
        let mut state = setup(filter.clone());
        let now = LogicalInstant::from_unix_seconds(12);
        let captured_indices: &[usize] = match members {
            "fresh" => &[],
            "partial" => &[1],
            "covered" => &[0, 1],
            _ => panic!("{row}"),
        };
        let target = std::iter::once(message("old", 9, true))
            .chain(captured_indices.iter().map(|i| (*captured[*i]).clone()))
            .chain(std::iter::once(message(
                "post",
                published.parse().unwrap(),
                true,
            )));
        for item in target {
            if filter.matches(&item.message.attributes) {
                state.enqueue(item, now).unwrap();
            }
        }

        let mut serial = 0;
        let mut token = || {
            serial += 1;
            serial.to_string()
        };
        let old_tokens = state
            .pull(20, now, &mut token)
            .received
            .into_iter()
            .map(|item| item.ack_id)
            .collect::<Vec<_>>();
        state
            .seek_to_snapshot(
                &captured,
                &retained,
                &pending,
                LogicalInstant::from_unix_seconds(10),
                now,
            )
            .unwrap();
        assert_eq!(state.acknowledge(&old_tokens), 0, "{row}");

        let outcome = state.pull(20, now, &mut token);
        assert!(outcome.dead_lettered.is_empty(), "{row}");
        let delivered = outcome
            .received
            .iter()
            .map(|item| item.message.message_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(delivered.join(","), expected, "{row}");
        assert!(
            outcome
                .received
                .iter()
                .all(|item| !old_tokens.contains(&item.ack_id)),
            "{row}"
        );
    }
}
