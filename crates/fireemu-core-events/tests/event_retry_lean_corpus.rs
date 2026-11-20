//! Replays the executable Lean specification of the bounded event retry policy.

use fireemu_core_events::retry::{RetryPolicy, RetryPolicyError};
use fireemu_core_types::time::LogicalDuration;

#[test]
fn event_retry_matches_lean() {
    let mut lines = include_str!("fixtures/lean-event-retry.corpus").lines();
    assert_eq!(lines.next(), Some("# 672 cases."));
    assert_eq!(lines.clone().count(), 672);
    for line in lines {
        let columns: Vec<_> = line.split('\t').collect();
        let [_, _, _, attempts, base, cap, doublings, window, attempt, elapsed, expected] =
            columns.as_slice()
        else {
            panic!("malformed fixture row: {line}");
        };
        let duration = |s: &str| LogicalDuration::from_nanos(s.parse().unwrap());
        let max_attempts = attempts.parse().unwrap();
        let policy = if *doublings == "-" {
            assert_eq!(*window, "-");
            RetryPolicy::try_new(max_attempts, duration(base), duration(cap))
        } else {
            RetryPolicy::try_with_limits(
                max_attempts,
                duration(base),
                duration(cap),
                doublings.parse().unwrap(),
                (*window != "-").then(|| duration(window)),
            )
        };
        let actual = match policy {
            Ok(policy) => {
                let attempt = attempt.parse().unwrap();
                format!(
                    "{},{},{}",
                    policy.backoff_for_attempt(attempt).as_nanos(),
                    policy.allows_retry_after(attempt),
                    policy.allows_retry_after_elapsed(attempt, duration(elapsed))
                )
            }
            Err(RetryPolicyError::ZeroAttempts) => "zero".to_owned(),
            Err(RetryPolicyError::NegativeBackoff) => "negative".to_owned(),
            Err(RetryPolicyError::BaseExceedsMax) => "inverted".to_owned(),
        };
        assert_eq!(actual, *expected, "{line}");
    }
}
