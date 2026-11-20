//! Replays source-order Firestore dispatch through the immutable manifest view.

use fireemu_core_functions::manifest::{
    DocumentEvent, FirestoreDispatchManifest, FunctionGeneration, FunctionManifest, FunctionSpec,
    PlatformOptions, Trigger,
};
use fireemu_core_functions::pattern::PathPattern;

const CORPUS: &str = include_str!("fixtures/lean-functions-firestore-index.corpus");
const EVENTS: [DocumentEvent; 4] = [
    DocumentEvent::Created,
    DocumentEvent::Updated,
    DocumentEvent::Deleted,
    DocumentEvent::Written,
];
const PARAMS: [&str; 4] = ["post", "user", "child", "anything"];

fn manifest(count: usize, reverse: bool) -> FirestoreDispatchManifest {
    let mut functions: Vec<_> = (0..count)
        .map(|i| FunctionSpec {
            name: (count - i).to_string(),
            region: "us-central1".to_owned(),
            entry_point: "load".to_owned(),
            trigger: if i % 7 == 6 {
                Trigger::RemoteConfig
            } else {
                Trigger::Firestore {
                    database: if i % 2 == 0 { "primary" } else { "archive" }.to_owned(),
                    event: EVENTS[i % EVENTS.len()],
                    document: PathPattern::parse(
                        [
                            "posts/{post}",
                            "users/{user}",
                            "posts/fixed/child/{child}",
                            "{anything=**}",
                        ][i % PARAMS.len()],
                    )
                    .unwrap(),
                    with_auth_context: i % 3 == 0,
                }
            },
            timeout_seconds: 1,
            retry: false,
            generation: FunctionGeneration::Second,
            concurrency: None,
            platform_options: PlatformOptions::default(),
        })
        .collect();
    if reverse {
        functions.reverse();
    }
    FirestoreDispatchManifest::new(FunctionManifest {
        functions,
        ignored: Vec::new(),
    })
}

#[test]
fn indexed_dispatch_order_and_captures_follow_lean() {
    let mut rows = CORPUS.lines();
    assert!(rows.next().unwrap().starts_with("# functions|"));
    assert_eq!(rows.clone().count(), 480);
    let mut previous = ("", "");
    let mut dispatch = None;
    for row in rows {
        let [size, reverse, database, event, shape, expected]: [&str; 6] =
            row.split('|').collect::<Vec<_>>().try_into().unwrap();
        if (size, reverse) != previous {
            dispatch = Some(manifest(size.parse().unwrap(), reverse == "true"));
            previous = (size, reverse);
        }
        let event = EVENTS[event.parse::<usize>().unwrap()];
        let shape = shape.parse::<usize>().unwrap();
        let path = ["posts/絵", "users/絵", "posts/fixed/child/絵", "other/絵"][shape];
        let matched = dispatch
            .as_ref()
            .unwrap()
            .firestore_matches(database, path, event);
        let encoded = matched
            .iter()
            .map(|candidate| {
                assert_eq!(candidate.params.len(), 1, "{row}");
                let (kind, capture) = PARAMS
                    .iter()
                    .enumerate()
                    .find_map(|(index, parameter)| {
                        candidate.params.get(*parameter).map(|value| (index, value))
                    })
                    .unwrap();
                format!("{}:{kind}:{capture}", candidate.function.name)
            })
            .collect::<Vec<_>>()
            .join(",");
        assert_eq!(encoded, expected, "{row}");
    }
}
