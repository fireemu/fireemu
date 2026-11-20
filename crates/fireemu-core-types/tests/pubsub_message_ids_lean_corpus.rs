//! Differential replay of the Lean model for the broker and runtime message IDs.

use fireemu_core_types::pubsub_message_id::{
    next_runtime_position, pubsub_message_id, runtime_message_id, session_runtime_message_id,
    BROKER_SPAN, SPAN,
};

const CORPUS: &str = include_str!("fixtures/lean-pubsub-message-ids.corpus");

#[test]
fn pubsub_message_ids_and_runtime_positions_match_lean() {
    let mut lines = CORPUS.lines();
    let declared: usize = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases"))
        .expect("case count header")
        .parse()
        .expect("numeric case count");
    assert_eq!(lines.clone().count(), declared);
    assert!(declared >= 160, "expected the full case matrix");
    assert_eq!(BROKER_SPAN, 5_000_000_000_000);
    assert_eq!(SPAN, 10_000_000_000_000);

    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        let [_, _, _, session, counter, count, broker, runtime, affine, position] =
            fields.as_slice()
        else {
            panic!("bad Pub/Sub corpus row: {line}");
        };
        let session = session.parse().expect("session");
        let counter = counter.parse().expect("counter");
        let count = count.parse().expect("count");
        assert_eq!(pubsub_message_id(counter), *broker, "{line}");
        assert_eq!(runtime_message_id(counter), *runtime, "{line}");
        assert_eq!(
            session_runtime_message_id(session, counter),
            *affine,
            "{line}"
        );
        assert_eq!(
            next_runtime_position(counter, count),
            position.parse::<u64>().expect("position"),
            "{line}"
        );
        if (1..=BROKER_SPAN).contains(&counter) {
            assert_ne!(broker, runtime, "{line}");
            assert_ne!(broker, affine, "{line}");
        }
        for id in [broker, runtime, affine] {
            assert_eq!(id.len(), 17, "{line}");
            assert!(id.bytes().all(|b| b.is_ascii_digit()), "{line}");
        }
    }
}
