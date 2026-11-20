//! Differential replay of the Lean write rules through `FirestoreState::commit` and `get`.
//! The Rust tests use the checked-in corpus and run without Lean or a server.

use std::collections::BTreeMap;

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_firestore::store::{
    CommitResult, FieldTransform, FirestoreError, FirestoreState, ImportedDocument, Precondition,
    TransformKind, Write, WriteOp, READ_TIME_RETENTION_SECONDS,
};
use fireemu_core_firestore::value::Value;
use fireemu_core_types::ids::{DatabaseId, ProjectId};
use fireemu_core_types::time::LogicalInstant;
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-write-precondition.corpus");

fn path() -> DocumentPath {
    DocumentPath::parse(
        &ProjectId::try_new("demo-write-precondition").unwrap(),
        &DatabaseId::default_database(),
        "docs/one",
    )
    .unwrap()
}

fn at(nanos: i128) -> LogicalInstant {
    LogicalInstant::from_nanos(nanos)
}

fn fields(value: Option<i64>) -> BTreeMap<String, Value> {
    value.map_or_else(BTreeMap::new, |n| {
        BTreeMap::from([("n".to_owned(), Value::Integer(n))])
    })
}

fn optional<T: std::str::FromStr>(text: &str) -> Option<T>
where
    T::Err: std::fmt::Debug,
{
    (text != "-").then(|| text.parse().expect("decimal operand"))
}

fn parse_write(text: &str, path: &DocumentPath) -> Write {
    let parts = text.split(':').collect::<Vec<_>>();
    let precondition = match *parts.get(1).expect("precondition") {
        "none" => None,
        "exists" => Some(Precondition::Exists(true)),
        "missing" => Some(Precondition::Exists(false)),
        instant => Some(Precondition::UpdateTime(at(instant
            .strip_prefix("at@")
            .expect("timestamp condition")
            .parse()
            .expect("timestamp")))),
    };
    let set = |value, update_mask| WriteOp::Set {
        path: path.clone(),
        fields: fields(value),
        update_mask,
    };
    let field = FieldPath::parse("n").unwrap();
    let inc = |delta: Option<i64>| FieldTransform {
        field: field.clone(),
        kind: TransformKind::Increment(delta.map_or(Value::Null, Value::Integer)),
    };
    let delete = || WriteOp::Delete { path: path.clone() };
    let (op, transforms) = match parts.as_slice() {
        ["create", "missing", value] | ["set" | "update", _, value] => {
            (set(optional(value), None), vec![])
        }
        ["masked", _, value] => (set(optional(value), Some(vec![field.clone()])), vec![]),
        ["empty-mask", _] => (set(Some(7), Some(vec![])), vec![]),
        ["delete", _] => (delete(), vec![]),
        ["delete-transform", _] => (delete(), vec![inc(Some(1))]),
        ["transform" | "bad-transform", _, delta] => {
            (set(None, Some(vec![])), vec![inc(optional(delta))])
        }
        ["masked-transform", _, value, delta] => (
            set(optional(value), Some(vec![field.clone()])),
            vec![inc(optional(delta))],
        ),
        _ => panic!("invalid write: {text}"),
    };
    Write {
        op,
        precondition,
        transforms,
    }
}

type DocumentState = Option<(i128, Option<i64>)>;

fn seeded(path: &DocumentPath, last: Option<i128>, initial: DocumentState) -> FirestoreState {
    let mut store = FirestoreState::new();
    if let Some(last) = last {
        let docs = initial
            .map(|(time, value)| ImportedDocument {
                path: path.clone(),
                fields: fields(value),
                create_time: None,
                update_time: Some(at(time)),
            })
            .into_iter()
            .collect();
        store.import_documents(docs, at(last)).unwrap();
    } else {
        assert!(initial.is_none(), "a seed document needs an import clock");
    }
    store
}

