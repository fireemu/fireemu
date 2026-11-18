//! IANA time zones for schedules (spec 11.4): `jiff` with its bundled zone database is the
//! single audited dependency that knows daylight-saving rules; the core only sees
//! [`ZoneRules`]. The database is bundled so results do not depend on the host's zoneinfo.

use std::sync::{Arc, LazyLock};

use fireemu_core_functions::cron::{fixed_offset_seconds, FixedOffset, ZoneRules};
use jiff::tz::{AmbiguousOffset, TimeZone, TimeZoneDatabase};
use jiff::Timestamp;

static DATABASE: LazyLock<TimeZoneDatabase> = LazyLock::new(TimeZoneDatabase::bundled);

/// The zone with exactly this IANA name (case-sensitive) from the bundled database.
#[must_use]
pub fn iana(name: &str) -> Option<TimeZone> {
    let zone = DATABASE.get(name).ok()?;
    (zone.iana_name() == Some(name)).then_some(zone)
}

/// A zone from the IANA database.
#[derive(Debug, Clone)]
pub struct IanaZone(pub TimeZone);

impl ZoneRules for IanaZone {
    fn local_of(&self, utc_secs: i64) -> i64 {
        let Ok(utc) = Timestamp::from_second(utc_secs) else {
            return utc_secs;
        };
        utc_secs + i64::from(self.0.to_offset(utc).seconds())
    }

    fn utc_of(&self, local_secs: i64) -> Option<i64> {
        let wall = jiff::tz::Offset::UTC.to_datetime(Timestamp::from_second(local_secs).ok()?);
        let offset = match self.0.to_ambiguous_timestamp(wall).offset() {
            AmbiguousOffset::Unambiguous { offset } => offset,
            // The earlier instant of a repeated wall time, as before.
            AmbiguousOffset::Fold { before, .. } => before,
            AmbiguousOffset::Gap { .. } => return None,
        };
        Some(local_secs - i64::from(offset.seconds()))
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
        assert_eq!(zone.local_of(i64::MAX), i64::MAX);
    }

    #[test]
    fn database_is_the_bundled_one() {
        assert_eq!(database_version(), "2026f");
    }
}
