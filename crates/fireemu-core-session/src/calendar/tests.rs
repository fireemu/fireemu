use super::*;
use proptest::prelude::*;

fn at(text: &str) -> LogicalInstant {
    LogicalInstant::parse_rfc3339(text).unwrap()
}

fn text(instant: LogicalInstant) -> String {
    instant.to_rfc3339().unwrap()
}

fn d(input: &str) -> CalendarDuration {
    CalendarDuration::parse(input).unwrap()
}

fn moved(start: &str, offset: i64, duration: Option<&str>, anchor: Option<Anchor>) -> String {
    let duration = duration.map(d);
    text(move_instant(at(start), &FixedZone(offset), duration.as_ref(), anchor).unwrap())
}

#[test]
fn duration_grammar_accepts_each_unit_in_order() {
    assert_eq!(
        d("P1Y2M3W4DT5H6M7S"),
        CalendarDuration {
            negative: false,
            years: 1,
            months: 2,
            weeks: 3,
            days: 4,
            hours: 5,
            minutes: 6,
            seconds: 7
        }
    );
    assert_eq!(d("P1M").months, 1);
    assert_eq!(d("PT1M").minutes, 1);
    assert_eq!(d("PT1M").months, 0);
    assert_eq!(d("PT36H").hours, 36);
    assert_eq!(d("P2W").weeks, 2);
    let back = d("-P3D");
    assert!(back.negative);
    assert_eq!(back.days, 3);
    assert_eq!(d("P0D"), CalendarDuration::default());
    // A zero duration is never negative.
    assert_eq!(d("-PT0S"), CalendarDuration::default());
    assert_eq!(d("P00012M").months, 12);
}

#[test]
fn duration_grammar_refuses_near_misses() {
    for input in [
        "",
        "P",
        "-P",
        "PT",
        "P1DT",
        "1D",
        "p1d",
        "P1d",
        "+P1D",
        "P1.5D",
        "PT0.5S",
        "P-1D",
        "P1D1M",
        "P1M1Y",
        "PT1S1M",
        "P1Y1Y",
        "P1H",
        "PT1D",
        "PT1W",
        "P 1D",
        "P1D ",
        " P1D",
        "--P1D",
        "P1DT1H-",
        "P1W1W",
        "PT1H1H",
        "P\u{0}1D",
        "P１D",
        "P99999999999999999999D",
        "P1Y2M3W4DT5H6M7S8",
    ] {
        assert!(
            CalendarDuration::parse(input).is_err(),
            "{input:?} must be refused"
        );
    }
    // Inputs are bounded before they are scanned.
    let long = format!("P{}D", "0".repeat(70));
    assert!(CalendarDuration::parse(&long).is_err());
}

#[test]
fn errors_say_what_was_wrong() {
    let error = CalendarDuration::parse("P1X").unwrap_err();
    assert_eq!(
        error.to_string(),
        format!(
            "duration must be an ISO 8601 duration such as P1M, PT36H or -P3D: expected {}",
            error.expected
        )
    );
    assert_eq!(
        CalendarError::Overflow.to_string(),
        "clock instant overflow"
    );
    assert_eq!(
        CalendarError::YearOutOfRange.to_string(),
        "the result is outside years 0001 through 9999"
    );
}

#[test]
fn inputs_up_to_64_bytes_are_scanned() {
    let at_limit = format!("P{}1D", "0".repeat(61));
    assert_eq!(at_limit.len(), 64);
    assert_eq!(d(&at_limit).days, 1);
    let over = format!("P{}1D", "0".repeat(62));
    assert!(CalendarDuration::parse(&over).is_err());
}

#[test]
fn duration_display_is_canonical() {
    assert_eq!(d("PT1H").to_string(), "PT1H");
    assert_eq!(d("PT1M").to_string(), "PT1M");
    assert_eq!(d("PT1S").to_string(), "PT1S");
    assert_eq!(d("P1DT1S").to_string(), "P1DT1S");
    assert_eq!(d("P1YT1M").to_string(), "P1YT1M");
    assert_eq!(d("P1Y2M3W4DT5H6M7S").to_string(), "P1Y2M3W4DT5H6M7S");
    assert_eq!(d("-P3D").to_string(), "-P3D");
    assert_eq!(d("PT36H").to_string(), "PT36H");
    assert_eq!(d("P0Y").to_string(), "PT0S");
    assert_eq!(d("P01M").to_string(), "P1M");
}

