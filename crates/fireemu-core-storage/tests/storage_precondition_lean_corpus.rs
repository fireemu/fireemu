//! Replays the Lean storage precondition corpus through the public Storage API and checks the
//! proved properties with proptest. Running the Rust tests does not require Lean.

use std::collections::BTreeMap;

use fireemu_core_storage::name::{BucketName, ObjectName};
use fireemu_core_storage::store::{
    ImportedObject, MetadataPatch, NewMetadata, ObjectMetadata, Precondition, StorageError,
    StorageState, UploadPhase, MAX_PERSISTED_IDENTITY,
};
use fireemu_core_types::time::LogicalInstant;
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-storage-precondition.corpus");
const BODY: &[u8] = b"new";
type Identity = (u64, u64);
type OperationResult = Result<ObjectMetadata, StorageError>;

#[derive(Clone, Copy, Debug)]
enum Op {
    Read,
    Metadata,
    Upload,
    Delete,
    Finalize,
}

const OPS: [Op; 5] = [Op::Read, Op::Metadata, Op::Upload, Op::Delete, Op::Finalize];
const GUARD_KINDS: [&str; 4] = ["gm", "mm", "gn", "mn"];

fn identity(meta: &ObjectMetadata) -> Identity {
    (meta.generation, meta.metageneration)
}

fn preconditions<'a>(guards: impl IntoIterator<Item = (&'a str, u64)>) -> Precondition {
    let mut pre = Precondition::default();
    for (kind, value) in guards {
        let field = match kind {
            "gm" => &mut pre.if_generation_match,
            "mm" => &mut pre.if_metageneration_match,
            "gn" => &mut pre.if_generation_not_match,
            "mn" => &mut pre.if_metageneration_not_match,
            _ => panic!("unknown guard {kind}"),
        };
        assert!(field.replace(value).is_none(), "repeated guard {kind}");
    }
    pre
}

fn status<T>(result: &Result<T, StorageError>) -> &'static str {
    match result {
        Ok(_) => "ok",
        Err(StorageError::PreconditionFailed(_)) => "412",
        Err(StorageError::NotModified(_)) => "304",
        Err(StorageError::NotFound) => "404",
        Err(StorageError::IdentityExhausted) => "exhausted",
        Err(error) => panic!("unexpected store error: {error:?}"),
    }
}

struct Store {
    state: StorageState,
    bucket: BucketName,
    object: ObjectName,
}

impl Store {
    fn new(initial: Option<Identity>, production: bool) -> Self {
        let mut state = StorageState::new(1);
        state.set_production_order(production);
        let mut store = Self {
            state,
            bucket: BucketName::try_new("demo-storage.appspot.com").unwrap(),
            object: ObjectName::try_new("object").unwrap(),
        };
        if let Some(initial) = initial {
            store.install(initial).expect("install the initial object");
        }
        store
    }

    fn install(&mut self, (generation, metageneration): Identity) -> OperationResult {
        self.state.insert_imported(
            ImportedObject {
                bucket: self.bucket.clone(),
                name: self.object.clone(),
                generation,
                metageneration,
                content_type: "text/plain".to_owned(),
                content_disposition: None,
                content_encoding: None,
                content_language: None,
                cache_control: None,
                custom: BTreeMap::default(),
                custom_defined: false,
                time_created: LogicalInstant::UNIX_EPOCH,
                updated: LogicalInstant::UNIX_EPOCH,
                download_tokens: Vec::new(),
                md5: None,
                crc32c: None,
                size: None,
            },
            b"old".to_vec(),
        )
    }

    fn current(&self) -> Option<&ObjectMetadata> {
        self.state.get(&self.bucket, &self.object)
    }

    fn observe(&self) -> Option<(ObjectMetadata, Vec<u8>)> {
        self.current()
            .map(|meta| (meta.clone(), self.state.bytes(meta).to_vec()))
    }

