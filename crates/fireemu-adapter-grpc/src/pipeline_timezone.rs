//! Named time zones for pipeline calendar functions.

use fireemu_core_firestore::pipeline_exec::{
    local_calendar_value, ZoneError, ZoneOperation, ZoneResult,
};
use fireemu_core_firestore::value::Timestamp;
use jiff::tz::{AmbiguousOffset, TimeZone, TimeZoneDatabase};

pub(crate) fn resolve(
    timestamp: Timestamp,
    zone: &str,
    unit: &str,
    operation: ZoneOperation,
) -> Result<ZoneResult, ZoneError> {
    let zone = match TimeZoneDatabase::bundled().get(zone) {
        // `Factory` is refused, as chrono-tz did.
        Ok(found) if zone != "Factory" && found.iana_name() == Some(zone) => found,
        _ if is_custom_gmt_offset(zone) => return Err(ZoneError::Unsupported),
        _ => return Err(ZoneError::InvalidZone),
    };
    let local_timestamp = Timestamp::new(
        timestamp.seconds() + offset_at(&zone, timestamp.seconds()),
        timestamp.nanos(),
    )
    .map_err(|_| ZoneError::OutOfRange)?;
    match local_calendar_value(local_timestamp, unit, operation)? {
        ZoneResult::Integer(value) => Ok(ZoneResult::Integer(value)),
        ZoneResult::Timestamp(boundary) => {
            let offset = unambiguous_wall_offset(&zone, boundary.seconds())?;
            let result = Timestamp::new(boundary.seconds() - offset, boundary.nanos())
                .map_err(|_| ZoneError::OutOfRange)?;
            Ok(ZoneResult::Timestamp(result))
        }
    }
}

/// The offset of `zone` at Unix second `utc_secs`. jiff's instants end late on 9999-12-30
/// (Firestore's run to the end of 9999); past them the offset of the nearest representable
/// instant applies, as the calendar functions did with chrono-tz.
fn offset_at(zone: &TimeZone, utc_secs: i64) -> i64 {
    let clamped = utc_secs.clamp(
        jiff::Timestamp::MIN.as_second(),
        jiff::Timestamp::MAX.as_second(),
    );
    let instant = jiff::Timestamp::from_second(clamped).unwrap_or(jiff::Timestamp::UNIX_EPOCH);
    i64::from(zone.to_offset(instant).seconds())
}

/// The single offset of local wall second `local_secs`, or `Ambiguous` for a skipped or
/// repeated wall time. Wall times past jiff's civil range use the nearest instant's offset.
fn unambiguous_wall_offset(zone: &TimeZone, local_secs: i64) -> Result<i64, ZoneError> {
    let days = local_secs.div_euclid(86_400);
    let of_day = local_secs.rem_euclid(86_400);
    let (year, month, day) = fireemu_core_types::time::civil_from_days(days);
    let civil = (|| {
        jiff::civil::DateTime::new(
            i16::try_from(year).ok()?,
            i8::try_from(month).ok()?,
            i8::try_from(day).ok()?,
            i8::try_from(of_day / 3_600).ok()?,
            i8::try_from(of_day / 60 % 60).ok()?,
            i8::try_from(of_day % 60).ok()?,
            0,
        )
        .ok()
    })();
    let Some(civil) = civil else {
        return Ok(offset_at(zone, local_secs));
    };
    match zone.to_ambiguous_timestamp(civil).offset() {
        AmbiguousOffset::Unambiguous { offset } => Ok(i64::from(offset.seconds())),
        AmbiguousOffset::Fold { .. } | AmbiguousOffset::Gap { .. } => Err(ZoneError::Ambiguous),
    }
}

// Recognize documented numeric GMT offset syntax without choosing its offset semantics.
fn is_custom_gmt_offset(zone: &str) -> bool {
    let Some(rest) = zone
        .strip_prefix("GMT")
        .and_then(|s| s.strip_prefix('+').or_else(|| s.strip_prefix('-')))
    else {
        return false;
    };
    let mut parts = rest.split(':');
    let valid = |part: &str, max: u8| {
        part.len() == 2
            && part.bytes().all(|b| b.is_ascii_digit())
            && part.parse::<u8>().is_ok_and(|n| n <= max)
    };
    let Some(hours) = parts.next() else {
        return false;
    };
    if !valid(hours, 23) {
        return false;
    }
    for part in parts.by_ref().take(2) {
        if !valid(part, 59) {
            return false;
        }
    }
    parts.next().is_none()
}

