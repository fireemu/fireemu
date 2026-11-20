//! Replays Lean's dotenv grammar and environment file order reference.

use fireemu_core_functions::env::{env_file_order, parse_strict, validate_key};
use fireemu_core_types::codec::hex_decode;
use std::collections::{BTreeMap, BTreeSet};

const CORPUS: &str = include_str!("fixtures/lean-functions-env.corpus");

fn decode(text: &str) -> String {
    String::from_utf8(hex_decode(text).expect("corpus hex")).expect("corpus UTF-8")
}

fn map(text: &str) -> BTreeMap<String, String> {
    text.split(',')
        .map(|entry| {
            let (key, value) = entry.split_once('=').expect("key/value pair");
            (decode(key), decode(value))
        })
        .collect()
}

#[test]
fn dotenv_agrees_with_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .strip_suffix(" cases.")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(count, 73);
    let mut seen = BTreeSet::new();
    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        assert!(seen.insert(fields[0]), "duplicate corpus row: {line}");
        match fields.as_slice() {
            [id, "key", key, expected] => {
                let result = if *expected == "-" {
                    Ok(())
                } else {
                    Err(decode(expected))
                };
                assert_eq!(validate_key(&decode(key)), result, "{id}");
            }
            [id, "strict", source, "ok", expected] => {
                assert_eq!(parse_strict(&decode(source)), Ok(map(expected)), "{id}");
            }
            [id, "strict", source, "error", expected] => {
                assert_eq!(parse_strict(&decode(source)), Err(decode(expected)), "{id}");
            }
            [id, "files", project, alias, expected] => {
                let alias = (*alias != "-").then(|| decode(alias));
                assert_eq!(
                    env_file_order(&decode(project), alias.as_deref()),
                    expected.split(',').collect::<Vec<_>>(),
                    "{id}"
                );
            }
            _ => panic!("invalid row: {line}"),
        }
    }
    assert_eq!(seen.len(), count);
}