    fn run(
        &mut self,
        op: Op,
        pre: Precondition,
        now: LogicalInstant,
    ) -> (OperationResult, &'static str) {
        let result = match op {
            // gcs_object looks up the target first. The core exposes lookup and guard evaluation.
            Op::Read => self
                .current()
                .ok_or(StorageError::NotFound)
                .and_then(|meta| pre.check(Some(meta)).map(|()| meta.clone())),
            Op::Metadata => self.state.update_metadata(
                &self.bucket,
                &self.object,
                &MetadataPatch {
                    content_type: Some(Some("application/octet-stream".to_owned())),
                    ..MetadataPatch::default()
                },
                pre,
                now,
            ),
            Op::Upload => self.state.put(
                &self.bucket,
                &self.object,
                BODY.to_vec(),
                NewMetadata::default(),
                pre,
                now,
            ),
            Op::Delete => self.state.delete(&self.bucket, &self.object, pre, now),
            Op::Finalize => {
                let len = u64::try_from(BODY.len()).unwrap();
                let id = self
                    .state
                    .begin_upload(
                        &self.bucket,
                        &self.object,
                        NewMetadata::default(),
                        pre,
                        Some(len),
                        now,
                    )
                    .expect("begin starts a session even when its guards would fail");
                assert_eq!(self.state.append_upload(&id, 0, BODY, now).unwrap(), len);
                assert!(matches!(
                    self.state.upload_phase(&id, now).unwrap(),
                    UploadPhase::Active(received) if received == len
                ));
                let result = self.state.finalize_upload(&id, now);
                let phase = match self.state.upload_phase(&id, now).unwrap() {
                    UploadPhase::Finalized(meta) => {
                        assert_eq!(result.as_ref().ok(), Some(meta.as_ref()));
                        "committed"
                    }
                    UploadPhase::Cancelled(0) => "aborted",
                    other => panic!("unexpected phase after finalization: {other:?}"),
                };
                assert_eq!(self.state.retained_upload_bytes(), 0);
                return (result, phase);
            }
        };
        (result, "-")
    }
}

fn parse_identity(token: &str) -> Option<Identity> {
    if token == "-" {
        return None;
    }
    let (generation, metageneration) = token.split_once(':').expect("generation:metageneration");
    Some((generation.parse().unwrap(), metageneration.parse().unwrap()))
}

fn replay_step(store: &mut Store, step: &str, line: usize) {
    let fields: Vec<_> = step.split_whitespace().collect();
    let [op, nanos, guards, "=>", expected, returned, live_identity, counter, phase] =
        fields.as_slice()
    else {
        panic!("line {line}: malformed step {step}");
    };
    let op = match *op {
        "read" => Op::Read,
        "metadata" => Op::Metadata,
        "upload" => Op::Upload,
        "delete" => Op::Delete,
        "finalize" => Op::Finalize,
        _ => panic!("line {line}: unknown operation {op}"),
    };
    let pre = if *guards == "-" {
        Precondition::default()
    } else {
        preconditions(guards.split(',').map(|guard| {
            let (kind, value) = guard.split_once(':').expect("guard:value");
            (kind, value.parse().expect("unsigned guard operand"))
        }))
    };
    let before = store.observe();
    let (result, actual_phase) =
        store.run(op, pre, LogicalInstant::from_nanos(nanos.parse().unwrap()));
    assert_eq!(status(&result), *expected, "line {line}: {step}");
    assert_eq!(
        result.as_ref().ok().map(identity),
        parse_identity(returned),
        "line {line}: return from {step}"
    );
    assert_eq!(
        store.current().map(identity),
        parse_identity(live_identity),
        "line {line}: live object after {step}"
    );
    let counter: u64 = counter.parse().expect("generation counter");
    match store
        .state
        .next_generation_preview(LogicalInstant::UNIX_EPOCH)
    {
        Ok(next) => {
            assert!(
                counter < MAX_PERSISTED_IDENTITY,
                "line {line}: counter ceiling"
            );
            assert_eq!(next, counter + 1, "line {line}: counter after {step}");
        }
        Err(StorageError::IdentityExhausted) => {
            assert_eq!(
                counter, MAX_PERSISTED_IDENTITY,
                "line {line}: counter after {step}"
            );
        }
        Err(other) => panic!("line {line}: unexpected preview error {other:?}"),
    }
    assert_eq!(actual_phase, *phase, "line {line}: phase after {step}");
    let events = store.state.drain_events();
    if result.is_err() {
        assert_eq!(
            store.observe(),
            before,
            "line {line}: refusal changed object"
        );
        assert!(events.is_empty(), "line {line}: refusal published events");
    }
}

#[test]
fn storage_preconditions_match_the_lean_golden_corpus() {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .and_then(|header| header.strip_prefix("# "))
        .and_then(|header| header.split_once(" cases. "))
        .expect("case count header")
        .0
        .parse()
        .expect("case count is an integer");
    let cases: Vec<_> = lines.collect();
    assert_eq!(cases.len(), count);
    assert!(count >= 200, "corpus too small: {count}");

    for (index, case) in cases.into_iter().enumerate() {
        let line = index + 2;
        let mut steps = case.split(" | ");
        let (mode, initial) = steps.next().unwrap().split_once(' ').expect("case start");
        let production = match mode {
            "counter" => false,
            "production" => true,
            _ => panic!("line {line}: unknown mode {mode}"),
        };
        let mut store = Store::new(parse_identity(initial), production);
        let first = steps.next().expect("at least one step");
        for step in std::iter::once(first).chain(steps) {
            replay_step(&mut store, step, line);
        }
    }
}

