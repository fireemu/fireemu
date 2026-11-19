//! Differential replay of the Lean RFC 3339 corpus and properties over Rust's public time API.

use fireemu_core_types::time::{civil_from_days, days_from_civil, LogicalInstant};
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-rfc3339-time.corpus");
const LOW: i128 = -62_167_219_200_000_000_000;
const HIGH: i128 = 253_402_300_800_000_000_000;
const NANOS_PER_SECOND: i128 = 1_000_000_000;

// For valid civil dates this upper day leaves room for the epoch subtraction in the
// Rust calculation. The corpus pins the exact checked behavior beyond this test domain.
const LAST_SAFE_DAY: i64 = i64::MAX - 719_468;

fn decode_hex(text: &str) -> String {
    assert_eq!(text.len() % 2, 0, "odd hex length");
    let bytes = (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex byte"))
        .collect();
    String::from_utf8(bytes).expect("UTF-8")
}

fn read_date(year: &str, month: &str, day: &str) -> (i64, i64, i64) {
    (
        year.parse().expect("i64 year"),
        month.parse().expect("i64 month"),
        day.parse().expect("i64 day"),
    )
}

#[test]
fn rfc3339_and_civil_date_functions_match_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let declared: usize = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases"))
        .expect("corpus case count")
        .parse()
        .expect("numeric case count");
    let count = lines.clone().count();
    assert_eq!(count, declared, "corpus header count");
    assert!(count >= 200, "corpus has only {count} cases");

    // Detect overflow checks independently of debug assertions and Cargo's profile name.
    let checked = std::panic::catch_unwind(|| {
        let _ = std::hint::black_box(i64::MAX) + 1;
    })
    .is_err();
    for (index, line) in lines.enumerate() {
        let fields: Vec<_> = line.split('\t').collect();
        let context = || format!("corpus line {}: {line}", index + 2);
        match fields.as_slice() {
            ["parse", hex, "ok", nanos] => {
                let expected: i128 = nanos.parse().expect("i128 nanoseconds");
                let actual = LogicalInstant::parse_rfc3339(&decode_hex(hex));
                assert_eq!(
                    actual.map(LogicalInstant::as_nanos),
                    Ok(expected),
                    "{}",
                    context()
                );
            }
            ["parse", hex, "error", offset, expected] => {
                let offset: usize = offset.parse().expect("byte offset");
                let error = LogicalInstant::parse_rfc3339(&decode_hex(hex)).expect_err(&context());
                assert_eq!(
                    (error.offset, error.expected),
                    (offset, *expected),
                    "{}",
                    context()
                );
            }
            ["format", nanos, "ok", expected] => {
                let instant = LogicalInstant::from_nanos(nanos.parse().expect("i128 nanoseconds"));
                assert_eq!(
                    instant.to_rfc3339().as_deref(),
                    Ok(*expected),
                    "{}",
                    context()
                );
            }
            ["format", nanos, "error", year] => {
                let instant = LogicalInstant::from_nanos(nanos.parse().expect("i128 nanoseconds"));
                let year: i128 = year.parse().expect("i128 year");
                assert_eq!(
                    instant.to_rfc3339().expect_err(&context()).year,
                    year,
                    "{}",
                    context()
                );
            }
            ["days", year, month, day, "ok", days] => {
                let (year, month, day) = read_date(year, month, day);
                let days: i64 = days.parse().expect("i64 day number");
                assert_eq!(days_from_civil(year, month, day), days, "{}", context());
            }
            ["days", year, month, day, "overflow", days] => {
                let (year, month, day) = read_date(year, month, day);
                let wrapping: i64 = days.parse().expect("i64 day number");
                if checked {
                    assert!(
                        std::panic::catch_unwind(|| days_from_civil(year, month, day)).is_err(),
                        "{}",
                        context()
                    );
                } else {
                    assert_eq!(days_from_civil(year, month, day), wrapping, "{}", context());
                }
            }
            ["civil", days, year, month, day] => {
                let days: i64 = days.parse().expect("i64 day number");
                assert_eq!(
                    civil_from_days(days),
                    read_date(year, month, day),
                    "{}",
                    context()
                );
            }
            _ => panic!("{}", context()),
        }
    }
}

