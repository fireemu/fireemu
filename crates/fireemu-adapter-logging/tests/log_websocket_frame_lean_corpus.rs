//! Replays the Lean frame and mask model without opening a socket.

use fireemu_adapter_logging::wire::{close_frame, encode_frame, encode_text_frame, unmask};

const CORPUS: &str = include_str!("fixtures/lean-log-websocket-frame.corpus");

fn hex_bytes(text: &str) -> Vec<u8> {
    if text == "-" {
        return Vec::new();
    }
    assert_eq!(text.len() % 2, 0);
    text.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

fn payload(length: usize, kind: &str) -> Vec<u8> {
    match kind {
        "zero" => vec![0; length],
        "pattern" => (0_u8..=255)
            .cycle()
            .map(|index| index.wrapping_mul(31).wrapping_add(17))
            .take(length)
            .collect(),
        "ff" => vec![255; length],
        _ => panic!("unrecognized payload template {kind}"),
    }
}

fn check_frame(actual: &[u8], header: &str, payload: &[u8], line: &str) {
    let header = hex_bytes(header);
    assert_eq!(actual.len(), header.len() + payload.len(), "{line}");
    let (actual_header, actual_body) = actual.split_at(header.len());
    assert_eq!(actual_header, header, "{line}");
    assert_eq!(actual_body, payload, "{line}");
}

#[test]
fn logging_websocket_frames_match_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let declared = lines
        .next()
        .unwrap()
        .strip_prefix("# cases ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert_eq!(declared, lines.clone().count());
    assert_eq!(declared, 254);
    for line in lines {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        match fields.as_slice() {
            ["frame", length, opcode, kind, header] => {
                let payload = payload(length.parse().unwrap(), kind);
                let frame = encode_frame(opcode.parse().unwrap(), &payload);
                check_frame(&frame, header, &payload, line);
            }
            ["text", input, header] => {
                let payload = hex_bytes(input);
                let text = std::str::from_utf8(&payload).unwrap();
                check_frame(&encode_text_frame(text), header, &payload, line);
            }
            ["close", payload, header] => {
                check_frame(&close_frame(), header, &hex_bytes(payload), line);
            }
            ["mask", length, kind, _, key, expected] => {
                let mut input = payload(length.parse().unwrap(), kind);
                let original = input.clone();
                let key = hex_bytes(key).try_into().unwrap();
                unmask(&mut input, key);
                assert_eq!(input, hex_bytes(expected), "{line}");
                unmask(&mut input, key);
                assert_eq!(input, original, "{line}");
            }
            _ => panic!("malformed frame case {line}"),
        }
    }
}
