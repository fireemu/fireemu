//! Node hashes (`ETag`s) and push ids.

mod support;

use fireemu_core_database::hash::{
    children_hash_without_priority, etag, node_hash, sha1, NULL_ETAG,
};
use fireemu_core_database::push_id::{PushIdGenerator, PUSH_CHARS};
use fireemu_core_database::{Content, Node};
use proptest::prelude::*;
use serde_json::json;
use support::{p, tree_with};

fn etag_of(value: &serde_json::Value) -> String {
    let tree = tree_with(json!({ "h": value.clone() }));
    etag(tree.get(&p("/h")))
}

#[test]
fn sha1_matches_the_rfc_3174_vectors() {
    let hex = |b: [u8; 20]| {
        use std::fmt::Write as _;
        b.iter().fold(String::new(), |mut out, x| {
            let _ = write!(out, "{x:02x}");
            out
        })
    };
    assert_eq!(
        hex(sha1(b"abc")),
        "a9993e364706816aba3e25717850c26c9cd0d89d"
    );
    assert_eq!(hex(sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    assert_eq!(
        hex(sha1(
            b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
        )),
        "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
    );
}

/// `ETag`s the official emulator (firebase-database-emulator v4.11.2) answered for these
/// values with `X-Firebase-ETag: true`.
#[test]
fn etags_match_the_official_emulator() {
    assert_eq!(etag_of(&json!(7)), "7wQgMram7RVqVIg/xRZWPfygGx0=");
    assert_eq!(etag_of(&json!(1)), "YPVfR2bXt/lcDjiQZ8pOkAd3qkQ=");
    assert_eq!(
        etag_of(&json!({"x": 1, "y": {"z": "s"}})),
        "6CNhL/bRBr4qg3PQLZRyxlcsmkg="
    );
    assert_eq!(
        etag_of(&json!({".value": 1, ".priority": 2})),
        "FvGzv2x5RbRTIc6uhMwY3pMW2oU="
    );
    assert_eq!(
        etag_of(&json!({
            "b": {".value": 1, ".priority": "z"},
            "a": {".value": 1, ".priority": "y"},
            "c": true
        })),
        "mV6kBXu7GiGh0g0Msmdpi1VmPfk="
    );
    assert_eq!(etag_of(&json!("héllo😀")), "/X5Qhf4oIAMtom1A+iehW8UBBfg=");
    assert_eq!(etag_of(&json!(false)), "aSSNoqcS4oQwJ2xxH20rvpp3zP0=");
    assert_eq!(etag_of(&json!(1.5)), "4MftviR9Z/2MQCMkjh2RNbvlLJc=");
    assert_eq!(
        etag_of(&json!({"x": 1, ".priority": 3})),
        "ru6Zen4x3REbVtvAwMSK4M32NiM="
    );
    assert_eq!(
        etag_of(&json!(9_007_199_254_740_993_i64)),
        "m4qsp/5BbIWTdjthNlnOX+WCTB0="
    );
    assert_eq!(
        etag_of(&json!({"10": 1, "2": 2})),
        "vnrPKbotvFSK3ZXk/BR0Y/sYfZo="
    );
}

#[test]
fn an_absent_value_has_the_null_etag_and_an_empty_hash() {
    assert_eq!(etag(None), NULL_ETAG);
    assert_eq!(NULL_ETAG, "null_etag");
    assert_eq!(node_hash(None), "");
}

#[test]
fn borrowed_children_hash_matches_the_synthetic_parent_definition() {
    let tree = tree_with(json!({
        ".priority": 900,
        "b": {"nested": {".value": "héllo😀", ".priority": 4}, ".priority": 9},
        "a": {".value": 2, ".priority": 1},
        "c": {".value": false, ".priority": 3}
    }));
    let Content::Children(children) = &tree.root().unwrap().content else {
        unreachable!();
    };
    let mut selected: Vec<(&str, &Node)> = children
        .iter()
        .filter(|(key, _)| key.as_str() != "c")
        .map(|(key, child)| (key.as_str(), child))
        .collect();
    selected.reverse();
    let expected = node_hash(Some(&Node {
        content: Content::Children(
            selected
                .iter()
                .map(|(key, child)| ((*key).to_owned(), (*child).clone()))
                .collect(),
        ),
        priority: None,
    }));
    assert_eq!(children_hash_without_priority(selected), expected);
    assert_eq!(children_hash_without_priority(Vec::new()), "");
}

proptest! {
    #[test]
    fn borrowed_children_hash_matches_the_old_synthetic_node_for_every_subset(
        selected_mask in any::<u8>(), reverse in any::<bool>()
    ) {
        let tree = tree_with(json!({
            ".priority": 123,
            "0": {"nested": {".value": "héllo😀", ".priority": 4}, ".priority": 9},
            "2": {".value": 2, ".priority": 1},
            "10": {".value": false, ".priority": 3},
            "-0": {".value": "x", ".priority": 2}
        }));
        let Content::Children(children) = &tree.root().unwrap().content else {
            unreachable!();
        };
        let mut selected: Vec<(&str, &Node)> = children
            .iter()
            .enumerate()
            .filter(|(index, _)| selected_mask & (1 << index) != 0)
            .map(|(_, (key, child))| (key.as_str(), child))
            .collect();
        if reverse {
            selected.reverse();
        }
        let expected = if selected.is_empty() {
            String::new()
        } else {
            node_hash(Some(&Node {
                content: Content::Children(
                    selected
                        .iter()
                        .map(|(key, child)| ((*key).to_owned(), (*child).clone()))
                        .collect(),
                ),
                priority: None,
            }))
        };
        prop_assert_eq!(children_hash_without_priority(selected), expected);
    }
}

#[test]
fn push_ids_encode_the_time_and_increment_within_one_millisecond() {
    let mut ids = PushIdGenerator::new(42);
    let first = ids.next(1_792_408_481_564);
    let second = ids.next(1_792_408_481_564);
    let later = ids.next(1_792_408_481_565);
    assert_eq!(first.len(), 20);
    assert_eq!(&first[..8], &second[..8]);
    assert!(first < second && second < later, "{first} {second} {later}");
    assert!(first.chars().all(|c| PUSH_CHARS.contains(c)));
    // The official emulator answered -P4Irirt... at about this time.
    assert_eq!(&first[..6], "-P4Iri");
}

#[test]
fn push_ids_stay_increasing_when_the_clock_goes_back() {
    let mut ids = PushIdGenerator::new(7);
    let a = ids.next(2_000);
    let b = ids.next(1_000);
    assert!(a < b);
}

#[test]
fn the_increment_carries_over_exhausted_characters() {
    let mut ids = PushIdGenerator::from_state(5_000, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 63], 0);
    assert_eq!(&ids.next(5_000)[8..], "----------0-");
}

#[test]
fn an_exhausted_millisecond_moves_to_the_next_one() {
    let mut ids = PushIdGenerator::from_state(5_000, [63; 12], 0);
    let before = PushIdGenerator::from_state(5_000, [63; 12], 0).current();
    let id = ids.next(5_000);
    let mut fresh = PushIdGenerator::new(1);
    assert_eq!(&id[..8], &fresh.next(5_001)[..8]);
    assert!(id > before);
}

#[test]
fn equal_seeds_give_equal_ids() {
    let mut a = PushIdGenerator::new(9);
    let mut b = PushIdGenerator::new(9);
    for t in [10, 10, 11, 50] {
        assert_eq!(a.next(t), b.next(t));
    }
}

proptest! {
    #[test]
    fn push_ids_increase_strictly(times in prop::collection::vec(1u64..1_000, 1..40), seed in any::<u64>()) {
        let mut ids = PushIdGenerator::new(seed);
        let mut last = String::new();
        for t in times {
            let id = ids.next(t);
            prop_assert_eq!(id.len(), 20);
            prop_assert!(id > last, "{} after {}", id, last);
            last = id;
        }
    }
}

#[test]
fn the_random_part_follows_the_seed() {
    // Pinned so the session seed keeps reproducing the same ids.
    assert_eq!(
        PushIdGenerator::new(42).next(1_792_408_481_564),
        "-P4IriwRj9GL1rCnKbCU"
    );
    assert_ne!(
        PushIdGenerator::new(1).next(5_000),
        PushIdGenerator::new(2).next(5_000)
    );
    let mut ids = PushIdGenerator::new(7);
    let a = ids.next(5_000);
    let b = ids.next(5_001);
    assert_ne!(
        &a[8..],
        &b[8..],
        "each new millisecond draws a new random part"
    );
}