#[test]
fn anchors_have_closed_case_sensitive_names() {
    for anchor in Anchor::ALL {
        assert_eq!(Anchor::parse(anchor.name()), Some(anchor));
    }
    for name in [
        "startofmonth",
        "StartOfMonth",
        "endOfWeek",
        "",
        "startOfMonth ",
    ] {
        assert_eq!(Anchor::parse(name), None);
    }
}

#[test]
fn a_month_from_the_last_days_clamps_to_the_target_month() {
    assert_eq!(
        moved("2025-01-31T10:00:00Z", 0, Some("P1M"), None),
        "2025-02-28T10:00:00Z"
    );
    assert_eq!(
        moved("2024-01-31T10:00:00Z", 0, Some("P1M"), None),
        "2024-02-29T10:00:00Z"
    );
    assert_eq!(
        moved("2024-01-30T10:00:00Z", 0, Some("P1M"), None),
        "2024-02-29T10:00:00Z"
    );
    assert_eq!(
        moved("2024-01-29T10:00:00Z", 0, Some("P1M"), None),
        "2024-02-29T10:00:00Z"
    );
    assert_eq!(
        moved("2024-01-28T10:00:00Z", 0, Some("P1M"), None),
        "2024-02-28T10:00:00Z"
    );
    assert_eq!(
        moved("2024-03-31T00:00:00Z", 0, Some("-P1M"), None),
        "2024-02-29T00:00:00Z"
    );
    assert_eq!(
        moved("2024-05-31T00:00:00Z", 0, Some("P1M"), None),
        "2024-06-30T00:00:00Z"
    );
    assert_eq!(
        moved("2024-12-31T00:00:00Z", 0, Some("P2M"), None),
        "2025-02-28T00:00:00Z"
    );
    assert_eq!(
        moved("2024-02-29T00:00:00Z", 0, Some("P1Y"), None),
        "2025-02-28T00:00:00Z"
    );
    assert_eq!(
        moved("2024-02-29T00:00:00Z", 0, Some("P4Y"), None),
        "2028-02-29T00:00:00Z"
    );
    assert_eq!(
        moved("2024-02-29T00:00:00Z", 0, Some("P12M"), None),
        "2025-02-28T00:00:00Z"
    );
}

#[test]
fn century_years_follow_the_gregorian_leap_rule() {
    assert_eq!(
        moved("2100-01-31T00:00:00Z", 0, Some("P1M"), None),
        "2100-02-28T00:00:00Z"
    );
    assert_eq!(
        moved("2000-01-31T00:00:00Z", 0, Some("P1M"), None),
        "2000-02-29T00:00:00Z"
    );
    assert_eq!(
        moved("1900-02-10T00:00:00Z", 0, None, Some(Anchor::EndOfMonth)),
        "1900-02-28T23:59:59.999999000Z"
    );
    assert_eq!(
        moved("2400-02-10T00:00:00Z", 0, None, Some(Anchor::EndOfMonth)),
        "2400-02-29T23:59:59.999999000Z"
    );
    assert_eq!(
        moved("2023-02-10T00:00:00Z", 0, None, Some(Anchor::EndOfMonth)),
        "2023-02-28T23:59:59.999999000Z"
    );
}

#[test]
fn years_and_months_clamp_once_then_days_apply() {
    // Feb 29 + P1Y1M is Mar 29 (one clamp of the combined months), not Mar 28.
    assert_eq!(
        moved("2024-02-29T00:00:00Z", 0, Some("P1Y1M"), None),
        "2025-03-29T00:00:00Z"
    );
    // Jan 31 + P1M1D: clamp to Feb 29 first, then a day: Mar 1.
    assert_eq!(
        moved("2024-01-31T00:00:00Z", 0, Some("P1M1D"), None),
        "2024-03-01T00:00:00Z"
    );
    // Negative: months first as well. Mar 31 - P1M1D = Feb 29 - 1 day = Feb 28.
    assert_eq!(
        moved("2024-03-31T00:00:00Z", 0, Some("-P1M1D"), None),
        "2024-02-28T00:00:00Z"
    );
    assert_eq!(
        moved("2024-01-01T00:00:00Z", 0, Some("P1W2D"), None),
        "2024-01-10T00:00:00Z"
    );
}

