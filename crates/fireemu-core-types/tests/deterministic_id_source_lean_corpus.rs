//! Differential replay of the Lean model for seeded ID streams and SplitMix64.

use fireemu_core_types::determinism::{
    DeterministicIdSource, DeterministicRng, IdSource, SplitMix64,
};
use fireemu_core_types::ids::SessionId;

const CORPUS: &str = include_str!("fixtures/lean-deterministic-id-source.corpus");

fn numbers<T: std::str::FromStr>(text: &str) -> impl Iterator<Item = T> + '_ {
    text.split(',').filter(move |_| text != "-").map(|part| {
        part.parse()
            .unwrap_or_else(|_| panic!("bad corpus number: {part}"))
    })
}

#[test]
fn deterministic_id_streams_and_random_draws_match_lean() {
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

    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        match fields.as_slice() {
            ["trace", _, _, _, session, seed, operations, expected] => {
                let mut source = DeterministicIdSource::new(
                    SessionId::new(session.parse().expect("session")),
                    seed.parse().expect("seed"),
                );
                let actual: Vec<_> = operations
                    .bytes()
                    .filter(|_| *operations != "-")
                    .map(|op| match op {
                        b'c' => u128::from(source.next_command_id().value()),
                        b'e' => source.next_event_id().value(),
                        b'i' => source.next_invocation_id().value(),
                        b't' => source.next_transaction_id().value(),
                        b'r' => source.next_correlation_id().value(),
                        _ => panic!("unknown operation in {line}"),
                    })
                    .collect();
                assert_eq!(actual, numbers(expected).collect::<Vec<u128>>(), "{line}");
            }
            ["draw", seed, expected] => {
                let mut rng = SplitMix64::new(seed.parse().expect("seed"));
                let expected: Vec<u64> = numbers(expected).collect();
                assert!(!expected.is_empty(), "{line}");
                let actual: Vec<_> = expected.iter().map(|_| rng.next_u64()).collect();
                assert_eq!(actual, expected, "{line}");
            }
            ["below", seed, bounds, expected, after] => {
                let mut rng = SplitMix64::new(seed.parse().expect("seed"));
                let expected: Vec<u64> = numbers(expected).collect();
                let actual: Vec<_> = numbers(bounds).map(|bound| rng.next_below(bound)).collect();
                assert_eq!(actual, expected, "{line}");
                assert_eq!(
                    rng.next_u64(),
                    after.parse::<u64>().expect("post-draw word"),
                    "{line}"
                );
            }
            _ => panic!("bad deterministic corpus row: {line}"),
        }
    }
}
