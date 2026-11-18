//! RFC 3339 text for task and event timestamps.
//!
//! The grammar and the output digits are fixed by the recorded production shapes these helpers
//! serve; they were previously produced by `chrono` 0.4.45, and readings recorded from it are
//! pinned in the tests.
//!
//! Accepted input: `YYYY-MM-DD`, then `T`, `t` or a space, then `HH:MM:SS`, an optional `.` with
//! one or more digits (digits past the ninth are ignored), then `Z`, `z` or a numeric offset
//! `±HH:MM` (the sign may also be U+2212) in the range -23:59..=+23:59. A second of `60` is a
//! leap second: it is read as second 59 with one extra second in the nanoseconds.

use fireemu_core_types::time::{civil_from_days, days_from_civil};

const NANOS_PER_SECOND: u32 = 1_000_000_000;
/// The calendar range a formatted instant may fall in (years -262143..=262142).
const MIN_YEAR: i64 = -262_143;
const MAX_YEAR: i64 = 262_142;

/// An instant read from RFC 3339 text: Unix seconds and the nanoseconds past them. A leap second
/// keeps the seconds of second 59 and carries `1_000_000_000..=1_999_999_999` nanoseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Parsed {
    /// Unix seconds.
    pub seconds: i64,
    /// Nanoseconds past `seconds`; at least one second only for a leap second.
    pub nanos: u32,
}

impl Parsed {
    /// Whether the text named a leap second.
    #[must_use]
    pub const fn is_leap_second(self) -> bool {
        self.nanos >= NANOS_PER_SECOND
    }

    /// Unix nanoseconds, counting a leap second's extra second.
    #[must_use]
    pub fn epoch_nanos(self) -> i128 {
        i128::from(self.seconds) * 1_000_000_000 + i128::from(self.nanos)
    }

    /// Unix microseconds, counting a leap second's extra second.
    #[must_use]
    pub fn micros(self) -> i128 {
        i128::from(self.seconds) * 1_000_000 + i128::from(self.nanos / 1_000)
    }
}

fn two_digits(bytes: &[u8], at: usize) -> Option<u32> {
    let hi = bytes.get(at).filter(|b| b.is_ascii_digit())?;
    let lo = bytes.get(at + 1).filter(|b| b.is_ascii_digit())?;
    Some(u32::from(hi - b'0') * 10 + u32::from(lo - b'0'))
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Reads RFC 3339 text (see the module documentation), or `None` when it is not one.
#[must_use]
pub fn parse_rfc3339(text: &str) -> Option<Parsed> {
    // Every field below is read with a bounds check, so text shorter than the 19 fixed bytes
    // stops at its first missing digit; the separators are indexed only after that.
    let bytes = text.as_bytes();
    let year = i64::from(two_digits(bytes, 0)? * 100 + two_digits(bytes, 2)?);
    let month = two_digits(bytes, 5)?;
    let day = two_digits(bytes, 8)?;
    let hour = two_digits(bytes, 11)?;
    let minute = two_digits(bytes, 14)?;
    let second = two_digits(bytes, 17)?;
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || !matches!(bytes[10], b'T' | b't' | b' ')
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    let (second, mut nanos) = match second {
        60 => (59, NANOS_PER_SECOND),
        s => (s, 0),
    };
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let mut rest = &text[19..];
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        let mut value = 0u32;
        for (index, b) in fraction.bytes().take(9).take(digits).enumerate() {
            value += u32::from(b - b'0') * 10u32.pow(8 - u32::try_from(index).ok()?);
        }
        nanos += value;
        rest = &fraction[digits..];
    }
    let offset = parse_offset(rest)?;
    let days = days_from_civil(year, i64::from(month), i64::from(day));
    let seconds =
        days * 86_400 + i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second)
            - offset;
    Some(Parsed { seconds, nanos })
}

/// The offset in seconds east of UTC that makes up all of `rest`.
fn parse_offset(rest: &str) -> Option<i64> {
    if rest == "Z" || rest == "z" {
        return Some(0);
    }
    let (negative, digits) = if let Some(d) = rest.strip_prefix('+') {
        (false, d)
    } else if let Some(d) = rest.strip_prefix('-') {
        (true, d)
    } else {
        (true, rest.strip_prefix('\u{2212}')?)
    };
    let bytes = digits.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return None;
    }
    let hours = two_digits(bytes, 0)?;
    let minutes = two_digits(bytes, 3)?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    let seconds = i64::from(hours * 3_600 + minutes * 60);
    Some(if negative { -seconds } else { seconds })
}

