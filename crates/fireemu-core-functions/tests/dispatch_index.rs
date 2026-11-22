//! Differential checks for the indexed Firestore dispatch view.

use fireemu_core_functions::manifest::{
    DocumentEvent, FirestoreDispatchManifest, FunctionGeneration, FunctionManifest, FunctionSpec,
    PlatformOptions, Trigger,
};
use fireemu_core_functions::pattern::PathPattern;
use proptest::prelude::*;

const EVENTS: [DocumentEvent; 4] = [
    DocumentEvent::Created,
    DocumentEvent::Updated,
    DocumentEvent::Deleted,
    DocumentEvent::Written,
];

fn manifest(count: usize, reverse: bool, dense: bool) -> FunctionManifest {
    let mut functions: Vec<_> = (0..count)
        .map(|position| {
            let trigger = if !dense && position % 13 == 11 {
                Trigger::RemoteConfig
            } else {
                Trigger::Firestore {
                    database: if dense || position % 5 == 0 {
                        "(default)".to_owned()
                    } else {
                        format!("db-{}", position % 7)
                    },
                    event: EVENTS[position % 4],
                    document: PathPattern::parse(
                        [
                            "posts/{post}",
                            "users/{user}",
                            "posts/{post}/child/{child}",
                            "{anything=**}",
                        ][position % 4],
                    )
                    .unwrap(),
                    with_auth_context: position % 3 == 0,
                }
            };
            FunctionSpec {
                trigger,
                name: format!("function-{:04}", count - position),
                entry_point: "function".to_owned(),
                region: "us-central1".to_owned(),
                timeout_seconds: 1,
                retry: false,
                generation: FunctionGeneration::Second,
                concurrency: None,
                platform_options: PlatformOptions::default(),
            }
        })
        .collect();
    if reverse {
        functions.reverse();
    }
    FunctionManifest {
        functions,
        ignored: Vec::new(),
    }
}

#[test]
fn firestore_dispatch_preserves_source_order_and_captures() {
    for count in [0, 1, 16, 64, 65, 96, 1024] {
        for reverse in [false, true] {
            for dense in [false, true] {
                let raw = manifest(count, reverse, dense);
                let indexed = FirestoreDispatchManifest::new(raw.clone());
                for database in ["(default)", "db-1", "missing"] {
                    for event in EVENTS {
                        for path in ["posts/z", "users/絵", "posts/é/child/a", "/other/"] {
                            assert_eq!(
                                indexed.firestore_matches(database, path, event),
                                raw.firestore_matches(database, path, event),
                                "{count}/{reverse}/{dense}/{database}/{event:?}/{path}"
                            );
                        }
                    }
                }
            }
        }
    }
}

proptest! {
    #[test]
    fn firestore_dispatch_matches_the_scan_for_generated_manifests(
        count in 0..350usize,
        reverse in any::<bool>(),
        dense in any::<bool>(),
        database in prop_oneof![
            Just("(default)".to_owned()),
            (0..9u8).prop_map(|db| format!("db-{db}")),
        ],
        event in 0..4usize,
        segment in "[[:alpha:]]{1,8}",
        depth in 0..3usize,
    ) {
        let raw = manifest(count, reverse, dense);
        let indexed = FirestoreDispatchManifest::new(raw.clone());
        let path = match depth {
            0 => format!("users/{segment}"),
            1 => format!("posts/{segment}/child/{segment}"),
            _ => segment,
        };
        prop_assert_eq!(
            indexed.firestore_matches(&database, &path, EVENTS[event]),
            raw.firestore_matches(&database, &path, EVENTS[event]),
        );
    }
}

#[test]
fn indexed_names_return_the_first_source_match_across_the_scan_cutoff() {
    for count in [2, 64, 65, 256] {
        let mut source = manifest(count, false, false);
        source.functions[0].name = "same-name".to_owned();
        source.functions[count - 1].name = "same-name".to_owned();
        let indexed = FirestoreDispatchManifest::new(source.clone());
        for function in &source.functions {
            assert_eq!(indexed.get(&function.name), source.get(&function.name));
        }
        assert!(indexed.get("absent").is_none());
    }
}
