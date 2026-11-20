//! Replays the Lean bit-sequence specification of the Auth Base32 codec.

use fireemu_core_auth::base32;

const CORPUS: &str = include_str!("fixtures/lean-auth-base32.corpus");

fn bytes(hex: &str) -> Vec<u8> {
    if hex == "-" {
        return Vec::new();
    }
    assert!(hex.len() % 2 == 0);
    hex.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

fn unempty(text: &str) -> &str {
    if text == "-" {
        ""
    } else {
        text
    }
}

#[test]
fn base32_matches_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let count = lines
        .next()
        .unwrap()
        .strip_prefix("# cases ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert_eq!(count, lines.clone().count());
    assert!(count > 350);
    for line in lines {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        match fields.as_slice() {
            ["encode", hex, expected] => {
                assert_eq!(base32::encode(&bytes(hex)), unempty(expected), "{line}");
                assert_eq!(
                    base32::decode(unempty(expected)).unwrap(),
                    bytes(hex),
                    "{line}"
                );
            }
            ["decode", _, _, _, input, "ok", hex] => {
                assert_eq!(
                    base32::decode(unempty(input)).unwrap(),
                    bytes(hex),
                    "{line}"
                );
            }
            ["decode", _, _, _, input, "error", offset] => {
                let error = base32::decode(unempty(input)).unwrap_err();
                assert_eq!(error.offset, offset.parse::<usize>().unwrap(), "{line}");
            }
            _ => panic!("malformed case {line}"),
        }
    }
}
