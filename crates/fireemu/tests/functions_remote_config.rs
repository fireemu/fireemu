//! Real SDK handlers reached by injected events and committed Remote Config versions.
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use fireemu_adapter_functions::http::FunctionsHttpProfile;
use fireemu_adapter_functions::manifest_json::parse_manifest;
use fireemu_adapter_functions::runner::{Runner, SpawnSpec};
use fireemu_adapter_functions::runtime::{
    CodebaseSpec, EventBatchReservation, FunctionsConfig, FunctionsRuntime,
    SourceEventAdmissionError,
};
use fireemu_adapter_http::control::{
    handle_with, ControlState, FunctionsHook, PublishEventError, RemoteConfigPublication,
    RunScheduleError,
};
use fireemu_adapter_http::identity_toolkit::RequestHeaders;
use fireemu_core_rules::runtime::RulesetSlot;
use fireemu_core_session::clock::VirtualClock;
use fireemu_core_session::tenancy::Tenancy;
use fireemu_core_types::edition::FirestoreEdition;
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};
use serde_json::{json, Value};

struct Hook(Arc<FunctionsRuntime>);

struct Publication(EventBatchReservation);

impl RemoteConfigPublication for Publication {
    fn publish(self: Box<Self>) {
        self.0.publish();
    }
}

impl FunctionsHook for Hook {
    fn on_clock_changed(&self) {
        self.0.on_clock_changed();
    }
    fn run_schedule(&self, _: &str) -> Result<(), RunScheduleError> {
        unreachable!()
    }
    fn is_idle(&self) -> bool {
        self.0.is_idle()
    }
    fn idle_notify(&self) -> Arc<tokio::sync::Notify> {
        self.0.idle_notify()
    }
    fn status(&self) -> Value {
        self.0.status()
    }
    fn publish(
        &self,
        _: &str,
        _: &[Value],
    ) -> Result<Vec<String>, fireemu_adapter_http::control::PublishMessagesError> {
        unreachable!()
    }
    fn project(&self) -> String {
        "demo-app".to_owned()
    }
    fn publish_remote_config(&self, body: &Value) -> Result<usize, PublishEventError> {
        self.0
            .publish_remote_config(body)
            .map_err(|error| match error {
                SourceEventAdmissionError::InvalidEvent
                | SourceEventAdmissionError::PayloadTooLarge => PublishEventError::Invalid,
                SourceEventAdmissionError::Capacity => PublishEventError::Capacity,
                SourceEventAdmissionError::Unavailable => PublishEventError::Unavailable,
            })
    }
    fn reserve_remote_config_version(
        &self,
        version: &Value,
    ) -> Result<Box<dyn RemoteConfigPublication>, PublishEventError> {
        let reservation =
            self.0
                .reserve_remote_config_version(version)
                .map_err(|error| match error {
                    SourceEventAdmissionError::InvalidEvent
                    | SourceEventAdmissionError::PayloadTooLarge => PublishEventError::Invalid,
                    SourceEventAdmissionError::Capacity => PublishEventError::Capacity,
                    SourceEventAdmissionError::Unavailable => PublishEventError::Unavailable,
                })?;
        Ok(Box::new(Publication(reservation)))
    }
}

fn control(runtime: Arc<FunctionsRuntime>, clock: Arc<Mutex<VirtualClock>>) -> ControlState {
    ControlState {
        clock,
        require_demo_prefix: true,
        edition: FirestoreEdition::Standard,
        capabilities: json!({"schemaVersion": 1}).into(),
        rules: Arc::new(RulesetSlot::default()),
        storage_rules: Arc::new(fireemu_adapter_http::storage::StorageRulesRegistry::default()),
        reset_hooks: vec![],
        functions: Some(Arc::new(Hook(runtime))),
        control_token: "fixture-capability".into(),
        app_check: None,
        firestore_listen_expiry: None,
        firestore_missing_indexes: None,
        require_control_token: false,
        calendar_zones: None,
        barrier: None,
        snapshot_hooks: vec![],
        snapshots: Mutex::new(std::collections::BTreeMap::new()),
        faults: None,
        text_indexes: Arc::new(Mutex::new(
            fireemu_core_firestore::text_index::TextIndexCatalog::default(),
        )),
        default_project: "demo-app".into(),
        tenancy: Arc::new(RwLock::new(Tenancy::new("demo-app"))),
        sessions: Mutex::new(
            [
                ("default".into(), "demo-app".into()),
                ("other".into(), "demo-other".into()),
                ("alias".into(), "demo-app".into()),
            ]
            .into(),
        ),
        project_hooks: None,
        resource_hooks: vec![],
    }
}