fn observe(store: &FirestoreState, path: &DocumentPath) -> DocumentState {
    store.get(path).map(|doc| {
        let value = doc.fields.get("n").map(|value| match value {
            Value::Integer(n) => *n,
            other => panic!("expected an integer field, got {other:?}"),
        });
        assert_eq!(doc.fields.len(), usize::from(value.is_some()));
        (doc.update_time.as_nanos(), value)
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Status {
    Applied,
    NotFound,
    AlreadyExists,
    FailedPrecondition,
    InvalidArgument,
}

fn status(result: &Result<CommitResult, FirestoreError>) -> Status {
    match result {
        Ok(_) => Status::Applied,
        Err(FirestoreError::NotFound(_)) => Status::NotFound,
        Err(FirestoreError::AlreadyExists(_)) => Status::AlreadyExists,
        Err(FirestoreError::FailedPrecondition(_)) => Status::FailedPrecondition,
        Err(FirestoreError::InvalidArgument(_)) => Status::InvalidArgument,
        Err(other) => panic!("unexpected commit error: {other:?}"),
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Observation {
    status: Status,
    doc: DocumentState,
    commit: Option<i128>,
    reports: Vec<Option<i128>>,
}

fn corpus() -> Vec<(usize, &'static str)> {
    let mut lines = CORPUS.lines().enumerate();
    assert!(lines.next().unwrap().1.starts_with("# Generated by "));
    let declared: usize = lines
        .next()
        .unwrap()
        .1
        .strip_prefix("# ")
        .unwrap()
        .strip_suffix(" cases. Format: see Main.lean.")
        .unwrap()
        .parse()
        .expect("case count");
    let cases: Vec<_> = lines.map(|(n, line)| (n + 1, line)).collect();
    assert_eq!(declared, cases.len(), "case count in the header");
    assert!(cases.len() >= 200, "corpus too small");
    cases
}

#[test]
fn commit_matches_the_lean_write_precondition_corpus() {
    let path = path();
    for (line_number, line) in corpus() {
        let (input, output) = line.split_once(" => ").expect("case separator");
        let mut input = input.split_whitespace();
        let label = input.next().expect("case label");
        let last = optional(input.next().unwrap());
        let initial_time = optional(input.next().unwrap());
        let initial_value = optional(input.next().unwrap());
        assert!(initial_time.is_some() || initial_value.is_none());
        let initial = initial_time.map(|time| (time, initial_value));
        let now = at(input.next().unwrap().parse().unwrap());
        let writes: Vec<_> = input.map(|write| parse_write(write, &path)).collect();
        assert!((1..=3).contains(&writes.len()));

        let mut output = output.split_whitespace();
        let expected_status = match output.next().unwrap() {
            "applied" => Status::Applied,
            "NOT_FOUND" => Status::NotFound,
            "ALREADY_EXISTS" => Status::AlreadyExists,
            "FAILED_PRECONDITION" => Status::FailedPrecondition,
            "INVALID_ARGUMENT" => Status::InvalidArgument,
            other => panic!("unknown status: {other}"),
        };
        let final_time = optional(output.next().unwrap());
        let final_value = optional(output.next().unwrap());
        assert!(final_time.is_some() || final_value.is_none());
        let expected = Observation {
            status: expected_status,
            doc: final_time.map(|time| (time, final_value)),
            commit: optional(output.next().unwrap()),
            reports: output.map(optional).collect(),
        };

        let mut store = seeded(&path, last, initial);
        let before = store.get(&path).cloned();
        let version = store.current_version();
        let next_commit = store.next_commit_time(now);
        let result = store.commit(&writes, None, now);
        let actual = Observation {
            status: status(&result),
            doc: observe(&store, &path),
            commit: result.as_ref().ok().map(|r| r.commit_time.as_nanos()),
            reports: result.as_ref().map_or_else(
                |_| vec![],
                |r| {
                    r.write_results
                        .iter()
                        .map(|w| w.update_time.map(LogicalInstant::as_nanos))
                        .collect()
                },
            ),
        };
        assert_eq!(actual, expected, "line {line_number} ({label}): {line}");
        if result.is_err() {
            assert_eq!(store.get(&path), before.as_ref(), "line {line_number}");
            assert_eq!(store.current_version(), version, "line {line_number}");
            assert_eq!(
                store.next_commit_time(now),
                next_commit,
                "line {line_number}"
            );
        }
    }
}

#[test]
fn updates_without_a_precondition_upsert_missing_documents() {
    let path = path();
    for (kind, suffix, value) in [
        ("update", ":7", Some(7)),
        ("masked", ":7", Some(7)),
        ("empty-mask", "", None),
    ] {
        let mut store = FirestoreState::new();
        let explicit = parse_write(&format!("{kind}:exists{suffix}"), &path);
        assert_eq!(
            status(&store.commit(&[explicit], None, at(11_000))),
            Status::NotFound
        );
        let implicit = parse_write(&format!("{kind}:none{suffix}"), &path);
        store.commit(&[implicit], None, at(11_000)).unwrap();
        assert_eq!(observe(&store, &path), Some((11_000, value)));
    }
}

#[test]
fn replaying_a_noop_set_with_its_reported_update_time_succeeds() {
    let path = path();
    let mut store = seeded(&path, Some(10_000), Some((10_000, Some(7))));
    let mut write = parse_write("set:none:7", &path);
    let first = store
        .commit(std::slice::from_ref(&write), None, at(11_000))
        .unwrap();
    assert_eq!(first.write_results[0].update_time, Some(at(10_000)));
    assert!(first.changes.is_empty());
    write.precondition = first.write_results[0]
        .update_time
        .map(Precondition::UpdateTime);
    let second = store.commit(&[write], None, at(12_000)).unwrap();
    assert_eq!(second.write_results[0].update_time, Some(at(10_000)));
    assert!(second.changes.is_empty());
}

#[test]
fn a_changed_write_advances_past_the_imported_update_time() {
    let path = path();
    for imported_time in [10_001, 11_000] {
        let mut store = seeded(&path, Some(10_000), Some((imported_time, Some(7))));
        assert_eq!(observe(&store, &path), Some((imported_time, Some(7))));
        let mut write = parse_write("set:none:8", &path);
        let first = store
            .commit(std::slice::from_ref(&write), None, at(10_001))
            .unwrap();
        assert_eq!(first.changes.len(), 1);
        assert_eq!(first.write_results[0].update_time, Some(at(12_000)));
        write.precondition = Some(Precondition::UpdateTime(at(imported_time)));
        assert_eq!(
            status(&store.commit(&[write], None, at(10_001))),
            Status::FailedPrecondition
        );
        assert_eq!(observe(&store, &path), Some((12_000, Some(8))));
    }
}

#[test]
fn a_refused_import_preserves_the_floor_and_an_empty_import_advances_it() {
    let path = path();
    let now = at(10_000);
    let mut store = seeded(&path, Some(now.as_nanos()), Some((50_001, Some(7))));
    let version = store.current_version();
    let refused = store.import_documents(
        vec![
            ImportedDocument {
                path: path.clone(),
                fields: fields(Some(8)),
                create_time: None,
                update_time: Some(at(100_001)),
            },
            ImportedDocument {
                path: path.clone(),
                fields: BTreeMap::from([(String::new(), Value::Integer(1))]),
                create_time: None,
                update_time: None,
            },
        ],
        now,
    );
    assert_eq!(status(&refused), Status::InvalidArgument);
    assert_eq!(store.read_time(now), at(51_000));
    assert_eq!(store.current_version(), version);
    assert_eq!(observe(&store, &path), Some((50_001, Some(7))));

    let empty = store.import_documents(vec![], now).unwrap();
    assert_eq!(empty.commit_time, at(52_000));
    assert_eq!(empty.version, version);
    assert!(empty.changes.is_empty());
    assert_eq!(store.read_time(now), empty.commit_time);
}

#[test]
fn rounding_the_import_floor_saturates_at_the_largest_instant() {
    let path = path();
    let now = at(10_000);
    let imported_time = i128::MAX - 1;
    let store = seeded(&path, Some(now.as_nanos()), Some((imported_time, Some(7))));
    assert_eq!(observe(&store, &path), Some((imported_time, Some(7))));
    assert_eq!(store.read_time(now), LogicalInstant::MAX);
}

#[test]
fn a_future_import_floor_delays_age_based_history_reclamation() {
    let path = path();
    let now = at(10_000);
    let window = LogicalInstant::from_unix_seconds(READ_TIME_RETENTION_SECONDS).as_nanos();
    let mut store = seeded(&path, Some(now.as_nanos()), Some((2 * window + 1, Some(7))));
    let imported_version = store.current_version();
    let changed = store
        .commit(&[parse_write("set:none:8", &path)], None, now)
        .unwrap();
    assert_eq!(changed.commit_time, at(2 * window + 2_000));

    assert_eq!(store.compact(at(now.as_nanos() + window)), imported_version);
    assert_eq!(
        store.get_at(&path, imported_version).unwrap().fields,
        fields(Some(7))
    );
    assert_eq!(
        store.compact(at(changed.commit_time.as_nanos() + window)),
        changed.version
    );
    assert_eq!(store.oldest_retained_version(), Some(changed.version));
    assert_eq!(observe(&store, &path), Some((2 * window + 2_000, Some(8))));
}

#[test]
fn a_delete_changes_existence_without_reporting_a_time_to_replay() {
    let path = path();
    let mut store = seeded(&path, Some(10_000), Some((10_000, Some(7))));
    let mut write = parse_write("delete:none", &path);
    let deleted = store
        .commit(std::slice::from_ref(&write), None, at(11_000))
        .unwrap();
    assert_eq!(deleted.changes.len(), 1);
    assert_eq!(deleted.write_results[0].update_time, None);
    assert_eq!(observe(&store, &path), None);
    write.precondition = Some(Precondition::UpdateTime(at(10_000)));
    assert_eq!(
        status(&store.commit(&[write], None, at(12_000))),
        Status::FailedPrecondition
    );
}

#[test]
fn the_core_compares_submicrosecond_update_times_exactly() {
    let path = path();
    let mut store = seeded(&path, Some(10_000), Some((10_000, Some(7))));
    let write = parse_write("set:at@10001:8", &path);
    assert_eq!(
        status(&store.commit(std::slice::from_ref(&write), None, at(10_001))),
        Status::FailedPrecondition
    );
    let mut store = seeded(&path, Some(10_000), Some((10_001, Some(7))));
    let committed = store.commit(&[write], None, at(10_001)).unwrap();
    assert_eq!(committed.write_results[0].update_time, Some(at(12_000)));
}

proptest! {
    #[test]
    fn changed_documents_advance_past_imported_times_and_earlier_commits(
        clock in -100_000_i128..100_000,
        prior_offset in -5000_i128..=5000,
        offsets in prop::collection::vec(prop::option::of(prop_oneof![
            Just(0_i128), -5000_i128..0, 1_i128..=5000,
        ]), 0..=4),
        writes in prop::collection::vec((
            0_usize..5,
            prop::sample::select(vec!["set:none:7", "set:none:8", "empty-mask:none",
                "masked:exists:-", "create:missing:7", "transform:none:1", "delete:none"]),
            -5000_i128..=5000,
        ), 1..=20),
    ) {
        let paths: Vec<_> = (0..=offsets.len()).map(|i| DocumentPath::parse(
            &ProjectId::try_new("demo-write-precondition").unwrap(),
            &DatabaseId::default_database(),
            &format!("docs/{i}"),
        ).unwrap()).collect();
        let mut store = FirestoreState::new();
        let prior = store.import_documents(vec![], at(clock + prior_offset)).unwrap();
        let docs = offsets.iter().zip(&paths).map(|(offset, path)| ImportedDocument {
            path: path.clone(),
            fields: fields(Some(7)),
            create_time: None,
            update_time: offset.map(|offset| at(clock + offset)),
        }).collect();
        let imported = store.import_documents(docs, at(clock)).unwrap();
        prop_assert!(imported.commit_time > prior.commit_time);
        prop_assert_eq!(imported.commit_time.as_nanos() % 1_000, 0);
        let mut latest = imported.commit_time;
        for (offset, path) in offsets.iter().zip(&paths) {
            let expected = offset.map_or(imported.commit_time, |offset| at(clock + offset));
            prop_assert_eq!(store.get(path).unwrap().update_time, expected);
            latest = latest.max(expected);
        }
        for (index, kind, offset) in writes {
            let path = &paths[index % paths.len()];
            let before = observe(&store, path);
            let result = store.commit(&[parse_write(kind, path)], None, at(clock + offset));
            let after = observe(&store, path);
            let Ok(commit) = result else {
                prop_assert_eq!(after, before);
                continue;
            };
            prop_assert!(commit.commit_time > latest);
            prop_assert_eq!(commit.commit_time.as_nanos() % 1_000, 0);
            if let Some((time, value)) = after {
                if before.map(|(_, old)| old) != Some(value) {
                    prop_assert!(before.is_none_or(|(old_time, _)| time > old_time));
                    prop_assert_eq!(at(time), commit.commit_time);
                }
            }
            latest = commit.commit_time;
        }
    }

    #[test]
    fn each_write_follows_the_precondition_and_body_rules(
        kind in prop::sample::select(vec![
            "set:P:7", "update:P:7", "masked:P:7", "empty-mask:P", "delete:P",
            "transform:P:1", "masked-transform:P:7:1", "delete-transform:P", "bad-transform:P:-",
        ]),
        present in any::<bool>(),
        value in prop::option::of(any::<i64>()),
        micros in -1000_i128..1000,
        offset in -2000_i128..3000,
        condition in 0_u8..4,
        stale in prop::sample::select(vec![-1000_i128, -1, 0, 1, 1000]),
    ) {
        let path = path();
        let time = micros * 1000;
        let initial = present.then_some((time, value));
        let mut store = seeded(&path, Some(time), initial);
        let requested = time + stale;
        let p = match condition {
            0 => "none".to_owned(),
            1 => "exists".to_owned(),
            2 => "missing".to_owned(),
            _ => format!("at@{requested}"),
        };
        let write = parse_write(&kind.replace('P', &p), &path);
        let invalid = matches!(kind, "delete-transform:P" | "bad-transform:P:-");
        let expected = match condition {
            1 if !present => Status::NotFound,
            2 if present => Status::AlreadyExists,
            3 if initial.map(|(t, _)| t) != Some(requested) => Status::FailedPrecondition,
            _ if invalid => Status::InvalidArgument,
            _ => Status::Applied,
        };
        let before = store.get(&path).cloned();
        let version = store.current_version();
        let now = at(time + offset);
        let next = store.next_commit_time(now);
        let result = store.commit(&[write], None, now);
        prop_assert_eq!(status(&result), expected);
        if let Ok(applied) = result {
            let stamp = applied.commit_time.as_nanos();
            prop_assert_eq!(stamp % 1000, 0);
            prop_assert!(stamp > time);
            prop_assert_eq!(store.next_commit_time(now).as_nanos(), stamp + 1000);
            let actual = observe(&store, &path);
            prop_assert_eq!(actual.is_some(), kind != "delete:P");
            prop_assert_eq!(applied.write_results[0].update_time, actual.map(|(t, _)| at(t)));
            if !present && kind == "delete:P" {
                prop_assert!(applied.changes.is_empty());
                prop_assert_eq!(store.current_version(), version);
            }
        } else {
            prop_assert_eq!(store.get(&path), before.as_ref());
            prop_assert_eq!(store.current_version(), version);
            prop_assert_eq!(store.next_commit_time(now), next);
        }
    }

    #[test]
    fn create_agrees_with_set_missing_and_updates_require_existence_only_when_requested(
        present in any::<bool>(),
        old in prop::option::of(any::<i64>()),
        new in any::<i64>(),
    ) {
        let path = path();
        let run = |text: &str| {
            let mut store = seeded(&path, Some(10_000), present.then_some((10_000, old)));
            let result = store.commit(&[parse_write(text, &path)], None, at(11_000));
            (status(&result), observe(&store, &path))
        };
        let create = run(&format!("create:missing:{new}"));
        prop_assert_eq!(create, run(&format!("set:missing:{new}")));
        prop_assert_eq!(create.0, if present { Status::AlreadyExists } else { Status::Applied });
        for (kind, operand) in [("update", format!(":{new}")), ("masked", format!(":{new}")), ("empty-mask", String::new())] {
            let implicit = run(&format!("{kind}:none{operand}"));
            let explicit = run(&format!("{kind}:exists{operand}"));
            prop_assert_eq!(implicit == explicit, present, "{}", kind);
            prop_assert_eq!(implicit.0, Status::Applied);
            prop_assert_eq!(explicit.0, if present { Status::Applied } else { Status::NotFound });
        }
    }

    #[test]
    fn a_valid_storing_write_can_repeat_at_its_reported_time(
        kind in prop::sample::select(vec!["set:none:7", "masked:none:7", "empty-mask:none",
            "transform:none:1", "masked-transform:none:7:1"]),
        old in prop::sample::select(vec![None, Some(7), Some(8), Some(i64::MAX)]),
        present in any::<bool>(),
    ) {
        let path = path();
        let initial = present.then_some((10_000, old));
        let mut store = seeded(&path, Some(10_000), initial);
        let mut write = parse_write(kind, &path);
        let first = store.commit(std::slice::from_ref(&write), None, at(11_000)).unwrap();
        let time = first.write_results[0].update_time.expect("storing write reports a time");
        prop_assert_eq!(Some(time.as_nanos()), observe(&store, &path).map(|(t, _)| t));
        let stamped = !first.changes.is_empty();
        prop_assert_eq!(initial.map(|(t, _)| t) != Some(time.as_nanos()), stamped);
        write.precondition = Some(Precondition::UpdateTime(time));
        let second = store.commit(&[write], None, at(12_000));
        prop_assert_eq!(status(&second), Status::Applied);
    }

    #[test]
    fn refusal_of_the_last_staged_write_restores_the_document_and_clock(
        original in any::<i64>(),
        values in prop::collection::vec(any::<i64>(), 1..=2),
        invalid_body in any::<bool>(),
    ) {
        let path = path();
        let mut store = seeded(&path, Some(10_000), Some((10_000, Some(original))));
        let mut writes: Vec<_> = values.iter()
            .map(|value| parse_write(&format!("set:none:{value}"), &path))
            .collect();
        let (last, expected) = if invalid_body {
            ("bad-transform:none:-", Status::InvalidArgument)
        } else {
            ("delete:missing", Status::AlreadyExists)
        };
        writes.push(parse_write(last, &path));
        let now = at(11_000);
        let before = store.get(&path).cloned();
        let version = store.current_version();
        let next = store.next_commit_time(now);
        prop_assert_eq!(status(&store.commit(&writes, None, now)), expected);
        prop_assert_eq!(store.get(&path), before.as_ref());
        prop_assert_eq!(store.current_version(), version);
        prop_assert_eq!(store.next_commit_time(now), next);
    }
}
