//! RFC 3339 text for task and event timestamps.
//!
//! The grammar and the output digits are fixed by the recorded production shapes these helpers
//! serve; they were previously produced by `chrono` and are pinned against it in the tests.
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
    let bytes = text.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
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

    /// The previous implementation's reading, kept as the reference while both exist.
    fn chrono_parse(text: &str) -> Option<Parsed> {
        let t = chrono::DateTime::parse_from_rfc3339(text).ok()?;
        Some(Parsed {
            seconds: t.timestamp(),
            nanos: t.timestamp_subsec_nanos(),
        })
    }

    fn chrono_micros(text: &str) -> Option<i128> {
        chrono::DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|t| i128::from(t.timestamp_micros()))
    }

    fn chrono_format(seconds: i64, nanos: u32, fraction: Fraction) -> Option<String> {
        let format = match fraction {
            Fraction::Auto => chrono::SecondsFormat::AutoSi,
            Fraction::Micros => chrono::SecondsFormat::Micros,
            Fraction::Nanos => chrono::SecondsFormat::Nanos,
        };
        if nanos >= NANOS_PER_SECOND {
            return None;
        }
        chrono::DateTime::from_timestamp(seconds, nanos).map(|t| t.to_rfc3339_opts(format, true))
    }

    /// Text close to the grammar: every position is drawn from a small alphabet that includes
    /// the characters the grammar wants there, so both accepted and refused inputs are common.
    fn near_rfc3339() -> impl Strategy<Value = String> {
        let digit = || prop::sample::select(b"0123456789".to_vec());
        let date = (
            (digit(), digit(), digit(), digit()),
            prop::sample::select(vec![b'-', b'/']),
            (prop::sample::select(b"0123".to_vec()), digit()),
            prop::sample::select(vec![b'-', b'.']),
            (prop::sample::select(b"0123".to_vec()), digit()),
            prop::sample::select(vec![b'T', b't', b' ', b'_']),
        );
        let time = (
            (prop::sample::select(b"0123".to_vec()), digit()),
            prop::sample::select(vec![b':', b'-']),
            (prop::sample::select(b"056".to_vec()), digit()),
            prop::sample::select(vec![b':', b'.']),
            (prop::sample::select(b"056".to_vec()), digit()),
        );
        let fraction = prop::sample::select(vec![
            String::new(),
            ".".to_owned(),
            ".5".to_owned(),
            ".123456".to_owned(),
            ".123456789".to_owned(),
            ".1234567891234".to_owned(),
            ".x".to_owned(),
        ]);
        let offset = prop::sample::select(vec![
            "Z",
            "z",
            "+00:00",
            "-00:00",
            "+09:00",
            "-23:59",
            "+23:59",
            "+24:00",
            "+05:60",
            "+0900",
            "+09",
            "\u{2212}05:30",
            "Zx",
            "",
            "+09:00 ",
            "UTC",
        ]);
        (date, time, fraction, offset).prop_map(
            |((y, d1, mo, d2, da, sep), (h, c1, mi, c2, s), frac, off)| {
                let bytes = [
                    y.0, y.1, y.2, y.3, d1, mo.0, mo.1, d2, da.0, da.1, sep, h.0, h.1, c1, mi.0,
                    mi.1, c2, s.0, s.1,
                ];
                format!("{}{frac}{off}", String::from_utf8(bytes.to_vec()).unwrap())
            },
        )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20_000))]

        #[test]
        fn parsing_matches_chrono_near_the_grammar(text in near_rfc3339()) {
            prop_assert_eq!(parse_rfc3339(&text), chrono_parse(&text));
            prop_assert_eq!(parse_rfc3339(&text).map(Parsed::micros), chrono_micros(&text));
        }

        #[test]
        fn parsing_matches_chrono_on_any_text(text in "\\PC{0,40}") {
            prop_assert_eq!(parse_rfc3339(&text), chrono_parse(&text));
        }

        #[test]
        fn formatting_matches_chrono(
            seconds in prop_oneof![
                -8_400_000_000_000i64..8_300_000_000_000,
                -62_167_219_200i64..253_402_300_800,
                Just(i64::MIN), Just(i64::MAX),
            ],
            nanos in prop_oneof![
                Just(0u32), Just(1_000_000), Just(123_000), Just(999_999_999),
                0u32..1_000_000_000, 1_000_000_000u32..=u32::MAX,
            ],
        ) {
            for fraction in [Fraction::Auto, Fraction::Micros, Fraction::Nanos] {
                prop_assert_eq!(
                    format_rfc3339_utc(seconds, nanos, fraction),
                    chrono_format(seconds, nanos, fraction)
                );
            }
        }
    }

    #[test]
    fn formatting_matches_chrono_at_the_calendar_limits() {
        // Edges of years -262144, -262143 and 262143, and one second past each.
        for seconds in [
            -8_334_632_851_200 - 1,
            -8_334_632_851_200,
            -8_303_010_451_201,
            -8_303_010_451_200,
            8_178_762_412_799,
            8_178_762_412_800,
            8_210_298_412_799,
            8_210_298_412_800,
            -62_167_219_201,
            253_402_300_800,
        ] {
            assert_eq!(
                format_rfc3339_utc(seconds, 0, Fraction::Auto),
                chrono_format(seconds, 0, Fraction::Auto),
                "{seconds}"
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
