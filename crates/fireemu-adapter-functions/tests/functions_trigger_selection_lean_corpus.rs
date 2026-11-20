//! Replays dispatch and selection order through the public Rust manifest methods.
use std::collections::BTreeMap;

use fireemu_adapter_functions::manifest_json::parse_manifest;
use fireemu_core_functions::manifest::{
    AuthEvent, BlockingAuthEvent, BlockingAuthSelection, BlockingAuthSelectionError, DocumentEvent,
    FunctionManifest, FunctionSpec, ObjectEvent,
};
use serde_json::json;

const SHORT: &str = "locations/us-central1/channels/c";
const FULL: &str = "projects/demo/locations/us-central1/channels/c";

fn manifest() -> FunctionManifest {
    parse_manifest(&json!({"functions": [
        {"name":"zDoc","trigger":{"type":"firestore","eventType":"google.cloud.firestore.document.v1.written","document":"items/{id}"}},
        {"name":"zBucket","trigger":{"type":"storage","eventType":"google.cloud.storage.object.v1.finalized"}},
        {"name":"zMessage","trigger":{"type":"pubsub","topic":"jobs"}},
        {"name":"zUser","trigger":{"type":"auth","eventType":"google.firebase.auth.user.v1.created"}},
        {"name":"zCustom","generation":2,"trigger":{"type":"eventarc","channel":SHORT,"eventType":"done","filters":{"area":"eu"}}},
        {"name":"zBlock","trigger":{"type":"blockingAuth","eventType":"beforeCreate"}},
        {"name":"aDoc","trigger":{"type":"firestore","eventType":"google.cloud.firestore.document.v1.created","document":"items/{id}"}},
        {"name":"aBucket","trigger":{"type":"storage","eventType":"google.cloud.storage.object.v1.finalized","bucket":"primary"}},
        {"name":"xDoc","trigger":{"type":"firestore","eventType":"google.cloud.firestore.document.v1.deleted","database":"archive","document":"items/{id}"}},
        {"name":"aMessage","trigger":{"type":"pubsub","topic":"jobs"}},
        {"name":"aUser","trigger":{"type":"auth","eventType":"google.firebase.auth.user.v1.created"}},
        {"name":"aCustom","generation":2,"trigger":{"type":"eventarc","channel":FULL,"eventType":"done"}},
        {"name":"aBlock","region":"us-east1","trigger":{"type":"blockingAuth","eventType":"beforeCreate"}},
        {"name":"xBucket","trigger":{"type":"storage","eventType":"google.cloud.storage.object.v1.archived","bucket":"cold"}},
        {"name":"xCustom","generation":2,"trigger":{"type":"eventarc","channel":SHORT,"eventType":"other"}},
        {"name":"xUser","trigger":{"type":"auth","eventType":"google.firebase.auth.user.v1.deleted"}},
        {"name":"xBlock","trigger":{"type":"blockingAuth","eventType":"beforeSignIn"}}
    ]})).unwrap()
}

fn names(functions: &[&FunctionSpec]) -> String {
    functions
        .iter()
        .map(|f| f.name.as_str())
        .collect::<Vec<_>>()
        .join(",")
}

