//! Replays the Lean runner frame model over in-memory byte streams.

use std::io::{Cursor, ErrorKind};

use fireemu_adapter_functions::protocol::{encode_frame, read_frame, write_frame};
use serde_json::value::RawValue;
use tokio::io::BufReader;

fn unhex(text: &str) -> Vec<u8> {
    if text == "-" {
        return Vec::new();
    }
    assert_eq!(text.len() % 2, 0);
    text.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

#[tokio::test]
async fn command_frames_match_lean() {
    let mut lines = include_str!("fixtures/lean-functions-protocol-frame.corpus").lines();
    assert_eq!(lines.next(), Some("# 97 cases."));
    assert_eq!(lines.clone().count(), 97);
    for line in lines {
        let columns: Vec<_> = line.split('\t').collect();
        let [_, _, _, wire, payload, canonical, answers] = columns.as_slice() else {
            panic!("malformed fixture row: {line}");
        };
        if *canonical != "-" {
            let raw = RawValue::from_string(String::from_utf8(unhex(payload)).unwrap()).unwrap();
            let bytes = unhex(canonical);
            assert_eq!(encode_frame(&raw), bytes, "{line}");
            let mut written = Vec::new();
            write_frame(&mut written, &raw).await.unwrap();
            assert_eq!(written, bytes, "{line}");
        }
        let mut stream = BufReader::with_capacity(2, Cursor::new(unhex(wire)));
        for expected in answers.split(',') {
            let actual = read_frame(&mut stream).await;
            if let Some(payload) = expected.strip_prefix("ok:") {
                let value: serde_json::Value = serde_json::from_slice(&unhex(payload)).unwrap();
                assert_eq!(actual.unwrap(), Some(value), "{line}");
                continue;
            }
            if expected == "eof" {
                assert_eq!(actual.unwrap(), None, "{line}");
                continue;
            }
            let error = actual.unwrap_err();
            match expected {
                "short" => assert_eq!(error.kind(), ErrorKind::UnexpectedEof, "{line}"),
                "malformed" => {
                    assert_eq!(error.kind(), ErrorKind::InvalidData, "{line}");
                    assert_eq!(error.to_string(), "malformed frame length", "{line}");
                }
                "too-large" => {
                    assert_eq!(error.kind(), ErrorKind::InvalidData, "{line}");
                    assert!(error.to_string().contains("exceeds"), "{line}");
                }
                "json" => {
                    assert_eq!(error.kind(), ErrorKind::Other, "{line}");
                    assert!(
                        error.to_string().starts_with("malformed frame JSON:"),
                        "{line}"
                    );
                }
                _ => panic!("unknown result {expected}: {line}"),
            }
        }
    }
}
