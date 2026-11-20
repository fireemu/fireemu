//! Replays the executable Lean fault selection contract and the bounded history.

use fireemu_core_session::fault::{
    FaultAction, FaultMatch, FaultPlan, FaultRecord, FaultRule, FaultState,
};

fn rule(function: Option<&str>, event: Option<&str>, nth: Option<u64>, id: i64) -> FaultRule {
    FaultRule {
        matches: FaultMatch {
            operation: "invoke".to_owned(),
            nth,
            function: function.map(str::to_owned),
            event_type: event.map(str::to_owned),
        },
        action: FaultAction::Delay { seconds: id },
    }
}

fn plan(which: &str) -> Option<FaultPlan> {
    let rules = match which {
        "none" => return None,
        "all" => vec![rule(None, None, None, 1)],
        "global" => vec![rule(None, None, Some(2), 2)],
        "function" => vec![rule(Some("f1"), None, Some(1), 3)],
        "event" => vec![rule(None, Some("created"), None, 4)],
        "overlap" => vec![
            rule(Some("f2"), None, Some(2), 5),
            rule(None, None, None, 1),
            rule(None, Some("created"), None, 4),
            rule(None, None, None, 1),
        ],
        _ => panic!("unknown plan: {which}"),
    };
    Some(FaultPlan { seed: 1, rules })
}

fn action_id(action: &FaultAction) -> i64 {
    if let FaultAction::Delay { seconds } = action {
        *seconds
    } else {
        panic!("unexpected action: {action:?}");
    }
}

fn encode_record(record: &FaultRecord) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        record.operation,
        record.function.as_deref().unwrap_or("-"),
        record.occurrence,
        record
            .function_occurrence
            .map_or_else(|| "-".to_owned(), |n| n.to_string()),
        action_id(&record.action)
    )
}

fn joined(values: impl IntoIterator<Item = String>) -> String {
    let mut values = values.into_iter();
    let Some(first) = values.next() else {
        return "-".to_owned();
    };
    values.fold(first, |head, next| head + "," + &next)
}

fn assert_clear(state: &FaultState) {
    assert!(state.counters().is_empty());
    assert!(state.fired().is_empty());
    assert_eq!(state.dropped_fired(), 0);
}

#[test]
fn session_fault_selection_matches_lean() {
    let mut lines = include_str!("fixtures/lean-session-fault.corpus").lines();
    assert_eq!(lines.next(), Some("# 113 cases."));
    assert_eq!(lines.clone().count(), 113);
    for line in lines {
        let columns: Vec<_> = line.split('\t').collect();
        let mut state = FaultState::default();
        match columns.as_slice() {
            ["history", matches, calls, dropped, expected] => {
                let rules = (1..=matches.parse::<i64>().unwrap())
                    .map(|id| rule(None, None, None, id))
                    .collect();
                let plan = FaultPlan { seed: 1, rules };
                state.install(plan.clone());
                let expected_per_call = matches.parse::<usize>().unwrap();
                let calls: u64 = calls.parse().unwrap();
                for _ in 0..calls {
                    assert_eq!(
                        state.decide("invoke", Some("f1"), None).len(),
                        expected_per_call
                    );
                }
                assert_eq!(state.counters().get("invoke"), Some(&calls));
                assert_eq!(state.counters().get("invoke|f1"), Some(&calls));
                assert_eq!(state.dropped_fired(), dropped.parse::<u64>().unwrap());
                assert_eq!(joined(state.fired().iter().map(encode_record)), *expected);

                state.install(plan);
                assert_clear(&state);
                assert_eq!(
                    state.decide("invoke", Some("f1"), None).len(),
                    expected_per_call
                );
                state.clear();
                assert!(state.plan().is_none());
                assert!(state.decide("invoke", Some("f1"), None).is_empty());
                assert_clear(&state);
            }
            [which, op, function, event, actions, records, counts] => {
                if let Some(p) = plan(which) {
                    state.install(p);
                }
                let _ = state.decide("invoke", Some("f2"), Some("deleted"));
                let actions_taken = state.decide(
                    op,
                    (*function != "-").then_some(*function),
                    (*event != "-").then_some(*event),
                );
                assert_eq!(
                    joined(actions_taken.iter().map(|a| action_id(a).to_string())),
                    *actions,
                    "{line}"
                );
                assert_eq!(
                    joined(state.fired().iter().map(encode_record)),
                    *records,
                    "{line}"
                );
                let names = [
                    "invoke",
                    "invoke|f1",
                    "invoke|f2",
                    "read",
                    "read|f1",
                    "read|f2",
                ];
                let expected: Vec<u64> = counts.split(',').map(|s| s.parse().unwrap()).collect();
                assert_eq!(expected.len(), names.len());
                for (key, count) in names.into_iter().zip(&expected) {
                    assert_eq!(
                        state.counters().get(key).copied(),
                        (*count != 0).then_some(*count),
                        "{line}"
                    );
                }
                assert_eq!(
                    state.counters().len(),
                    expected.iter().filter(|&&count| count != 0).count()
                );
                assert_eq!(state.dropped_fired(), 0);
            }
            _ => panic!("malformed fixture row: {line}"),
        }
    }
}
