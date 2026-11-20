//! Replays the executable Lean event phase contract through public transitions.

use fireemu_core_events::event::{EventSource, EventType, LogicalEvent};
use fireemu_core_events::retry::RetryPolicy;
use fireemu_core_events::state::{EventRecord, EventState, EventTransitionError, FailureOutcome};
use fireemu_core_types::ids::{CorrelationId, Epoch, EventId, SessionId};
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};

fn event() -> LogicalEvent {
    LogicalEvent {
        event_id: EventId::new(1),
        session_id: SessionId::new(1),
        epoch: Epoch::initial(),
        source: EventSource::Manual,
        event_type: EventType::try_new("test.phase").unwrap(),
        subject: String::new(),
        logical_time: LogicalInstant::UNIX_EPOCH,
        causation_id: None,
        correlation_id: CorrelationId::new(1),
        payload: Vec::new(),
    }
}

fn policy(attempts: u32, max_age: Option<i128>) -> RetryPolicy {
    let unit = LogicalDuration::from_nanos(1);
    RetryPolicy::try_with_limits(
        attempts,
        unit,
        unit,
        0,
        max_age.map(LogicalDuration::from_nanos),
    )
    .unwrap()
}

fn state(record: &EventRecord) -> (&'static str, String) {
    let (name, payload, terminal) = match record.state() {
        EventState::Pending => ("pending", "-".to_owned(), false),
        EventState::Leased => ("leased", "-".to_owned(), false),
        EventState::Running => ("running", "-".to_owned(), false),
        EventState::Succeeded => ("succeeded", "-".to_owned(), true),
        EventState::RetryWaiting { retry_at } => {
            ("waiting", retry_at.as_nanos().to_string(), false)
        }
        EventState::DeadLettered { attempts } => ("dead", attempts.to_string(), true),
        EventState::Cancelled => ("cancelled", "-".to_owned(), true),
        EventState::DiscardedStaleEpoch => ("stale", "-".to_owned(), true),
    };
    assert_eq!(record.is_terminal(), terminal);
    (name, payload)
}

fn newer_epoch() -> Epoch {
    Epoch::new(Epoch::initial().value() + 1)
}

fn prepare(source: &str) -> EventRecord {
    let mut record = EventRecord::new(event());
    match source {
        "pending" => {}
        "leased" => record.lease().unwrap(),
        "cancelled" => record.cancel().unwrap(),
        "stale" => record.discard_stale(newer_epoch()).unwrap(),
        "running" | "succeeded" | "waiting" | "dead" => {
            record.lease().unwrap();
            record.start().unwrap();
            match source {
                "succeeded" => record.succeed().unwrap(),
                "waiting" | "dead" => {
                    let attempts = if source == "waiting" { 2 } else { 1 };
                    record
                        .fail(&policy(attempts, None), LogicalInstant::from_nanos(10))
                        .unwrap();
                }
                _ => {}
            }
        }
        "retry-leased" | "retry-running" => {
            record.lease().unwrap();
            record.start().unwrap();
            record
                .fail(&policy(2, None), LogicalInstant::from_nanos(10))
                .unwrap();
            record.retry_due(LogicalInstant::from_nanos(11)).unwrap();
            record.lease().unwrap();
            assert_eq!(record.attempt(), 1);
            if source == "retry-running" {
                record.start().unwrap();
                assert_eq!(record.attempt(), 2);
            }
        }
        _ => panic!("unknown source phase: {source}"),
    }
    assert_eq!(
        state(&record).0,
        source.strip_prefix("retry-").unwrap_or(source)
    );
    record
}

#[test]
fn event_phase_transitions_match_lean() {
    let mut lines = include_str!("fixtures/lean-event-transition.corpus").lines();
    assert_eq!(lines.next(), Some("# 480 cases."));
    assert_eq!(lines.clone().count(), 480);
    for line in lines {
        let columns: Vec<_> = line.split('\t').collect();
        let [source, action, _, now, newer, limit, max_age, outcome, phase, attempt, payload] =
            columns.as_slice()
        else {
            panic!("malformed fixture row: {line}");
        };
        let mut record = prepare(source);
        let state_before = record.state().clone();
        let now = LogicalInstant::from_nanos(now.parse().unwrap());
        let policy = policy(
            limit.parse().unwrap(),
            (*max_age != "-").then(|| max_age.parse().unwrap()),
        );
        let result = match *action {
            "lease" => record.lease().map(|()| "ok"),
            "start" => record.start().map(|()| "ok"),
            "succeed" => record.succeed().map(|()| "ok"),
            "interrupt" => record.interrupt().map(|()| "ok"),
            "retry" => record.retry_due(now).map(|()| "ok"),
            "cancel" => record.cancel().map(|()| "ok"),
            "discard" => record
                .discard_stale(if *newer == "true" {
                    newer_epoch()
                } else {
                    Epoch::initial()
                })
                .map(|()| "ok"),
            "fail" => record.fail(&policy, now).map(|failure| match failure {
                FailureOutcome::RetryScheduled { retry_at } => {
                    assert_eq!(record.state(), &EventState::RetryWaiting { retry_at });
                    "scheduled"
                }
                FailureOutcome::DeadLettered => "dead-lettered",
            }),
            _ => panic!("unknown action: {line}"),
        };
        let actual = match result {
            Ok(s) => s,
            Err(EventTransitionError::Terminal { state }) => {
                assert_eq!(state, state_before.name(), "{line}");
                "terminal"
            }
            Err(EventTransitionError::InvalidTransition { from, action: got }) => {
                assert_eq!(from, state_before.name(), "{line}");
                assert_eq!(got, *action, "{line}");
                "invalid"
            }
            Err(EventTransitionError::RetryNotDue) => "not-due",
            Err(EventTransitionError::EpochIsCurrent) => "epoch-current",
            Err(EventTransitionError::AttemptOverflow) => "attempt-overflow",
            Err(EventTransitionError::RetryInstantOverflow) => "instant-overflow",
        };
        assert_eq!(actual, *outcome, "{line}");
        assert_eq!(state(&record), (*phase, (*payload).to_owned()), "{line}");
        assert_eq!(record.attempt(), attempt.parse::<u32>().unwrap(), "{line}");
    }
}
