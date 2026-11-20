//! Differential replay of the Lean reference for core JSON.

use fireemu_core_types::json::{parse, JsonValue};

const CORPUS: &str = include_str!("fixtures/lean-core-json.corpus");

fn text(encoded: &str) -> String {
    if encoded == "-" {
        return String::new();
    }
    assert_eq!(encoded.len() % 2, 0);
    let bytes = (0..encoded.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&encoded[i..i + 2], 16).expect("hex byte"))
        .collect();
    String::from_utf8(bytes).expect("UTF-8 input")
}

fn hex(source: &str) -> String {
    use std::fmt::Write as _;

    source.bytes().fold(String::new(), |mut out, b| {
        write!(&mut out, "{b:02x}").expect("write hex");
        out
    })
}

fn shape(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => "n".into(),
        JsonValue::Bool(true) => "t".into(),
        JsonValue::Bool(false) => "f".into(),
        JsonValue::Int(n) => format!("i{n}"),
        JsonValue::Float(_) => "d".into(),
        JsonValue::String(s) => format!("s{}", hex(s)),
        JsonValue::Array(items) => {
            let items: Vec<_> = items.iter().map(shape).collect();
            format!("[{}]", items.join(","))
        }
        JsonValue::Object(entries) => {
            let items: Vec<_> = entries
                .keys()
                .map(|k| {
                    let v = value.get(k).expect("object key lookup");
                    format!("{}:{}", hex(k), shape(v))
                })
                .collect();
            format!("{{{}}}", items.join(","))
        }
    }
}

#[test]
fn lexical_and_structural_results_match_lean() {
    let mut lines = CORPUS.lines();
    let declared: usize = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases"))
        .expect("case count")
        .parse()
        .expect("numeric count");
    assert_eq!(declared, lines.clone().count());
    assert!(declared > 72);
    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        match fields.as_slice() {
            [_, _, _, input, "ok", expected] => {
                let value = parse(&text(input)).unwrap_or_else(|e| panic!("{line}: {e}"));
                assert_eq!(shape(&value), *expected, "{line}");
            }
            [_, _, _, input, "err", offset, expected] => {
                let error = parse(&text(input)).expect_err(line);
                assert_eq!(
                    error.offset,
                    offset.parse::<usize>().expect("error offset"),
                    "{line}"
                );
                assert_eq!(error.expected, *expected, "{line}");
            }
            _ => panic!("invalid case: {line}"),
        }
    }
}