#[test]
fn clock_units_are_exact_and_keep_fractions() {
    assert_eq!(
        moved("2024-01-01T00:00:00.123456789Z", 0, Some("PT36H"), None),
        "2024-01-02T12:00:00.123456789Z"
    );
    assert_eq!(
        moved("2024-01-01T00:00:00Z", 0, Some("-PT90M"), None),
        "2023-12-31T22:30:00Z"
    );
    assert_eq!(
        moved("2024-01-01T00:00:00Z", 0, Some("PT61S"), None),
        "2024-01-01T00:01:01Z"
    );
    // The calendar part keeps the fraction too.
    assert_eq!(
        moved("2024-01-31T23:59:59.5Z", 0, Some("P1M"), None),
        "2024-02-29T23:59:59.500000000Z"
    );
}

#[test]
fn calendar_units_apply_in_the_zone() {
    // 2024-01-31T20:00Z is Feb 1 05:00 in Tokyo: P1M lands on Mar 1 05:00 Tokyo.
    assert_eq!(
        moved("2024-01-31T20:00:00Z", 32_400, Some("P1M"), None),
        "2024-02-29T20:00:00Z"
    );
    // In UTC the same start is Jan 31: P1M clamps to Feb 29.
    assert_eq!(
        moved("2024-01-31T20:00:00Z", 0, Some("P1M"), None),
        "2024-02-29T20:00:00Z"
    );
    assert_eq!(
        moved("2024-01-30T20:00:00Z", 32_400, Some("P1M"), None),
        "2024-02-28T20:00:00Z"
    );
    assert_eq!(
        moved("2024-01-30T20:00:00Z", 0, Some("P1M"), None),
        "2024-02-29T20:00:00Z"
    );
    assert_eq!(
        moved("2024-01-31T20:00:00Z", -18_000, Some("P1M"), None),
        "2024-02-29T20:00:00Z"
    );
    // A zone where Jan 31 20:00Z is still Jan 31 but a month later differs from Tokyo:
    assert_eq!(
        moved("2024-03-31T20:00:00Z", 32_400, Some("P1M"), None),
        "2024-04-30T20:00:00Z"
    );
    assert_eq!(
        moved("2024-03-30T20:00:00Z", 32_400, Some("P1M"), None),
        "2024-04-29T20:00:00Z"
    );
    assert_eq!(
        moved("2024-03-29T20:00:00Z", 32_400, Some("P1M"), None),
        "2024-04-29T20:00:00Z"
    );
}

#[test]
fn anchors_land_on_local_boundaries() {
    use Anchor::*;
    let start = "2024-02-15T10:20:30.5Z";
    assert_eq!(
        moved(start, 0, None, Some(StartOfDay)),
        "2024-02-15T00:00:00Z"
    );
    assert_eq!(
        moved(start, 0, None, Some(EndOfDay)),
        "2024-02-15T23:59:59.999999000Z"
    );
    assert_eq!(
        moved(start, 0, None, Some(StartOfMonth)),
        "2024-02-01T00:00:00Z"
    );
    assert_eq!(
        moved(start, 0, None, Some(EndOfMonth)),
        "2024-02-29T23:59:59.999999000Z"
    );
    assert_eq!(
        moved(start, 0, None, Some(StartOfNextMonth)),
        "2024-03-01T00:00:00Z"
    );
    assert_eq!(
        moved(start, 0, None, Some(StartOfYear)),
        "2024-01-01T00:00:00Z"
    );
    assert_eq!(
        moved(start, 0, None, Some(EndOfYear)),
        "2024-12-31T23:59:59.999999000Z"
    );
    assert_eq!(
        moved("2024-12-10T00:00:00Z", 0, None, Some(StartOfNextMonth)),
        "2025-01-01T00:00:00Z"
    );
    // In Tokyo the local day starts at 15:00Z the day before.
    assert_eq!(
        moved(start, 32_400, None, Some(StartOfDay)),
        "2024-02-14T15:00:00Z"
    );
    assert_eq!(
        moved(start, 32_400, None, Some(StartOfMonth)),
        "2024-01-31T15:00:00Z"
    );
    assert_eq!(
        moved("2024-01-31T20:00:00Z", 32_400, None, Some(StartOfMonth)),
        "2024-01-31T15:00:00Z"
    );
    assert_eq!(
        moved(start, -18_000, None, Some(EndOfMonth)),
        "2024-03-01T04:59:59.999999000Z"
    );
}

