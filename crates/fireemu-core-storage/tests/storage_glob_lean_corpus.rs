//! Replays full-match and admission examples from the Lean Storage glob reference.

use fireemu_core_storage::glob::{glob_matches, validate};

#[test]
fn storage_globs_follow_the_lean_reference() {
    let fixture = include_str!("fixtures/lean-storage-glob.corpus");
    let mut rows = fixture.lines();
    let count: usize = rows
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .parse()
        .unwrap();
    assert!(count >= 144);
    assert_eq!(rows.clone().count(), count);
    for row in rows {
        let [id, kind, pattern, name, expected]: [&str; 5] = row
            .split('\t')
            .collect::<Vec<_>>()
            .try_into()
            .expect("case, kind, pattern, name, output");
        match kind {
            "match" => {
                validate(pattern).expect("admissible fragment");
                assert_eq!(
                    glob_matches(pattern, name),
                    expected.parse::<bool>().unwrap(),
                    "fixture {id}: {pattern:?} on {name:?}"
                );
            }
            "validate" => {
                let actual = validate(pattern).err().unwrap_or_else(|| "ok".to_owned());
                assert_eq!(actual, expected, "fixture {id}");
            }
            _ => panic!("unknown operation {kind}"),
        }
    }
}
