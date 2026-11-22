//! The scan order uses the CRC and full resource name, with stable ties.

use fireemu_adapter_grpc::pipeline::{crc32, in_scan_order};
use fireemu_proto_firestore::google::firestore::v1 as pb;

#[test]
fn scan_order_keeps_control_and_duplicate_response_order_across_crc_collisions() {
    let low = "QV7n0nv4XVOv";
    let high = "ifgJoGQosbE2";
    assert_eq!(crc32(low.as_bytes()), crc32(high.as_bytes()));

    let make = |id: Option<&str>, skipped_results| pb::RunQueryResponse {
        document: id.map(|id| pb::Document {
            name: format!("projects/p/databases/(default)/documents/parents/p/items/{id}"),
            ..Default::default()
        }),
        skipped_results,
        ..Default::default()
    };
    let mut malformed = make(None, 5);
    malformed.document = Some(pb::Document {
        name: "malformed".to_owned(),
        ..Default::default()
    });
    let input = vec![
        make(Some(high), 1),
        make(None, 2),
        make(Some(low), 3),
        make(Some(high), 4),
        malformed,
        make(None, 6),
    ];

    let sorted = in_scan_order(input);
    assert_eq!(
        sorted
            .iter()
            .map(|row| row.skipped_results)
            .collect::<Vec<_>>(),
        [2, 5, 6, 3, 1, 4],
    );
    assert_eq!(in_scan_order(sorted.clone()), sorted);
}
