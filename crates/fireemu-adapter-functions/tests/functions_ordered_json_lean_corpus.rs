//! Replays parsed first-member lookup, last-wins projection, and exact output bytes.
use fireemu_adapter_functions::ordered_json::{parse, Ordered};

fn decode_hex(text: &str) -> Vec<u8> {
    let text = text.as_bytes();
    assert_eq!(text.len() % 2, 0);
    text.chunks_exact(2)
        .map(|bytes| u8::from_str_radix(std::str::from_utf8(bytes).unwrap(), 16).unwrap())
        .collect()
}

#[test]
fn ordered_json_preserves_members_and_projects_duplicates_as_specified() {
    let mut lines = include_str!("fixtures/lean-functions-ordered-json.corpus").lines();
    assert_eq!(
        lines.next(),
        Some("# keys|value|lookup|wire hex|pretty hex|first hex or -|last hex or -")
    );
    let mut count = 0;
    for line in lines {
        let fields: Vec<_> = line.split('|').collect();
        let [_, _, key, wire, output, first, last] = fields.as_slice() else {
            panic!("invalid ordered JSON row {line}")
        };
        let parsed = parse(&decode_hex(wire)).unwrap();
        let pretty = parsed.to_pretty();
        assert_eq!(pretty.as_bytes(), decode_hex(output), "{line}");
        assert_eq!(parse(pretty.as_bytes()).unwrap(), parsed, "{line}");

        if *first == "-" {
            assert!(parsed.get(key).is_none(), "{line}");
            assert_eq!(&parsed[*key], &Ordered::Null, "{line}");
        } else {
            let actual = parsed.get(key).unwrap().to_pretty();
            assert_eq!(actual.as_bytes(), decode_hex(first), "{line}");
        }
        let projected = parsed.to_value();
        if *last == "-" {
            assert!(projected.get(*key).is_none(), "{line}");
        } else {
            let expected: serde_json::Value = serde_json::from_slice(&decode_hex(last)).unwrap();
            assert_eq!(projected.get(*key), Some(&expected), "{line}");
        }
        count += 1;
    }
    assert_eq!(count, 36);
}
