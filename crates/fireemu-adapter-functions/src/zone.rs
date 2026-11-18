//! IANA time zones for schedules (spec 11.4): `jiff` with its bundled zone database is the
//! single audited dependency that knows daylight-saving rules; the core only sees
//! [`ZoneRules`]. The database is bundled so results do not depend on the host's zoneinfo.

use std::sync::{Arc, LazyLock};

use fireemu_core_functions::cron::{fixed_offset_seconds, FixedOffset, ZoneRules};
use jiff::tz::{AmbiguousOffset, TimeZone, TimeZoneDatabase};
use jiff::Timestamp;

static DATABASE: LazyLock<TimeZoneDatabase> = LazyLock::new(TimeZoneDatabase::bundled);

/// The zone with exactly this IANA name (case-sensitive) from the bundled database.
/// `Factory` is refused, as chrono-tz did (it names no place and has no rules).
#[must_use]
pub fn iana(name: &str) -> Option<TimeZone> {
    if name == "Factory" {
        return None;
    }
    let zone = DATABASE.get(name).ok()?;
    (zone.iana_name() == Some(name)).then_some(zone)
}

/// The offset of `zone` at Unix second `utc_secs`, in seconds east of UTC. jiff's instants
/// end inside year 9999 (and begin inside year -9999); beyond them the offset of the nearest
/// representable instant applies, so schedules and calendars keep working up to the
/// calendar limits as they did with chrono-tz.
#[must_use]
pub fn offset_at(zone: &TimeZone, utc_secs: i64) -> i64 {
    let clamped = utc_secs.clamp(Timestamp::MIN.as_second(), Timestamp::MAX.as_second());
    let instant = Timestamp::from_second(clamped).unwrap_or(Timestamp::UNIX_EPOCH);
    i64::from(zone.to_offset(instant).seconds())
}

/// The offset that turns local wall second `local_secs` (seconds since 1970-01-01T00:00 of
/// the wall clock) into UTC: one offset, both offsets of a repeated hour (earlier first), or
/// none in a skipped hour. Outside jiff's civil range the offset of its nearest instant applies.
#[must_use]
pub fn wall_offsets(zone: &TimeZone, local_secs: i64) -> WallOffsets {
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
        return WallOffsets::One(offset_at(zone, local_secs));
    };
    match zone.to_ambiguous_timestamp(civil).offset() {
        AmbiguousOffset::Unambiguous { offset } => WallOffsets::One(i64::from(offset.seconds())),
        AmbiguousOffset::Fold { before, after } => {
            WallOffsets::Fold(i64::from(before.seconds()), i64::from(after.seconds()))
        }
        AmbiguousOffset::Gap { .. } => WallOffsets::Gap,
    }
}

/// See [`wall_offsets`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WallOffsets {
    /// The wall time happens once with this offset.
    One(i64),
    /// The wall time happens twice: the earlier instant's offset, then the later one's.
    Fold(i64, i64),
    /// The wall time is skipped.
    Gap,
}

/// A zone from the IANA database.
#[derive(Debug, Clone)]
pub struct IanaZone(pub TimeZone);

impl ZoneRules for IanaZone {
    fn local_of(&self, utc_secs: i64) -> i64 {
        utc_secs.saturating_add(offset_at(&self.0, utc_secs))
    }

    fn utc_of(&self, local_secs: i64) -> Option<i64> {
        match wall_offsets(&self.0, local_secs) {
            // The earlier instant of a repeated wall time, as before.
            WallOffsets::One(offset) | WallOffsets::Fold(offset, _) => {
                local_secs.checked_sub(offset)
            }
            WallOffsets::Gap => None,
        }
    }
}

/// Shared zone rules.
pub type SharedZone = Arc<dyn ZoneRules + Send + Sync>;

