//! Replays the numeric and ordered validation contract for subscription configuration.

use fireemu_core_pubsub::{
    subscription::{
        DeadLetterPolicy, ExpirationPolicy, PushConfig, RetryPolicy, SubscriptionConfig,
    },
    Code, Filter, Result, SubscriptionName, TopicName,
};
use fireemu_core_types::time::LogicalDuration;
use std::collections::BTreeMap;

const CORPUS: &str = include_str!("fixtures/lean-pubsub-subscription.corpus");

fn duration(nanos: &str) -> LogicalDuration {
    LogicalDuration::from_nanos(nanos.parse().unwrap())
}

fn optional_duration(nanos: &str) -> Option<LogicalDuration> {
    (nanos != "-").then(|| duration(nanos))
}

fn config(ack: &str, retention: &str) -> SubscriptionConfig {
    SubscriptionConfig {
        name: SubscriptionName::new("p", "sub").unwrap(),
        topic: TopicName::new("p", "topic").unwrap(),
        ack_deadline_seconds: ack.parse().unwrap(),
        labels: BTreeMap::new(),
        expiration_policy: None,
        retain_acked_messages: false,
        message_retention_duration: optional_duration(retention),
        enable_message_ordering: false,
        filter: Filter::always(),
        dead_letter_policy: None,
        retry_policy: None,
        push_config: PushConfig::default(),
    }
}

fn check_issue(result: Result<()>, expected: &str, line: &str) {
    let prefix = match expected {
        "ok" => {
            assert!(result.is_ok(), "{line}: {result:?}");
            return;
        }
        "coreAck" => "ackDeadlineSeconds must be ",
        "productionAck" => "Invalid ack deadline given ",
        "retention" => "The value for message retention duration is out of bounds.",
        "deadLow" => "The value for max_delivery_attempts is too small.",
        "deadHigh" => "The value for max_delivery_attempts is too large.",
        "retryMin" => "The value for minimum_backoff is out of bounds.",
        "retryMax" => "The value for maximum_backoff is out of bounds.",
        "retryOrder" => "The specified maximum_backoff ",
        "labels" => "You have passed an invalid argument to the service (argument=Invalid labels:",
        "expiryMinimum" => "The value for expiration duration is too small.",
        "retentionAfterExpiry" => "The subscription's message retention duration ",
        _ => panic!("unknown validation issue {expected}: {line}"),
    };
    let error = result.unwrap_err();
    assert_eq!(error.code(), Code::InvalidArgument, "{line}");
    assert!(error.message().starts_with(prefix), "{line}: {error:?}");
}

#[test]
fn replay_subscription_configuration() {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(count, 2478);
    assert_eq!(lines.clone().count(), count);
    for line in lines {
        let row = line.split('\t').collect::<Vec<_>>();
        match row.as_slice() {
            ["core", _, _, _, _, ack, retention, dead, retry_min, retry_max, expected] => {
                let mut config = config(ack, retention);
                if *dead != "-" {
                    config.dead_letter_policy = Some(DeadLetterPolicy {
                        dead_letter_topic: TopicName::new("p", "dead").unwrap(),
                        max_delivery_attempts: dead.parse().unwrap(),
                    });
                }
                if *retry_min != "-" {
                    config.retry_policy = Some(RetryPolicy {
                        minimum_backoff: duration(retry_min),
                        maximum_backoff: duration(retry_max),
                    });
                }
                check_issue(config.validate(), expected, line);
            }
            ["production", _, _, _, labels, ack, retention, expiry, expected, resolved] => {
                let mut config = config(ack, retention);
                if *labels == "invalid" {
                    config.labels.insert("A".into(), "value".into());
                }
                config.expiration_policy = match *expiry {
                    "default" => None,
                    "never" => Some(ExpirationPolicy { ttl: None }),
                    nanos => Some(ExpirationPolicy {
                        ttl: Some(duration(nanos)),
                    }),
                };
                assert_eq!(config.resolved_retention(), duration(resolved), "{line}");
                check_issue(config.validate_production_configuration(), expected, line);
            }
            _ => panic!("malformed subscription row: {line}"),
        }
    }
}
