//! Replays the Cloud Tasks timestamp and duration dialect against the Lean oracle.

use fireemu_adapter_functions::tasks_production::{
    format_duration, format_proto_timestamp, parse_duration, parse_timestamp,
};

fn expected_nanos(text: &str) -> Option<i128> {
    (text != "reject").then(|| text.parse().unwrap())
}

#[test]
fn cloud_tasks_time_codec_matches_lean() {
    let mut lines = include_str!("fixtures/lean-cloud-tasks-time-codec.corpus").lines();
    assert_eq!(
        lines.next(),
        Some("# duration/timestamp parser and formatter rows, pipe-delimited")
    );
    let mut count = 0;
    for row in lines {
        let fields: Vec<_> = row.split('|').collect();
        match fields.as_slice() {
            ["timestamp", _, _, _, input, expected] => {
                assert_eq!(parse_timestamp(input), expected_nanos(expected), "{row}");
            }
            ["duration", input, expected] => {
                assert_eq!(parse_duration(input), expected_nanos(expected), "{row}");
            }
            ["formatDuration", input, expected] => {
                assert_eq!(format_duration(input.parse().unwrap()), *expected, "{row}");
            }
            ["formatTimestamp", input, expected] => {
                assert_eq!(
                    format_proto_timestamp(input.parse().unwrap()),
                    *expected,
                    "{row}"
                );
            }
            _ => panic!("invalid fixture row: {row}"),
        }
        count += 1;
    }
    assert_eq!(count, 246);
}

#[test]
fn negative_fractional_duration_prints_euclidean_quotient_and_remainder() {
    let rendered = format_duration(-500_000_000);
    assert_eq!(rendered, "-1.500s");
    assert_eq!(parse_duration(&rendered), Some(-1_500_000_000));
}
