use super::{CodebaseSpec, FunctionsConfig, FunctionsRuntime};
use crate::application_clock::ApplicationClockPolicy;
use crate::manifest_json::parse_manifest;
use crate::runner::{Runner, SpawnSpec};
use fireemu_core_session::clock::VirtualClock;
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};
use serde_json::json;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The fake runner's one virtual timer comes due at clock revision `due_at`.
fn spec(log: &Path, clock: Option<serde_json::Value>, due_at: u64) -> SpawnSpec {
    let mut env = vec![
        (
            "FIREEMU_FAKE_CLOCK_LOG".to_owned(),
            log.display().to_string(),
        ),
        ("FIREEMU_FAKE_RUN_DUE".to_owned(), "1".to_owned()),
        (
            "FIREEMU_FAKE_TIMER_DUE_REVISION".to_owned(),
            due_at.to_string(),
        ),
    ];
    if let Some(clock) = clock {
        env.push(("FIREEMU_CLOCK_JSON".to_owned(), clock.to_string()));
    }
    SpawnSpec {
        command: vec![
            "python3".to_owned(),
            concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake_runner.py").to_owned(),
        ],
        cwd: None,
        env,
        hello_timeout: Duration::from_secs(60),
    }
}

fn frames(log: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

/// A reload that sampled the clock before a move and installs its runner after `clock:runDue`
/// settled the move on the old runner, but before the batch picks its runner, does not get the
/// batch on the pre-move clock: the batch's own runner is synced first. Checked: the replacement
/// receives `clock:set` of the move's revision before `clock:runDue`, reports that revision with
/// the batch, and runs the fake runner's one timer due at that revision.
#[tokio::test]
async fn a_timer_batch_reaches_a_runner_installed_after_its_settlement_with_the_settled_clock() {
    let dir = std::env::temp_dir().join(format!("fireemu-run-due-swap-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let (old_log, new_log) = (dir.join("old.jsonl"), dir.join("new.jsonl"));
    let policy = ApplicationClockPolicy {
        date_virtual: true,
        timers_virtual: true,
        ..Default::default()
    };
    let clock = Arc::new(Mutex::new(VirtualClock::new(
        LogicalInstant::from_unix_seconds(1_788_004_860),
    )));
    let old_spec = spec(&old_log, None, u64::MAX);
    let old = Runner::spawn_spec(&old_spec).await.unwrap();
    let manifest = parse_manifest(old.hello().manifest.as_ref().unwrap()).unwrap();
    let runtime = FunctionsRuntime::new(
        manifest,
        FunctionsConfig {
            clock_policy: policy,
            ..FunctionsConfig::for_tests(1, "test-secret".to_owned())
        },
        clock.clone(),
        Arc::new(old),
        Some(old_spec),
    );
    runtime.sync_clock().await.unwrap();
    // The replacement starts with the start options of the moment before the move.
    let pre_move = clock.lock().unwrap().snapshot();
    let mut options = policy.runner_options(pre_move);
    options["following"] = json!(false);
    // Its timer comes due at the move.
    let new_spec = spec(&new_log, Some(options), pre_move.revision + 1);
    let replacement = Arc::new(Runner::spawn_spec(&new_spec).await.unwrap());
    let pending = Mutex::new(Some(CodebaseSpec {
        function: None,
        name: "default".to_owned(),
        manifest: runtime.manifest().clone(),
        runner: replacement.clone(),
        spawn: Some(new_spec),
        cleanup_dir: None,
    }));
    let weak = Arc::downgrade(&runtime);
    *runtime.run_due_selection_probe.lock().unwrap() = Some(Arc::new(move || {
        if let (Some(runtime), Some(spec)) = (weak.upgrade(), pending.lock().unwrap().take()) {
            runtime.reload_codebase(spec).unwrap();
        }
    }));
    clock
        .lock()
        .unwrap()
        .advance(LogicalDuration::from_seconds(1))
        .unwrap();
    let target = clock.lock().unwrap().snapshot().revision;
    let report = tokio::time::timeout(Duration::from_secs(20), runtime.run_due(1)).await;
    let new_frames = frames(&new_log);
    runtime.shutdown().await;
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(target, pre_move.revision + 1);
    let report = report.expect("the batch answers").expect("the batch runs");
    assert!(Arc::ptr_eq(&runtime.runner(), &replacement));
    let position = |kind: &str| {
        new_frames.iter().position(|frame| {
            frame["type"] == kind
                && (kind != "clock:set" || frame["revision"] == json!(target.to_string()))
        })
    };
    let (synced, batch) = (position("clock:set"), position("clock:runDue"));
    assert!(
        synced.is_some() && batch.is_some() && synced < batch,
        "the replacement got the batch without the settled clock first: {new_frames:?}"
    );
    assert_eq!(
        report["codebases"][0]["timers"]["revision"],
        json!(target.to_string()),
        "{report}"
    );
    assert_eq!(
        report["codebases"][0]["timers"]["ran"],
        json!(["timer"]),
        "the timer due at the move did not run: {report}"
    );
}
