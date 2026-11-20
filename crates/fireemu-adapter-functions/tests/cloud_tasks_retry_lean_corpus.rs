//! Replays Cloud Tasks exhaustion, declared backoff and production floors.

use fireemu_adapter_functions::tasks_production::retry_gap_millis;
use fireemu_core_functions::manifest::TaskRetryConfig;

#[test]
fn cloud_tasks_retry_matches_lean() {
    let mut lines = include_str!("fixtures/lean-cloud-tasks-retry.corpus").lines();
    assert_eq!(
        lines.next(),
        Some("# exhaustion and backoff rows, pipe-delimited")
    );
    let mut count = 0;
    for row in lines {
        let fields: Vec<_> = row.split('|').collect();
        match fields.as_slice() {
            ["exhausted", limit, budget, elapsed, attempt, expected] => {
                let config = TaskRetryConfig {
                    max_attempts: limit.parse().unwrap(),
                    max_retry_millis: match *budget {
                        "none" => None,
                        "zero" => Some(0),
                        "positive" => Some(10),
                        value => panic!("invalid budget: {value}"),
                    },
                    ..TaskRetryConfig::default()
                };
                assert_eq!(
                    config.exhausted(attempt.parse().unwrap(), elapsed.parse().unwrap()),
                    expected.parse::<bool>().unwrap(),
                    "{row}"
                );
            }
            ["backoff", _, attempt, production, base, cap, doublings, declared, gap] => {
                let config = TaskRetryConfig {
                    min_backoff_millis: base.parse().unwrap(),
                    max_backoff_millis: cap.parse().unwrap(),
                    max_doublings: doublings.parse().unwrap(),
                    ..TaskRetryConfig::default()
                };
                let attempt = attempt.parse().unwrap();
                let actual_declared = config.backoff_millis(attempt);
                assert_eq!(actual_declared, declared.parse::<u64>().unwrap(), "{row}");
                assert_eq!(
                    retry_gap_millis(actual_declared, attempt, production.parse().unwrap()),
                    gap.parse::<u64>().unwrap(),
                    "{row}"
                );
            }
            _ => panic!("invalid fixture row: {row}"),
        }
        count += 1;
    }
    assert_eq!(count, 984);
}
