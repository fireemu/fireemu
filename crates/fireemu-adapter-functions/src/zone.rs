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
mod chrono_parity_tests {
    use super::*;
    use chrono::{Offset, TimeZone as _};
    use proptest::prelude::*;
    use std::str::FromStr;

    fn chrono_local_of(tz: chrono_tz::Tz, utc_secs: i64) -> i64 {
        let Some(utc) = chrono::DateTime::from_timestamp(utc_secs, 0) else {
            return utc_secs;
        };
        utc_secs
            + i64::from(
                tz.offset_from_utc_datetime(&utc.naive_utc())
                    .fix()
                    .local_minus_utc(),
            )
    }

    fn chrono_utc_of(tz: chrono_tz::Tz, local_secs: i64) -> Option<i64> {
        let naive = chrono::DateTime::from_timestamp(local_secs, 0)?.naive_utc();
        match tz.from_local_datetime(&naive) {
            chrono::LocalResult::Single(dt) | chrono::LocalResult::Ambiguous(dt, _) => {
                Some(dt.timestamp())
            }
            chrono::LocalResult::None => None,
        }
    }

    /// Zones whose offsets between 1900 and 2037 differ between chrono-tz's database (2025b)
    /// and jiff's (2026f): tzdb data corrections and rule changes announced after 2025b (for
    /// example Canada's and Cuba's from November 2026). Not a difference of the libraries.
    pub(super) const CHANGED_SINCE_2025B: &[&str] = &[
        "Africa/Casablanca",
        "Africa/El_Aaiun",
        "America/Araguaina",
        "America/Bahia",
        "America/Belem",
        "America/Boa_Vista",
        "America/Bogota",
        "America/Campo_Grande",
        "America/Cuiaba",
        "America/Edmonton",
        "America/Eirunepe",
        "America/Ensenada",
        "America/Fortaleza",
        "America/Havana",
        "America/Inuvik",
        "America/Maceio",
        "America/Manaus",
        "America/Noronha",
        "America/Porto_Acre",
        "America/Porto_Velho",
        "America/Rainy_River",
        "America/Recife",
        "America/Rio_Branco",
        "America/Santa_Isabel",
        "America/Santarem",
        "America/Sao_Paulo",
        "America/Tijuana",
        "America/Vancouver",
        "America/Winnipeg",
        "America/Yellowknife",
        "Asia/Tehran",
        "Brazil/Acre",
        "Brazil/DeNoronha",
        "Brazil/East",
        "Brazil/West",
        "CST6CDT",
        "Canada/Central",
        "Canada/Mountain",
        "Canada/Pacific",
        "Cuba",
        "EST5EDT",
        "Eire",
        "Europe/Chisinau",
        "Europe/Dublin",
        "Europe/Tiraspol",
        "Iran",
        "MST7MDT",
        "Mexico/BajaNorte",
        "PST8PDT",
    ];

    fn zone_names() -> Vec<&'static str> {
        chrono_tz::TZ_VARIANTS
            .iter()
            .map(|tz| tz.name())
            .filter(|name| !CHANGED_SINCE_2025B.contains(name))
            .collect()
    }

    #[test]
    fn only_the_listed_zones_changed_between_the_databases() {
        let mut changed = Vec::new();
        for tz in chrono_tz::TZ_VARIANTS {
            let new = iana(tz.name()).unwrap();
            let differs = (-2_208_988_800i64..2_145_916_800).step_by(1_800).any(|s| {
                let dt = chrono::DateTime::from_timestamp(s, 0).unwrap().naive_utc();
                tz.offset_from_utc_datetime(&dt).fix().local_minus_utc()
                    != new.to_offset(Timestamp::from_second(s).unwrap()).seconds()
            });
            if differs {
                changed.push(tz.name());
            }
        }
        assert_eq!(changed, CHANGED_SINCE_2025B);
    }

    #[test]
    fn every_old_zone_name_resolves_with_the_same_spelling_only() {
        for tz in chrono_tz::TZ_VARIANTS {
            let name = tz.name();
            assert!(iana(name).is_some(), "{name}");
            let lower = name.to_ascii_lowercase();
            assert_eq!(
                iana(&lower).is_some(),
                chrono_tz::Tz::from_str(&lower).is_ok(),
                "{lower}"
            );
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20_000))]

        /// 1900..2037: the span both databases describe with explicit transitions.
        #[test]
        fn offsets_match_chrono_tz(
            zone in prop::sample::select(zone_names()),
            secs in -2_208_988_800i64..2_145_916_800,
        ) {
            let old = chrono_tz::Tz::from_str(zone).unwrap();
            let new = IanaZone(iana(zone).unwrap());
            prop_assert_eq!(new.local_of(secs), chrono_local_of(old, secs));
            prop_assert_eq!(new.utc_of(secs), chrono_utc_of(old, secs));
        }
    }

    #[test]
    fn dst_transitions_match_chrono_tz() {
        // Every second within two hours of each New York, London, Sydney and Sao Paulo
        // transition in 2018-2026, local and UTC.
        for zone in [
            "America/New_York",
            "Europe/London",
            "Australia/Sydney",
            "America/Sao_Paulo",
        ] {
            let old = chrono_tz::Tz::from_str(zone).unwrap();
            let new = IanaZone(iana(zone).unwrap());
            let mut secs = 1_514_764_800i64;
            while secs < 1_798_761_600 {
                if chrono_local_of(old, secs) - secs
                    != chrono_local_of(old, secs + 7_200) - secs - 7_200
                {
                    for s in (secs - 7_200..secs + 14_400).step_by(60) {
                        assert_eq!(new.local_of(s), chrono_local_of(old, s), "{zone} {s}");
                        assert_eq!(new.utc_of(s), chrono_utc_of(old, s), "{zone} {s}");
                    }
                }
                secs += 7_200;
            }
        }
    }
}
