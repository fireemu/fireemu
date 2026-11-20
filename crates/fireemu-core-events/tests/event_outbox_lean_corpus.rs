//! Replays dispatch and retry projections and evictions from the Lean outbox model.

use fireemu_core_events::event::{EventSource, EventType, LogicalEvent};
use fireemu_core_events::outbox::{Outbox, OutboxError};
use fireemu_core_events::retry::RetryPolicy;
use fireemu_core_events::state::{EventRecord, EventState, EventTransitionError};
use fireemu_core_types::ids::{CorrelationId, Epoch, EventId, SessionId};
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};

fn instant(n: &str) -> LogicalInstant {
    LogicalInstant::from_nanos(n.parse().unwrap())
}

fn event(id: EventId, when: LogicalInstant) -> LogicalEvent {
    LogicalEvent {
        event_id: id,
        session_id: SessionId::new(1),
        epoch: Epoch::initial(),
        source: EventSource::Manual,
        event_type: EventType::try_new("test.outbox").unwrap(),
        subject: String::new(),
        logical_time: when,
        causation_id: None,
        correlation_id: CorrelationId::new(id.value()),
        payload: Vec::new(),
    }
}

fn applied(outbox: &mut Outbox, command: &str) -> &'static str {
    let fields: Vec<_> = command.split(',').collect();
    let id = EventId::new(fields[1].parse().unwrap());
    if let ["enqueue", _, time, queue] = fields.as_slice() {
        let item = event(id, instant(time));
        let result = if *queue == "default" {
            outbox.enqueue(item)
        } else {
            outbox.enqueue_in_queue(item, queue)
        };
        return match result {
            Ok(()) => "ok",
            Err(OutboxError::DuplicateEventId(got)) => {
                assert_eq!(got, id);
                "duplicate"
            }
            Err(error) => panic!("unexpected enqueue result: {error}"),
        };
    }

    let result = match fields.as_slice() {
        ["lease", _] => outbox.update(id, EventRecord::lease),
        ["run", _] => outbox.update(id, EventRecord::start),
        ["interrupt", _] => outbox.update(id, EventRecord::interrupt),
        ["retire", _] => outbox.update(id, EventRecord::cancel),
        ["wait", _, now] => {
            let tick = LogicalDuration::from_nanos(1);
            let policy = RetryPolicy::try_new(20, tick, tick).unwrap();
            outbox.update(id, |r| r.fail(&policy, instant(now)).map(|_| ()))
        }
        ["release", _, now] => outbox.update(id, |r| r.retry_due(instant(now))),
        _ => panic!("malformed operation: {command}"),
    };
    match result {
        Ok(Ok(())) => "ok",
        Ok(Err(EventTransitionError::Terminal { .. })) => "terminal",
        Ok(Err(EventTransitionError::InvalidTransition { .. })) => "invalid",
        Ok(Err(EventTransitionError::RetryNotDue)) => "not-due",
        Err(OutboxError::UnknownEventId(got)) => {
            assert_eq!(got, id);
            "unknown"
        }
        unexpected => panic!("unexpected outcome: {unexpected:?}"),
    }
}

fn text_list(values: impl IntoIterator<Item = String>) -> String {
    let fields: Vec<_> = values.into_iter().collect();
    if fields.is_empty() {
        "-".to_owned()
    } else {
        fields.join(",")
    }
}

fn key((time, id): (LogicalInstant, EventId)) -> String {
    format!("{}:{}", time.as_nanos(), id.value())
}

fn snapshot(outbox: &Outbox) -> String {
    assert_eq!(
        outbox.is_empty(),
        (1..=4).all(|id| outbox.record(EventId::new(id)).is_none())
    );
    let pending: Vec<_> = outbox
        .dispatchable()
        .map(|event| event.event_id.value().to_string())
        .collect();
    assert_eq!(outbox.dispatch_visits(), pending.len());
    let heads = text_list(outbox.dispatchable_queue_heads().map(|(queue, head)| {
        let after = outbox
            .next_dispatchable_in_queue(queue, head)
            .map_or_else(|| "-".to_owned(), key);
        let name = if queue.is_empty() { "default" } else { queue };
        format!("{name}:{}:{after}", key(head))
    }));
    assert!(outbox
        .next_dispatchable_in_queue("missing", (LogicalInstant::UNIX_EPOCH, EventId::new(0)))
        .is_none());
    let due: Vec<_> = [0, 2, 3, 4]
        .into_iter()
        .map(|time| {
            let instant = LogicalInstant::from_nanos(time);
            let ids = outbox.retries_due(instant);
            assert_eq!(outbox.retry_sweep_visits(instant), ids.len());
            text_list(ids.iter().map(|id| id.value().to_string()))
        })
        .collect();
    let entries = text_list((1..=4).map(|id| {
        let Some(record) = outbox.record(EventId::new(id)) else {
            return "-".to_owned();
        };
        match record.state() {
            EventState::Pending => "pending".to_owned(),
            EventState::Leased => "leased".to_owned(),
            EventState::Running => "running".to_owned(),
            EventState::RetryWaiting { retry_at } => format!("wait:{}", retry_at.as_nanos()),
            EventState::Cancelled => "terminal".to_owned(),
            unexpected => panic!("unexpected retained state: {unexpected:?}"),
        }
    }));
    [
        outbox.len().to_string(),
        outbox.has_active().to_string(),
        outbox.evicted().to_string(),
        text_list(pending),
        heads,
        due.join("/"),
        entries,
    ]
    .join("|")
}

#[test]
fn outbox_queue_and_retention_match_lean() {
    let mut lines = include_str!("fixtures/lean-event-outbox.corpus").lines();
    assert_eq!(lines.next(), Some("# 72 cases."));
    assert_eq!(lines.clone().count(), 72);
    for line in lines {
        let columns: Vec<_> = line.split('\t').collect();
        let [retention, layout, order, trace, replay] = columns.as_slice() else {
            panic!("malformed fixture row: {line}");
        };
        let retention = retention.parse::<usize>().unwrap();
        let mut outbox = Outbox::with_terminal_retention(retention);
        assert_eq!(outbox.terminal_retention(), retention.max(1));
        for step in replay.split(';') {
            let fields: Vec<_> = step.split('#').collect();
            let [command, result, expected] = fields.as_slice() else {
                panic!("malformed fixture step: {step}");
            };
            let context = format!("{retention}/{layout}/{order}/{trace}: {command}");
            assert_eq!(applied(&mut outbox, command), *result, "{context}");
            assert_eq!(snapshot(&outbox), *expected, "{context}");
        }
    }
}