fn firestore(manifest: &FunctionManifest, index: usize) -> String {
    use DocumentEvent::{Created, Deleted, Updated};
    let (event, db, path) = [
        (Created, "(default)", "items/x"),
        (Updated, "(default)", "items/y"),
        (Deleted, "archive", "items/a"),
        (Deleted, "(default)", "other/a"),
        (Created, "archive", "items/x"),
        (Created, "(default)", "items/x/nested/y"),
    ][index];
    manifest
        .firestore_matches(db, path, event)
        .into_iter()
        .map(|matched| {
            assert_eq!(matched.params.len(), 1);
            format!("{}:{}", matched.function.name, matched.params["id"])
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn storage(manifest: &FunctionManifest, index: usize) -> String {
    use ObjectEvent::{Archived, Deleted, Finalized};
    let (event, bucket, default) = [
        (Finalized, "primary", "primary"),
        (Finalized, "cold", "cold"),
        (Archived, "cold", "primary"),
        (Archived, "primary", "cold"),
        (Finalized, "primary", "cold"),
        (Deleted, "primary", "primary"),
    ][index];
    names(&manifest.storage_matches(bucket, default, event))
}

fn eventarc(manifest: &FunctionManifest, index: usize) -> String {
    let (channel, kind, data): (&str, &str, &[(&str, &str)]) = [
        (FULL, "done", &[("area", "eu")][..]),
        (SHORT, "done", &[("area", "us")][..]),
        (SHORT, "done", &[][..]),
        (
            "locations/us-east1/channels/c",
            "done",
            &[("area", "eu")][..],
        ),
        (FULL, "other", &[][..]),
        (FULL, "done", &[("area", "eu"), ("extra", "1")][..]),
    ][index];
    let attrs: BTreeMap<_, _> = data
        .iter()
        .map(|&(k, v)| (k.to_owned(), v.to_owned()))
        .collect();
    names(&manifest.eventarc_matches(channel, kind, &attrs))
}

fn blocking(manifest: &mut FunctionManifest, index: usize) -> String {
    let named = |target: &str, location: Option<&str>| BlockingAuthSelection::Explicit {
        function: target.to_owned(),
        region: location.map(str::to_owned),
    };
    let selection = match index {
        0 => BlockingAuthSelection::Discovery,
        1 => BlockingAuthSelection::Disabled,
        2 => named("aBlock", Some("us-east1")),
        3 => named("absent", None),
        4 => named("xBlock", Some("us-east1")),
        5 => named("zBlock", Some("us-east1")),
        6 => {
            let mut duplicate = manifest.get("xBlock").unwrap().clone();
            "zBlock".clone_into(&mut duplicate.name);
            manifest.functions.insert(0, duplicate);
            named("zBlock", Some("us-east1"))
        }
        _ => panic!("unknown blocking case {index}"),
    };
    match manifest.blocking_auth_target(BlockingAuthEvent::BeforeCreate, &selection) {
        Ok(target) => target.map_or("", |target| target.name.as_str()),
        Err(BlockingAuthSelectionError::FunctionNotFound { .. }) => "missing",
        Err(BlockingAuthSelectionError::AmbiguousFunction { .. }) => "ambiguous",
        Err(BlockingAuthSelectionError::WrongEvent { .. }) => "wrong-event",
        Err(BlockingAuthSelectionError::RegionMismatch { .. }) => "region-mismatch",
    }
    .to_owned()
}

#[test]
fn public_manifest_dispatch_matches_lean() {
    let mut lines = include_str!("fixtures/lean-functions-trigger-selection.corpus").lines();
    assert_eq!(
        lines.next(),
        Some("# family|case|manifest order|selected functions or refusal")
    );
    let mut count = 0;
    for line in lines {
        let fields: Vec<_> = line.split('|').collect();
        let [family, index, order, expected] = fields.as_slice() else {
            panic!("invalid dispatch fixture row {line}")
        };
        let index: usize = index.parse().unwrap();
        let mut manifest = manifest();
        match *order {
            "forward" => {}
            "reverse" => manifest.functions.reverse(),
            _ => panic!("unknown order {order}"),
        }
        let result = match *family {
            "firestore" => firestore(&manifest, index),
            "storage" => storage(&manifest, index),
            "pubsub" => names(&manifest.pubsub_matches(
                [
                    "jobs",
                    "other",
                    "Jobs",
                    "projects/demo/topics/jobs",
                    "",
                    "job",
                ][index],
            )),
            "auth" => {
                use AuthEvent::{Created, Deleted};
                names(&manifest.auth_matches([Created, Deleted][index]))
            }
            "eventarc" => eventarc(&manifest, index),
            "blocking" => blocking(&mut manifest, index),
            _ => panic!("unknown dispatch family {family}"),
        };
        assert_eq!(result, *expected, "{line}");
        count += 1;
    }
    assert_eq!(count, 66);
}
