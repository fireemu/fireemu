//! Replays configuration discovery against a synthetic directory tree with observable reads.

use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::rc::Rc;

#[path = "../src/config_discovery.rs"]
#[allow(dead_code)] // The replay supplies the metadata and open callbacks in memory.
mod config_discovery;

use config_discovery::{discover, Discovered, Opened, Stat, Trust};

const CORPUS: &str = include_str!("fixtures/lean-config-discovery.corpus");
const CWD: &str = "/suite/near/work";
const OWNER: u32 = 501;

fn metadata(state: &str, is_file: bool) -> Stat {
    Stat {
        owner: OWNER,
        mode: if state == "writable" { 0o777 } else { 0o755 },
        is_file,
    }
}

fn response(state: &str) -> Result<String, String> {
    match state {
        "good" => Ok("fixture".to_owned()),
        "unreadable" => Err("fixture read refused".to_owned()),
        other => panic!("unexpected file response {other}"),
    }
}

fn replay(
    directories: &BTreeMap<&str, &str>,
    files: &BTreeMap<&str, &str>,
) -> (String, String, usize) {
    let reads = Rc::new(Cell::new(0));
    let sample = |path: &Path| path.display().to_string().replace('\\', "/");
    let discovery = discover(
        Path::new(CWD),
        &Trust::new(OWNER, None),
        |path| {
            let shown = sample(path);
            directories
                .get(shown.as_str())
                .map(|state| metadata(state, false))
                .or_else(|| files.get(shown.as_str()).map(|state| metadata(state, true)))
        },
        |path| {
            let shown = sample(path);
            files.get(shown.as_str()).map(|state| {
                let value = (*state).to_owned();
                let reads = Rc::clone(&reads);
                Opened::new(metadata(state, true), move || {
                    reads.set(reads.get() + 1);
                    response(&value)
                })
            })
        },
    );
    let path = |value: PathBuf| sample(&value);
    let (result, chosen) = match (discovery.found, discovery.skipped) {
        (Discovered::Canonical(selected, text), None) => (
            if text == response("good") {
                "canonical:good"
            } else {
                assert_eq!(text, response("unreadable"));
                "canonical:unreadable"
            },
            path(selected),
        ),
        (Discovered::FirebaseJson(selected, text), None) => (
            if text == response("good") {
                "firebase:good"
            } else {
                assert_eq!(text, response("unreadable"));
                "firebase:unreadable"
            },
            path(selected),
        ),
        (Discovered::Ambiguous, None) => ("ambiguous:-", "-".to_owned()),
        (Discovered::Nothing, None) => ("nothing:-", "-".to_owned()),
        (Discovered::Nothing, Some(skipped)) => {
            assert!(skipped.reason.contains("can be written by any user"));
            ("skipped:-", path(skipped.path))
        }
        (found, skipped) => panic!("unexpected discovery {found:?}, {skipped:?}"),
    };
    (result.to_owned(), chosen, reads.get())
}

#[test]
fn configuration_precedence_matches_the_lean_corpus() {
    let mut rows = CORPUS.lines();
    assert_eq!(rows.next(), Some("# 54 cases."));
    let mut seen = BTreeSet::new();
    for line in rows {
        let fields: Vec<_> = line.split('\t').collect();
        let [id, toml, json, local, near, far, working_dir, nearer_dir, kind, expected, state] =
            fields.as_slice()
        else {
            panic!("invalid row: {line}");
        };
        assert!(seen.insert(*id), "duplicate row {id}");
        let directories = BTreeMap::from([
            ("/", "safe"),
            ("/suite", "safe"),
            ("/suite/near", *nearer_dir),
            (CWD, *working_dir),
        ]);
        let files = BTreeMap::from([
            ("/suite/near/work/fireemu.toml", *toml),
            ("/suite/near/work/fireemu.json", *json),
            ("/suite/near/work/firebase.json", *local),
            ("/suite/near/firebase.json", *near),
            ("/suite/firebase.json", *far),
            ("/suite/near/fireemu.toml", "good"),
        ])
        .into_iter()
        .filter(|(_, state)| *state != "-")
        .collect();
        let (decision, selected, reads) = replay(&directories, &files);
        assert_eq!(decision, format!("{kind}:{state}"), "{id}");
        assert_eq!(selected, *expected, "{id}");
        assert_eq!(
            reads,
            usize::from(matches!(*kind, "canonical" | "firebase")),
            "{id}"
        );
    }
    assert_eq!(seen.len(), 54);
}
