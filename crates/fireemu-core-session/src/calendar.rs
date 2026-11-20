//! Relative and calendar moves of the virtual clock.
//!
//! A move is an ISO 8601 duration (`P1M`, `PT36H`, `-P3D`), an anchor (`startOfMonth`, ...),
//! or a duration followed by an anchor, evaluated in one time zone. This module is the pure
//! arithmetic: it never reads a clock or a zone database. Daylight-saving rules come from the
//! adapter through [`CalendarZone`] (ADR-001: the core takes no date/time dependency), so the
//! same function serves UTC, fixed offsets and IANA zones.
//!
//! Rules, in the order they apply:
//!
//! - The calendar part (years, months, weeks, days) moves the local civil date-time: years and
//!   months together as a count of months, with the day clamped to the last day of the target
//!   month (Jan 31 + P1M = Feb 28 or 29), then weeks and days. The time of day is kept. The
//!   local result is resolved to an instant (see [`LocalOffsets`]). An all-zero calendar part
//!   leaves the instant as it is.
//! - The clock part (hours, minutes, seconds) is exact elapsed time added to that instant.
//! - A leading minus negates every component; the order is the same.
//! - An anchor then moves to the start or end of the local day, month or year; an end is
//!   23:59:59.999999 local time (microsecond precision, as Firestore timestamps).
//! - The result must lie in years 0001 through 9999 (UTC), and so must every local civil
//!   date the calendar part or an anchor computes. Clock units alone compute no local date.
//!
//! The scheduler skips that day's occurrence when the local time falls in a spring-forward gap.
//! A clock move cannot skip the occurrence, so it lands on the same wall time shifted by the gap (02:30 becomes 03:30).
//! A repeated local time (a fall-back overlap) resolves to the earlier instant, as it does in the scheduler.

use core::fmt;

use fireemu_core_types::time::{civil_from_days, days_from_civil, LogicalInstant};

const NANOS_PER_SECOND: i128 = 1_000_000_000;
const SECONDS_PER_DAY: i64 = 86_400;
/// The last microsecond of a day, in nanoseconds after midnight.
const END_OF_DAY_NANOS: i128 = 86_400 * NANOS_PER_SECOND - 1_000;
/// Smallest and largest civil year a move may reach.
pub const MIN_YEAR: i64 = 1;
/// See [`MIN_YEAR`].
pub const MAX_YEAR: i64 = 9_999;

/// An ISO 8601 duration with calendar units (Y, M, W, D) and clock units (H, M, S).
///
/// Components are non-negative; `negative` applies to all of them. A duration whose
/// components are all zero is never negative.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Hash)]
pub struct CalendarDuration {
    /// Whether every component counts backwards.
    pub negative: bool,
    /// Years.
    pub years: u64,
    /// Months.
    pub months: u64,
    /// Weeks.
    pub weeks: u64,
    /// Days.
    pub days: u64,
    /// Hours.
    pub hours: u64,
    /// Minutes.
    pub minutes: u64,
    /// Seconds.
    pub seconds: u64,
}

/// Why a duration string was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DurationParseError {
    /// What was expected.
    pub expected: &'static str,
}

impl fmt::Display for DurationParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "duration must be an ISO 8601 duration such as P1M, PT36H or -P3D: expected {}",
            self.expected
        )
    }
}

impl std::error::Error for DurationParseError {}