#[test]
fn a_duration_applies_before_the_anchor() {
    assert_eq!(
        moved(
            "2024-01-31T10:00:00Z",
            0,
            Some("P1M"),
            Some(Anchor::StartOfMonth)
        ),
        "2024-02-01T00:00:00Z"
    );
    assert_eq!(
        moved(
            "2024-01-15T10:00:00Z",
            0,
            Some("-P1M"),
            Some(Anchor::EndOfMonth)
        ),
        "2023-12-31T23:59:59.999999000Z"
    );
    assert_eq!(
        moved(
            "2024-01-31T23:30:00Z",
            0,
            Some("PT1H"),
            Some(Anchor::StartOfDay)
        ),
        "2024-02-01T00:00:00Z"
    );
}

#[test]
fn years_outside_0001_to_9999_are_refused() {
    let err = |start: &str, duration: Option<&str>, anchor: Option<Anchor>, offset: i64| {
        let duration = duration.map(d);
        move_instant(at(start), &FixedZone(offset), duration.as_ref(), anchor).unwrap_err()
    };
    assert_eq!(
        err("9999-12-15T00:00:00Z", Some("P1M"), None, 0),
        CalendarError::YearOutOfRange
    );
    assert_eq!(
        err(
            "9999-12-15T00:00:00Z",
            None,
            Some(Anchor::StartOfNextMonth),
            0
        ),
        CalendarError::YearOutOfRange
    );
    assert_eq!(
        err("0001-01-01T00:00:00Z", Some("-P1D"), None, 0),
        CalendarError::YearOutOfRange
    );
    assert_eq!(
        err("0001-01-01T00:00:00Z", Some("-PT1S"), None, 0),
        CalendarError::YearOutOfRange
    );
    assert_eq!(
        err("9999-12-31T23:59:59Z", Some("PT1S"), None, 0),
        CalendarError::YearOutOfRange
    );
    // Year 0000 is RFC 3339 but outside the calendar range.
    assert_eq!(
        err("0000-12-31T00:00:00Z", Some("PT1S"), None, 0),
        CalendarError::YearOutOfRange
    );
    // Local year 10000 in Tokyo, even for a zero calendar step plus an anchor.
    assert_eq!(
        err(
            "9999-12-31T20:00:00Z",
            None,
            Some(Anchor::StartOfDay),
            32_400
        ),
        CalendarError::YearOutOfRange
    );
    // The result's UTC year counts too: 0001-01-01T00:00 in Tokyo is year 0000 in UTC.
    assert_eq!(
        err(
            "0001-01-01T20:00:00Z",
            None,
            Some(Anchor::StartOfYear),
            32_400
        ),
        CalendarError::YearOutOfRange
    );
    assert!(move_instant(
        at("9999-12-31T23:59:58Z"),
        &FixedZone(0),
        Some(&d("PT1S")),
        None
    )
    .is_ok());
    assert!(move_instant(
        at("0001-01-02T00:00:00Z"),
        &FixedZone(0),
        Some(&d("-P1D")),
        None
    )
    .is_ok());
}

#[test]
fn huge_components_overflow_or_leave_the_range_without_panicking() {
    for input in [
        "P18446744073709551615Y",
        "P18446744073709551615M",
        "P18446744073709551615W",
        "P18446744073709551615D",
        "PT18446744073709551615H",
        "PT18446744073709551615M",
        "PT18446744073709551615S",
        "-P18446744073709551615Y",
        "-PT18446744073709551615S",
    ] {
        let result = move_instant(
            at("2024-01-01T00:00:00Z"),
            &FixedZone(0),
            Some(&d(input)),
            None,
        );
        assert!(result.is_err(), "{input} must be refused, got {result:?}");
    }
}

/// A zone with one transition at `at` (a Unix second) from `before` to `after`.
struct OneTransition {
    at: i64,
    before: i64,
    after: i64,
}