#[test]
fn numeric_offsets_can_cross_the_four_digit_utc_year_range() {
    for (text, nanos, year) in [
        ("0000-01-01T00:00:00+00:01", LOW - 60 * NANOS_PER_SECOND, -1),
        (
            "9999-12-31T23:59:59-00:01",
            HIGH + 59 * NANOS_PER_SECOND,
            10_000,
        ),
    ] {
        let instant = LogicalInstant::parse_rfc3339(text).expect("valid local timestamp");
        assert_eq!(instant.as_nanos(), nanos);
        assert_eq!(
            instant
                .to_rfc3339()
                .expect_err("UTC year outside range")
                .year,
            year
        );
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1024))]

    /// Both civil inverses and strict calendar ordering where Rust's intermediates fit.
    #[test]
    fn civil_inverses_and_order(
        year in -10_000_000i64..=10_000_000,
        month in 1i64..=12,
        day in 1i64..=31,
        a in i64::MIN..=LAST_SAFE_DAY,
        b in i64::MIN..=LAST_SAFE_DAY,
    ) {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let last = match month {
            2 if leap => 29,
            2 => 28,
            4 | 6 | 9 | 11 => 30,
            _ => 31,
        };
        let day = day.min(last);
        prop_assert_eq!(civil_from_days(days_from_civil(year, month, day)), (year, month, day));

        let (ay, am, ad) = civil_from_days(a);
        let (by, bm, bd) = civil_from_days(b);
        prop_assert_eq!(days_from_civil(ay, am, ad), a);
        prop_assert_eq!(days_from_civil(by, bm, bd), b);
        prop_assert_eq!((ay, am, ad).cmp(&(by, bm, bd)), a.cmp(&b));
    }

    #[test]
    fn canonical_format_round_trips_and_refuses_outside_years(
        inside in LOW..HIGH,
        outside in prop_oneof![i128::MIN..LOW, HIGH..=i128::MAX],
    ) {
        let instant = LogicalInstant::from_nanos(inside);
        let text = instant.to_rfc3339().expect("four-digit UTC year");
        prop_assert_eq!(LogicalInstant::parse_rfc3339(&text), Ok(instant));

        let error = LogicalInstant::from_nanos(outside)
            .to_rfc3339()
            .expect_err("UTC year outside range");
        prop_assert!(error.year < 0 || error.year > 9999);
    }

    #[test]
    fn parser_grammar_and_equivalent_offsets(
        day in -600_000i64..=2_900_000,
        second in 0i64..86_400,
        // Every fractional width, where width zero gives no dot.
        width in 0u32..=9,
        digits in 0u32..1_000_000_000,
        offset_minutes in -1439i64..=1439,
        lowercase in any::<bool>(),
    ) {
        let (year, month, date) = civil_from_days(day);
        let hour = second / 3600;
        let minute = second / 60 % 60;
        let second_in_minute = second % 60;
        let separator = if lowercase { 't' } else { 'T' };
        let zone = if lowercase { 'z' } else { 'Z' };
        let prefix = format!("{year:04}-{month:02}-{date:02}{separator}{hour:02}:{minute:02}:{second_in_minute:02}");
        let digits = digits % 10_u32.pow(width);
        let fractional = if width == 0 { String::new() } else {
            let padding = usize::try_from(width).expect("fraction width");
            format!(".{digits:0padding$}")
        };
        let sign = if offset_minutes < 0 { '-' } else { '+' };
        let hours = offset_minutes.abs() / 60;
        let minutes = offset_minutes.abs() % 60;
        let offset_text = format!("{prefix}{fractional}{sign}{hours:02}:{minutes:02}");
        let nanos = i128::from(digits) * 10_i128.pow(9 - width);
        let utc = (i128::from(day) * 86_400 + i128::from(second - offset_minutes * 60))
            * NANOS_PER_SECOND + nanos;
        let instant = LogicalInstant::from_nanos(utc);
        prop_assert_eq!(LogicalInstant::parse_rfc3339(&offset_text), Ok(instant));
        let canonical = instant.to_rfc3339().expect("UTC year in range");
        prop_assert_eq!(LogicalInstant::parse_rfc3339(&canonical), Ok(instant));
        let local = (i128::from(day) * 86_400 + i128::from(second)) * NANOS_PER_SECOND + nanos;
        prop_assert_eq!(
            LogicalInstant::parse_rfc3339(&format!("{prefix}{fractional}{zone}")),
            Ok(LogicalInstant::from_nanos(local))
        );

        for invalid in [
            format!("{prefix}.0000000000{zone}"),
            format!("{prefix}.{zone}"),
            format!("{prefix}+24:00"),
            format!("{prefix}-23:60"),
            format!("{prefix}{fractional}{zone}!"),
            format!("{year:04}-{month:02}-{date:02}{separator}{hour:02}:{minute:02}:60{zone}"),
        ] {
            prop_assert!(LogicalInstant::parse_rfc3339(&invalid).is_err(), "{}", invalid);
        }
    }
}