fn body(metadata: &str, retry: bool) -> Value {
    let mut body = json!({
        "data": {"versionNumber": 7, "updateTime": "2026-01-02T03:04:05Z"},
        "v1Context": {"eventId": "caller-v1", "timestamp": "2026-01-02T03:04:06Z", "eventType": "google.firebase.remoteconfig.update", "resource": {"service": "firebaseremoteconfig.googleapis.com", "name": "projects/demo-app"}},
        "v2Context": {"specversion": "1.0", "id": "caller-v2", "time": "2026-01-02T03:04:07Z", "type": "google.firebase.remoteconfig.remoteConfig.v1.updated", "source": "//firebaseremoteconfig.googleapis.com/projects/demo-app"}
    });
    if metadata != "absent" {
        body["data"]["updateUser"] = json!({"email": "fixture-actor", "name": "Fixture", "imageUrl": "https://example.invalid/inert"});
        body["data"]["description"] = json!("fixture metadata");
        body["data"]["updateOrigin"] = json!("REST_API");
        body["data"]["updateType"] = json!(if metadata == "rollback" {
            "ROLLBACK"
        } else {
            "INCREMENTAL_UPDATE"
        });
    }
    if metadata == "rollback" {
        body["data"]["rollbackSource"] = json!(3);
    }
    if retry {
        body["data"]["description"] = json!("fail once");
    }
    body
}

fn observed(runtime: &FunctionsRuntime) -> Vec<Value> {
    runtime
        .runner()
        .logs_since(None)
        .lines
        .iter()
        .filter_map(|line| {
            line.message()
                .strip_prefix("REMOTE_CONFIG_EVENT ")
                .map(|text| serde_json::from_str(text).unwrap())
        })
        .collect()
}

async fn wait_rows(runtime: &FunctionsRuntime, count: usize) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if observed(runtime).len() >= count {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("SDK handler records the event");
}

