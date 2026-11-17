//! A bucket's labels and metageneration (strict profile; recorded in STORAGE-STRICTNESS-OBS v4.1): the
//! patch rules, and the same lifecycle as the versioning flag (session capture, restore, reset, bucket
//! delete).

use fireemu_core_storage::name::{BucketName, ObjectName};
use fireemu_core_storage::store::{NewMetadata, Precondition, StorageState};
use fireemu_core_types::time::LogicalInstant;
use std::collections::BTreeMap;

fn bucket(name: &str) -> BucketName {
    BucketName::try_new(name).unwrap()
}

fn changes(pairs: &[(&str, Option<&str>)]) -> Vec<(String, Option<String>)> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), value.map(str::to_owned)))
        .collect()
}

fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}

#[test]
fn an_unpatched_bucket_has_no_labels_and_metageneration_one() {
    let store = StorageState::new(1);
    assert!(store.bucket_labels(&bucket("a.example")).is_empty());
    assert_eq!(store.bucket_metageneration(&bucket("a.example")), 1);
}

#[test]
fn a_patch_sets_and_removes_labels_and_moves_the_metageneration_on_by_one() {
    let mut store = StorageState::new(1);
    let a = bucket("a.example");
    store.patch_bucket_labels(&a, &changes(&[("k", Some("v")), ("z", Some("1"))]), true);
    assert_eq!(store.bucket_labels(&a), labels(&[("k", "v"), ("z", "1")]));
    assert_eq!(store.bucket_metageneration(&a), 2);
    store.patch_bucket_labels(
        &a,
        &changes(&[("k", Some("w")), ("z", None), ("absent", None)]),
        true,
    );
    assert_eq!(store.bucket_labels(&a), labels(&[("k", "w")]));
    assert_eq!(store.bucket_metageneration(&a), 3);
    // An empty patch still counts as a patch; creating a bucket with labels does not.
    store.patch_bucket_labels(&a, &[], true);
    assert_eq!(store.bucket_metageneration(&a), 4);
    let b = bucket("b.example");
    store.patch_bucket_labels(&b, &changes(&[("k", Some("v"))]), false);
    assert_eq!(store.bucket_labels(&b), labels(&[("k", "v")]));
    assert_eq!(store.bucket_metageneration(&b), 1);
    // Another bucket is unaffected.
    assert!(store.bucket_labels(&bucket("c.example")).is_empty());
    assert_eq!(store.bucket_metageneration(&bucket("c.example")), 1);
}

fn patched(names: &[&str]) -> StorageState {
    let mut store = StorageState::new(1);
    for name in names {
        store.patch_bucket_labels(&bucket(name), &changes(&[("k", Some(name))]), true);
    }
    store
}

#[test]
fn a_session_reset_and_a_bucket_removal_drop_the_metadata_of_the_buckets_they_own() {
    let mut store = patched(&["a.example", "b.example", "c.example"]);
    store.remove_buckets_where(|name| name == "a.example");
    assert!(store.bucket_labels(&bucket("a.example")).is_empty());
    assert_eq!(store.bucket_metageneration(&bucket("a.example")), 1);
    assert_eq!(
        store.bucket_labels(&bucket("b.example")),
        labels(&[("k", "b.example")])
    );
    store.remove_bucket(&bucket("b.example"));
    assert!(store.bucket_labels(&bucket("b.example")).is_empty());
    assert_eq!(
        store.bucket_labels(&bucket("c.example")),
        labels(&[("k", "c.example")])
    );
    store.clear();
    assert!(store.bucket_labels(&bucket("c.example")).is_empty());
    assert_eq!(store.bucket_metageneration(&bucket("c.example")), 1);
}

#[test]
fn deleting_an_empty_bucket_drops_its_metadata_and_a_full_one_keeps_it() {
    let mut store = patched(&["a.example", "b.example"]);
    store
        .put(
            &bucket("b.example"),
            &ObjectName::try_new("o").unwrap(),
            b"x".to_vec(),
            NewMetadata::default(),
            Precondition::default(),
            LogicalInstant::from_unix_seconds(1_788_000_000),
        )
        .unwrap();
    assert!(store.delete_empty_bucket(&bucket("a.example")));
    assert!(store.bucket_labels(&bucket("a.example")).is_empty());
    assert!(!store.delete_empty_bucket(&bucket("b.example")));
    assert_eq!(
        store.bucket_labels(&bucket("b.example")),
        labels(&[("k", "b.example")])
    );
    assert_eq!(store.bucket_metageneration(&bucket("b.example")), 2);
}

#[test]
fn a_capture_holds_the_metadata_of_its_buckets_only_and_a_restore_brings_it_back() {
    let mut live = patched(&["a.example", "b.example"]);
    let captured = live.capture_buckets(|name| name == "a.example").unwrap();
    assert_eq!(
        captured.bucket_labels(&bucket("a.example")),
        labels(&[("k", "a.example")])
    );
    assert_eq!(captured.bucket_metageneration(&bucket("a.example")), 2);
    assert!(captured.bucket_labels(&bucket("b.example")).is_empty());
    // The live store moves on, then the owned bucket is restored; the other is left alone.
    live.patch_bucket_labels(
        &bucket("a.example"),
        &changes(&[("k", None), ("n", Some("1"))]),
        true,
    );
    live.patch_bucket_labels(
        &bucket("b.example"),
        &changes(&[("k", Some("changed"))]),
        true,
    );
    live.restore_buckets(|name| name == "a.example", &captured)
        .unwrap();
    assert_eq!(
        live.bucket_labels(&bucket("a.example")),
        labels(&[("k", "a.example")])
    );
    assert_eq!(live.bucket_metageneration(&bucket("a.example")), 2);
    assert_eq!(
        live.bucket_labels(&bucket("b.example")),
        labels(&[("k", "changed")])
    );
    assert_eq!(live.bucket_metageneration(&bucket("b.example")), 3);
    // A restore of a bucket the capture never had leaves the live bucket's metadata only if not owned.
    live.restore_buckets(|name| name == "b.example", &captured)
        .unwrap();
    assert!(live.bucket_labels(&bucket("b.example")).is_empty());
    assert_eq!(live.bucket_metageneration(&bucket("b.example")), 1);
}
