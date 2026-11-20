//! Replays Lean's Firestore expiration and offset reference.

use std::collections::BTreeMap;

use fireemu_core_firestore::{
    field_path::FieldPath,
    ttl::{
        format_expiration_offset, is_expired_with_offset, parse_expiration_offset, timestamp_at,
        OffsetError,
    },
    value::{Timestamp, Value},
};
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};

const NANOS: i128 = 1_000_000_000;

fn timestamp(raw: &str) -> Timestamp {
    let nanos = raw.parse::<i128>().expect("timestamp nanoseconds");
    let seconds = nanos
        .div_euclid(NANOS)
        .try_into()
        .expect("timestamp seconds");
    let sub = nanos
        .rem_euclid(NANOS)
        .try_into()
        .expect("subsecond fraction");
    Timestamp::new(seconds, sub).expect("fixture timestamp in range")
}

fn offset_error(error: OffsetError) -> &'static str {
    match error {
        OffsetError::NotADuration => "syntax",
        OffsetError::SubSecondPrecision => "precision",
        OffsetError::OutOfRange => "range",
    }
}

fn fields(kind: &str, at: Timestamp) -> (FieldPath, BTreeMap<String, Value>) {
    let expiry = Value::Timestamp(at);
    let (field, map) = match kind {
        "direct" => ("expiry", BTreeMap::from([("expiry".to_owned(), expiry)])),
        "nested" => (
            "nested.expiry",
            BTreeMap::from([(
                "nested".to_owned(),
                Value::Map(BTreeMap::from([("expiry".to_owned(), expiry)])),
            )]),
        ),
        "missing" => ("expiry", BTreeMap::from([("other".to_owned(), expiry)])),
        "wrong-type" => (
            "expiry",
            BTreeMap::from([("expiry".to_owned(), Value::Integer(at.seconds()))]),
        ),
        "blocked" => (
            "nested.expiry",
            BTreeMap::from([("nested".to_owned(), expiry)]),
        ),
        kind => panic!("unknown fixture field shape {kind}"),
    };
    (FieldPath::parse(field).expect("TTL field"), map)
}

#[test]
fn ttl_offset_and_expiry_match_lean_corpus() {
    let mut lines = include_str!("fixtures/lean-firestore-ttl.corpus").lines();
    let count = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases."))
        .expect("fixture count")
        .parse::<usize>()
        .expect("numeric case count");
    assert!(count >= 600);
    assert_eq!(lines.clone().count(), count);

    for line in lines {
        let record: Vec<_> = line.split('\t').collect();
        match record.as_slice() {
            ["offset", _, _, _, input, expected, canonical] => {
                let result = parse_expiration_offset(input);
                if let Some(seconds) = expected.strip_prefix("ok:") {
                    let duration = result.expect("accepted offset");
                    assert_eq!(
                        duration.as_nanos(),
                        seconds.parse::<i128>().expect("offset seconds") * NANOS,
                        "{line}"
                    );
                    assert_eq!(format_expiration_offset(duration), *canonical, "{line}");
                    assert_eq!(parse_expiration_offset(canonical), result, "{line}");
                } else {
                    assert_eq!(
                        offset_error(result.expect_err("invalid offset")),
                        *expected,
                        "{line}"
                    );
                    assert_eq!(*canonical, "-");
                }
            }
            ["expiry", field, _, _, _, at, now, offset, expected] => {
                let (field, fields) = fields(field, timestamp(at));
                let offset = (*offset != "-").then(|| {
                    LogicalDuration::from_nanos(offset.parse().expect("offset nanoseconds"))
                });
                assert_eq!(
                    is_expired_with_offset(&fields, &field, timestamp(now), offset),
                    expected.parse::<bool>().expect("expiry decision"),
                    "{line}"
                );
            }
            ["clock", instant, expected] => {
                let logical = LogicalInstant::from_nanos(instant.parse().expect("logical instant"));
                assert_eq!(timestamp_at(logical), timestamp(expected), "{line}");
            }
            _ => panic!("invalid TTL fixture row"),
        }
    }
}
