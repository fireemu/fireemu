//! Replays stable live and versioned page traces from the Lean reference.

use fireemu_core_storage::name::{BucketName, ObjectName};
use fireemu_core_storage::store::{
    ListPage, NewMetadata, ObjectMetadata, Precondition, StorageState, VersionsCursor,
};
use fireemu_core_types::time::LogicalInstant;

const WRITES: &[&str] = &[
    "z", "a/z", "a/a", "a/", "a/a", "a//y", "a--b", "a----c", "A", "a/é", "a/🌸", "aa", "é",
    "e\u{301}", "a--",
];

fn object_text(object: &ObjectMetadata, live: bool) -> String {
    let lifecycle = if live { "l" } else { "a" };
    format!("{}@{}:{lifecycle}", object.name.as_str(), object.generation)
}

fn version_marker(token: &str) -> Option<VersionsCursor> {
    if let Some(name) = token.strip_prefix("p:") {
        return Some(VersionsCursor::Prefix(name.to_owned()));
    }
    if let Some(item) = token.strip_prefix("i:") {
        let (name, generation) = item.split_once('@').expect("version key");
        return Some(VersionsCursor::Item {
            name: name.to_owned(),
            generation: generation.parse().unwrap(),
        });
    }
    assert_eq!(token, "-");
    None
}

fn list_page(
    store: &StorageState,
    bucket: &BucketName,
    mode: &str,
    prefix: &str,
    delimiter: &str,
    marker: &str,
    cap: usize,
) -> (String, String, String) {
    if mode == "versions" {
        let page = store.list_versions_page(
            bucket,
            prefix,
            delimiter,
            version_marker(marker).as_ref(),
            cap,
        );
        let items = page
            .items
            .into_iter()
            .map(|item| object_text(item.object, item.time_deleted.is_none()))
            .collect::<Vec<_>>()
            .join(",");
        let next = match page.next {
            Some(VersionsCursor::Prefix(name)) => format!("p:{name}"),
            Some(VersionsCursor::Item { name, generation }) => format!("i:{name}@{generation}"),
            None => "-".to_owned(),
        };
        return (items, page.prefixes.join(","), next);
    }
    let delimiter = (!delimiter.is_empty()).then_some(delimiter);
    let marker = (marker != "-").then_some(marker);
    let ListPage {
        items,
        prefixes,
        next_page_token,
    } = match mode {
        "gcs" => store.list(bucket, prefix, delimiter, marker, Some(cap)),
        "strict" | "trailing" => store.list_matching_production(
            bucket,
            prefix,
            delimiter,
            marker,
            Some(cap),
            mode == "trailing",
            &|_| true,
        ),
        "firebase" => store.list_after(bucket, prefix, delimiter, marker, cap),
        _ => panic!("unknown list mode: {mode}"),
    };
    let items = items
        .iter()
        .map(|item| object_text(item, true))
        .collect::<Vec<_>>()
        .join(",");
    (
        items,
        prefixes.join(","),
        next_page_token.unwrap_or_else(|| "-".to_owned()),
    )
}

#[test]
fn stable_list_pages_follow_the_lean_reference() {
    let bucket = BucketName::try_new("demo-list").unwrap();
    let mut store = StorageState::new(1);
    store.set_versioning(&bucket, true);
    for (index, name) in WRITES.iter().enumerate() {
        let version = store
            .put(
                &bucket,
                &ObjectName::try_new(*name).unwrap(),
                b"x".to_vec(),
                NewMetadata::default(),
                Precondition::default(),
                LogicalInstant::UNIX_EPOCH,
            )
            .unwrap();
        assert_eq!(version.generation, u64::try_from(index + 1).unwrap());
    }
    store
        .put(
            &BucketName::try_new("other-list").unwrap(),
            &ObjectName::try_new("a/a").unwrap(),
            b"out of scope".to_vec(),
            NewMetadata::default(),
            Precondition::default(),
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();

    let mut fixture = include_str!("fixtures/lean-storage-list-pages.corpus").lines();
    let count = fixture
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert!(count >= 135);
    assert_eq!(fixture.clone().count(), count);
    for row in fixture {
        let [id, mode, prefix, delimiter, cap, initial, trace]: [&str; 7] = row
            .split('\t')
            .collect::<Vec<_>>()
            .try_into()
            .expect("fixture shape");
        let cap = cap.parse().unwrap();
        let mut marker = initial.to_owned();
        let pages: Vec<_> = trace.split(';').collect();
        assert!(!pages.is_empty(), "{id}");
        for (index, expected) in pages.iter().enumerate() {
            let (items, prefixes, next) =
                list_page(&store, &bucket, mode, prefix, delimiter, &marker, cap);
            assert_eq!(
                format!("{items}|{prefixes}|{next}"),
                *expected,
                "{id}, page {index}"
            );
            assert_eq!(
                next == "-",
                index + 1 == pages.len(),
                "{id}, terminal marker"
            );
            marker = next;
        }
    }
}

#[test]
fn folded_resume_keeps_filter_calls_and_multibyte_delimiters() {
    let bucket = BucketName::try_new("test-bucket").unwrap();
    let mut store = StorageState::new(1);
    let names = ["root-α💾", "root-α💾no", "root-α💾yes", "root-β💾yes"];
    for name in names {
        store
            .put(
                &bucket,
                &ObjectName::try_new(name).unwrap(),
                Vec::new(),
                NewMetadata::default(),
                Precondition::default(),
                LogicalInstant::UNIX_EPOCH,
            )
            .unwrap();
    }

    let calls = std::cell::RefCell::new(Vec::new());
    let page = store.list_matching(
        &bucket,
        "root-",
        Some("💾"),
        Some("root-α💾"),
        Some(1),
        &|name| {
            calls.borrow_mut().push(name.to_owned());
            name.ends_with("yes")
        },
    );
    assert_eq!(page.prefixes, ["root-α💾"]);
    assert_eq!(page.next_page_token.as_deref(), Some("root-β💾"));
    assert!(page.items.is_empty());
    assert_eq!(calls.into_inner(), [&names[..3], &names[..]].concat());
}