pub(crate) fn runtime(
    local: &crate::local::LocalBackend,
) -> fireemu_core_firestore::pipeline_exec::RuntimeContext {
    let nanos = local.admin_now().as_nanos();
    let timestamp = i64::try_from(nanos.div_euclid(1_000_000_000))
        .ok()
        .and_then(|seconds| {
            u32::try_from(nanos.rem_euclid(1_000_000_000) / 1_000 * 1_000)
                .ok()
                .and_then(|nanos| Timestamp::new(seconds, nanos).ok())
        });
    fireemu_core_firestore::pipeline_exec::RuntimeContext {
        request_timestamp: timestamp,
        zone_resolver: Some(resolve),
        regex_resolver: Some(crate::pipeline_regex::resolve),
        sample_seed: None,
        expr_rng: Some(std::sync::Arc::new(std::sync::Mutex::new(
            fireemu_core_types::determinism::SplitMix64::new(local.next_expr_seed()),
        ))),
    }
}

pub(crate) fn runtime_for_stages(
    local: &crate::local::LocalBackend,
    stages: &[fireemu_core_firestore::pipeline_exec::Stage],
) -> fireemu_core_firestore::pipeline_exec::RuntimeContext {
    let mut runtime = runtime(local);
    if stages.iter().any(|stage| {
        matches!(
            stage,
            fireemu_core_firestore::pipeline_exec::Stage::Sample(_)
        )
    }) {
        runtime.sample_seed = Some(local.next_sample_seed());
    }
    runtime
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokyo_recorded_calendar_and_invalid_zone() {
        let t = Timestamp::new(1_582_979_696, 789_012_000).unwrap();
        assert_eq!(
            resolve(t, "Asia/Tokyo", "day", ZoneOperation::Trunc),
            Ok(ZoneResult::Timestamp(
                Timestamp::new(1_582_902_000, 0).unwrap()
            ))
        );
        assert_eq!(
            resolve(t, "Asia/Tokyo", "hour", ZoneOperation::Extract),
            Ok(ZoneResult::Integer(21))
        );
        assert_eq!(
            resolve(t, "Not/AZone", "hour", ZoneOperation::Extract),
            Err(ZoneError::InvalidZone)
        );
        assert_eq!(
            resolve(t, "Factory", "hour", ZoneOperation::Extract),
            Err(ZoneError::InvalidZone)
        );
        // Names are case-sensitive, as they were with chrono-tz.
        assert_eq!(
            resolve(t, "asia/tokyo", "hour", ZoneOperation::Extract),
            Err(ZoneError::InvalidZone)
        );
    }

    #[test]
    fn dst_boundary_is_not_silently_chosen() {
        let t = Timestamp::new(1_699_165_800, 0).unwrap();
        assert_eq!(
            resolve(t, "America/New_York", "hour", ZoneOperation::Trunc),
            Err(ZoneError::Ambiguous)
        );
    }
    #[test]
    fn request_samples_configured_clock_once() {
        use fireemu_core_firestore::index::{IndexSet, IndexValidationPolicy, PlanningContext};
        use fireemu_core_session::clock::VirtualClock;
        use fireemu_core_types::edition::{FirestoreApiMode, FirestoreEdition};
        use fireemu_core_types::time::LogicalInstant;
        use std::sync::{Arc, Mutex};
        let clock = Arc::new(Mutex::new(VirtualClock::new(
            LogicalInstant::from_unix_seconds(100),
        )));
        let local = crate::local::LocalBackend::new(
            crate::gateway::Gateway {
                enforce_limits: false,
                ctx: PlanningContext {
                    edition: FirestoreEdition::Enterprise,
                    api_mode: FirestoreApiMode::Native,
                    policy: IndexValidationPolicy::Emulator,
                },
                indexes: IndexSet::default(),
            },
            clock.clone(),
            7,
        );
        let first = runtime(&local);
        clock
            .lock()
            .unwrap()
            .advance_to(LogicalInstant::from_unix_seconds(200))
            .unwrap();
        let second = runtime(&local);
        assert_eq!(
            first.request_timestamp,
            Some(Timestamp::new(100, 0).unwrap())
        );
        assert_eq!(
            second.request_timestamp,
            Some(Timestamp::new(200, 0).unwrap())
        );
    }

    #[test]
    fn request_clock_floors_submicroseconds_for_both_epoch_sides() {
        use fireemu_core_firestore::index::{IndexSet, IndexValidationPolicy, PlanningContext};
        use fireemu_core_session::clock::VirtualClock;
        use fireemu_core_types::edition::{FirestoreApiMode, FirestoreEdition};
        use fireemu_core_types::time::LogicalInstant;
        use std::sync::{Arc, Mutex};
        let clock = Arc::new(Mutex::new(VirtualClock::new(LogicalInstant::from_nanos(
            -1,
        ))));
        let local = crate::local::LocalBackend::new(
            crate::gateway::Gateway {
                enforce_limits: false,
                ctx: PlanningContext {
                    edition: FirestoreEdition::Enterprise,
                    api_mode: FirestoreApiMode::Native,
                    policy: IndexValidationPolicy::Emulator,
                },
                indexes: IndexSet::default(),
            },
            clock.clone(),
            7,
        );
        assert_eq!(
            runtime(&local).request_timestamp,
            Some(Timestamp::new(-1, 999_999_000).unwrap())
        );
        clock
            .lock()
            .unwrap()
            .advance_to(LogicalInstant::from_nanos(1_000_001_234))
            .unwrap();
        assert_eq!(
            runtime(&local).request_timestamp,
            Some(Timestamp::new(1, 1_000).unwrap())
        );
        clock
            .lock()
            .unwrap()
            .set_allow_backwards(LogicalInstant::from_nanos(i128::MIN));
        assert_eq!(runtime(&local).request_timestamp, None);
        clock
            .lock()
            .unwrap()
            .set_allow_backwards(LogicalInstant::from_nanos(i128::MAX));
        assert_eq!(runtime(&local).request_timestamp, None);
    }

    #[test]
    fn documented_gmt_offsets_are_unobserved_but_bad_names_are_invalid() {
        let t = Timestamp::new(1_582_979_696, 0).unwrap();
        assert_eq!(
            resolve(t, "GMT+06:32:43", "hour", ZoneOperation::Extract),
            Err(ZoneError::Unsupported)
        );
        assert_eq!(
            resolve(t, "not-a-zone", "hour", ZoneOperation::Extract),
            Err(ZoneError::InvalidZone)
        );
        assert_eq!(
            resolve(t, "GMT+bad", "hour", ZoneOperation::Extract),
            Err(ZoneError::InvalidZone)
        );
    }

    #[test]
    fn dst_gap_and_other_zone() {
        let gap_day = Timestamp::new(1_541_332_800, 0).unwrap();
        assert_eq!(
            resolve(gap_day, "America/Sao_Paulo", "day", ZoneOperation::Trunc),
            Err(ZoneError::Ambiguous)
        );
        let winter = Timestamp::new(1_704_067_200, 0).unwrap();
        assert_eq!(
            resolve(winter, "Europe/Berlin", "hour", ZoneOperation::Extract),
            Ok(ZoneResult::Integer(1))
        );
    }

    #[test]
    fn a_half_hour_fold_is_ambiguous_by_its_minutes() {
        let zone = TimeZoneDatabase::bundled()
            .get("Australia/Lord_Howe")
            .unwrap();
        // 2024-04-07T01:45 is repeated; 01:15 and 02:15 are not.
        assert_eq!(
            unambiguous_wall_offset(&zone, 1_712_454_300),
            Err(ZoneError::Ambiguous)
        );
        assert_eq!(unambiguous_wall_offset(&zone, 1_712_452_500), Ok(39_600));
        assert_eq!(unambiguous_wall_offset(&zone, 1_712_456_100), Ok(37_800));
    }

    #[test]
    fn the_last_day_of_9999_keeps_working() {
        // 9999-12-31T12:00:00Z is 07:00 in New York; the day starts at 9999-12-31T05:00:00Z.
        let t = Timestamp::new(253_402_257_600, 0).unwrap();
        assert_eq!(
            resolve(t, "America/New_York", "hour", ZoneOperation::Extract),
            Ok(ZoneResult::Integer(7))
        );
        assert_eq!(
            resolve(t, "America/New_York", "day", ZoneOperation::Trunc),
            Ok(ZoneResult::Timestamp(
                Timestamp::new(253_402_232_400, 0).unwrap()
            ))
        );
        let last = Timestamp::new(253_402_300_799, 999_999_999).unwrap();
        assert_eq!(
            resolve(last, "America/Los_Angeles", "hour", ZoneOperation::Extract),
            Ok(ZoneResult::Integer(15))
        );
        // Tokyo's wall clock is already in year 10000, which a Firestore timestamp cannot hold.
        assert_eq!(
            resolve(last, "Asia/Tokyo", "year", ZoneOperation::Extract),
            Err(ZoneError::OutOfRange)
        );
    }
}
