//! Regression tests for the in-memory Remote Config template store.

use std::sync::{Arc, Barrier};

use fireemu_adapter_http::remote_config::{
    Change, Error, TemplateStore, WriteMode, WriteResult, MAX_RETAINED_VERSIONS,
};
use fireemu_core_types::time::LogicalInstant;
use proptest::prelude::*;
use serde_json::{json, Value};

const NOW: LogicalInstant = LogicalInstant::from_unix_seconds(1_765_000_000);

fn draft(value: &str) -> Value {
    json!({
        "conditions": [
            {"name": "second", "expression": "true", "tagColor": "BLUE"},
            {"name": "first", "expression": "false"}
        ],
        "parameters": {"colour": {"defaultValue": {"value": value}, "conditionalValues": {
            "second": {"value": "special"}
        }}},
        "parameterGroups": {"beta": {"description": "Beta features", "parameters": {
            "active": {"defaultValue": {"useInAppDefault": true}, "valueType": "BOOLEAN"}
        }}},
        "version": {"description": "Test publish", "versionNumber": "999", "updateTime": "bad"}
    })
}

fn publish(
    store: &TemplateStore,
    etag: &str,
    value: &str,
) -> Arc<fireemu_adapter_http::remote_config::Version> {
    let WriteResult::Published(version) = store
        .write(WriteMode::Publish, Some(etag), draft(value), NOW)
        .unwrap()
    else {
        panic!("publish must return a version");
    };
    version
}

#[test]
fn write_matrix_changes_history_only_for_a_valid_publication() {
    for (mode, operation) in [
        (WriteMode::Validate, "validate"),
        (WriteMode::Publish, "publish"),
    ] {
        for selection in ["matching", "stale", "wildcard", "missing"] {
            for valid in [true, false] {
                let name = format!(
                    "{operation}/{selection}/{}",
                    if valid { "valid" } else { "invalid" }
                );
                let store = TemplateStore::default();
                let initial = store.current();
                let etag = initial.etag();
                let selected = match selection {
                    "matching" => Some(etag.as_str()),
                    "stale" => Some("\"obsolete\""),
                    "wildcard" => Some("*"),
                    "missing" => None,
                    _ => unreachable!(),
                };
                let mut input = draft("original");
                if !valid {
                    input["conditions"] = json!([]);
                }
                let result = store.write(mode, selected, input, NOW);
                match (selection, valid, mode) {
                    ("missing", _, _) => {
                        assert!(matches!(result, Err(Error::MissingPrecondition)), "{name}");
                    }
                    ("stale", _, _) => {
                        assert!(matches!(result, Err(Error::PreconditionFailed)), "{name}");
                    }
                    (_, false, _) => {
                        assert!(matches!(result, Err(Error::InvalidTemplate(_))), "{name}");
                    }
                    (_, true, WriteMode::Validate) => {
                        let Ok(WriteResult::Validated {
                            template,
                            base_etag,
                        }) = result
                        else {
                            panic!("{name}: expected successful validation")
                        };
                        assert_eq!(template.document()["conditions"][0]["name"], "second");
                        assert_eq!(template.description(), Some("Test publish"));
                        assert_eq!(base_etag, etag);
                    }
                    (_, true, WriteMode::Publish) => {
                        let Ok(WriteResult::Published(version)) = result else {
                            panic!("{name}: expected a committed version")
                        };
                        assert_eq!(version.number(), 1);
                        assert_eq!(version.update_time(), Some(NOW));
                        assert_eq!(
                            version.change(),
                            Change::Publish {
                                forced: selection == "wildcard"
                            }
                        );
                        assert_ne!(version.etag(), etag);
                        assert_eq!(
                            version.template().document()["parameters"]["colour"]["defaultValue"]
                                ["value"],
                            "original"
                        );
                        assert!(version.template().document().get("version").is_none());
                    }
                }
                if mode == WriteMode::Publish
                    && valid
                    && matches!(selection, "matching" | "wildcard")
                {
                    assert_eq!(store.current().number(), 1, "{name}");
                    assert!(store.version(1).is_some(), "{name}");
                } else {
                    assert_eq!(store.current().etag(), etag, "{name}");
                    assert!(store.version(1).is_none(), "{name}");
                }
                assert!(store.version(0).is_none(), "{name}");
                println!("verified {name}");
            }
        }
    }
}

#[test]
fn rejects_malformed_documents_and_duplicate_definitions() {
    let invalid = [
        json!([]),
        json!({"conditions": {}}),
        json!({"parameters": []}),
        json!({"parameterGroups": {"group": {"parameters": []}}}),
        json!({"parameterGroups": {"group": []}}),
        json!({"conditions": [{"name": "x", "expression": "true"}, {"name": "x", "expression": "false"}]}),
        json!({"conditions": [{"name": "x", "expression": ""}]}),
        json!({"conditions": [{"name": "x", "expression": "true", "tagColor": []}]}),
        json!({"parameters": {"x": false}}),
        json!({"parameters": {"x": {"description": []}}}),
        json!({"parameters": {"x": {"valueType": {}}}}),
        json!({"parameterGroups": {"g": {"description": false, "parameters": {}}}}),
        json!({"parameters": {"x": {"defaultValue": "not an object"}}}),
        json!({"parameters": {"x": {"defaultValue": {"value": false}}}}),
        json!({"parameters": {"x": {"defaultValue": {"value": "x", "useInAppDefault": true}}}}),
        json!({"parameters": {"x": {"conditionalValues": {"absent": {"value": "x"}}}}}),
        json!({"conditions": [{"name": "x", "expression": "true"}], "parameters": {
            "x": {"conditionalValues": {"x": {"useInAppDefault": "yes"}}}
        }}),
        json!({"parameters": {"x": {}}, "parameterGroups": {"g": {"parameters": {"x": {}}}}}),
        json!({"version": {"description": []}}),
        json!({"version": []}),
    ];
    let store = TemplateStore::default();
    for input in invalid {
        assert!(
            matches!(
                store.write(WriteMode::Validate, Some("*"), input.clone(), NOW),
                Err(Error::InvalidTemplate(_))
            ),
            "{input}"
        );
    }
    assert_eq!(store.current().number(), 0);
    let version = publish(&store, "*", "green");
    assert_eq!(
        version.template().document()["parameterGroups"]["beta"]["parameters"]["active"]
            ["defaultValue"]["useInAppDefault"],
        true
    );
}

