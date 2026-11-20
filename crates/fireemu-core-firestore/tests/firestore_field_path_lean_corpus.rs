//! Replays Lean's Firestore field path grammar and byte bounds.

use fireemu_core_firestore::field_path::{FieldPath, FieldPathError};
use fireemu_core_types::codec::hex_decode;

fn text(bytes: &str) -> String {
    String::from_utf8(hex_decode(bytes).expect("fixture hex")).expect("fixture UTF-8")
}

fn error_code(error: &FieldPathError) -> String {
    match *error {
        FieldPathError::Empty => "empty".to_owned(),
        FieldPathError::EmptySegment { index } => format!("empty-segment:{index}"),
        FieldPathError::ReservedSegment { index } => format!("reserved:{index}"),
        FieldPathError::ControlCharacter { offset } => format!("control:{offset}"),
        FieldPathError::SegmentTooLong {
            index,
            bytes,
            maximum,
        } => format!("segment-bytes:{index}:{bytes}:{maximum}"),
        FieldPathError::PathTooLong { bytes, maximum } => format!("path-bytes:{bytes}:{maximum}"),
        FieldPathError::UnterminatedQuote { offset } => format!("unterminated:{offset}"),
        FieldPathError::UnquotedSpecialCharacter { offset } => format!("unquoted:{offset}"),
    }
}

#[test]
fn field_path_matches_lean_corpus() {
    let mut lines = include_str!("fixtures/lean-firestore-field-path.corpus").lines();
    let count = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases."))
        .expect("fixture count")
        .parse::<usize>()
        .expect("numeric case count");
    assert!(count >= 25);
    assert_eq!(lines.clone().count(), count);

    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        let [_, _, _, segments, expected, quoted] = fields.as_slice() else {
            panic!("invalid field path fixture row");
        };
        let segments = match *segments {
            "-" => Vec::new(),
            payload => payload.split(',').map(text).collect::<Vec<_>>(),
        };
        let result = FieldPath::from_segments(segments.iter().map(String::as_str));
        if let Some(canonical) = expected.strip_prefix("ok:") {
            let path = result.expect("accepted raw field path");
            assert_eq!(path.segments(), segments);
            assert_eq!(path.canonical(), text(canonical));
            assert_eq!(FieldPath::parse(&text(canonical)).as_ref(), Ok(&path));
            assert_eq!(FieldPath::parse(&text(quoted)).as_ref(), Ok(&path));
        } else {
            assert_eq!(
                error_code(&result.expect_err("rejected raw field path")),
                *expected
            );
            assert_eq!(*quoted, "-");
        }
    }
}

#[test]
fn aliases_and_malformed_spellings_keep_their_distinct_contracts() {
    let alias = "root.\x60__private__\x60";
    assert_eq!(
        FieldPath::parse(alias),
        Err(FieldPathError::ReservedSegment { index: 1 })
    );
    assert_eq!(
        FieldPath::parse_allowing_reserved(alias)
            .expect("pipeline alias")
            .canonical(),
        "root.__private__"
    );
    assert_eq!(
        FieldPath::parse("a.\x60é"),
        Err(FieldPathError::UnterminatedQuote { offset: 2 })
    );
    assert_eq!(
        FieldPath::parse("a.\x60é\\q\x60"),
        Err(FieldPathError::UnquotedSpecialCharacter { offset: 5 })
    );
    assert_eq!(
        FieldPath::parse("a.\x60é\x60b"),
        Err(FieldPathError::UnquotedSpecialCharacter { offset: 6 })
    );
    assert_eq!(
        FieldPath::parse("a.\x60é\u{0085}\x60"),
        Err(FieldPathError::ControlCharacter { offset: 2 })
    );
    assert_eq!(
        FieldPath::parse("a."),
        Err(FieldPathError::EmptySegment { index: 1 })
    );
}
