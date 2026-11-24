//! Regression tests for the in-memory Remote Config template store.

use std::sync::{Arc, Barrier};

use fireemu_adapter_http::remote_config::{
    Change, Error, Namespace, RemoteConfigStores, TemplateStore, WriteMode, WriteResult,
    MAX_RETAINED_VERSIONS,
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
fn out_of_range_clock_leaves_both_histories_intact() {
    let stores = RemoteConfigStores::default();
    let now = LogicalInstant::from_unix_seconds(253_402_300_801);
    assert!(now.to_rfc3339().is_err());
    for namespace in [Namespace::Client, Namespace::Server] {
        let store = stores.get(namespace);
        let before = publish(store, "*", "original");
        assert_eq!(
            store
                .write(WriteMode::Publish, Some("*"), draft("changed"), now)
                .unwrap_err(),
            Error::ClockOutOfRange,
        );
        assert_eq!(store.rollback(1, now).unwrap_err(), Error::ClockOutOfRange);
        assert!(Arc::ptr_eq(&store.current(), &before));
        let history = store.history();
        assert_eq!(history.len(), 1);
        assert!(Arc::ptr_eq(&history[0], &before));
    }
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
                        assert_eq!(base_etag, format!("{etag}-0"));
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
                Err(Error::InvalidTemplate(_) | Error::Transcoder { .. })
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
fn declared_types_apply_to_defaults_and_conditional_values_including_groups() {
    let store = TemplateStore::default();
    for (kind, good, bad) in [
        ("STRING", json!("literal"), json!(17)),
        ("BOOLEAN", json!("TRUE"), json!("maybe")),
        ("BOOLEAN", json!("false"), json!("0")),
        ("NUMBER", json!("-2.3e2"), json!(" 2.3 ")),
        ("JSON", json!("null"), json!("{")),
        (
            "PARAMETER_VALUE_TYPE_UNSPECIFIED",
            json!("literal"),
            json!(false),
        ),
        ("OTHER", json!("literal"), json!("literal")),
    ] {
        for (use_kind, value) in [
            (true, json!({"value": good})),
            (false, json!({"value": bad})),
            (true, json!({"useInAppDefault": true})),
        ] {
            for field in ["defaultValue", "conditionalValues"] {
                for grouped in [false, true] {
                    let mut input = json!({
                        "conditions": [{"name": "selected", "expression": "true"}],
                    });
                    let definition = if grouped {
                        &mut input["parameterGroups"]["example"]["parameters"]["marker"]
                    } else {
                        &mut input["parameters"]["marker"]
                    };
                    *definition =
                        json!({"valueType": kind, "defaultValue": {"useInAppDefault": true}});
                    definition[field] = if field == "conditionalValues" {
                        json!({"selected": value})
                    } else {
                        value.clone()
                    };
                    let result = store.write(WriteMode::Validate, Some("*"), input.clone(), NOW);
                    assert_eq!(result.is_ok(), use_kind && kind != "OTHER", "{input}");
                }
            }
        }
    }
    for (kind, value) in [("BOOLEAN", "0"), ("NUMBER", "Infinity")] {
        let input = json!({"parameters": {"flag": {
            "valueType": kind, "defaultValue": {"value": value},
        }}});
        assert!(matches!(
            store.write(WriteMode::Publish, Some("*"), input, NOW),
            Err(Error::InvalidTemplate(_))
        ));
    }
    assert_eq!(store.current().number(), 0);
    assert!(store.history().is_empty());
}

#[test]
fn malformed_draft_fields_are_rejected_before_the_write_precondition() {
    let store = TemplateStore::default();
    let original = store.current().etag();
    let drafts = [
        json!({"conditions": [{"name": "flag", "expression": "true", "tagColor": []}]}),
        json!({"parameterGroups": {"group": {"description": false}}}),
        json!({"parameters": {"flag": {"valueType": []}}}),
        json!({"parameters": {"flag": {"valueType": "OTHER"}}}),
    ];
    for mode in [WriteMode::Validate, WriteMode::Publish] {
        for tag in [None, Some("obsolete"), Some(original.as_str())] {
            for draft in &drafts {
                assert!(
                    matches!(
                        store.write(mode, tag, draft.clone(), NOW),
                        Err(Error::InvalidTemplate(_) | Error::Transcoder { .. })
                    ),
                    "{mode:?} {tag:?} {draft}"
                );
            }
        }
    }
    assert_eq!(store.current().etag(), original);
    assert!(store.history().is_empty());
}

#[test]
fn parameter_names_and_implicit_defaults_match_the_observed_storage_contract() {
    let store = TemplateStore::default();
    let long_valid = "a".repeat(256);
    let long_invalid = "a".repeat(257);
    for (name, valid) in [
        ("_feature_1", true),
        (long_valid.as_str(), true),
        ("1feature", false),
        ("試験", false),
        ("feature-flag", false),
        (long_invalid.as_str(), false),
    ] {
        let input = json!({"parameters": {(name): {}}});
        let result = store.write(WriteMode::Validate, Some("*"), input, NOW);
        assert_eq!(result.is_ok(), valid, "{name}");
    }
    assert!(matches!(
        store.write(
            WriteMode::Validate,
            Some("*"),
            json!({
                "parameters": {"flag": {"valueType": "BOOLEAN"}}
            }),
            NOW
        ),
        Err(Error::InvalidTemplate(_))
    ));
    let input = json!({
        "parameters": {"probe": {}},
        "parameterGroups": {"other": {"parameters": {
            "flag": {"defaultValue": {}, "valueType": "PARAMETER_VALUE_TYPE_UNSPECIFIED"}
        }}},
    });
    let WriteResult::Published(version) = store
        .write(WriteMode::Publish, Some("*"), input, NOW)
        .unwrap()
    else {
        panic!("valid template was not published");
    };
    assert_eq!(
        version.template().document()["parameters"]["probe"],
        json!({
            "defaultValue": {"value": ""}
        })
    );
    assert_eq!(
        version.template().document()["parameterGroups"]["other"]["parameters"]["flag"],
        json!({
            "defaultValue": {"value": ""}
        })
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
            // The loser either saw the winner's version (stale) or lost under the lock.
            Err(Error::PreconditionFailed | Error::ConcurrentPrecondition { .. }) => (),
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
fn server_namespace_publishes_version_one_with_its_initial_etag() {
    let stores = RemoteConfigStores::default();
    let client = stores.get(Namespace::Client);
    let server = stores.get(Namespace::Server);
    let initial_server = server.current();
    assert_eq!(initial_server.number(), 0);
    assert_ne!(initial_server.etag(), client.current().etag());

    let first_client = publish(client, "*", "client one");
    let second_client = publish(client, &first_client.etag(), "client two");
    assert_eq!(server.current().etag(), initial_server.etag());
    assert!(server.history().is_empty());

    let first_server = publish(server, &initial_server.etag(), "server one");
    assert_eq!(first_server.number(), 1);
    assert_eq!(first_server.change(), Change::Publish { forced: false });
    assert_ne!(first_server.etag(), first_client.etag());
    assert!(Arc::ptr_eq(&client.current(), &second_client));
    assert_eq!(client.history().len(), 2);
    assert_eq!(server.history().len(), 1);
}

#[test]
fn server_namespace_rejects_client_etags_and_rolls_back_its_own_content() {
    let stores = RemoteConfigStores::default();
    let client = publish(&stores.client, "*", "client");
    let first_server = publish(&stores.server, "*", "server one");
    let second_server = publish(&stores.server, "*", "server two");
    for (store, foreign_etag) in [
        (&stores.client, second_server.etag()),
        (&stores.server, client.etag()),
    ] {
        let current = store.current();
        assert!(matches!(
            store.write(
                WriteMode::Publish,
                Some(&foreign_etag),
                draft("crossed"),
                NOW
            ),
            Err(Error::PreconditionFailed)
        ));
        assert!(Arc::ptr_eq(&store.current(), &current));
    }

    let rolled_back = stores.server.rollback(1, NOW).unwrap();
    assert_eq!(rolled_back.number(), 3);
    assert_eq!(rolled_back.change(), Change::Rollback { source: 1 });
    assert_eq!(rolled_back.template(), first_server.template());
    assert!(Arc::ptr_eq(&stores.client.current(), &client));
    assert!(matches!(
        stores.client.rollback(2, NOW),
        Err(Error::UnknownVersion)
    ));
    assert_eq!(stores.client.history().len(), 1);
    assert!(Arc::ptr_eq(&stores.server.current(), &rolled_back));
}

// The HTTP test pict_rows_follow_the_recorded_namespace_rules uses src/remote_config_testdata/pict.tsv.

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
    fn server_namespace_versions_are_independent_of_client(
        steps in proptest::collection::vec(
            (
                any::<bool>(),
                prop_oneof![
                    Just("publish-current"),
                    Just("publish-wildcard"),
                    Just("publish-stale"),
                    Just("validate"),
                    Just("rollback-known"),
                    Just("rollback-unknown"),
                ],
                0_usize..40,
            ),
            0..=40,
        ),
    ) {
        let stores = RemoteConfigStores::default();
        let namespaces = [Namespace::Client, Namespace::Server].map(|namespace| stores.get(namespace));
        let empty = json!({"conditions": [], "parameters": {}, "parameterGroups": {}});
        let mut model = [Vec::<Value>::new(), Vec::new()];
        for (step, (server, operation, choice)) in steps.into_iter().enumerate() {
            let selected = usize::from(server);
            let store = namespaces[selected];
            let current = namespaces.map(TemplateStore::current);
            let history = namespaces.map(TemplateStore::history);
            let etag = current[selected].etag();
            let mut proposal = empty.clone();
            proposal["parameters"]["colour"] = json!({"defaultValue": {"value": step.to_string()}});
            let versions = &mut model[selected];
            match operation {
                "publish-current" | "publish-wildcard" => {
                    let forced = operation == "publish-wildcard";
                    let precondition = if forced { "*" } else { etag.as_str() };
                    let result = store.write(WriteMode::Publish, Some(precondition), proposal.clone(), NOW);
                    prop_assert!(matches!(result, Ok(WriteResult::Published(version))
                        if version.change() == (Change::Publish { forced })), "step {step}: {operation}");
                    versions.push(proposal);
                }
                "publish-stale" => {
                    let result = store.write(WriteMode::Publish, Some("stale"), proposal, NOW);
                    prop_assert!(matches!(result, Err(Error::PreconditionFailed)));
                }
                "validate" => {
                    let result = store.write(WriteMode::Validate, Some(&etag), proposal.clone(), NOW);
                    prop_assert!(matches!(result, Ok(WriteResult::Validated { template, base_etag })
                        if template.document() == &proposal && base_etag == format!("{etag}-0")), "step {step}: {operation}");
                }
                "rollback-known" | "rollback-unknown" => {
                    let index = if operation == "rollback-known" {
                        choice % versions.len().max(1)
                    } else {
                        versions.len()
                    };
                    let source = u64::try_from(index + 1).unwrap();
                    let result = store.rollback(source, NOW);
                    if let Some(expected) = versions.get(index).cloned() {
                        prop_assert!(matches!(result, Ok(version)
                            if version.change() == (Change::Rollback { source })), "step {step}: {operation}");
                        versions.push(expected);
                    } else {
                        prop_assert!(matches!(result, Err(Error::UnknownVersion)));
                    }
                }
                _ => unreachable!(),
            }

            for (index, store) in namespaces.iter().enumerate() {
                let versions = &model[index];
                let head = store.current();
                let retained = store.history();
                prop_assert_eq!(head.number(), u64::try_from(versions.len()).unwrap());
                prop_assert_eq!(head.template().document(), versions.last().unwrap_or(&empty));
                prop_assert_eq!(retained.len(), versions.len());
                let added = versions.len() - history[index].len();
                if added == 0 {
                    prop_assert_eq!(head.number(), current[index].number());
                    prop_assert_eq!(head.etag(), current[index].etag());
                } else {
                    prop_assert_ne!(head.etag(), current[index].etag());
                }
                for (before, after) in history[index].iter().zip(&retained[added..]) {
                    prop_assert!(Arc::ptr_eq(before, after));
                }
                for (index, (version, expected)) in retained.iter().rev().zip(versions).enumerate() {
                    prop_assert_eq!(version.number(), u64::try_from(index + 1).unwrap());
                    prop_assert_eq!(version.template().document(), expected);
                }
            }
        }
    }

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