impl CalendarZone for OneTransition {
    fn offset_at(&self, utc_seconds: i64) -> i64 {
        if utc_seconds < self.at {
            self.before
        } else {
            self.after
        }
    }

    fn local_offsets(&self, local_seconds: i64) -> LocalOffsets {
        let with_before = local_seconds - self.before < self.at;
        let with_after = local_seconds - self.after >= self.at;
        match (with_before, with_after) {
            (true, true) => LocalOffsets::Fold(self.before, self.after),
            (true, false) => LocalOffsets::Unique(self.before),
            (false, true) => LocalOffsets::Unique(self.after),
            (false, false) => LocalOffsets::Gap {
                before: self.before,
                after: self.after,
            },
        }
    }
}

/// New York, 2024: spring forward at 2024-03-10T07:00Z, fall back at 2024-11-03T06:00Z.
fn spring() -> OneTransition {
    OneTransition {
        at: 1_710_054_000,
        before: -18_000,
        after: -14_400,
    }
}

fn fall() -> OneTransition {
    OneTransition {
        at: 1_730_613_600,
        before: -14_400,
        after: -18_000,
    }
}

fn zmove(zone: &dyn CalendarZone, start: &str, duration: &str, anchor: Option<Anchor>) -> String {
    text(move_instant(at(start), zone, Some(&d(duration)), anchor).unwrap())
}

#[test]
fn a_gap_resolves_to_the_later_instant() {
    // 2024-03-09 02:30 EST + P1D = 2024-03-10 02:30, which does not exist: 03:30 EDT.
    assert_eq!(
        zmove(&spring(), "2024-03-09T07:30:00Z", "P1D", None),
        "2024-03-10T07:30:00Z"
    );
    // Clock units are exact across the gap: 01:30 EST + PT1H = 03:30 EDT.
    assert_eq!(
        zmove(&spring(), "2024-03-10T06:30:00Z", "PT1H", None),
        "2024-03-10T07:30:00Z"
    );
    // A day keeps the wall time across the transition: 23 hours of elapsed time.
    assert_eq!(
        zmove(&spring(), "2024-03-09T12:00:00Z", "P1D", None),
        "2024-03-10T11:00:00Z"
    );
}

#[test]
fn an_overlap_resolves_to_the_earlier_instant() {
    // 2024-11-02 01:30 EDT + P1D = 2024-11-03 01:30, which happens twice: EDT (05:30Z).
    assert_eq!(
        zmove(&fall(), "2024-11-02T05:30:00Z", "P1D", None),
        "2024-11-03T05:30:00Z"
    );
    // From the second 01:30 (EST, 06:30Z) a zero calendar step keeps the instant.
    assert_eq!(
        zmove(&fall(), "2024-11-03T06:30:00Z", "P0D", None),
        "2024-11-03T06:30:00Z"
    );
    assert_eq!(
        zmove(&fall(), "2024-11-03T06:30:00Z", "PT0S", None),
        "2024-11-03T06:30:00Z"
    );
    // ... and so does a pure clock step: exact time.
    assert_eq!(
        zmove(&fall(), "2024-11-03T05:30:00Z", "PT1H", None),
        "2024-11-03T06:30:00Z"
    );
    // A day from the second 01:30 lands on Nov 4 01:30 EST.
    assert_eq!(
        zmove(&fall(), "2024-11-03T06:30:00Z", "P1D", None),
        "2024-11-04T06:30:00Z"
    );
}

#[test]
fn anchors_resolve_through_the_zone() {
    // Start of 2024-03-10 in New York is 05:00Z (EST); end of day is EDT.
    assert_eq!(
        zmove(
            &spring(),
            "2024-03-10T15:00:00Z",
            "PT0S",
            Some(Anchor::StartOfDay)
        ),
        "2024-03-10T05:00:00Z"
    );
    assert_eq!(
        zmove(
            &spring(),
            "2024-03-10T15:00:00Z",
            "PT0S",
            Some(Anchor::EndOfDay)
        ),
        "2024-03-11T03:59:59.999999000Z"
    );
    // A zone whose midnight is skipped starts its day at the end of the gap.
    let midnight_gap = OneTransition {
        at: 1_710_039_600,
        before: -10_800,
        after: -7_200,
    };
    // Local 2024-03-10T00:00 at -03:00 would be 03:00Z = the transition: skipped.
    assert_eq!(
        zmove(
            &midnight_gap,
            "2024-03-10T12:00:00Z",
            "PT0S",
            Some(Anchor::StartOfDay)
        ),
        "2024-03-10T03:00:00Z"
    );
}

