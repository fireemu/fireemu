//! Checks the physical blocks and logical records of Lean-generated `LevelDB` framing plans.

use fireemu_core_export::leveldb::{read_log, write_log, LogError, BLOCK_SIZE, HEADER_SIZE};

const CASES: &str = include_str!("fixtures/lean-export-leveldb.corpus");

fn record_payload(length: usize, ordinal: usize) -> Vec<u8> {
    (0..length)
        .map(|index| u8::try_from((index + 37 * ordinal) % 251).unwrap())
        .collect()
}

#[test]
fn replay_the_block_and_fragment_reference() {
    let mut cases = CASES.lines();
    assert_eq!(
        cases.next(),
        Some("# LEADING BODY FOLLOWING LENGTHS FRAMES, tab separated")
    );
    let mut count = 0;
    for row in cases {
        let columns = row.split('\t').collect::<Vec<_>>();
        let [_, _, _, lengths, frames] = columns.as_slice() else {
            panic!("malformed corpus row: {row}");
        };
        let records = lengths
            .split(',')
            .enumerate()
            .map(|(ordinal, length)| record_payload(length.parse().unwrap(), ordinal))
            .collect::<Vec<_>>();
        let bytes = write_log(&records);
        let mut offset = 0;
        for frame in frames.split(',') {
            let (kind, length) = frame.split_once(':').unwrap();
            let length = length.parse::<usize>().unwrap();
            if kind == "pad" {
                assert_eq!(offset % BLOCK_SIZE + length, BLOCK_SIZE, "{row}");
                assert!(
                    bytes[offset..offset + length].iter().all(|byte| *byte == 0),
                    "{row}"
                );
                offset += length;
            } else {
                assert_eq!(bytes[offset + 6], kind.parse::<u8>().unwrap(), "{row}");
                assert_eq!(
                    usize::from(u16::from_le_bytes([bytes[offset + 4], bytes[offset + 5]])),
                    length,
                    "{row}"
                );
                assert!(
                    offset % BLOCK_SIZE + HEADER_SIZE + length <= BLOCK_SIZE,
                    "{row}"
                );
                offset += HEADER_SIZE + length;
            }
        }
        assert_eq!(offset, bytes.len(), "{row}");
        assert_eq!(read_log(&bytes).expect(row), records, "{row}");
        count += 1;
    }
    assert_eq!(count, 50);
    assert!(write_log(&[]).is_empty());
    assert_eq!(read_log(&[]).unwrap(), Vec::<Vec<u8>>::new());
}

#[test]
fn a_bad_final_record_refuses_the_whole_file() {
    let records = vec![vec![0x33], vec![0x23; BLOCK_SIZE], vec![0x01, 0x02]];
    let intact = write_log(&records);
    assert_eq!(read_log(&intact).unwrap(), records);
    let final_header = intact.len() - HEADER_SIZE - 2;
    let mut bad_checksum = intact.clone();
    *bad_checksum.last_mut().unwrap() ^= 1;
    assert_eq!(
        read_log(&bad_checksum),
        Err(LogError::Checksum {
            offset: final_header
        })
    );
    assert_eq!(
        read_log(&intact[..intact.len() - 1]),
        Err(LogError::Truncated {
            offset: final_header
        })
    );
}