/// How many fractional digits [`format_rfc3339_utc`] writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fraction {
    /// None, three, six or nine digits: the fewest that keep every non-zero digit.
    Auto,
    /// Always six digits (nanoseconds are truncated).
    Micros,
    /// Always nine digits.
    Nanos,
}

/// The UTC civil date and time of `seconds`, or `None` outside years -262143..=262142.
fn civil(seconds: i64) -> Option<(i64, i64, i64, i64)> {
    let days = seconds.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    (MIN_YEAR..=MAX_YEAR)
        .contains(&year)
        .then_some((year, month, day, seconds.rem_euclid(86_400)))
}

/// Writes `seconds` + `nanos` (below one second) as RFC 3339 in UTC with a `Z` suffix, or
/// `None` when the instant is outside years -262143..=262142 or `nanos` is a second or more.
/// A year outside 0..=9999 carries an explicit sign and at least four digits.
#[must_use]
pub fn format_rfc3339_utc(seconds: i64, nanos: u32, fraction: Fraction) -> Option<String> {
    if nanos >= NANOS_PER_SECOND {
        return None;
    }
    let (year, month, day, of_day) = civil(seconds)?;
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else {
        format!("{year:+05}")
    };
    let fraction = match fraction {
        Fraction::Auto if nanos == 0 => String::new(),
        Fraction::Auto if nanos % 1_000_000 == 0 => format!(".{:03}", nanos / 1_000_000),
        Fraction::Auto if nanos % 1_000 == 0 => format!(".{:06}", nanos / 1_000),
        Fraction::Auto | Fraction::Nanos => format!(".{nanos:09}"),
        Fraction::Micros => format!(".{:06}", nanos / 1_000),
    };
    Some(format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}{fraction}Z",
        of_day / 3_600,
        of_day / 60 % 60,
        of_day % 60
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn formatted_text_parses_back(
            seconds in -62_167_219_200i64..253_402_300_800,
            nanos in 0u32..1_000_000_000,
        ) {
            for fraction in [Fraction::Auto, Fraction::Nanos] {
                let text = format_rfc3339_utc(seconds, nanos, fraction).unwrap();
                prop_assert_eq!(parse_rfc3339(&text), Some(Parsed { seconds, nanos }));
            }
        }

        #[test]
        fn any_text_or_prefix_is_read_without_panicking(text in "\\PC{0,40}", cut in 0usize..32) {
            let _ = parse_rfc3339(&text);
            let valid = "2026-01-02T03:04:05.123+09:00";
            let prefix = &valid[..cut.min(valid.len())];
            prop_assert_eq!(parse_rfc3339(prefix).is_some(), prefix.len() == valid.len());
        }

        #[test]
        fn offsets_shift_the_instant(
            seconds in 0i64..253_402_000_000,
            hours in 0i64..24,
            minutes in 0i64..60,
            east in any::<bool>(),
        ) {
            let text = format_rfc3339_utc(seconds, 0, Fraction::Auto).unwrap();
            let sign = if east { '+' } else { '-' };
            let shifted = text.replace('Z', &format!("{sign}{hours:02}:{minutes:02}"));
            let offset = (hours * 3_600 + minutes * 60) * if east { 1 } else { -1 };
            prop_assert_eq!(parse_rfc3339(&shifted).map(|p| p.seconds), Some(seconds - offset));
        }
    }

    /// Readings recorded from chrono 0.4.45 before it was removed.
    const RECORDED_READINGS: &[(&str, Option<(i64, u32)>)] = &[
        ("2026-01-02T03:04:05Z", Some((1_767_323_045, 0))),
        ("2026-01-02t03:04:05z", Some((1_767_323_045, 0))),
        ("2026-01-02 03:04:05-00:00", Some((1_767_323_045, 0))),
        ("2026-01-02T03:04:05\u{2212}05:30", Some((1_767_342_845, 0))),
        (
            "2026-01-02T03:04:05.5+23:59",
            Some((1_767_236_705, 500_000_000)),
        ),
        ("2016-12-31T23:59:60Z", Some((1_483_228_799, 1_000_000_000))),
        ("0000-01-01T00:00:00Z", Some((-62_167_219_200, 0))),
        ("2026-01-02T03:04:05.Z", None),
        ("2026-01-02T03:04:05+24:00", None),
        ("2026-01-02T03:04:05+05:60", None),
        ("2026-01-02T03:04:05+0530", None),
        ("2026-01-02T03:04:05UTC", None),
        ("2026-01-02T03:04:05Z ", None),
        ("2026-01-02T24:00:00Z", None),
        ("2026-13-02T03:04:05Z", None),
        ("2026-01-02T03:60:05Z", None),
        ("2026-01-02T03:04:61Z", None),
        ("+2026-01-02T03:04:05Z", None),
        ("2024-02-29T00:00:00Z", Some((1_709_164_800, 0))),
        ("2000-02-29T00:00:00Z", Some((951_782_400, 0))),
        ("1900-02-29T00:00:00Z", None),
        ("2026-04-30T00:00:00Z", Some((1_777_507_200, 0))),
        ("2026-04-31T00:00:00Z", None),
        ("2026-06-31T00:00:00Z", None),
        ("2026-09-31T00:00:00Z", None),
        ("2026-11-31T00:00:00Z", None),
        ("2026-01-31T00:00:00Z", Some((1_769_817_600, 0))),
        ("2026", None),
        ("2026/01-02T03:04:05Z", None),
        ("2026-01/02T03:04:05Z", None),
        ("2026-01-02_03:04:05Z", None),
        ("2026-01-02T03-04:05Z", None),
        ("2026-01-02T03:04-05Z", None),
        ("2026-01-02T03:04:05+09:000", None),
        ("2026-01-02T03:04:05+09-00", None),
    ];

    /// Formatted text recorded from chrono 0.4.45 before it was removed.
    const RECORDED_TEXT: &[(i64, u32, Fraction, Option<&str>)] = &[
        (-8_334_601_228_801, 0, Fraction::Auto, None),
        (
            -8_334_601_228_800,
            0,
            Fraction::Auto,
            Some("-262143-01-01T00:00:00Z"),
        ),
        (
            8_210_266_876_799,
            0,
            Fraction::Auto,
            Some("+262142-12-31T23:59:59Z"),
        ),
        (8_210_266_876_800, 0, Fraction::Auto, None),
        (
            -62_167_219_201,
            0,
            Fraction::Auto,
            Some("-0001-12-31T23:59:59Z"),
        ),
        (
            253_402_300_800,
            0,
            Fraction::Micros,
            Some("+10000-01-01T00:00:00.000000Z"),
        ),
        (0, 1_000_000_000, Fraction::Auto, None),
        (
            0,
            120_000,
            Fraction::Auto,
            Some("1970-01-01T00:00:00.000120Z"),
        ),
        (
            0,
            120_000_000,
            Fraction::Auto,
            Some("1970-01-01T00:00:00.120Z"),
        ),
        (0, 1, Fraction::Auto, Some("1970-01-01T00:00:00.000000001Z")),
        (0, 1, Fraction::Micros, Some("1970-01-01T00:00:00.000000Z")),
        (
            -1,
            1_000,
            Fraction::Auto,
            Some("1969-12-31T23:59:59.000001Z"),
        ),
    ];

    #[test]
    fn readings_and_text_recorded_from_chrono() {
        for (text, expected) in RECORDED_READINGS {
            let got = parse_rfc3339(text).map(|p| (p.seconds, p.nanos));
            assert_eq!(got, *expected, "{text}");
        }
        for (seconds, nanos, fraction, expected) in RECORDED_TEXT {
            assert_eq!(
                format_rfc3339_utc(*seconds, *nanos, *fraction).as_deref(),
                *expected,
                "{seconds} {nanos}"
            );
        }
    }

    #[test]
    fn named_cases() {
        assert_eq!(
            parse_rfc3339("2026-01-02T03:04:05.123456789123+09:00"),
            Some(Parsed {
                seconds: 1_767_290_645,
                nanos: 123_456_789
            })
        );
        let leap = parse_rfc3339("2016-12-31T23:59:60.5Z").unwrap();
        assert!(leap.is_leap_second());
        assert_eq!(leap.seconds, 1_483_228_799);
        assert_eq!(leap.nanos, 1_500_000_000);
        assert_eq!(parse_rfc3339("2026-02-29T00:00:00Z"), None);
        assert_eq!(parse_rfc3339("2026-01-01T00:00:00+24:00"), None);
        assert_eq!(
            format_rfc3339_utc(-1, 1_000, Fraction::Auto).as_deref(),
            Some("1969-12-31T23:59:59.000001Z")
        );
        assert_eq!(
            format_rfc3339_utc(253_402_300_800, 0, Fraction::Micros).as_deref(),
            Some("+10000-01-01T00:00:00.000000Z")
        );
    }
}
