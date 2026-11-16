//! A virtual `functions.clock` follows the daemon clock in the runner: with no
//! `daemon.clockStart` the daemon clock follows real time, so the function's `Date.now()`
//! advances and its virtual timers come due without anyone moving the clock; a pinned start
//! keeps the clock still, so neither happens until the clock is moved.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[path = "../../../tests/support/real_node.rs"]
mod real_node;

fn sdk_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/sdk-smoke")
}

const INDEX: &str = r"
const { onRequest } = require('firebase-functions/v2/https');
let armedAt = null;
let fired = false;
exports.arm = onRequest((_req, res) => {
  armedAt = Date.now();
  fired = false;
  setTimeout(() => { fired = true; }, 1000);
  res.json({ now: armedAt });
});
exports.state = onRequest((_req, res) => res.json({ now: Date.now(), armedAt, fired }));
exports.crash = onRequest(() => process.exit(1));
";

const PROBE: &str = r#"
base="http://$FIREEMU_FUNCTIONS_HOST/demo-vclock/us-central1"
curl -fsS "$base/arm" >/dev/null || exit 3
sleep 1.6
curl -fsS "$base/state"
echo
if [ "$1" = "recover" ]; then
  # A runner the daemon starts again (recovery) keeps following the clock.
  curl -sS "$base/crash" >/dev/null 2>&1
  i=0
  until curl -fsS "$base/arm" >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 100 ] && exit 4; sleep 0.1; done
  sleep 1.6
  curl -fsS "$base/state"
  echo
fi
"#;

fn run(name: &str, daemon: &str) -> Vec<serde_json::Value> {
    let dir = std::env::temp_dir().join(format!("fireemu-vclock-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let source = dir.join("functions");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(source.join("index.js"), INDEX).unwrap();
    std::fs::write(
        source.join("package.json"),
        r#"{"name":"vclock","main":"index.js"}"#,
    )
    .unwrap();
    std::os::unix::fs::symlink(
        std::fs::canonicalize(sdk_root().join("node_modules")).unwrap(),
        source.join("node_modules"),
    )
    .unwrap();
    let config = dir.join("fireemu.json");
    std::fs::write(
        &config,
        format!(
            r#"{{"schemaVersion":1,"profile":"strict","daemon":{daemon},"functions":{{"clock":{{"date":"virtual","timers":"virtual"}}}}}}"#
        ),
    )
    .unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_fireemu"));
    real_node::use_real_node(&mut command);
    let output = command
        .current_dir(&dir)
        .args(["exec", "--config", "fireemu.json", "--only", "functions"])
        .args([
            "--functions-port",
            "0",
            "--eventarc-port",
            "0",
            "--tasks-port",
            "0",
        ])
        .args(["--logging-port", "0", "--ui-port", "0", "--hub-port", "0"])
        .args(["--project", "demo-vclock", "--functions", "functions"])
        .args(["--", "/bin/sh", "-c", PROBE, "probe", name])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let _ = std::fs::remove_dir_all(&dir);
    stdout
        .lines()
        .filter(|l| l.starts_with('{'))
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

#[test]
fn an_unpinned_virtual_functions_clock_advances_date_and_fires_timers_with_real_time() {
    if !sdk_root().join("node_modules/firebase-functions").exists() {
        eprintln!("skipped: tools/sdk-smoke has no node_modules");
        return;
    }
    // The second state comes from a runner the daemon started again after a crash.
    let states = run("recover", "{}");
    assert_eq!(states.len(), 2, "{states:?}");
    for state in &states {
        let advanced = state["now"].as_i64().unwrap() - state["armedAt"].as_i64().unwrap();
        assert!(
            advanced >= 1400,
            "Date.now() advanced {advanced} ms: {state}"
        );
        assert_eq!(state["fired"], true, "{state}");
    }
}

#[test]
fn a_pinned_virtual_functions_clock_stands_still_until_moved() {
    if !sdk_root().join("node_modules/firebase-functions").exists() {
        eprintln!("skipped: tools/sdk-smoke has no node_modules");
        return;
    }
    let state = run("pinned", r#"{"clockStart":"2026-01-31T23:59:00Z"}"#).remove(0);
    assert_eq!(state["now"], state["armedAt"], "{state}");
    assert_eq!(state["now"], 1_769_903_940_000_i64, "{state}");
    assert_eq!(state["fired"], false, "{state}");
}
