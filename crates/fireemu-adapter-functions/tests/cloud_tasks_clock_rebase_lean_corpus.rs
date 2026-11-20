//! Replays integer clock inputs against the public Cloud Tasks rebase function.

use fireemu_adapter_functions::tasks::rebase_schedule_time;
use fireemu_core_types::time::LogicalInstant;

#[test]
fn cloud_tasks_clock_rebase_matches_lean() {
    let mut lines = include_str!("fixtures/lean-cloud-tasks-clock-rebase.corpus").lines();
    assert_eq!(
        lines.next(),
        Some("# own|other|scheduled|own_ns|other_ns|scheduled_ns|result_ns")
    );
    let mut count = 0;
    for row in lines {
        let fields: Vec<_> = row.split('|').collect();
        let [_, _, _, own, other, scheduled, expected]: [&str; 7] = fields.try_into().unwrap();
        let at = LogicalInstant::from_nanos(scheduled.parse().unwrap());
        let rebased = rebase_schedule_time(at, own.parse().unwrap(), other.parse().unwrap());
        assert_eq!(
            rebased.as_nanos(),
            expected.parse::<i128>().unwrap(),
            "{row}"
        );
        count += 1;
    }
    assert_eq!(count, 512);
}
