//! Replays media Range and resumable Content-Range traces through the public Storage handler.

use std::sync::{Arc, Mutex};

use fireemu_adapter_http::storage::{
    StorageRequest, StorageResponse, StorageRulesRegistry, StorageState, handle,
};
use fireemu_core_auth::jwt::TokenAcceptance;
use fireemu_core_auth::mfa::TotpPolicy;
use fireemu_core_auth::store::{AuthRegistry, AuthStore};
use fireemu_core_rules::runtime::{LoadedRules, RulesetSlot};
use fireemu_core_session::clock::VirtualClock;
use fireemu_core_storage::store::StorageState as ObjectStore;
use fireemu_core_types::determinism::SplitMix64;
use fireemu_core_types::time::LogicalInstant;
use serde_json::Value;

const PROJECT: &str = "demo-app";
const HOST: &str = "localhost:9199";
const UPLOAD: &str = "/upload/storage/v1/b/demo-app.appspot.com/o";
const MEDIA: &str = "/storage/v1/b/demo-app.appspot.com/o/object?alt=media";

fn state(profile: &str) -> StorageState {
    let token_acceptance = match profile {
        "strict" => TokenAcceptance::Verified,
        "emulator" => TokenAcceptance::EmulatorMock,
        _ => panic!("unknown profile: {profile}"),
    };
    StorageState {
        store: Mutex::new(ObjectStore::new(9)),
        clock: Arc::new(Mutex::new(VirtualClock::new(
            LogicalInstant::from_unix_seconds(1_800_000_000),
        ))),
        auth: Arc::new(AuthRegistry::new(
            PROJECT,
            Arc::new(Mutex::new(AuthStore::new(
                PROJECT,
                SplitMix64::new(3),
                TotpPolicy::default(),
            ))),
        )),
        tenancy: None,
        rules: Arc::new(StorageRulesRegistry::global(Arc::new(RulesetSlot::new(
            LoadedRules::default(),
        )))),
        project: PROJECT.to_owned(),
        events: None,
        barrier: None,
        firestore: None,
        faults: None,
        clock_observer: None,
        app_check_policy: None,
        admin_capability: None,
        server_requests: fireemu_adapter_http::storage::StorageServerRequests::default(),
        caller_times: fireemu_adapter_http::CallerTimes::default(),
        token_acceptance,
        allow_unsigned_id_tokens: false,
        control_token: None,
    }
}

fn send(
    state: &StorageState,
    method: &str,
    route: &str,
    field: &str,
    value: &str,
    body: &str,
) -> StorageResponse {
    let (path, query) = route.split_once('?').unwrap_or((route, ""));
    let mut request = StorageRequest {
        method: method.to_owned(),
        path: path.to_owned(),
        query: query.to_owned(),
        host: Some(HOST.to_owned()),
        body: body.as_bytes().to_vec(),
        ..StorageRequest::default()
    };
    request
        .headers
        .insert("authorization".to_owned(), "Bearer owner".to_owned());
    if value != "-" {
        request.headers.insert(field.to_owned(), value.to_owned());
    }
    handle(state, request)
}

fn header<'a>(response: &'a StorageResponse, key: &str) -> Option<&'a str> {
    response
        .headers
        .iter()
        .find_map(|(k, v)| k.eq_ignore_ascii_case(key).then_some(v.as_str()))
}

fn check_download(state: &StorageState, id: &str, input: &str, expected: &str) {
    let (content, range) = input.split_once('|').unwrap();
    let created = send(
        state,
        "POST",
        &format!("{UPLOAD}?uploadType=media&name=object"),
        "content-type",
        "application/octet-stream",
        content,
    );
    assert_eq!(created.status, 200, "{id}: {:?}", created.body);

    let response = send(state, "GET", MEDIA, "range", range, "");
    let body = std::str::from_utf8(&response.body).unwrap();
    let content_range = header(&response, "content-range").unwrap_or("-");
    assert_eq!(
        format!("{}|{content_range}|{body}", response.status),
        expected,
        "{id}"
    );
}

fn upload_observation(state: &StorageState, response: &StorageResponse) -> String {
    let range = header(response, "range").unwrap_or("-");
    match response.status {
        200 => {
            let metadata: Value = serde_json::from_slice(&response.body).unwrap();
            let restored = send(state, "GET", MEDIA, "range", "-", "");
            assert_eq!(restored.status, 200);
            let body = std::str::from_utf8(&restored.body).unwrap();
            assert_eq!(
                metadata["size"].as_str().unwrap().parse::<usize>().unwrap(),
                body.len()
            );
            format!("200|{range}|{body}")
        }
        308 => {
            assert!(response.body.is_empty());
            assert_eq!(send(state, "GET", MEDIA, "range", "-", "").status, 404);
            format!("308|{range}|-")
        }
        400 => {
            let result = serde_json::from_slice::<Value>(&response.body);
            let message = result
                .as_ref()
                .ok()
                .and_then(|body| body["error"]["message"].as_str())
                .unwrap_or("-");
            format!("400|{range}|{message}")
        }
        499 => format!("499|{range}|-"),
        status => panic!("unexpected upload response {status}: {:?}", response.body),
    }
}

fn check_upload(state: &StorageState, id: &str, input: &str, expected: &str) {
    let started = send(
        state,
        "POST",
        &format!("{UPLOAD}?uploadType=resumable&name=object"),
        "content-type",
        "application/json",
        "{}",
    );
    assert_eq!(started.status, 200, "{id}: {:?}", started.body);
    let location = header(&started, "location").unwrap();
    let session = location.strip_prefix(&format!("http://{HOST}")).unwrap();
    let inputs: Vec<_> = input.split(';').collect();
    let outputs: Vec<_> = expected.split(';').collect();
    assert_eq!(inputs.len(), outputs.len());
    for (index, (request, want)) in inputs.into_iter().zip(outputs).enumerate() {
        let (range, chunk) = request.split_once('|').unwrap();
        let response = send(state, "PUT", session, "content-range", range, chunk);
        assert_eq!(
            upload_observation(state, &response),
            want,
            "{id}, step {index}"
        );
    }
}

#[test]
fn storage_ranges_follow_the_lean_reference_without_listening() {
    let mut fixture = include_str!("fixtures/lean-storage-http-range.corpus").lines();
    let count = fixture
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert!(count >= 90);
    assert_eq!(fixture.clone().count(), count);
    for row in fixture {
        let [id, profile, kind, input, expected]: [&str; 5] = row
            .split('\t')
            .collect::<Vec<_>>()
            .try_into()
            .expect("fixture shape");
        let state = state(profile);
        match kind {
            "get" => check_download(&state, id, input, expected),
            "upload" => check_upload(&state, id, input, expected),
            _ => panic!("unknown operation: {kind}"),
        }
    }
}
