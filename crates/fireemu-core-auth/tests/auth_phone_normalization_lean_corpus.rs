//! Replay both public phone input paths on the same Lean vectors.

use fireemu_core_auth::store::{AuthError, AuthStore};

const CORPUS: &str = include_str!("fixtures/lean-auth-phone-normalization.corpus");

fn decode(scalars: &str) -> String {
    if scalars == "-" {
        return String::new();
    }
    scalars
        .split(',')
        .map(|scalar| char::from_u32(scalar.parse().unwrap()).unwrap())
        .collect()
}

#[test]
fn phone_formatting_and_raw_validation_match_the_reference() {
    let mut lines = CORPUS.lines();
    assert_eq!(
        lines.next(),
        Some("# prefix|length|head|edit|input scalars|validate|normalized"),
    );
    assert_eq!(lines.clone().count(), 724);
    for line in lines {
        let fields: Vec<_> = line.split('|').collect();
        let [_, _, _, _, scalars, valid, expected] = fields.as_slice() else {
            panic!("unexpected case {line}");
        };
        let input = decode(scalars);
        let outcome = if *valid == "true" {
            Ok(())
        } else {
            Err(AuthError::InvalidPhoneNumber)
        };
        assert_eq!(AuthStore::validate_phone_number(&input), outcome, "{line}");
        let outcome = if *expected == "-" {
            Err(AuthError::InvalidPhoneNumber)
        } else {
            assert_eq!(AuthStore::validate_phone_number(expected), Ok(()), "{line}");
            Ok((*expected).to_owned())
        };
        assert_eq!(AuthStore::normalize_phone_number(&input), outcome, "{line}");
    }
}
