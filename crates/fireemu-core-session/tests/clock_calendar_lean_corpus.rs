//! Replays the fixed-offset calendar corpus from `verification/lean/clock-calendar`.
//! The Rust tests do not need Lean.

use fireemu_core_session::calendar::{
    decide, move_instant, Anchor, CalendarDuration, CalendarError, FixedZone, MoveDecision,
    MoveKind,
};
use fireemu_core_types::time::{civil_from_days, days_from_civil, LogicalInstant};
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-clock-calendar.corpus");
const SECOND: i128 = 1_000_000_000;
const DAY: i128 = 86_400 * SECOND;
const LOW: i128 = -62_135_596_800_000_000_000;

fn at(year: i64, month: i64, day: i64) -> i128 {
    i128::from(days_from_civil(year, month, day)) * DAY
}

fn moved(
    start: i128,
    offset: i64,
    duration: Option<&CalendarDuration>,
    anchor: Option<Anchor>,
) -> Result<i128, CalendarError> {
    move_instant(
        LogicalInstant::from_nanos(start),
        &FixedZone(offset),
        duration,
        anchor,
    )
    .map(LogicalInstant::as_nanos)
}

fn duration(text: &str) -> Option<CalendarDuration> {
    (text != "-").then(|| {
        let value = CalendarDuration::parse(text).unwrap();
        assert_eq!(value.to_string(), text);
        value
    })
}

#[test]
fn replay_clock_calendar_corpus() {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .strip_suffix(" cases.")
        .unwrap()
        .parse()
        .unwrap();
    assert!(count >= 400);
    assert_eq!(lines.clone().count(), count);
    for line in lines {
        let fields: Vec<_> = line.split_ascii_whitespace().collect();
        let [start, offset, duration_text, anchor, expected]: [&str; 5] =
            fields.try_into().expect("five corpus fields");
        let start = start.parse().unwrap();
        let offset = offset.parse().unwrap();
        let parsed_duration = duration(duration_text);
        let anchor = (anchor != "-").then(|| Anchor::parse(anchor).unwrap());
        let expected = match expected {
            "Overflow" => Err(CalendarError::Overflow),
            "YearOutOfRange" => Err(CalendarError::YearOutOfRange),
            nanos => Ok(nanos.parse().unwrap()),
        };
        assert_eq!(
            moved(start, offset, parsed_duration.as_ref(), anchor),
            expected,
            "{line}"
        );
    }
}

#[test]
fn combined_years_and_months_clamp_only_once() {
    let february = at(2024, 2, 29);
    let after_year = moved(february, 0, duration("P1Y").as_ref(), None).unwrap();
    assert_eq!(after_year, at(2025, 2, 28));
    assert_eq!(
        moved(after_year, 0, duration("P1M").as_ref(), None),
        Ok(at(2025, 3, 28))
    );
    assert_eq!(
        moved(february, 0, duration("P1Y1M").as_ref(), None),
        Ok(at(2025, 3, 29))
    );
}

#[test]
fn negating_a_month_step_cannot_restore_a_clamped_day() {
    let february = moved(at(2024, 1, 31), 0, duration("P1M").as_ref(), None).unwrap();
    assert_eq!(february, at(2024, 2, 29));
    assert_eq!(
        moved(february, 0, duration("-P1M").as_ref(), None),
        Ok(at(2024, 1, 29))
    );
}

#[test]
fn next_month_keeps_advancing_and_clock_reversal_can_leave_the_range() {
    let next = Some(Anchor::StartOfNextMonth);
    let february = moved(at(2024, 1, 31), 0, None, next).unwrap();
    assert_eq!(february, at(2024, 2, 1));
    assert_eq!(moved(february, 0, None, next), Ok(at(2024, 3, 1)));
    let inside = moved(LOW - 1, 0, duration("PT1S").as_ref(), None).unwrap();
    assert_eq!(
        moved(inside, 0, duration("-PT1S").as_ref(), None),
        Err(CalendarError::YearOutOfRange)
    );
}

fn unit_duration(unit: usize, component: i64) -> CalendarDuration {
    let mut d = CalendarDuration {
        negative: component < 0,
        ..CalendarDuration::default()
    };
    let field = match unit {
        0 => &mut d.years,
        1 => &mut d.months,
        2 => &mut d.weeks,
        3 => &mut d.days,
        4 => &mut d.hours,
        5 => &mut d.minutes,
        6 => &mut d.seconds,
        _ => unreachable!(),
    };
    *field = component.unsigned_abs();
    d
}

