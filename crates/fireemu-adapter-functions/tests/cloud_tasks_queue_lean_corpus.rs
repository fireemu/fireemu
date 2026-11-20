//! Replays name reuse and generation boundaries against the crate-private scheduler.
//!
//! The explicit source modules expose the real scheduler to this test without widening the
//! adapter's public API or starting the Functions runtime. Only the new replayer uses virtual time.

#[allow(dead_code)]
#[path = "../src/task_scheduler.rs"]
mod task_scheduler;
#[allow(dead_code)]
#[path = "../src/tasks.rs"]
mod tasks;
#[allow(dead_code)]
#[path = "../src/tasks_production.rs"]
mod tasks_production;

use std::collections::BTreeMap;
use std::time::Duration;

use fireemu_adapter_functions::time_text;
use fireemu_core_functions::manifest::{
    FunctionGeneration, FunctionManifest, FunctionSpec, PlatformOptions, TaskRateLimits,
    TaskRetryConfig, Trigger, DEFAULT_REGION, DEFAULT_TIMEOUT_SECONDS,
};
use serde_json::json;
use task_scheduler::{AdmissionError, BurstRule, NameState, TaskScheduler, TaskTime};
use tasks::Task;
use tasks_production::NameReuse;

const PROJECT: &str = "demo-lean";
const QUEUE: &str = "queue";
const NAME: &str = "name";

fn manifest() -> FunctionManifest {
    FunctionManifest {
        functions: vec![FunctionSpec {
            name: QUEUE.to_owned(),
            region: DEFAULT_REGION.to_owned(),
            entry_point: QUEUE.to_owned(),
            trigger: Trigger::TaskQueue {
                retry: TaskRetryConfig::default(),
                rate_limits: TaskRateLimits {
                    max_concurrent_dispatches: 1,
                    max_dispatches_per_second: 1.0,
                },
            },
            timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
            retry: false,
            generation: FunctionGeneration::Second,
            concurrency: None,
            platform_options: PlatformOptions::default(),
        }],
        ignored: Vec::new(),
    }
}

fn task(schedule: &str) -> Task {
    Task {
        name: NAME.to_owned(),
        url: "http://127.0.0.1/unused".to_owned(),
        headers: BTreeMap::new(),
        body: json!({}),
        body_json_error: None,
        raw_body: Vec::new(),
        create_time: None,
        schedule_time: match schedule {
            "now" => None,
            "future" | "release" => Some("1970-01-01T00:00:05Z".to_owned()),
            other => panic!("unknown schedule {other}"),
        },
        dispatch_deadline_seconds: 60,
        dispatch_deadline: "60s".to_owned(),
        oauth_token: None,
        oidc: None,
    }
}

fn replay(reuse: NameReuse, schedule: &str, trace: &str) {
    let virtual_now = |seconds: u64| TaskTime::Virtual(u128::from(seconds) * 1_000_000_000);
    let mut scheduler = TaskScheduler::from_manifest(&manifest(), virtual_now(0));
    scheduler.set_name_reuse(reuse);
    scheduler.set_burst_rule(BurstRule::Production);
    let mut first = None;
    let mut latest = None;
    for step in trace.split(';') {
        let parts: Vec<_> = step.split(':').collect();
        let [tick, action, output, state, active, outstanding]: [&str; 6] =
            parts.try_into().unwrap();
        let tick: u64 = tick.parse().unwrap();
        let now = virtual_now(tick);
        let observed = match action {
            "enqueue" => match scheduler.enqueue_at(
                QUEUE,
                task(schedule),
                TaskRetryConfig::default(),
                64,
                now,
            ) {
                Ok(()) => "accepted".to_owned(),
                Err(AdmissionError::Duplicate) => "duplicate".to_owned(),
                Err(AdmissionError::Closed) => "closed".to_owned(),
                Err(error) => panic!("unexpected queue admission: {error:?}"),
            },
            "poll" => {
                let (dispatches, _) = scheduler.dispatch_ready_at(
                    now,
                    Some(i128::from(tick) * 1_000_000_000),
                    PROJECT,
                    |_| Some(DEFAULT_REGION.to_owned()),
                    1,
                );
                if let Some(dispatch) = dispatches.first() {
                    assert_eq!(dispatch.queue, QUEUE);
                    assert_eq!(dispatch.task.name, NAME);
                    let mark = (dispatch.id, dispatch.generation);
                    first.get_or_insert(mark);
                    latest = Some(mark);
                    format!("{}+{}", mark.0, mark.1)
                } else {
                    "none".to_owned()
                }
            }
            "runNow" => scheduler.run_now(QUEUE, Some(NAME)).to_string(),
            "delete" => scheduler
                .delete_pending(QUEUE, |name| name == NAME, now)
                .to_string(),
            "finish" | "finishFirst" => {
                let mark = if action == "finish" { latest } else { first };
                mark.is_some_and(|(id, generation)| {
                    scheduler.finish_with_outcome_at(QUEUE, id, generation, false, now)
                })
                .to_string()
            }
            "staleGeneration" => latest
                .and_then(|(id, generation)| generation.checked_sub(1).map(|old| (id, old)))
                .is_some_and(|(id, old)| {
                    scheduler.finish_with_outcome_at(QUEUE, id, old, false, now)
                })
                .to_string(),
            "reset" => {
                scheduler.reset(now);
                "-".to_owned()
            }
            "close" => {
                scheduler.close(now);
                "-".to_owned()
            }
            "peek" => "-".to_owned(),
            other => panic!("unknown operation {other}"),
        };
        assert_eq!(observed, output, "{step} in {trace}");
        let name_state = match scheduler.name_state(QUEUE, NAME, now) {
            NameState::Free => "free",
            NameState::Live => "live",
            NameState::Finished => "finished",
        };
        assert_eq!(name_state, state, "{step} in {trace}");
        assert_eq!(
            scheduler.active(),
            active.parse::<usize>().unwrap(),
            "{step} in {trace}"
        );
        assert_eq!(
            scheduler.outstanding(),
            outstanding.parse::<usize>().unwrap(),
            "{step} in {trace}"
        );
    }
}

#[test]
fn cloud_tasks_queue_matches_lean() {
    let mut lines = include_str!("fixtures/lean-cloud-tasks-queue.corpus").lines();
    assert_eq!(
        lines.next(),
        Some("# reuse|disposal|age|schedule|time:action:result:name:active:outstanding;...")
    );
    let mut count = 0;
    for row in lines {
        let fields: Vec<_> = row.split('|').collect();
        let [reuse, _, _, schedule, trace]: [&str; 5] = fields.try_into().unwrap();
        let reuse = match reuse {
            "immediate" => NameReuse::Immediate,
            "retained" => NameReuse::Retained,
            "window" => NameReuse::Window(Duration::from_secs(2)),
            other => panic!("unknown reuse policy {other}"),
        };
        replay(reuse, schedule, trace);
        count += 1;
    }
    assert_eq!(count, 144);
}
