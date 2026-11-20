//! Replays the Lean fixed-window and tracked reservation specification.

use fireemu_core_auth::signup_quota::{
    QuotaConfigError, QuotaError, QuotaMode, SignupQuota, SignupQuotaConfig, SignupReservation,
    TemporaryQuota,
};
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};

const CORPUS: &str = include_str!("fixtures/lean-auth-signup-quota.corpus");
const HOUR: i128 = 3_600_000_000_000;
const PROJECT: &str = "project";
const PEER: &str = "192.0.2.1";

fn offer_tag(result: &Result<SignupReservation, QuotaError>) -> &'static str {
    match result {
        Ok(reservation) if reservation.would_exceed => "over",
        Ok(_) => "ok",
        Err(QuotaError::Exceeded) => "exceeded",
        Err(QuotaError::InvalidPeerAddress) => "invalid-peer",
        other => panic!("unexpected reservation {other:?}"),
    }
}

fn check_finalizer(result: Result<(), QuotaError>, expected: &str, line: &str) {
    let tag = match result {
        Ok(()) => "ok",
        Err(QuotaError::StaleReservation) => "stale",
        Err(QuotaError::InvalidReservation) => "invalid",
        other => panic!("unexpected finalizer {other:?}"),
    };
    assert_eq!(tag, expected, "{line}");
}

fn config_tag(result: Result<(), QuotaConfigError>) -> &'static str {
    match result {
        Ok(()) => "ok",
        Err(QuotaConfigError::DefaultQuotaOutOfRange) => "default",
        Err(QuotaConfigError::BucketLimitOutOfRange) => "buckets",
        Err(QuotaConfigError::QuotaOutOfRange) => "quota",
        Err(QuotaConfigError::DurationNotPositive) => "duration",
        Err(QuotaConfigError::IntervalOverflow) => "overflow",
        Err(other) => panic!("unexpected configuration refusal {other:?}"),
    }
}

fn mode(tag: &str) -> QuotaMode {
    match tag {
        "off" => QuotaMode::Off,
        "observe" => QuotaMode::Observe,
        "enforce" => QuotaMode::Enforce,
        _ => panic!("unexpected mode {tag}"),
    }
}

fn quota(mode: QuotaMode, limit: u64, temporary: Option<TemporaryQuota>) -> SignupQuota {
    SignupQuota::new(SignupQuotaConfig {
        mode,
        default_quota_per_hour: limit,
        temporary,
        ..SignupQuotaConfig::default()
    })
    .unwrap()
}

fn check_trace(fields: [&str; 10], line: &str) {
    let [kind, limit, action, initial, held_probe, finalizer, duplicate, committed, held, end_probe] =
        fields;
    let limit: u64 = limit.parse().unwrap();
    let zero = LogicalInstant::from_nanos(0);
    let temporary = (action == "override").then(|| {
        TemporaryQuota::new(
            limit + 1,
            LogicalInstant::from_nanos(1),
            LogicalDuration::from_nanos(10),
        )
        .unwrap()
    });
    let mut quota = quota(mode(kind), limit, temporary);
    let offer = quota.reserve(PROJECT, PEER, zero);
    assert_eq!(offer_tag(&offer), initial, "{line}");
    let probe = quota.reserve(PROJECT, PEER, zero);
    assert_eq!(offer_tag(&probe), held_probe, "{line}");
    if let Ok(probe) = probe {
        quota.release(probe).unwrap();
    }
    let mut now = zero;
    if let Ok(reservation) = offer {
        if action == "late" {
            now = LogicalInstant::from_nanos(HOUR);
        } else if action == "override" {
            now = LogicalInstant::from_nanos(1);
        } else if action == "changed" {
            quota.set_config(quota.config().clone()).unwrap();
        }
        let saved = reservation.clone();
        let result = if action == "release" {
            quota.release(reservation)
        } else {
            quota.commit(reservation, now)
        };
        check_finalizer(result, finalizer, line);
        check_finalizer(quota.commit(saved, now), duplicate, line);
    } else {
        assert_eq!((finalizer, duplicate), ("skipped", "skipped"), "{line}");
    }
    assert_eq!(
        quota.usage(PROJECT, PEER, zero),
        (committed.parse().unwrap(), held.parse().unwrap()),
        "{line}"
    );
    assert_eq!(
        offer_tag(&quota.reserve(PROJECT, PEER, now)),
        end_probe,
        "{line}"
    );
}

#[test]
fn signup_quota_matches_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let declared = lines
        .next()
        .unwrap()
        .strip_prefix("# cases ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert_eq!(declared, lines.clone().count());
    assert!(declared > 200);
    for line in lines {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        match fields.as_slice() {
            ["config", limit, buckets, expected] => {
                let config = SignupQuotaConfig {
                    default_quota_per_hour: limit.parse().unwrap(),
                    max_tracked_buckets: buckets.parse().unwrap(),
                    ..SignupQuotaConfig::default()
                };
                assert_eq!(config_tag(config.validate()), *expected, "{line}");
            }
            ["temporary", limit, start, duration, expected] => {
                let actual = TemporaryQuota::new(
                    limit.parse().unwrap(),
                    LogicalInstant::from_nanos(start.parse().unwrap()),
                    LogicalDuration::from_nanos(duration.parse().unwrap()),
                );
                assert_eq!(config_tag(actual.map(|_| ())), *expected, "{line}");
            }
            ["window", before, after, result] => {
                let mut quota = quota(QuotaMode::Enforce, 1, None);
                let before = LogicalInstant::from_nanos(before.parse().unwrap());
                let after = LogicalInstant::from_nanos(after.parse().unwrap());
                let reservation = quota.reserve(PROJECT, PEER, before).unwrap();
                check_finalizer(quota.commit(reservation, after), result, line);
                let committed = u64::from(*result == "ok");
                assert_eq!(quota.usage(PROJECT, PEER, before), (committed, 0), "{line}");
            }
            ["override", now, expected] => {
                let temporary = TemporaryQuota::new(
                    1,
                    LogicalInstant::from_nanos(-1),
                    LogicalDuration::from_nanos(2),
                )
                .unwrap();
                let mut quota = quota(QuotaMode::Enforce, 0, Some(temporary));
                let time = LogicalInstant::from_nanos(now.parse().unwrap());
                assert_eq!(
                    offer_tag(&quota.reserve(PROJECT, PEER, time)),
                    *expected,
                    "{line}"
                );
            }
            ["peer", kind, peer, expected] => {
                let peer = match *peer {
                    "empty" => "",
                    "control" => "ip\t",
                    "valid" => PEER,
                    _ => panic!("unexpected peer {peer}"),
                };
                let mut quota = quota(mode(kind), 1, None);
                assert_eq!(
                    offer_tag(&quota.reserve(PROJECT, peer, LogicalInstant::from_nanos(0))),
                    *expected,
                    "{line}"
                );
            }
            ["trace", tail @ ..] => check_trace(tail.try_into().unwrap(), line),
            _ => panic!("malformed case {line}"),
        }
    }
}
