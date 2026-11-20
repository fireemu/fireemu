use fireemu_core_database::push_id::{PushIdGenerator, PUSH_CHARS};

const CORPUS: &str = include_str!("fixtures/lean-rtdb-push-id.corpus");

fn decode_suffix(encoded: &str) -> [u8; 12] {
    encoded
        .bytes()
        .map(|c| u8::try_from(PUSH_CHARS.bytes().position(|d| d == c).unwrap()).unwrap())
        .collect::<Vec<_>>()
        .try_into()
        .expect("12 characters")
}

#[test]
fn lean_push_id_transition_agrees_with_core() {
    assert_eq!(CORPUS.lines().count(), 81);
    for line in CORPUS.lines() {
        let fields: Vec<_> = line.split('\t').collect();
        let [clock, tail, time, stamp, suffix, seed, requested, before, after] = fields.as_slice()
        else {
            panic!("malformed corpus row {line:?}");
        };
        let mut generator = PushIdGenerator::from_state(
            stamp.parse().expect("previous timestamp"),
            decode_suffix(suffix),
            seed.parse().expect("seed"),
        );
        assert_eq!(generator.current(), *before, "{line:?}");
        let actual = generator.next(requested.parse().expect("requested timestamp"));
        assert_eq!(actual, *after, "{line:?}");
        assert_eq!(generator.current(), *after, "{line:?}");
        let wraps = *time == "wrap" && (*clock == "later" || *tail == "full");
        assert_eq!(before > after, wraps, "{line:?}");
    }
}
