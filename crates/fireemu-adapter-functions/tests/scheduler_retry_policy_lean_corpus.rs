//! Replays the isolated Scheduler retry projection and admission decisions.

use fireemu_adapter_functions::runtime::schedule_retry_policy;
use fireemu_core_functions::manifest::{FunctionGeneration, ScheduleRetryConfig};
use fireemu_core_types::time::LogicalDuration;

#[test]
fn scheduler_retry_policy_agrees_with_the_lean_projection() {
    let mut rows = include_str!("fixtures/lean-scheduler-retry-policy.corpus").lines();
    assert_eq!(
        rows.next(),
        Some("# Scheduler retry projection and decision probes")
    );
    let mut configurations = 0;
    let mut total_probes = 0;
    for row in rows {
        let chunks: Vec<_> = row.split('|').collect();
        let [generation, _, _, _, _, count, window, minimum, maximum, doublings, expected_attempts, expected_minimum, expected_maximum, refused, deadline, probes] =
            chunks.as_slice()
        else {
            panic!("invalid policy row {row}")
        };
        let config = ScheduleRetryConfig {
            retry_count: count.parse().unwrap(),
            max_retry_seconds: window.parse().unwrap(),
            min_backoff_seconds: minimum.parse().unwrap(),
            max_backoff_seconds: maximum.parse().unwrap(),
            max_doublings: doublings.parse().unwrap(),
        };
        let generation = match *generation {
            "first" => FunctionGeneration::First,
            "second" => FunctionGeneration::Second,
            _ => panic!("invalid generation {generation}"),
        };
        let policy = schedule_retry_policy(&config, generation);
        assert_eq!(
            policy.max_attempts(),
            expected_attempts.parse::<u32>().unwrap(),
            "{row}"
        );
        assert_eq!(
            policy.base_backoff().as_seconds(),
            expected_minimum.parse::<i128>().unwrap(),
            "{row}"
        );
        assert_eq!(
            policy.max_backoff().as_seconds(),
            expected_maximum.parse::<i128>().unwrap(),
            "{row}"
        );
        let refusal = refused.parse::<bool>().unwrap().then_some(
            "invalid retry count. The retry_count must be a positive integer less than 5: invalid argument",
        );
        assert_eq!(config.scheduler_refusal(), refusal, "{row}");
        let deadline: i128 = deadline.parse().unwrap();
        let mut probe_count = 0;
        for probe in probes.split(';') {
            let parts: Vec<_> = probe.split(',').collect();
            let [attempt, expected_delay, answers] = parts.as_slice() else {
                panic!("invalid timing probe {probe}")
            };
            let attempt = attempt.parse().unwrap();
            let delay: i128 = expected_delay.parse().unwrap();
            assert_eq!(
                policy.backoff_for_attempt(attempt).as_nanos(),
                delay,
                "{row}"
            );
            let mut decisions = answers.bytes();
            for elapsed in [0, deadline - delay, i128::MAX - 1] {
                for moment in [elapsed, elapsed + 1] {
                    let allow = match decisions.next() {
                        Some(b'0') => false,
                        Some(b'1') => true,
                        _ => panic!("invalid decision bits {probe}"),
                    };
                    assert_eq!(
                        policy.allows_retry_after_elapsed(
                            attempt,
                            LogicalDuration::from_nanos(moment)
                        ),
                        allow,
                        "{row} at {moment}",
                    );
                }
                probe_count += 1;
            }
            assert_eq!(decisions.next(), None);
        }
        assert_eq!(probe_count, 27);
        total_probes += probe_count;
        configurations += 1;
    }
    assert_eq!(configurations, 540);
    assert_eq!(total_probes, 14_580);
}