/// PICT rows may be supplied by the private verification run; default rows keep CI useful.
#[tokio::test]
#[allow(clippy::too_many_lines)]
#[ignore = "requires own tools/sdk-smoke npm ci dependencies"]
async fn remote_config_control_delivers_real_sdk_events_in_both_profiles() {
    let rows = std::env::var("REMOTE_CONFIG_PICT").map_or_else(|_| {
        "Generation\tProfile\tMetadata\tCapability\tDelivery\tBackground\nboth\tstrict\tabsent\tvalid\tsuccess\tenabled\nboth\temulator\tfull\tvalid\tretry\tenabled\nv1\tstrict\trollback\tmissing\tsuccess\tenabled\nv2\temulator\tabsent\twrong\tsuccess\tenabled\nboth\tstrict\trollback\tvalid\tsuccess\tdisabled\nboth\tstrict\trollback\tvalid\tretry\tenabled\nboth\temulator\tabsent\tvalid\tsuccess\tenabled\nv1\temulator\tfull\tvalid\tsuccess\tenabled\nv1\tstrict\tabsent\tvalid\tsuccess\tenabled\n".to_owned()
    }, |path| std::fs::read_to_string(path).unwrap());
    for (index, row) in rows.lines().skip(1).enumerate() {
        let columns: Vec<_> = row.split('\t').collect();
        assert_eq!(columns.len(), 6);
        let [generation, profile, metadata, capability, delivery, background] =
            <[&str; 6]>::try_from(columns).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let runner = Arc::new(
            Runner::spawn_spec(&SpawnSpec {
                command: vec![
                    "node".into(),
                    root.join("tools/runner-node/index.mjs")
                        .display()
                        .to_string(),
                    "--source".into(),
                    root.join("tools/sdk-smoke/functions-project/fixtures/remote-config")
                        .display()
                        .to_string(),
                ],
                cwd: None,
                env: vec![
                    ("GCLOUD_PROJECT".into(), "demo-app".into()),
                    ("FIREEMU_HTTP_PROFILE".into(), profile.into()),
                ],
                hello_timeout: Duration::from_secs(15),
            })
            .await
            .unwrap(),
        );
        let mut manifest = parse_manifest(runner.hello().manifest.as_ref().unwrap()).unwrap();
        assert_eq!(manifest.functions.len(), 2, "SDK discovery row {index}");
        manifest.functions.retain(|spec| {
            generation == "both"
                || spec.name == format!("configV{}", if generation == "v1" { 1 } else { 2 })
        });
        for spec in &mut manifest.functions {
            if spec.generation == fireemu_core_functions::manifest::FunctionGeneration::Second {
                spec.concurrency = Some(1);
            }
        }
        let targets = manifest.functions.len();
        let clock = Arc::new(Mutex::new(VirtualClock::new(
            LogicalInstant::from_unix_seconds(1_788_004_860),
        )));
        let runtime = FunctionsRuntime::with_codebases(
            vec![CodebaseSpec {
                function: None,
                name: "default".into(),
                manifest,
                runner,
                spawn: None,
                cleanup_dir: None,
            }],
            FunctionsConfig::for_tests(1, "test-secret".into()),
            clock.clone(),
            if profile == "strict" {
                FunctionsHttpProfile::Strict
            } else {
                FunctionsHttpProfile::Emulator
            },
        )
        .unwrap();
        let state = control(runtime.clone(), clock.clone());
        runtime.set_background_triggers(background == "enabled");
        let headers = RequestHeaders {
            authorization: match capability {
                "valid" => Some("Bearer fixture-capability".into()),
                "wrong" => Some("Bearer wrong".into()),
                _ => None,
            },
            ..RequestHeaders::default()
        };
        let mut input = body(metadata, delivery == "retry");
        if generation == "v1" {
            input.as_object_mut().unwrap().remove("v2Context");
        }
        if generation == "v2" {
            input.as_object_mut().unwrap().remove("v1Context");
        }
        let response = handle_with(
            &state,
            "POST",
            "/v1/sessions/default/functions/remoteConfig:publish",
            &headers,
            &input,
        );
        let accepted = capability == "valid";
        assert_eq!(
            response.status,
            if accepted { 200 } else { 403 },
            "row {index}: {}",
            response.body
        );
        let expected = if accepted && background == "enabled" {
            targets
        } else {
            0
        };
        assert_eq!(
            runtime.source_event_accounting().unwrap().published_records,
            expected,
            "row {index}"
        );
        let dispatch = tokio::spawn(runtime.clone().dispatch_loop());
        if expected > 0 {
            wait_rows(&runtime, targets).await;
            if delivery == "retry" {
                // A log precedes failure acknowledgement; wait until all first attempts settle.
                tokio::time::timeout(Duration::from_secs(10), async {
                    while runtime.history().len() < targets {
                        tokio::time::sleep(Duration::from_millis(5)).await;
                    }
                })
                .await
                .unwrap();
                clock
                    .lock()
                    .unwrap()
                    .advance(LogicalDuration::from_seconds(20))
                    .unwrap();
                runtime.on_clock_changed();
            }
            runtime.await_idle(Duration::from_secs(10)).await.unwrap();
            let records = observed(&runtime);
            assert_eq!(
                records.len(),
                targets * if delivery == "retry" { 2 } else { 1 },
                "row {index}"
            );
            for record in &records {
                assert_eq!(record["data"], input["data"], "row {index}");
                let context = &record["context"];
                if record["generation"] == 1 {
                    for (key, value) in input["v1Context"].as_object().unwrap() {
                        assert_eq!(&context[key], value);
                    }
                } else {
                    // SDK 7.3.2 adds enumerable v1 compatibility accessors. These are
                    // SDK behavior, not fields manufactured by the emulator.
                    assert_eq!(context["version"], input["data"]);
                    assert_eq!(
                        context["context"],
                        json!({
                            "eventId": input["v2Context"]["id"],
                            "timestamp": input["v2Context"]["time"],
                            "eventType": "google.firebase.remoteconfig.update",
                            "resource": {"service": "firebaseremoteconfig.googleapis.com", "name": ""},
                            "params": {},
                        })
                    );
                    let mut envelope = context.clone();
                    envelope.as_object_mut().unwrap().remove("context");
                    envelope.as_object_mut().unwrap().remove("version");
                    assert_eq!(
                        envelope, input["v2Context"],
                        "no emulator-invented v2 fields"
                    );
                }
            }
            // Accepted publications use the ordinary per-function serial queue.
            for version in [8, 9] {
                let mut next = body("absent", false);
                next["data"]["versionNumber"] = json!(version);
                assert_eq!(runtime.publish_remote_config(&next), Ok(targets));
            }
            runtime.await_idle(Duration::from_secs(10)).await.unwrap();
            for gen in [1, 2] {
                let versions: Vec<_> = observed(&runtime)
                    .iter()
                    .filter(|row| {
                        row["generation"] == gen
                            && row["data"]["versionNumber"].as_u64().unwrap() >= 8
                    })
                    .map(|row| row["data"]["versionNumber"].as_u64().unwrap())
                    .collect();
                if generation == "both" || generation == format!("v{gen}") {
                    assert_eq!(versions, [8, 9]);
                }
            }
        } else {
            runtime.await_idle(Duration::from_secs(2)).await.unwrap();
            assert_eq!(observed(&runtime), [] as [serde_json::Value; 0]);
        }
        runtime.shutdown().await;
        dispatch.await.unwrap();
    }
}

