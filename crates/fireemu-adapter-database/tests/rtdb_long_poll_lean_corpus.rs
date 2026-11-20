use fireemu_adapter_database::long_poll::{BadSegments, Reassembler, Segment};

const CORPUS: &str = include_str!("fixtures/lean-rtdb-long-poll.corpus");

fn segments(record: &str) -> Vec<Segment> {
    record
        .split('|')
        .map(|field| {
            let pieces: Vec<_> = field.split(',').collect();
            let [number, total, body] = pieces.as_slice() else {
                panic!("malformed segment {field:?}");
            };
            Segment {
                number: number.parse().expect("segment number"),
                total: total.parse().expect("packet size"),
                data: (*body).into(),
            }
        })
        .collect()
}

fn reply(record: &str) -> Result<Vec<String>, BadSegments> {
    if record == "ok" {
        Ok(Vec::new())
    } else if record == "bad" {
        Err(BadSegments)
    } else {
        Ok(record
            .strip_prefix("ok:")
            .expect("message reply")
            .split(',')
            .map(str::to_owned)
            .collect())
    }
}

#[test]
fn replay_lean_long_poll() {
    assert_eq!(CORPUS.lines().count(), 84);
    for line in CORPUS.lines() {
        let fields: Vec<_> = line.split('\t').collect();
        let [_, _, _, bytes, count, requests, expected] = fields.as_slice() else {
            panic!("malformed corpus row {line:?}");
        };
        let mut reassembler = Reassembler::with_bounds(
            bytes.parse().expect("pending byte limit"),
            count.parse().expect("pending segment limit"),
        );
        let mut requests = requests.split(';');
        let mut results = expected.split(';');
        while let Some(record) = results.next() {
            let request = requests.next().expect("request for expected reply");
            let expected = reply(record);
            let actual = reassembler.add(segments(request));
            assert_eq!(actual, expected, "{line:?}");
            if expected.is_err() {
                assert!(
                    results.next().is_none(),
                    "connection continued after refusal"
                );
                break;
            }
            if results.clone().next().is_none() {
                assert!(
                    requests.next().is_none(),
                    "missing replies for successful trace"
                );
            }
        }
    }
}
