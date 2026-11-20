//! Replays Lean's shared byte and string codec reference.

use fireemu_core_types::codec::{
    hex_decode, json_escape_into, percent_decode_bytes, percent_escapes_are_well_formed,
    write_json_string, JsonControlEscape, PlusMode,
};

fn bytes(encoded: &str) -> Vec<u8> {
    assert_eq!(encoded.len() % 2, 0);
    (0..encoded.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&encoded[i..i + 2], 16).unwrap())
        .collect()
}

#[test]
fn wire_codecs_match_lean_on_controls_malformed_escapes_and_wire_bytes() {
    let mut lines = include_str!("fixtures/lean-wire-codecs.corpus").lines();
    assert_eq!(lines.next(), Some("# percent, hex and JSON cases"));
    let mut count = [0usize; 3];
    for row in lines {
        let fields: Vec<_> = row.split('|').collect();
        match fields.as_slice() {
            ["p", _, mode, _, input, output, well_formed] => {
                let mode = match *mode {
                    "form" => PlusMode::Space,
                    "literal" => PlusMode::Literal,
                    _ => panic!("unknown plus mode: {row}"),
                };
                let input = String::from_utf8(bytes(input)).unwrap();
                assert_eq!(percent_decode_bytes(&input, mode), bytes(output), "{row}");
                assert_eq!(
                    percent_escapes_are_well_formed(&input),
                    well_formed.parse::<bool>().unwrap(),
                    "{row}",
                );
                count[0] += 1;
            }
            ["h", input, output] => {
                let input = String::from_utf8(bytes(input)).unwrap();
                let expected = (*output != "!").then(|| bytes(output));
                assert_eq!(hex_decode(&input), expected, "{row}");
                count[1] += 1;
            }
            ["j", control, input, output] => {
                let control = match *control {
                    "short" => JsonControlEscape::Short,
                    "unicode" => JsonControlEscape::Unicode,
                    _ => panic!("unknown control dialect: {row}"),
                };
                let input = String::from_utf8(bytes(input)).unwrap();
                let output = String::from_utf8(bytes(output)).unwrap();
                let mut unquoted = String::from("prefix");
                json_escape_into(&mut unquoted, &input, control);
                assert_eq!(unquoted, format!("prefix{output}"), "{row}");
                let mut quoted = String::new();
                write_json_string(&mut quoted, &input, control);
                assert_eq!(quoted, format!("\"{output}\""), "{row}");
                count[2] += 1;
            }
            _ => panic!("bad fixture row: {row}"),
        }
    }
    assert_eq!(count, [304, 265, 72]);
}