/// Resolves a zone name: an IANA name (daylight-saving rules included), one of the core's
/// fixed-offset aliases, or UTC when absent.
pub fn resolve(name: Option<&str>) -> Result<SharedZone, String> {
    let Some(name) = name else {
        return Ok(Arc::new(FixedOffset(0)));
    };
    if let Some(tz) = iana(name) {
        return Ok(Arc::new(IanaZone(tz)));
    }
    fixed_offset_seconds(Some(name))
        .map(|o| Arc::new(FixedOffset(o)) as SharedZone)
        .map_err(|_| format!("unknown time zone {name:?}"))
}

/// The version of the bundled zone database (recorded in traces / status).
#[must_use]
pub fn database_version() -> &'static str {
    jiff_tzdb::VERSION
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_case_sensitive_iana_names() {
        assert!(iana("Asia/Tokyo").is_some());
        assert!(iana("US/Eastern").is_some());
        assert!(iana("asia/tokyo").is_none());
        assert!(iana("Not/AZone").is_none());
        assert!(resolve(Some("asia/tokyo")).is_err());
    }

    #[test]
    fn new_york_fold_takes_the_earlier_instant_and_gap_has_none() {
        let zone = IanaZone(iana("America/New_York").unwrap());
        // 2024-11-03 01:30 local happens twice: 05:30Z (EDT) is the earlier.
        assert_eq!(zone.utc_of(1_730_597_400), Some(1_730_611_800));
        // 2024-03-10 02:30 local does not happen.
        assert_eq!(zone.utc_of(1_710_037_800), None);
        assert_eq!(zone.local_of(1_710_054_000), 1_710_039_600);
        // No silent zero offset at the far end: the last representable offset (EST) applies.
        assert_eq!(zone.local_of(i64::MAX), i64::MAX - 18_000);
    }

    #[test]
    fn tokyo_schedule_runs_past_the_end_of_year_9999() {
        use fireemu_core_functions::cron::Schedule;
        use fireemu_core_types::time::LogicalInstant;
        let tokyo = resolve(Some("Asia/Tokyo")).unwrap();
        let nine = Schedule::parse("0 9 * * *").unwrap();
        // After 9999-12-31T00:00:00Z the next 09:00 Tokyo is 10000-01-01T00:00:00Z.
        let after = LogicalInstant::from_unix_seconds(253_402_214_400);
        assert_eq!(
            nine.next_after_in(after, &*tokyo),
            Some(LogicalInstant::from_unix_seconds(253_402_300_800))
        );
    }

    #[test]
    fn new_york_recurring_rules_continue_after_2099() {
        // 2100-07-01T09:00 New York is 13:00Z (EDT): the recurring rule continues.
        let zone = IanaZone(iana("America/New_York").unwrap());
        assert_eq!(zone.utc_of(4_118_115_600), Some(4_118_130_000));
    }

    #[test]
    fn factory_is_refused_like_chrono_tz() {
        assert!(iana("Factory").is_none());
        assert!(resolve(Some("Factory")).is_err());
    }

    #[test]
    fn offsets_continue_past_the_end_of_jiff_instants() {
        // 9999-12-31T12:00:00Z and 10000-01-01T00:00:00 Tokyo wall time.
        let tokyo = IanaZone(iana("Asia/Tokyo").unwrap());
        assert_eq!(tokyo.local_of(253_402_257_600), 253_402_257_600 + 32_400);
        assert_eq!(
            tokyo.utc_of(253_402_300_800),
            Some(253_402_300_800 - 32_400)
        );
        let new_york = IanaZone(iana("America/New_York").unwrap());
        assert_eq!(new_york.local_of(253_402_257_600), 253_402_257_600 - 18_000);
        assert_eq!(
            new_york.utc_of(253_402_300_800 + 86_400 * 400),
            Some(253_402_300_800 + 86_400 * 400 + 18_000)
        );
        assert_eq!(
            new_york.local_of(-400_000_000_000),
            -400_000_000_000 + offset_at(&new_york.0, i64::MIN)
        );
        assert_ne!(offset_at(&new_york.0, i64::MIN), 0);
    }

    #[test]
    fn database_is_the_bundled_one() {
        assert_eq!(database_version(), "2026f");
    }
}