#[test]
fn two_writers_with_one_etag_commit_exactly_one_document() {
    let store = TemplateStore::default();
    let initial = store.current().etag();
    let ready = Barrier::new(2);
    let results = std::thread::scope(|scope| {
        let store = &store;
        let initial = &initial;
        let ready = &ready;
        let write = |value| {
            ready.wait();
            store.write(WriteMode::Publish, Some(initial), draft(value), NOW)
        };
        let a = scope.spawn(move || write("a"));
        let b = scope.spawn(move || write("b"));
        [a.join().unwrap(), b.join().unwrap()]
    });
    let mut successes = 0;
    for result in results {
        match result {
            Ok(WriteResult::Published(version)) => {
                assert!(Arc::ptr_eq(&store.current(), &version));
                successes += 1;
            }
            Err(Error::PreconditionFailed) => (),
            other => panic!("unexpected write outcome: {other:?}"),
        }
    }
    assert_eq!(successes, 1);
    assert!(store.version(2).is_none());
    assert!(TemplateStore::default().version(1).is_none());
}

#[test]
fn rollback_retains_the_old_version_and_allocates_new_metadata() {
    let store = TemplateStore::default();
    assert!(matches!(store.rollback(0, NOW), Err(Error::UnknownVersion)));
    let one = publish(&store, "*", "one");
    let two = publish(&store, &one.etag(), "two");
    assert!(matches!(
        store.rollback(99, NOW),
        Err(Error::UnknownVersion)
    ));
    assert_eq!(store.current().etag(), two.etag());
    let later = LogicalInstant::from_unix_seconds(1_765_000_001);
    let restored = store.rollback(one.number(), later).unwrap();

    assert_eq!(restored.number(), 3);
    assert_eq!(restored.update_time(), Some(later));
    assert_eq!(restored.change(), Change::Rollback { source: 1 });
    assert_eq!(one.template().document(), restored.template().document());
    assert_ne!(one.etag(), restored.etag());
    assert_ne!(two.etag(), restored.etag());
    assert!(Arc::ptr_eq(&store.version(1).unwrap(), &one));
    assert!(Arc::ptr_eq(&store.version(2).unwrap(), &two));
    assert!(Arc::ptr_eq(&store.current(), &restored));
}

#[test]
fn etags_cannot_be_reused_against_an_independent_store() {
    let left = TemplateStore::default();
    let right = TemplateStore::default();
    assert_ne!(left.current().etag(), right.current().etag());
    let left_version = publish(&left, "*", "left");
    let right_version = publish(&right, "*", "right");
    assert_eq!(left_version.number(), right_version.number());
    assert_ne!(left_version.etag(), right_version.etag());
    assert!(matches!(
        right.write(
            WriteMode::Publish,
            Some(&left_version.etag()),
            draft("replacement"),
            NOW
        ),
        Err(Error::PreconditionFailed)
    ));
    assert!(Arc::ptr_eq(&right.current(), &right_version));
}

#[test]
fn history_is_bounded_even_for_identical_forced_writes() {
    let store = TemplateStore::default();
    assert_eq!(
        store.current().template().document(),
        &json!({"conditions": [], "parameters": {}, "parameterGroups": {}})
    );
    let first = publish(&store, "*", "same");
    let mut latest = first.clone();
    for _ in 0..MAX_RETAINED_VERSIONS {
        let previous = latest.etag();
        latest = publish(&store, "*", "same");
        assert_ne!(previous, latest.etag());
    }
    assert_eq!(
        usize::try_from(latest.number()).unwrap(),
        MAX_RETAINED_VERSIONS + 1
    );
    assert!(store.version(0).is_none());
    assert!(store.version(first.number()).is_none());
    assert_eq!(store.version(2).unwrap().number(), 2);
    assert!(Arc::ptr_eq(&store.current(), &latest));
}

proptest! {
    #[test]
    fn condition_membership_and_literal_values_survive_draft_validation(
        ids in proptest::collection::btree_set(0_u8..8, 0..8),
        selected in 0_u8..8,
        literal in any::<String>(),
    ) {
        let conditions: Vec<_> = ids.iter().map(|id| json!({
            "name": format!("condition{id}"), "expression": "true",
        })).collect();
        let name = format!("condition{selected}");
        let body = json!({
            "conditions": conditions,
            "parameters": {"sample": {"conditionalValues": {(name.clone()): {"value": literal}}}},
        });
        let store = TemplateStore::default();
        let checked = store.write(WriteMode::Validate, Some("*"), body, NOW);
        if ids.contains(&selected) {
            let WriteResult::Validated { template, .. } = checked.unwrap() else {
                panic!("expected a checked draft");
            };
            prop_assert_eq!(&template.document()["parameters"]["sample"]["conditionalValues"][name]["value"], &json!(literal));
        } else {
            prop_assert!(matches!(checked, Err(Error::InvalidTemplate(_))));
        }
        prop_assert_eq!(store.current().number(), 0);
    }
}