impl CalendarDuration {
    /// Parses `-?P[nY][nM][nW][nD][T[nH][nM][nS]]`: at least one component, a `T` followed by
    /// at least one clock component, ASCII digits and uppercase designators only, each unit at
    /// most once and in this order.
    pub fn parse(input: &str) -> Result<Self, DurationParseError> {
        const MAX_LEN: usize = 64;
        let fail = |expected| Err(DurationParseError { expected });
        if input.len() > MAX_LEN {
            return fail("at most 64 characters");
        }
        let (negative, rest) = match input.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, input),
        };
        let Some(mut rest) = rest.strip_prefix('P') else {
            return fail("'P' (or '-P')");
        };
        let mut duration = Self::default();
        let mut any_component = false;
        let mut in_time = false;
        // Designators allowed next, in order; each one consumes itself and those before it.
        let date_units = *b"YMWD";
        let time_units = *b"HMS";
        let mut next_unit = 0usize;
        while !rest.is_empty() {
            if !in_time && rest.as_bytes()[0] == b'T' {
                in_time = true;
                next_unit = 0;
                rest = &rest[1..];
                if rest.is_empty() {
                    return fail("a clock component after 'T'");
                }
                continue;
            }
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            if digits == 0 {
                return fail("digits before a designator");
            }
            let Ok(value) = rest[..digits].parse::<u64>() else {
                return fail("a component that fits in 64 bits");
            };
            let Some(&designator) = rest.as_bytes().get(digits) else {
                return fail("a designator after the digits");
            };
            let units: &[u8] = if in_time { &time_units } else { &date_units };
            let Some(position) = units[next_unit..].iter().position(|&u| u == designator) else {
                return fail("designators Y, M, W, D, then T and H, M, S, each once and in order");
            };
            let index = next_unit + position;
            next_unit = index + 1;
            let slot = match (in_time, index) {
                (false, 0) => &mut duration.years,
                (false, 1) => &mut duration.months,
                (false, 2) => &mut duration.weeks,
                (false, _) => &mut duration.days,
                (true, 0) => &mut duration.hours,
                (true, 1) => &mut duration.minutes,
                (true, _) => &mut duration.seconds,
            };
            *slot = value;
            any_component = true;
            rest = &rest[digits + 1..];
        }
        if !any_component {
            return fail("at least one component");
        }
        duration.negative = negative && !duration.is_zero();
        Ok(duration)
    }

    /// Whether the years, months, weeks and days are all zero.
    #[must_use]
    pub const fn calendar_is_zero(&self) -> bool {
        self.years == 0 && self.months == 0 && self.weeks == 0 && self.days == 0
    }

    /// Whether every component is zero.
    #[must_use]
    pub const fn is_zero(&self) -> bool {
        self.calendar_is_zero() && self.hours == 0 && self.minutes == 0 && self.seconds == 0
    }
}

/// Canonical form: designators in order, zero components left out, `PT0S` for zero.
impl fmt::Display for CalendarDuration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_zero() {
            return f.write_str("PT0S");
        }
        if self.negative {
            f.write_str("-")?;
        }
        f.write_str("P")?;
        for (value, unit) in [
            (self.years, 'Y'),
            (self.months, 'M'),
            (self.weeks, 'W'),
            (self.days, 'D'),
        ] {
            if value != 0 {
                write!(f, "{value}{unit}")?;
            }
        }
        if self.hours != 0 || self.minutes != 0 || self.seconds != 0 {
            f.write_str("T")?;
            for (value, unit) in [(self.hours, 'H'), (self.minutes, 'M'), (self.seconds, 'S')] {
                if value != 0 {
                    write!(f, "{value}{unit}")?;
                }
            }
        }
        Ok(())
    }
}

/// Where a move lands within the local day, month or year.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Anchor {
    /// 00:00 of the day.
    StartOfDay,
    /// 23:59:59.999999 of the day.
    EndOfDay,
    /// 00:00 of the first day of the month.
    StartOfMonth,
    /// 23:59:59.999999 of the last day of the month.
    EndOfMonth,
    /// 00:00 of the first day of the next month.
    StartOfNextMonth,
    /// 00:00 of January 1.
    StartOfYear,
    /// 23:59:59.999999 of December 31.
    EndOfYear,
}

impl Anchor {
    /// Every anchor, in the order the documentation lists them.
    pub const ALL: [Self; 7] = [
        Self::StartOfDay,
        Self::EndOfDay,
        Self::StartOfMonth,
        Self::EndOfMonth,
        Self::StartOfNextMonth,
        Self::StartOfYear,
        Self::EndOfYear,
    ];

    /// The request name (`startOfMonth`, ...).
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::StartOfDay => "startOfDay",
            Self::EndOfDay => "endOfDay",
            Self::StartOfMonth => "startOfMonth",
            Self::EndOfMonth => "endOfMonth",
            Self::StartOfNextMonth => "startOfNextMonth",
            Self::StartOfYear => "startOfYear",
            Self::EndOfYear => "endOfYear",
        }
    }

    /// The anchor with this exact (case-sensitive) name.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|anchor| anchor.name() == name)
    }
}

/// The offsets a local wall second can have in a zone, in seconds east of UTC.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalOffsets {
    /// The local time happens once.
    Unique(i64),
    /// The local time happens twice, once with each offset (a fall-back overlap).
    Fold(i64, i64),
    /// The local time is skipped: `before` is in force before the gap, `after` after it.
    Gap {
        /// Offset before the transition.
        before: i64,
        /// Offset after the transition.
        after: i64,
    },
}

/// A time zone as calendar moves need it. Offsets are whole seconds east of UTC.
pub trait CalendarZone {
    /// The offset in force at Unix second `utc_seconds`.
    fn offset_at(&self, utc_seconds: i64) -> i64;
    /// The offsets of local wall second `local_seconds` (seconds since 1970-01-01T00:00 of
    /// the wall clock).
    fn local_offsets(&self, local_seconds: i64) -> LocalOffsets;
}

