//! Replays createTask checking order and its deferred size measurement.

use std::cell::Cell;

use fireemu_adapter_functions::tasks_production::{admit, Refusal, MAX_TASK_BYTES};
use serde_json::{json, Value};

const QUEUE: &str = "projects/demo-lean/locations/us-central1/queues/replay";
const OTHER: &str = "projects/demo-lean/locations/us-central1/queues/other";
const NOW: i128 = 1_234_567_890;
const DEADLINE: u64 = 17;
const HORIZON: &str = "1970-01-31T00:00:01.234567890Z";
const BEYOND: &str = "1970-01-31T00:00:01.234567891Z";

fn request(unknown: &str, syntax: &str, scenario: &str) -> (Value, usize) {
    let mut task = json!({"name": format!("{QUEUE}/tasks/given"), "httpRequest": {}});
    let mut size = 0;
    match scenario {
        "defaults" | "fullView" => {}
        "generated" => {
            task.as_object_mut().unwrap().remove("name");
        }
        "zero" => task["dispatchDeadline"] = json!("0s"),
        "minimum" => task["dispatchDeadline"] = json!("15s"),
        "maximum" => task["dispatchDeadline"] = json!("1800s"),
        "below" => task["dispatchDeadline"] = json!("14.999999999s"),
        "above" => task["dispatchDeadline"] = json!("1800.000000001s"),
        "fractional" => task["dispatchDeadline"] = json!("15.000000001s"),
        "past" => task["scheduleTime"] = json!("1970-01-01T00:00:00Z"),
        "near" => task["scheduleTime"] = json!("1970-01-01T00:00:01.234568105Z"),
        "horizon" => task["scheduleTime"] = json!(HORIZON),
        "beyond" => task["scheduleTime"] = json!(BEYOND),
        "missingPayload" => {
            task.as_object_mut().unwrap().remove("httpRequest");
        }
        "nullPayload" => task["httpRequest"] = Value::Null,
        "appEngine" => {
            task.as_object_mut().unwrap().remove("httpRequest");
            task["appEngineHttpRequest"] = json!({});
        }
        "badShape" => task["name"] = json!("not/a/task"),
        "badId" => task["name"] = json!(format!("{QUEUE}/tasks/invalid!")),
        "wrongQueue" => task["name"] = json!(format!("{OTHER}/tasks/given")),
        "exactBytes" => size = MAX_TASK_BYTES,
        "large" => size = MAX_TASK_BYTES + 1,
        "payloadWins" => {
            task.as_object_mut().unwrap().remove("httpRequest");
            task["name"] = json!("not/a/task");
            task["dispatchDeadline"] = json!("-1s");
            size = MAX_TASK_BYTES + 1;
        }
        "nameWins" => {
            task["name"] = json!(format!("{OTHER}/tasks/given"));
            task["dispatchDeadline"] = json!("-1s");
            task["scheduleTime"] = json!(BEYOND);
        }
        "deadlineWins" => {
            task["dispatchDeadline"] = json!("-1s");
            task["scheduleTime"] = json!(BEYOND);
            size = MAX_TASK_BYTES + 1;
        }
        "horizonWins" => {
            task["scheduleTime"] = json!(BEYOND);
            size = MAX_TASK_BYTES + 1;
        }
        value => panic!("invalid scenario: {value}"),
    }
    if matches!(syntax, "schedule" | "both") {
        task["scheduleTime"] = json!("malformed");
    }
    if matches!(syntax, "deadline" | "both") {
        task["dispatchDeadline"] = json!("malformed");
    }
    match unknown {
        "task" => task["unknown"] = json!(true),
        "http" => task["httpRequest"] = json!({"unknown": true}),
        "none" | "request" => {}
        value => panic!("invalid unknown-field location: {value}"),
    }
    let mut request = json!({"task": task});
    if unknown == "request" {
        request["unknown"] = json!(true);
    }
    if scenario == "fullView" {
        request["responseView"] = json!("FULL");
    }
    (request, size)
}