#[test]
fn decide_follows_the_backwards_rules() {
    let early = at("2024-01-01T00:00:00Z");
    let late = at("2024-01-02T00:00:00Z");
    for kind in [MoveKind::Advance, MoveKind::Set, MoveKind::AdvanceTo] {
        for allow in [false, true] {
            assert_eq!(decide(kind, allow, early, late), MoveDecision::Forward);
            assert_eq!(decide(kind, allow, early, early), MoveDecision::Forward);
        }
        assert_eq!(
            decide(kind, false, late, early),
            MoveDecision::RefuseBackwards
        );
    }
    assert_eq!(
        decide(MoveKind::Advance, true, late, early),
        MoveDecision::Rewind
    );
    assert_eq!(
        decide(MoveKind::Set, true, late, early),
        MoveDecision::Rewind
    );
    assert_eq!(
        decide(MoveKind::AdvanceTo, true, late, early),
        MoveDecision::RefuseBackwards
    );
}

// ---------- properties ----------

/// Instants in years 0002..9998 so that small moves stay in range.
fn instant() -> impl Strategy<Value = LogicalInstant> {
    (
        -62_104_060_800i64..253_339_200_000i64,
        0i128..NANOS_PER_SECOND,
    )
        .prop_map(|(s, n)| LogicalInstant::from_nanos(i128::from(s) * NANOS_PER_SECOND + n))
}

fn offset() -> impl Strategy<Value = i64> {
    prop_oneof![
        Just(0i64),
        -50_400i64..=50_400i64,
        (-56i64..=56).prop_map(|q| q * 900)
    ]
}

fn clock_duration() -> impl Strategy<Value = CalendarDuration> {
    (0u64..100_000, 0u64..100_000, 0u64..10_000_000).prop_map(|(hours, minutes, seconds)| {
        CalendarDuration {
            hours,
            minutes,
            seconds,
            ..CalendarDuration::default()
        }
    })
}

fn any_duration() -> impl Strategy<Value = CalendarDuration> {
    (
        any::<bool>(),
        0u64..50,
        0u64..200,
        0u64..100,
        0u64..1_000,
        0u64..1_000,
        0u64..1_000,
        0u64..100_000,
    )
        .prop_map(
            |(negative, years, months, weeks, days, hours, minutes, seconds)| {
                let duration = CalendarDuration {
                    negative,
                    years,
                    months,
                    weeks,
                    days,
                    hours,
                    minutes,
                    seconds,
                };
                CalendarDuration {
                    negative: negative && !duration.is_zero(),
                    ..duration
                }
            },
        )
}

fn negated(duration: CalendarDuration) -> CalendarDuration {
    CalendarDuration {
        negative: !duration.negative && !duration.is_zero(),
        ..duration
    }
}

fn local_civil(instant: LogicalInstant, offset: i64) -> (i64, i64, i64) {
    let seconds = i64::try_from(instant.as_nanos().div_euclid(NANOS_PER_SECOND)).unwrap() + offset;
    civil_from_days(seconds.div_euclid(SECONDS_PER_DAY))
}

