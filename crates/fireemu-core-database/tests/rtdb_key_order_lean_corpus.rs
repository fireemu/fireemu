//! Replays Lean's RTDB key validation and ordering reference.

use std::cmp::Ordering;

use fireemu_core_database::key::{key_as_int, name_compare, utf16_cmp, validate_key};
use fireemu_core_database::ErrorKind;

const CORPUS: &str = include_str!("fixtures/lean-rtdb-key-order.corpus");

fn text(field: &str) -> String {
    field
        .split(',')
        .filter(|part| !part.is_empty())
        .map(|part| char::from_u32(part.parse().expect("decimal Unicode code point")).unwrap())
        .collect()
}

fn order(field: &str) -> Ordering {
    match field {
        "lt" => Ordering::Less,
        "eq" => Ordering::Equal,
        "gt" => Ordering::Greater,
        _ => panic!("unknown order {field:?}"),
    }
}

#[test]
fn lean_key_grammar_and_order_agree_with_core() {
    let mut counts = [0; 3];
    for line in CORPUS.lines() {
        let fields: Vec<_> = line.split('\t').collect();
        match fields.as_slice() {
            ["integer", _, _, _, key, result] => {
                counts[0] += 1;
                let expected = (*result != "-").then(|| result.parse().expect("i32"));
                assert_eq!(key_as_int(&text(key)), expected, "{line:?}");
            }
            ["compare", a, b, result, utf16] => {
                counts[1] += 1;
                let (a, b) = (text(a), text(b));
                assert_eq!(name_compare(&a, &b), order(result), "{line:?}");
                assert_eq!(utf16_cmp(&a, &b), order(utf16), "{line:?}");
            }
            ["validate", key, result] => {
                counts[2] += 1;
                let expected = match *result {
                    "ok" => Ok(()),
                    "invalid" => Err(ErrorKind::InvalidKey),
                    _ => panic!("unknown validation result {result:?}"),
                };
                assert_eq!(
                    validate_key(&text(key)).map_err(|error| error.kind),
                    expected,
                    "{line:?}",
                );
            }
            _ => panic!("malformed corpus row {line:?}"),
        }
    }
    assert_eq!(counts, [72, 625, 153]);
}