#[tokio::test]
#[allow(clippy::too_many_lines)]
#[ignore = "requires own tools/sdk-smoke npm ci dependencies"]
async fn remote_config_publish_through_admin_reaches_real_sdk_handlers() {
    use fireemu_adapter_http::identity_toolkit::AuthState;
    use fireemu_core_auth::{mfa::TotpPolicy, store::AuthStore};
    use fireemu_core_types::determinism::SplitMix64;
    use http_body_util::{BodyExt, Full};
    use hyper::{body::Bytes, Request};
    use hyper_util::rt::TokioIo;

    const PATH: &str = "/v1/projects/demo-app/remoteConfig";
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let runner = Arc::new(
        Runner::spawn_spec(&SpawnSpec {
            command: vec![
                "node".into(),
                root.join("tools/runner-node/index.mjs")
                    .display()
                    .to_string(),
                "--source".into(),
                root.join("tools/sdk-smoke/functions-project/fixtures/remote-config")
                    .display()
                    .to_string(),
            ],
            cwd: None,
            env: vec![
                ("GCLOUD_PROJECT".into(), "demo-app".into()),
                ("FIREEMU_HTTP_PROFILE".into(), "strict".into()),
                (
                    "REMOTE_CONFIG_READ_URL".into(),
                    format!("http://{addr}{PATH}"),
                ),
                (
                    "REMOTE_CONFIG_READ_TOKEN".into(),
                    "fixture-capability".into(),
                ),
            ],
            hello_timeout: Duration::from_secs(15),
        })
        .await
        .unwrap(),
    );
    let manifest = parse_manifest(runner.hello().manifest.as_ref().unwrap()).unwrap();
    assert_eq!(manifest.functions.len(), 2);
    let clock = Arc::new(Mutex::new(VirtualClock::new(
        LogicalInstant::from_unix_seconds(1_788_004_860),
    )));
    let runtime = FunctionsRuntime::with_codebases(
        vec![CodebaseSpec {
            function: None,
            name: "default".into(),
            manifest,
            runner,
            spawn: None,
            cleanup_dir: None,
        }],
        FunctionsConfig::for_tests(1, "test-secret".into()),
        clock.clone(),
        FunctionsHttpProfile::Strict,
    )
    .unwrap();
    runtime.set_background_triggers(true);
    let dispatch = tokio::spawn(runtime.clone().dispatch_loop());
    let auth = AuthState {
        store: Arc::new(Mutex::new(AuthStore::new(
            "demo-app",
            SplitMix64::new(5),
            TotpPolicy::default(),
        ))),
        clock: clock.clone(),
        wall_clock: None,
        totp_extension_enabled: false,
        reveal_totp_codes: true,
        barrier: None,
        events: None,
        notices: None,
        blocking: None,
        operation_gate: Arc::new(Mutex::new(())),
        control_token: None,
        registry: None,
        allow_routed_projects: false,
        stateless_refresh_tokens: true,
        idp_continuations: fireemu_adapter_http::identity_toolkit::IdpContinuationPolicy::Disabled,
        query_limits: fireemu_adapter_http::identity_toolkit::AuthQueryLimits::EmulatorUnbounded,
        client_api_key: fireemu_adapter_http::identity_toolkit::ClientApiKeyPolicy::Optional,
        fake_custom_token_expiry:
            fireemu_adapter_http::identity_toolkit::FakeCustomTokenExpiry::Ignore,
        custom_token_trust: None,
        allow_unsigned_custom_tokens: true,
        caller_times: fireemu_adapter_http::CallerTimes::default(),
        idp_assertions: fireemu_adapter_http::identity_toolkit::IdpAssertionPolicy::Fixture,
        app_check: None,
        app_check_policy: None,
        tenancy: None,
    };
    let server = tokio::spawn(fireemu_adapter_http::server::serve_with_control(
        listener,
        Arc::new(auth),
        Arc::new(control(runtime.clone(), clock)),
    ));
    let stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    let (mut client, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .unwrap();
    let connection = tokio::spawn(connection);
    let mut etag = hyper::header::HeaderValue::from_static("*");
    for (method, path, body) in [
        ("PUT", PATH.to_owned(), r#"{"version":{"description":"d"}}"#),
        ("PUT", PATH.to_owned(), "{}"),
        (
            "POST",
            format!("{PATH}:rollback"),
            r#"{"versionNumber":"1"}"#,
        ),
    ] {
        let mut request = Request::builder()
            .method(method)
            .uri(path)
            .header("host", addr.to_string())
            .header("authorization", "Bearer fixture-capability")
            .header("content-type", "application/json")
            .header("accept-encoding", "gzip");
        if method == "PUT" {
            request = request.header("if-match", &etag);
        }
        let request = request
            .body(Full::new(Bytes::from_static(body.as_bytes())))
            .unwrap();
        let response = tokio::time::timeout(Duration::from_secs(5), client.send_request(request))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(response.status(), 200);
        etag = response.headers()["etag"].clone();
        response.into_body().collect().await.unwrap();
    }
    drop(client);
    tokio::time::timeout(Duration::from_secs(5), connection)
        .await
        .unwrap()
        .unwrap()
        .unwrap();

    let time = "2026-08-29T12:01:00Z";
    let forced = json!({
        "versionNumber": "1", "updateTime": time, "updateOrigin": "REST_API",
        "updateType": "FORCED_UPDATE", "description": "d",
    });
    let conditional = json!({
        "versionNumber": "2", "updateTime": time, "updateOrigin": "REST_API",
        "updateType": "INCREMENTAL_UPDATE",
    });
    let rollback = json!({
        "versionNumber": "3", "updateTime": time, "updateOrigin": "REST_API",
        "updateType": "ROLLBACK", "description": "Rollback to version 1", "rollbackSource": "1",
    });
    wait_rows(&runtime, 6).await;
    runtime.await_idle(Duration::from_secs(10)).await.unwrap();
    let rows = observed(&runtime);
    runtime.shutdown().await;
    dispatch.await.unwrap();
    server.abort();
    let _ = server.await;

    assert_eq!(rows.len(), 6);
    for (version, v1_id, v2_id, source) in [
        (forced, "1179521134", "641564555", "0"),
        (conditional, "-468215107", "-2073758376", "0"),
        (rollback, "48170188", "1655466793", "1"),
    ] {
        let row = |generation| {
            let row = rows
                .iter()
                .find(|row| {
                    row["generation"] == generation
                        && row["data"]["versionNumber"] == version["versionNumber"]
                })
                .unwrap();
            let read = row["readVersion"].as_str().unwrap().parse::<u64>().unwrap();
            let delivered = version["versionNumber"]
                .as_str()
                .unwrap()
                .parse::<u64>()
                .unwrap();
            assert!(read >= delivered, "{row}");
            row
        };
        let v1 = row(1);
        assert_eq!(v1["attempt"], 1);
        assert_eq!(v1["data"], version);
        let context = json!({
            "eventId": v1_id,
            "eventType": "google.firebase.remoteconfig.update",
            "resource": {"service": "firebaseremoteconfig.googleapis.com", "name": "projects/demo-app"},
            "timestamp": time,
        });
        for (key, value) in context.as_object().unwrap() {
            assert_eq!(&v1["context"][key], value, "{key}");
        }

        let v2 = row(2);
        assert_eq!(v2["attempt"], 1);
        assert_eq!(
            v2["data"],
            json!({
                "@type": "type.googleapis.com/google.events.firebase.remoteconfig.v1.RemoteConfigEventData",
                "versionNumber": version["versionNumber"],
                "updateTime": time,
                "updateOrigin": "REST_API",
                "updateType": version["updateType"],
                "description": version["description"].as_str().unwrap_or_default(),
                "rollbackSource": source,
            })
        );
        let mut context = v2["context"].as_object().unwrap().clone();
        // The SDK exposes these v1 compatibility accessors on its v2 event.
        context.remove("context");
        context.remove("version");
        assert_eq!(
            Value::Object(context),
            json!({
                "id": v2_id,
                "project": "demo-app",
                "source": "//firebaseremoteconfig.googleapis.com/projects/demo-app",
                "specversion": "1.0",
                "time": time,
                "type": "google.firebase.remoteconfig.remoteConfig.v1.updated",
            })
        );
    }
}
