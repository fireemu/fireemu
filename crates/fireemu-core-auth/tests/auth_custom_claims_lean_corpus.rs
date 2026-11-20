//! Replays the Lean custom-claims size and presentation contracts.

use fireemu_core_auth::claims::{ClaimValue, CustomClaims, CustomClaimsError};

const CORPUS: &str = include_str!("fixtures/lean-auth-custom-claims.corpus");

fn from_hex(text: &str) -> String {
    assert_eq!(text.len() % 2, 0);
    let bytes = text
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    String::from_utf8(bytes).unwrap()
}

fn check_trace(fields: [&str; 9], line: &str) {
    let [source, shape, count, action, presented, size, canonical_size, eligible, value_state] =
        fields;
    let count: usize = count.parse().unwrap();
    let (scalar, wire) = match shape {
        "ascii" => ("a", "a"),
        "bmp" => ("é", "é"),
        "astral" => ("😀", "😀"),
        "escape" => ("\n", "\\n"),
        _ => panic!("unknown shape {shape}"),
    };
    let value = scalar.repeat(count);
    let quoted = wire.repeat(count);
    let initial = match source {
        "direct" => None,
        "compact" => Some(format!(r#"{{"v":"{quoted}","a":true}}"#)),
        "padded" => Some(format!(" {{ \"v\":\"{quoted}\", \"a\":true }} ")),
        _ => panic!("unknown source {source}"),
    };
    let mut claims = if let Some(text) = &initial {
        CustomClaims::parse_attributes(text).unwrap()
    } else {
        let mut claims = CustomClaims::default();
        claims
            .insert("v", ClaimValue::String(value.clone()))
            .unwrap();
        claims.insert("a", ClaimValue::Bool(true)).unwrap();
        claims
    };
    match action {
        "keep" => (),
        "replace" => claims
            .insert("v", ClaimValue::String("replacement".into()))
            .unwrap(),
        "remove" => assert!(claims.remove("v"), "{line}"),
        "miss" => assert!(!claims.remove("absent"), "{line}"),
        "reject" => {
            assert_eq!(
                claims.insert("sub", ClaimValue::Null),
                Err(CustomClaimsError::ReservedName("sub".into())),
                "{line}"
            );
        }
        _ => panic!("unknown mutation {action}"),
    }
    let value_state = match value_state {
        "initial" => Some(ClaimValue::String(value)),
        "replacement" => Some(ClaimValue::String("replacement".into())),
        "absent" => None,
        _ => panic!("unknown entry state {value_state}"),
    };
    assert_eq!(claims.get("v"), value_state.as_ref(), "{line}");
    assert_eq!(claims.get("a"), Some(&ClaimValue::Bool(true)), "{line}");
    let canonical = claims.canonical_json();
    assert_eq!(
        canonical.len(),
        canonical_size.parse::<usize>().unwrap(),
        "{line}"
    );
    let text = claims.attributes_text().unwrap();
    let expected = match presented {
        "source" => initial.unwrap(),
        "canonical" => canonical,
        _ => panic!("unknown presentation {presented}"),
    };
    assert_eq!(text, expected, "{line}");
    assert_eq!(text.len(), size.parse::<usize>().unwrap(), "{line}");
    assert_eq!(claims.check_size().is_ok(), eligible == "accept", "{line}");
}

fn check_literal(input: &str, canonical: &str, action: &str, text: &str, line: &str) {
    let input = from_hex(input);
    let mut claims = CustomClaims::parse_attributes(&input).unwrap();
    match action {
        "keep" => (),
        "remove" => assert!(claims.remove("user_id"), "{line}"),
        _ => panic!("unknown mutation {action}"),
    }
    assert_eq!(claims.canonical_json(), from_hex(canonical), "{line}");
    let expected = (text != "-").then(|| from_hex(text));
    assert_eq!(claims.attributes_text(), expected, "{line}");
    assert!(claims.check_size().is_ok(), "{line}");
}

#[test]
fn auth_custom_claims_match_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let count = lines
        .next()
        .unwrap()
        .strip_prefix("# cases ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert_eq!(count, lines.clone().count());
    assert_eq!(count, 964);
    for line in lines {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        match fields.as_slice() {
            ["trace", fields @ ..] => check_trace(fields.try_into().unwrap(), line),
            ["literal", input, canonical, action, text] => {
                check_literal(input, canonical, action, text, line)
            }
            _ => panic!("malformed case {line}"),
        }
    }
}