proptest! {
    #[test]
    fn display_and_parse_round_trip(duration in any_duration()) {
        prop_assert_eq!(CalendarDuration::parse(&duration.to_string()).unwrap(), duration);
    }

    #[test]
    fn clock_units_add_then_subtract_return_the_start(start in instant(), zone in offset(), duration in clock_duration()) {
        let zone = FixedZone(zone);
        let Ok(there) = move_instant(start, &zone, Some(&duration), None) else {
            return Ok(());
        };
        let back = move_instant(there, &zone, Some(&negated(duration)), None).unwrap();
        prop_assert_eq!(back, start);
    }

    #[test]
    fn anchors_are_idempotent(start in instant(), zone in offset(), anchor in proptest::sample::select(Anchor::ALL.to_vec())) {
        let zone = FixedZone(zone);
        let once = move_instant(start, &zone, None, Some(anchor)).unwrap();
        let start_like = !matches!(anchor, Anchor::StartOfNextMonth);
        if start_like {
            prop_assert_eq!(move_instant(once, &zone, None, Some(anchor)).unwrap(), once);
        } else {
            // startOfNextMonth twice moves two months; startOfMonth of it stays put.
            prop_assert_eq!(move_instant(once, &zone, None, Some(Anchor::StartOfMonth)).unwrap(), once);
        }
    }

    #[test]
    fn start_and_end_enclose_the_instant(start in instant(), zone in offset()) {
        let zone = FixedZone(zone);
        let get = |anchor| move_instant(start, &zone, None, Some(anchor)).unwrap();
        for (low, high) in [(Anchor::StartOfDay, Anchor::EndOfDay), (Anchor::StartOfMonth, Anchor::EndOfMonth), (Anchor::StartOfYear, Anchor::EndOfYear)] {
            prop_assert!(get(low) <= start, "{:?}", low);
            // The end is the last microsecond: an instant inside that microsecond is later.
            prop_assert!(start.as_nanos() < get(high).as_nanos() + 1_000, "{:?}", high);
        }
        prop_assert!(start < get(Anchor::StartOfNextMonth));
    }

    #[test]
    fn end_of_month_plus_a_microsecond_is_the_next_month(start in instant(), zone in offset()) {
        let zone = FixedZone(zone);
        let end = move_instant(start, &zone, None, Some(Anchor::EndOfMonth)).unwrap();
        let next = move_instant(start, &zone, None, Some(Anchor::StartOfNextMonth)).unwrap();
        prop_assert_eq!(end.as_nanos() + 1_000, next.as_nanos());
        let end_of_day = move_instant(start, &zone, None, Some(Anchor::EndOfDay)).unwrap();
        let day = move_instant(start, &zone, None, Some(Anchor::StartOfDay)).unwrap();
        prop_assert_eq!(end_of_day.as_nanos() + 1_000 - day.as_nanos(), 86_400 * NANOS_PER_SECOND);
    }

    #[test]
    fn month_steps_never_leave_the_target_month(start in instant(), zone in offset(), months in 0u64..400, negative in any::<bool>()) {
        let duration = CalendarDuration { negative: negative && months > 0, months, ..CalendarDuration::default() };
        let Ok(result) = move_instant(start, &FixedZone(zone), Some(&duration), None) else {
            return Ok(());
        };
        let (y0, m0, d0) = local_civil(start, zone);
        let (y1, m1, d1) = local_civil(result, zone);
        let delta = i64::try_from(months).unwrap() * if duration.negative { -1 } else { 1 };
        prop_assert_eq!(y1 * 12 + m1 - 1, y0 * 12 + m0 - 1 + delta);
        prop_assert!(d1 <= d0);
        // The time of day is kept.
        let of_day = |i: LogicalInstant| (i.as_nanos() + i128::from(zone) * NANOS_PER_SECOND).rem_euclid(86_400 * NANOS_PER_SECOND);
        prop_assert_eq!(of_day(result), of_day(start));
    }

    #[test]
    fn moves_are_monotone_in_each_unit(start in instant(), zone in offset(), unit in 0usize..7, a in 0u64..500, b in 0u64..500) {
        let (small, large) = (a.min(b), a.max(b));
        let with = |n: u64| {
            let mut duration = CalendarDuration::default();
            *[&mut duration.years, &mut duration.months, &mut duration.weeks, &mut duration.days, &mut duration.hours, &mut duration.minutes, &mut duration.seconds][unit] = n;
            duration
        };
        let zone = FixedZone(zone);
        let s = move_instant(start, &zone, Some(&with(small)), None);
        let l = move_instant(start, &zone, Some(&with(large)), None);
        if let (Ok(s), Ok(l)) = (s, l) {
            prop_assert!(s <= l);
            let sn = move_instant(start, &zone, Some(&negated(with(small))), None);
            let ln = move_instant(start, &zone, Some(&negated(with(large))), None);
            if let (Ok(sn), Ok(ln)) = (sn, ln) {
                prop_assert!(ln <= sn);
                prop_assert!(sn <= start && start <= s);
            }
        }
    }
}
