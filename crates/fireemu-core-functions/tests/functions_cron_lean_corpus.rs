use fireemu_core_functions::cron::{RunCount, Schedule};
use fireemu_core_types::time::LogicalInstant;
use std::collections::BTreeSet;

const CORPUS: &str = include_str!("fixtures/lean-functions-cron.corpus");

fn seconds(text: &str) -> LogicalInstant {
    LogicalInstant::from_unix_seconds(text.parse().expect("seconds"))
}

fn maybe_seconds(text: &str) -> Option<LogicalInstant> {
    (text != "-").then(|| seconds(text))
}

#[test]
fn fixed_offset_cron_and_epoch_intervals_agree_with_lean() {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .strip_suffix(" cases.")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(count, 293);
    let mut seen = BTreeSet::new();
    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        let [id, source, offset, from, to, cap, next, latest, kind, count, prefix] =
            fields.as_slice()
        else {
            panic!("invalid row: {line}");
        };
        assert!(seen.insert(*id), "duplicate row: {id}");
        let schedule = Schedule::parse(source).expect("modeled schedule");
        let offset = offset.parse().expect("fixed offset");
        let from = LogicalInstant::from_nanos(from.parse().expect("from"));
        let to = LogicalInstant::from_nanos(to.parse().expect("to"));
        let window = schedule.window(from, to, offset, cap.parse().expect("cap"));
        let count = count.parse().expect("run count");
        let expected_count = match *kind {
            "exact" => RunCount::Exact(count),
            "atleast" => RunCount::AtLeast(count),
            _ => panic!("invalid run count kind: {kind}"),
        };
        assert_eq!(window.count, expected_count, "{id}");
        assert_eq!(window.latest, maybe_seconds(latest), "{id}");
        assert_eq!(
            schedule.next_after(from, offset),
            maybe_seconds(next),
            "{id}"
        );
        let prefix: Vec<_> = prefix
            .split(',')
            .filter(|text| *text != "-")
            .map(seconds)
            .collect();
        assert_eq!(schedule.runs_between(from, to, offset, 5), prefix, "{id}");
    }
    assert_eq!(seen.len(), count);
}
