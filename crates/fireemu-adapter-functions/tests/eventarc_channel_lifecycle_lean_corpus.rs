//! Replays the bounded single-channel Eventarc lifecycle with an injected clock and IDs.
use fireemu_adapter_functions::{
    eventarc_channels::{uuid_from, ChannelStore, Created, Deleted, Entropy, Lookup, Timing},
    ordered_json::Ordered,
};

const CHANNEL: &str = "projects/demo/locations/us-central1/channels/c";
const NANOS_PER_MILLISECOND: u64 = 1_000_000;

#[derive(Default)]
struct TestEntropy {
    identity: u64,
    serial: u64,
}

impl Entropy for TestEntropy {
    fn uuid(&mut self) -> String {
        self.identity += 1;
        uuid_from(0, self.identity)
    }

    fn hex(&mut self, digits: usize) -> String {
        self.serial += 1;
        format!("{:0digits$x}", self.serial)
    }

    fn topic_suffix(&mut self) -> u16 {
        u16::try_from(self.identity).unwrap()
    }
}

fn replay(trace: &str) {
    let store = ChannelStore::new(
        Box::<TestEntropy>::default(),
        Timing {
            create: 4 * NANOS_PER_MILLISECOND,
            delete: 3 * NANOS_PER_MILLISECOND,
        },
    );
    let mut operations = Vec::new();
    let mut steps = 0;
    for row in trace.split(';') {
        let fields: Vec<_> = row.splitn(5, ',').collect();
        let [action, wall, result, phase, observed] = fields.as_slice() else {
            panic!("invalid lifecycle step {row}")
        };
        let wall = wall.parse::<u64>().unwrap() * NANOS_PER_MILLISECOND;
        let actual = match *action {
            "lookup" => {
                let _ = store.lookup(CHANNEL, wall);
                "observed"
            }
            "declare" => {
                store.declare(CHANNEL, wall);
                "declared"
            }
            "create" => match store.create(CHANNEL, wall) {
                Created::Started(started) => {
                    operations.push(started.operation);
                    "created"
                }
                Created::Exists => "exists",
            },
            "delete" => match store.delete(CHANNEL, wall) {
                Deleted::Started(started) => {
                    operations.push(started.operation);
                    "deleted"
                }
                Deleted::Absent => "missing",
            },
            _ => panic!("unknown action {action}"),
        };
        assert_eq!(actual, *result, "{row}");

        let view = store.lookup(CHANNEL, wall);
        let actual_phase = match &view {
            Lookup::Absent => "absent",
            Lookup::Creating(_) => "creating",
            Lookup::Ready(_) => "ready",
            Lookup::Deleting(_) => "deleting",
        };
        assert_eq!(actual_phase, *phase, "{row}");

        let (metadata, bits) = observed.rsplit_once(',').unwrap();
        if metadata == "-" {
            assert!(view.view().is_none(), "{row}");
        } else {
            let data: Vec<_> = metadata
                .split(',')
                .map(|n| n.parse::<u64>().unwrap())
                .collect();
            let [uid, created, updated] = data.as_slice() else {
                panic!("invalid view metadata {row}")
            };
            let metadata = view.view().unwrap();
            assert_eq!(metadata.uid, uuid_from(0, *uid), "{row}");
            assert_eq!(metadata.name, CHANNEL, "{row}");
            assert_eq!(
                metadata.create_time,
                created * NANOS_PER_MILLISECOND,
                "{row}"
            );
            assert_eq!(
                metadata.update_time,
                updated * NANOS_PER_MILLISECOND,
                "{row}"
            );
            assert_eq!(metadata.active, actual_phase != "creating", "{row}");
            if actual_phase == "creating" {
                assert!(metadata.pubsub_topic.is_empty(), "{row}");
            } else {
                assert_eq!(
                    metadata.pubsub_topic,
                    format!("projects/demo/topics/eventarc-channel-us-central1-c-{uid:03}"),
                    "{row}",
                );
            }
        }

        assert_eq!(bits.len(), operations.len(), "{row}");
        for (id, expected) in operations.iter().zip(bits.bytes()) {
            let operation = store.operation(id, wall).unwrap();
            assert!(matches!(expected, b'0' | b'1'), "{row}");
            assert_eq!(operation["done"], Ordered::Bool(expected == b'1'), "{row}");
        }
        steps += 1;
    }
    assert!((16..=17).contains(&steps));
}

#[test]
fn eventarc_channel_lifecycle_replays_lean_traces() {
    let mut rows = include_str!("fixtures/lean-eventarc-channel-lifecycle.corpus").lines();
    assert_eq!(rows.next(), Some("# initial|deleteAt|clock|ordered action, wall, answer, phase, identity/time data, operation bits"));
    let mut count = 0;
    for row in rows {
        let parts: Vec<_> = row.split('|').collect();
        let [_, _, _, trace] = parts.as_slice() else {
            panic!("invalid lifecycle row {row}")
        };
        replay(trace);
        count += 1;
    }
    assert_eq!(count, 27);
}