proptest! {
    #[test]
    fn gregorian_civil_conversion_round_trips(year in 1i64..=9999, month in 1i64..=12, day in 1i64..=31) {
        let first = days_from_civil(year, month, 1);
        let next = if month == 12 {
            days_from_civil(year + 1, 1, 1)
        } else {
            days_from_civil(year, month + 1, 1)
        };
        prop_assume!(day <= next - first);
        let index = days_from_civil(year, month, day);
        prop_assert_eq!(civil_from_days(index), (year, month, day));
        prop_assert_eq!(index, first + day - 1);
    }

    #[test]
    fn clock_units_are_exact_and_reversible(
        day in -700_000i64..2_900_000, nanos in 0..DAY, offset in -50400i64..=50400,
        hours in 0u64..1000, minutes in 0u64..1000, seconds in 0u64..1000, negative in any::<bool>(),
    ) {
        let start = i128::from(day) * DAY + nanos;
        let d = CalendarDuration { hours, minutes, seconds, negative, ..CalendarDuration::default() };
        let delta = i128::from(3600 * hours + 60 * minutes + seconds) * SECOND;
        let mid = moved(start, offset, Some(&d), None).unwrap();
        prop_assert_eq!(mid, start + if negative { -delta } else { delta });
        let reverse = CalendarDuration { negative: !negative, ..d };
        prop_assert_eq!(moved(mid, offset, Some(&reverse), None), Ok(start));
    }

    #[test]
    fn anchor_idempotence_bounds_and_adjacency(
        day in -700_000i64..2_900_000,
        nanos in prop_oneof![0..DAY, Just(0), Just(DAY - 1), Just(DAY - 1000)],
        offset in -50400i64..=50400,
    ) {
        let start = i128::from(day) * DAY + nanos;
        let anchor = |t, a| moved(t, offset, None, Some(a)).unwrap();
        for a in Anchor::ALL {
            let snapped = anchor(start, a);
            let repeat = if a == Anchor::StartOfNextMonth { Anchor::StartOfMonth } else { a };
            prop_assert_eq!(anchor(snapped, repeat), snapped);
        }
        for (first, last) in [
            (Anchor::StartOfDay, Anchor::EndOfDay),
            (Anchor::StartOfMonth, Anchor::EndOfMonth),
            (Anchor::StartOfYear, Anchor::EndOfYear),
        ] {
            prop_assert!(anchor(start, first) <= start);
            prop_assert!(start <= anchor(start, last) + 999);
        }
        prop_assert_eq!(anchor(start, Anchor::EndOfDay) + 1000, anchor(start + DAY, Anchor::StartOfDay));
        prop_assert_eq!(anchor(start, Anchor::EndOfMonth) + 1000, anchor(start, Anchor::StartOfNextMonth));
    }

    #[test]
    fn a_month_step_clamps_inside_the_target_month(
        day in -700_000i64..2_900_000, nanos in 0..DAY, offset in -50400i64..=50400,
        months in -120i64..=120, next_months in -120i64..=120,
    ) {
        let z = i128::from(offset) * SECOND;
        let start = i128::from(day) * DAY + nanos - z;
        let (year, month, date) = civil_from_days(day);
        let result = moved(start, offset, Some(&unit_duration(1, months)), None).unwrap() + z;
        let (y, m, d) = civil_from_days(i64::try_from(result.div_euclid(DAY)).unwrap());
        let first = at(y, m, 1);
        let next = if m == 12 { at(y + 1, 1, 1) } else { at(y, m + 1, 1) };
        prop_assert_eq!(y * 12 + m - 1, year * 12 + month - 1 + months);
        prop_assert_eq!(d, date.min(i64::try_from((next - first) / DAY).unwrap()));
        prop_assert_eq!(result.rem_euclid(DAY), nanos);
        if d == date {
            let mid = result - z;
            prop_assert_eq!(
                moved(mid, offset, Some(&unit_duration(1, -months)), None),
                Ok(start)
            );
            prop_assert_eq!(
                moved(mid, offset, Some(&unit_duration(1, next_months)), None),
                moved(start, offset, Some(&unit_duration(1, months + next_months)), None)
            );
        }
    }

    #[test]
    fn a_move_is_monotone_in_each_signed_unit(
        day in -719_162i64..2_932_897, nanos in 0..DAY, offset in -50400i64..=50400,
        a in -240i64..=240, b in -240i64..=240,
    ) {
        let start = i128::from(day) * DAY + nanos;
        for unit in 0..7 {
            let lo = unit_duration(unit, a.min(b));
            let hi = unit_duration(unit, a.max(b));
            for anchor in std::iter::once(None).chain(Anchor::ALL.map(Some)) {
                if let (Ok(x), Ok(y)) = (
                    moved(start, offset, Some(&lo), anchor),
                    moved(start, offset, Some(&hi), anchor),
                ) {
                    prop_assert!(x <= y, "unit {unit}, anchor {anchor:?}: {x} > {y}");
                }
            }
        }
    }

    #[test]
    fn decision_matches_the_backwards_rule(current in any::<i128>(), other in any::<i128>(), allow in any::<bool>()) {
        for target in [current, other] {
            for kind in [MoveKind::Advance, MoveKind::Set, MoveKind::AdvanceTo] {
                let expected = if target >= current {
                    MoveDecision::Forward
                } else if allow && matches!(kind, MoveKind::Advance | MoveKind::Set) {
                    MoveDecision::Rewind
                } else {
                    MoveDecision::RefuseBackwards
                };
                prop_assert_eq!(
                    decide(kind, allow, LogicalInstant::from_nanos(current), LogicalInstant::from_nanos(target)),
                    expected,
                );
            }
        }
    }
}