/// A zone with one offset for all time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FixedZone(pub i64);

impl CalendarZone for FixedZone {
    fn offset_at(&self, _utc_seconds: i64) -> i64 {
        self.0
    }

    fn local_offsets(&self, _local_seconds: i64) -> LocalOffsets {
        LocalOffsets::Unique(self.0)
    }
}

/// Why a move has no result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CalendarError {
    /// The arithmetic left the representable range.
    Overflow,
    /// A civil date or the result is outside years 0001 through 9999.
    YearOutOfRange,
}

impl fmt::Display for CalendarError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Overflow => f.write_str("clock instant overflow"),
            Self::YearOutOfRange => f.write_str("the result is outside years 0001 through 9999"),
        }
    }
}

impl std::error::Error for CalendarError {}

/// Applies `duration` (if any) and then `anchor` (if any) to `start` in `zone`.
pub fn move_instant(
    start: LogicalInstant,
    zone: &dyn CalendarZone,
    duration: Option<&CalendarDuration>,
    anchor: Option<Anchor>,
) -> Result<LogicalInstant, CalendarError> {
    let mut instant = start;
    if let Some(duration) = duration {
        instant = apply_duration(instant, zone, duration)?;
    }
    if let Some(anchor) = anchor {
        let local = Local::of(instant, zone)?;
        instant = local.anchored(anchor)?.resolve(zone)?;
    }
    check_year(utc_year(instant)?)?;
    Ok(instant)
}

fn apply_duration(
    start: LogicalInstant,
    zone: &dyn CalendarZone,
    duration: &CalendarDuration,
) -> Result<LogicalInstant, CalendarError> {
    let signed = |magnitude: i128| {
        if duration.negative {
            -magnitude
        } else {
            magnitude
        }
    };
    let mut instant = start;
    if !duration.calendar_is_zero() {
        let months = signed(
            i128::from(duration.years)
                .checked_mul(12)
                .and_then(|m| m.checked_add(i128::from(duration.months)))
                .ok_or(CalendarError::Overflow)?,
        );
        let days = signed(
            i128::from(duration.weeks)
                .checked_mul(7)
                .and_then(|d| d.checked_add(i128::from(duration.days)))
                .ok_or(CalendarError::Overflow)?,
        );
        let local = Local::of(instant, zone)?;
        instant = local.plus_months(months)?.plus_days(days)?.resolve(zone)?;
    }
    let seconds = signed(
        i128::from(duration.hours)
            .checked_mul(3_600)
            .and_then(|s| s.checked_add(i128::from(duration.minutes).checked_mul(60)?))
            .and_then(|s| s.checked_add(i128::from(duration.seconds)))
            .and_then(|s| s.checked_mul(NANOS_PER_SECOND))
            .ok_or(CalendarError::Overflow)?,
    );
    instant
        .as_nanos()
        .checked_add(seconds)
        .map(LogicalInstant::from_nanos)
        .ok_or(CalendarError::Overflow)
}

fn check_year(year: i64) -> Result<(), CalendarError> {
    if (MIN_YEAR..=MAX_YEAR).contains(&year) {
        Ok(())
    } else {
        Err(CalendarError::YearOutOfRange)
    }
}

fn utc_year(instant: LogicalInstant) -> Result<i64, CalendarError> {
    let seconds = i64::try_from(instant.as_nanos().div_euclid(NANOS_PER_SECOND))
        .map_err(|_| CalendarError::YearOutOfRange)?;
    Ok(civil_from_days(seconds.div_euclid(SECONDS_PER_DAY)).0)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// A local civil date-time: a date in years 0001..9999 and nanoseconds after midnight.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Local {
    year: i64,
    month: i64,
    day: i64,
    nanos_of_day: i128,
}

impl Local {
    fn of(instant: LogicalInstant, zone: &dyn CalendarZone) -> Result<Self, CalendarError> {
        let utc_seconds = i64::try_from(instant.as_nanos().div_euclid(NANOS_PER_SECOND))
            .map_err(|_| CalendarError::YearOutOfRange)?;
        let fraction = instant.as_nanos().rem_euclid(NANOS_PER_SECOND);
        let local_seconds = utc_seconds
            .checked_add(zone.offset_at(utc_seconds))
            .ok_or(CalendarError::Overflow)?;
        let (year, month, day) = civil_from_days(local_seconds.div_euclid(SECONDS_PER_DAY));
        check_year(year)?;
        Ok(Self {
            year,
            month,
            day,
            nanos_of_day: i128::from(local_seconds.rem_euclid(SECONDS_PER_DAY)) * NANOS_PER_SECOND
                + fraction,
        })
    }