fn check_refusal(refusal: &Refusal, expected: &str, row: &str) {
    assert_eq!(refusal.http, 400, "{row}");
    assert_eq!(refusal.status, "INVALID_ARGUMENT", "{row}");
    match expected {
        "unknownRequest" | "unknownTask" | "unknownHttp" => {
            let path = match expected {
                "unknownRequest" => "",
                "unknownTask" => " at 'task'",
                _ => " at 'task.http_request'",
            };
            assert_eq!(
                refusal.message,
                format!("Invalid JSON payload received. Unknown name \"unknown\"{path}: Cannot find field."),
                "{row}"
            );
        }
        "scheduleSyntax" | "deadlineSyntax" | "bothSyntax" => {
            let details = refusal.details.as_ref().unwrap();
            let fields = details[0]["fieldViolations"].as_array().unwrap();
            let names: Vec<_> = fields
                .iter()
                .map(|item| item["field"].as_str().unwrap())
                .collect();
            let expected_fields: &[_] = match expected {
                "scheduleSyntax" => &["task.schedule_time"],
                "deadlineSyntax" => &["task.dispatch_deadline"],
                _ => &["task.schedule_time", "task.dispatch_deadline"],
            };
            assert_eq!(names, expected_fields, "{row}");
        }
        "payload" => assert_eq!(refusal.message, "Task.payload_type is not set.", "{row}"),
        "nameShape" => assert!(
            refusal.message.starts_with("Task name must be formatted:"),
            "{row}"
        ),
        "nameId" => assert!(
            refusal
                .message
                .starts_with("Task ID \"invalid!\" can contain"),
            "{row}"
        ),
        "nameQueue" => assert!(
            refusal.message.starts_with("The queue name from request"),
            "{row}"
        ),
        "deadlineRange" => assert_eq!(
            refusal.message, "Task.dispatchDeadline must be between [15s, 30m].",
            "{row}"
        ),
        "horizon" => assert!(
            refusal
                .message
                .ends_with("Schedule time must be no more than 720h in the future."),
            "{row}"
        ),
        "size" => assert_eq!(refusal.message, "Task size too large", "{row}"),
        value => panic!("invalid refusal: {value}"),
    }
}

#[test]
fn cloud_tasks_admission_matches_lean() {
    let mut lines = include_str!("fixtures/lean-cloud-tasks-admission.corpus").lines();
    assert_eq!(
        lines.next(),
        Some("# unknown|syntax|scenario|outcome|size_called|schedule_ns|deadline_seconds|view")
    );
    let mut count = 0;
    for row in lines {
        let fields: Vec<_> = row.split('|').collect();
        let [unknown, syntax, scenario, outcome, size_called, schedule, deadline, view]: [&str; 8] =
            fields.try_into().unwrap();
        let (body, size) = request(unknown, syntax, scenario);
        let calls = Cell::new(0_u32);
        let result = admit(QUEUE, &body, NOW, 7, DEADLINE, || {
            calls.set(calls.get() + 1);
            size
        });
        assert_eq!(
            calls.get(),
            u32::from(size_called.parse::<bool>().unwrap()),
            "{row}"
        );
        if outcome == "accepted" {
            let accepted = result.unwrap_or_else(|error| panic!("{row}: {error:?}"));
            assert_eq!(
                accepted.schedule_nanos,
                schedule.parse::<i128>().unwrap(),
                "{row}"
            );
            assert_eq!(
                accepted.deadline_seconds,
                deadline.parse::<u64>().unwrap(),
                "{row}"
            );
            assert_eq!(accepted.create_time, "1970-01-01T00:00:01Z", "{row}");
            assert_eq!(accepted.view, view, "{row}");
            if scenario == "generated" {
                let prefix = format!("{QUEUE}/tasks/");
                let id = accepted.name.strip_prefix(&prefix).unwrap();
                assert_eq!(id.len(), 19, "{row}");
                assert!(id.bytes().all(|byte| byte.is_ascii_digit()), "{row}");
            } else {
                assert_eq!(accepted.name, format!("{QUEUE}/tasks/given"), "{row}");
            }
        } else {
            check_refusal(&result.expect_err(row), outcome, row);
        }
        count += 1;
    }
    assert_eq!(count, 400);
}