#[test]
fn zero_match_accepts_raw_zero_metadata_but_import_refuses_it() {
    let store = Store::new(Some((7, 3)), false);
    let mut raw = store.current().unwrap().clone();
    raw.generation = 0;
    let zero = preconditions([("gm", 0)]);
    assert!(zero.check(Some(&raw)).is_ok());
    let mut empty = Store::new(None, false);
    let result = empty.install(identity(&raw));
    assert!(matches!(
        result,
        Err(StorageError::InvalidImportedIdentity(_))
    ));
    assert!(empty.current().is_none());
}

proptest! {
    #[test]
    fn decisions_follow_guard_priority_independent_of_written_order_and_generation_counter(
        present in any::<bool>(), g in 1..1000u64, m in 1..1000u64, choices in any::<[u8; 4]>(),
    ) {
        let initial = present.then_some((g, m));
        let written: Vec<_> = GUARD_KINDS.into_iter().zip([g, m, g, m]).zip(choices)
            .filter_map(|((kind, same), choice)| match choice % 4 {
                0 => None,
                1 => Some((kind, same)),
                2 => Some((kind, same + 1)),
                _ => Some((kind, 0)),
            })
            .collect();
        let forwards = preconditions(written.iter().copied());
        let backwards = preconditions(written.iter().rev().copied());
        let failed = if present {
            forwards.if_generation_match.is_some_and(|n| n != g)
                || forwards.if_metageneration_match.is_some_and(|n| n != m)
        } else {
            written.iter().any(|&guard| guard != ("gm", 0))
        };
        let unmodified = present && (forwards.if_generation_not_match == Some(g)
            || forwards.if_metageneration_not_match == Some(m));
        for op in OPS {
            let expected = if !present && matches!(op, Op::Read) {
                "404"
            } else if failed {
                "412"
            } else if unmodified {
                "304"
            } else if !present && matches!(op, Op::Metadata | Op::Delete) {
                "404"
            } else {
                "ok"
            };

            let mut first = Store::new(initial, false);
            let mut second = Store::new(None, true);
            let later = LogicalInstant::from_nanos(2_000_000);
            second.run(Op::Upload, Precondition::default(), later).0.unwrap();
            second.run(Op::Delete, Precondition::default(), later).0.unwrap();
            second.state.drain_events();
            if let Some(initial) = initial {
                // The import installs the same live object while the allocator stays ahead.
                second.install(initial).unwrap();
            }
            for (store, pre, now) in [
                (&mut first, forwards, LogicalInstant::UNIX_EPOCH),
                (&mut second, backwards, later),
            ] {
                let before = store.observe();
                let preview = store.state.next_generation_preview(now);
                let (result, phase) = store.run(op, pre, now);
                prop_assert_eq!(status(&result), expected, "{:?} {:?}", op, written);
                if result.is_err() {
                    prop_assert_eq!(store.observe(), before);
                    prop_assert_eq!(store.state.next_generation_preview(now), preview);
                    prop_assert!(store.state.drain_events().is_empty());
                    if matches!(op, Op::Finalize) {
                        prop_assert_eq!(phase, "aborted");
                    }
                }
            }
        }
    }

    #[test]
    fn matched_and_excluded_values_cannot_both_pass_and_zero_requires_absence(
        g in 1..1000u64, m in 1..1000u64, n in 0..1000u64, present in any::<bool>(),
    ) {
        let store = Store::new(present.then_some((g, m)), false);
        let current = store.current();
        prop_assert_eq!(preconditions([("gm", 0)]).check(current).is_ok(), !present);
        for (matching, not_matching) in [("gm", "gn"), ("mm", "mn")] {
            let matched = preconditions([(matching, n)]).check(current);
            let excluded = preconditions([(not_matching, n)]).check(current);
            prop_assert!(!(matched.is_ok() && excluded.is_ok()));
            prop_assert!(preconditions([(matching, n), (not_matching, n)]).check(current).is_err());
        }
    }

    #[test]
    fn body_replacement_accepts_the_new_generation_and_refuses_the_old_one(
        g in 1..1000u64, m in 1..1000u64, production in any::<bool>(),
        nanos in -1_000..2_000_000i128, resumable in any::<bool>(),
    ) {
        let mut store = Store::new(Some((g, m)), production);
        let now = LogicalInstant::from_nanos(nanos);
        let generation_match = preconditions([("gm", g)]);
        let patch = store.run(Op::Metadata, generation_match, now).0.unwrap();
        prop_assert_eq!(identity(&patch), (g, m + 1));
        prop_assert!(generation_match.check(store.current()).is_ok());

        let op = if resumable { Op::Finalize } else { Op::Upload };
        let written = store.run(op, generation_match, now).0.unwrap();
        prop_assert!(written.generation > g);
        prop_assert_eq!(written.metageneration, 1);
        let current = store.current();
        prop_assert!(preconditions([("gm", written.generation)]).check(current).is_ok());
        prop_assert_eq!(status(&generation_match.check(current)), "412");
    }
}
