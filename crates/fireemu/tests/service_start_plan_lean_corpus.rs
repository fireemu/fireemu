//! Replays Lean's product service decisions through the real no-start CLI plan.

mod scratch;

use scratch::Scratch;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::Path;
use std::process::{Command, Output, Stdio};

const CORPUS: &str = include_str!("fixtures/lean-service-start-plan.corpus");
const MODELED: [&str; 9] = [
    "firestore",
    "auth",
    "storage",
    "hosting",
    "functions",
    "eventarc",
    "tasks",
    "pubsub",
    "database",
];

fn fixture(dir: &Path, functions: &str, hosting: &str, optional: &str) {
    let mut firebase = json!({"emulators": {}});
    if hosting == "present" {
        firebase["hosting"] = json!({"public": "public"});
    }
    let mut canonical = json!({"schemaVersion": 1, "firebaseJson": "firebase.json"});
    if functions == "present" {
        firebase["functions"] = json!({"source": "functions"});
        canonical["functions"] = json!({"source": "functions", "runner": ["fixture-runner"]});
    }
    if matches!(optional, "pubsub" | "both") {
        firebase["emulators"]["pubsub"] = json!({"port": 8085});
    }
    if matches!(optional, "database" | "both") {
        firebase["emulators"]["database"] = json!({"port": 9000});
    }
    std::fs::write(dir.join("firebase.json"), firebase.to_string()).unwrap();
    std::fs::write(dir.join("fireemu.json"), canonical.to_string()).unwrap();
}

fn run_plan(dir: &Path, only: &str) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_fireemu"));
    command
        .env_clear()
        .env("HOME", dir.join("home"))
        .current_dir(dir)
        .stdin(Stdio::null())
        .args([
            "up",
            "--plan",
            "--json",
            "--config",
            "fireemu.json",
            "--project",
            "demo-lean-plan",
        ]);
    if only != "-" {
        command.args(["--only", only]);
    }
    command.output().expect("run the read-only plan")
}

fn started(plan: &Value) -> BTreeSet<&str> {
    let mut selected = BTreeSet::new();
    let mut covered = BTreeSet::new();
    for service in plan["services"].as_array().expect("service rows") {
        let name = service["name"].as_str().expect("service name");
        if MODELED.contains(&name) {
            assert!(covered.insert(name), "duplicate service row {name}");
            if service["start"].as_bool().expect("start flag") {
                selected.insert(name);
            }
        }
    }
    assert_eq!(covered.len(), MODELED.len());
    selected
}

#[test]
fn real_service_start_plan_agrees_with_lean() {
    let dir = Scratch::new("lean-start-plan", "matrix");
    std::fs::create_dir(dir.join("public")).unwrap();
    std::fs::create_dir(dir.join("home")).unwrap();
    std::fs::create_dir(dir.join("functions")).unwrap();
    std::fs::write(dir.join("functions/package.json"), "{\"name\":\"fixture\"}").unwrap();
    let mut lines = CORPUS.lines();
    assert_eq!(lines.next(), Some("# 128 cases."));
    let mut seen = BTreeSet::new();
    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        let [id, only, functions, hosting, optional, expected] = fields.as_slice() else {
            panic!("invalid row: {line}");
        };
        assert!(seen.insert(*id), "duplicate row {id}");
        fixture(&dir, functions, hosting, optional);
        let output = run_plan(&dir, only);
        let stderr = String::from_utf8_lossy(&output.stderr);
        match *expected {
            "error-hosting" => {
                assert!(!output.status.success(), "{id}");
                assert!(
                    stderr.contains("--only hosting requires hosting.public"),
                    "{id}: {stderr}"
                );
            }
            "error-support" => {
                assert!(!output.status.success(), "{id}");
                assert!(stderr.contains("No emulators to start"), "{id}: {stderr}");
            }
            outcome => {
                assert!(output.status.success(), "{id}: {stderr}");
                let plan: Value = serde_json::from_slice(&output.stdout).expect("JSON plan");
                let expected: BTreeSet<_> = outcome
                    .strip_prefix("ok:")
                    .expect("expected result")
                    .split(',')
                    .filter(|part| !part.is_empty())
                    .collect();
                assert_eq!(started(&plan), expected, "{id}");
            }
        }
    }
    assert_eq!(seen.len(), 128);
}
