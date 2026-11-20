//! Compares observed notice events with an independent bounded Lean reference.

use fireemu_adapter_support::notice_limit::{NoticeEvent, NoticeLimit};

#[test]
fn notice_capacity_duplicates_and_suppression_agree_with_lean() {
    let mut rows = include_str!("fixtures/lean-adapter-notice-limit.corpus").lines();
    assert_eq!(rows.next(), Some("# prior|phase|case|sequence|outcomes"));
    let mut count = 0;
    for row in rows {
        let fields: Vec<_> = row.split('|').collect();
        let [_, _, _, sequence, events]: [&str; 5] = fields.try_into().unwrap();
        let mut actual = NoticeLimit::default();
        let names: Vec<_> = sequence.split(',').collect();
        let outcomes: Vec<_> = events.split(',').collect();
        assert_eq!(names.len(), outcomes.len(), "{row}");
        for (name, expected) in names.into_iter().zip(outcomes) {
            let observed = actual.observe(name);
            let expected = match expected {
                "-" => None,
                "first" => Some(NoticeEvent::First(name)),
                "stop" => Some(NoticeEvent::Suppressed),
                _ => panic!("{row}"),
            };
            assert_eq!(observed, expected, "{row}, {name}");
        }
        count += 1;
    }
    assert_eq!(count, 18);
}