    fn date(year: i64, month: i64, day: i64, nanos_of_day: i128) -> Result<Self, CalendarError> {
        check_year(year)?;
        Ok(Self {
            year,
            month,
            day,
            nanos_of_day,
        })
    }

    fn plus_months(self, months: i128) -> Result<Self, CalendarError> {
        if months == 0 {
            return Ok(self);
        }
        let total = i128::from(self.year) * 12 + i128::from(self.month - 1) + months;
        let year =
            i64::try_from(total.div_euclid(12)).map_err(|_| CalendarError::YearOutOfRange)?;
        check_year(year)?;
        let month = i64::try_from(total.rem_euclid(12)).unwrap_or(0) + 1;
        let day = self.day.min(days_in_month(year, month));
        Self::date(year, month, day, self.nanos_of_day)
    }

    fn plus_days(self, days: i128) -> Result<Self, CalendarError> {
        if days == 0 {
            return Ok(self);
        }
        // Years 0001..9999 span about 3.65 million days; anything larger leaves the range.
        let days = i64::try_from(days)
            .ok()
            .filter(|d| d.unsigned_abs() <= 4_000_000)
            .ok_or(CalendarError::YearOutOfRange)?;
        let (year, month, day) =
            civil_from_days(days_from_civil(self.year, self.month, self.day) + days);
        Self::date(year, month, day, self.nanos_of_day)
    }

    fn anchored(self, anchor: Anchor) -> Result<Self, CalendarError> {
        let (year, month) = (self.year, self.month);
        match anchor {
            Anchor::StartOfDay => Self::date(year, month, self.day, 0),
            Anchor::EndOfDay => Self::date(year, month, self.day, END_OF_DAY_NANOS),
            Anchor::StartOfMonth => Self::date(year, month, 1, 0),
            Anchor::EndOfMonth => {
                Self::date(year, month, days_in_month(year, month), END_OF_DAY_NANOS)
            }
            Anchor::StartOfNextMonth => Self::date(year, month, 1, 0)?.plus_months(1),
            Anchor::StartOfYear => Self::date(year, 1, 1, 0),
            Anchor::EndOfYear => Self::date(year, 12, 31, END_OF_DAY_NANOS),
        }
    }

    /// The instant of this wall time: the earlier of an overlap, the offset before a gap.
    fn resolve(self, zone: &dyn CalendarZone) -> Result<LogicalInstant, CalendarError> {
        let whole_seconds = i64::try_from(self.nanos_of_day.div_euclid(NANOS_PER_SECOND))
            .map_err(|_| CalendarError::Overflow)?;
        let local_seconds = days_from_civil(self.year, self.month, self.day)
            .checked_mul(SECONDS_PER_DAY)
            .and_then(|s| s.checked_add(whole_seconds))
            .ok_or(CalendarError::Overflow)?;
        let offset = match zone.local_offsets(local_seconds) {
            LocalOffsets::Unique(offset) => offset,
            LocalOffsets::Fold(a, b) => a.max(b),
            LocalOffsets::Gap { before, .. } => before,
        };
        let utc_seconds = local_seconds
            .checked_sub(offset)
            .ok_or(CalendarError::Overflow)?;
        i128::from(utc_seconds)
            .checked_mul(NANOS_PER_SECOND)
            .and_then(|n| n.checked_add(self.nanos_of_day.rem_euclid(NANOS_PER_SECOND)))
            .map(LogicalInstant::from_nanos)
            .ok_or(CalendarError::Overflow)
    }
}

/// Which control action a move came through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveKind {
    /// `clock:advance`.
    Advance,
    /// `clock:set`.
    Set,
    /// `clock:advanceTo`.
    AdvanceTo,
}

/// How the clock takes a computed target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveDecision {
    /// The target is not earlier than the current instant.
    Forward,
    /// The target is earlier and the request allows a rewind.
    Rewind,
    /// The target is earlier and the request does not allow it (the clock's backwards error).
    RefuseBackwards,
}

/// `clock:advance` and `clock:set` rewind only with `allowBackwards`; `clock:advanceTo`
/// never does.
#[must_use]
pub fn decide(
    kind: MoveKind,
    allow_backwards: bool,
    current: LogicalInstant,
    target: LogicalInstant,
) -> MoveDecision {
    if target >= current {
        MoveDecision::Forward
    } else if allow_backwards && kind != MoveKind::AdvanceTo {
        MoveDecision::Rewind
    } else {
        MoveDecision::RefuseBackwards
    }
}

#[cfg(test)]
mod tests;
