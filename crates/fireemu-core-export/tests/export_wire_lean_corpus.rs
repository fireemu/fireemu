//! Replays the Lean reference for protobuf varints and proto2 signed int64.

use fireemu_core_export::wire::{Reader, WireType, Writer};
use fireemu_core_types::codec::hex_decode;

const CASES: &str = include_str!("fixtures/lean-export-wire.corpus");

fn read_varint(input: &str, expected: &str, consumed: &str, row: &str) {
    let bytes = hex_decode(input).expect("hexadecimal wire bytes");
    let mut reader = Reader::new(&bytes);
    match expected {
        "short" => {
            let error = reader.varint().expect_err(row);
            assert_eq!(error.offset, 0, "{row}");
            assert_eq!(error.expected, "more varint bytes", "{row}");
        }
        "long" => {
            let error = reader.varint().expect_err(row);
            assert_eq!(error.offset, 0, "{row}");
            assert_eq!(error.expected, "a varint of at most ten bytes", "{row}");
        }
        value => assert_eq!(
            reader.varint().expect(row),
            value.parse::<u64>().unwrap(),
            "{row}"
        ),
    }
    assert_eq!(
        reader.position(),
        consumed.parse::<usize>().unwrap(),
        "{row}"
    );
}

fn write_varint(field: &str, mode: &str, value: &str, output: &str, row: &str) {
    let number = field.parse::<u32>().unwrap();
    let value = value.parse::<u64>().unwrap();
    let mut writer = Writer::new();
    match mode {
        "unsigned" => writer.write_varint(number, value),
        "signed" => writer.write_int64(number, i64::from_ne_bytes(value.to_ne_bytes())),
        _ => panic!("unexpected integer mode: {mode}"),
    }
    let bytes = writer.finish();
    assert_eq!(bytes, hex_decode(output).unwrap(), "{row}");
    let mut reader = Reader::new(&bytes);
    assert_eq!(reader.field().unwrap(), Some((number, WireType::Varint)));
    assert_eq!(reader.varint().unwrap(), value, "{row}");
    assert_eq!(reader.position(), bytes.len(), "{row}");
    assert!(reader.is_empty(), "{row}");
}

#[test]
fn replay_the_wire_reference() {
    let mut cases = CASES.lines();
    assert_eq!(
        cases.next(),
        Some("# write FIELD MODE U64 BITS, or read BITS EXPECTED CONSUMED, tab separated")
    );
    let mut counts = (0, 0);
    for row in cases {
        match row.split('\t').collect::<Vec<_>>().as_slice() {
            ["write", number, mode, value, output] => {
                write_varint(number, mode, value, output, row);
                counts.0 += 1;
            }
            ["read", input, value, consumed] => {
                read_varint(input, value, consumed, row);
                counts.1 += 1;
            }
            _ => panic!("malformed corpus row: {row}"),
        }
    }
    assert_eq!(counts, (210, 41));
}
