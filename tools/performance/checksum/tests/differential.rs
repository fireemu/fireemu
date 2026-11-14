use checksum_hardware_experiment::{Backend, BackendSelection, object_digests, raw_update};

#[test]
fn each_candidate_preserves_arbitrary_raw_state() {
    let bytes_all = (0..=255).collect::<Vec<_>>();
    let inputs: [&[u8]; 5] = [b"", b"a", b"123456789", &[0xff; 17], &bytes_all];
    let initial_states = [0, u32::MAX, 0x1357_9bdf, 0x8000_0001];

    for backend in Backend::ALL {
        for state in initial_states {
            for bytes in inputs {
                let expected = independent_bitwise_update(state, bytes);
                let actual = raw_update(backend, state, bytes);
                assert_eq!(
                    actual,
                    expected,
                    "backend={backend:?}, state={state:#010x}, len={}",
                    bytes.len()
                );
            }
        }
    }
}

#[test]
fn candidates_preserve_tail_alignment_and_chunk_boundaries() {
    for backend in Backend::ALL {
        for len in (0..=33).chain([63, 64, 65, 255, 256, 257]) {
            for offset in 0..8 {
                let (storage, range) = aligned_slice(offset, len);
                let bytes = &storage[range];
                for state in [u32::MAX, 0, 0xa5c3_7e19] {
                    let expected = independent_bitwise_update(state, &bytes);
                    for partition in [1, 7, 8, 997, 4093] {
                        let actual = update_in_chunks(backend, state, &bytes, partition);
                        assert_eq!(
                            actual, expected,
                            "backend={backend:?}, len={len}, offset={offset}, partition={partition}, state={state:#010x}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn runtime_dispatch_reports_the_selected_path_without_forcing_unsupported_code() {
    for backend in Backend::ALL {
        let selection = BackendSelection::detect(backend);
        let result = raw_update(backend, 0xdead_beef, b"runtime dispatch probe");
        assert_eq!(
            result,
            independent_bitwise_update(0xdead_beef, b"runtime dispatch probe")
        );
        assert!(!selection.hardware || selection.hardware_supported);
        eprintln!(
            "backend={} path={} hardware_supported={}",
            backend.label(),
            selection.path,
            selection.hardware_supported
        );
    }
}

#[test]
fn crc32c_public_convention_matches_known_check_value() {
    assert_eq!(
        checksum_hardware_experiment::crc32c(Backend::Scalar, b"123456789"),
        0xe306_9283
    );
    for backend in Backend::ALL {
        assert_eq!(
            checksum_hardware_experiment::crc32c(backend, b"123456789"),
            0xe306_9283,
            "backend={backend:?}"
        );
    }
}

#[test]
fn complete_object_digests_keep_md5_and_crc32c_vectors() {
    let bytes = patterned_bytes(64);
    for backend in Backend::ALL {
        let (md5, crc32c) = object_digests(backend, &bytes);
        assert_eq!(
            md5,
            [
                0xb6, 0xbf, 0x87, 0xc2, 0x4b, 0x1b, 0xc3, 0x34, 0xe2, 0x54, 0x13, 0x87, 0xa9, 0x2b,
                0x98, 0x1b,
            ]
        );
        assert_eq!(crc32c, 0x2b1d_65d8);
    }
}

#[test]
fn every_generated_pict_row_preserves_raw_and_finalized_contracts() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("PICT.generated.tsv");
    let table = std::fs::read_to_string(&path).expect("generate PICT.generated.tsv before replay");
    let mut lines = table.lines();
    let header = lines
        .next()
        .expect("PICT output header")
        .split('\t')
        .collect::<Vec<_>>();
    assert_eq!(
        header,
        [
            "Backend",
            "Workload",
            "Size",
            "Offset",
            "Partition",
            "RawState",
            "Bytes"
        ]
    );
    let mut rows = 0;
    for row in lines.filter(|line| !line.is_empty()) {
        let fields = row.split('\t').collect::<Vec<_>>();
        assert_eq!(fields.len(), 7, "PICT row {row}");
        let backend = match fields[0] {
            "scalar" => Backend::Scalar,
            "rust_intrinsic" => Backend::RustIntrinsic,
            "c_intrinsic" => Backend::CIntrinsic,
            "dependency" => Backend::Dependency,
            other => panic!("unknown backend {other}"),
        };
        let size = pict_size(fields[2]);
        let offset = fields[3]
            .trim_start_matches("offset")
            .parse::<usize>()
            .unwrap();
        let (storage, range) = aligned_fixture(offset, size, fields[6]);
        let bytes = &storage[range];
        let start_state = match fields[5] {
            "all_ones" => u32::MAX,
            "zero" => 0,
            "arbitrary" => 0x69a5_27c3,
            other => panic!("unknown state {other}"),
        };
        let expected_raw = independent_bitwise_update(start_state, bytes);
        let observed_raw = update_in_pict_partition(backend, start_state, bytes, fields[4]);
        assert_eq!(observed_raw, expected_raw, "PICT row {row}");
        if fields[1] == "finalized_digest" {
            assert_eq!(
                checksum_hardware_experiment::crc32c(backend, bytes),
                !independent_bitwise_update(u32::MAX, bytes),
                "PICT row {row}"
            );
        }
        rows += 1;
    }
    assert!(rows > 0, "generated PICT table must contain rows");
    eprintln!("PICT rows replayed: {rows}");
}

fn independent_bitwise_update(mut state: u32, bytes: &[u8]) -> u32 {
    for &byte in bytes {
        state ^= u32::from(byte);
        for _ in 0..8 {
            state = if state & 1 == 1 {
                (state >> 1) ^ 0x82f6_3b78
            } else {
                state >> 1
            };
        }
    }
    state
}

fn update_in_chunks(backend: Backend, mut state: u32, bytes: &[u8], chunk_size: usize) -> u32 {
    for chunk in bytes.chunks(chunk_size) {
        state = raw_update(backend, state, chunk);
    }
    state
}

fn patterned_bytes(len: usize) -> Vec<u8> {
    (0..len)
        .map(|index| (index.wrapping_mul(31) + 7) as u8)
        .collect()
}

fn aligned_slice(offset: usize, len: usize) -> (Vec<u8>, std::ops::Range<usize>) {
    let mut storage = vec![0; len + 15];
    let base = storage.as_ptr() as usize;
    let prefix = (offset + 8 - base % 8) % 8;
    for (index, byte) in storage.iter_mut().enumerate() {
        *byte = (index as u8).wrapping_mul(29).wrapping_add(11);
    }
    (storage, prefix..prefix + len)
}

fn pict_size(level: &str) -> usize {
    match level {
        "zero" => 0,
        "one" => 1,
        "tail3" => 3,
        "word" | "tail8" => 8,
        "tail7" => 7,
        "tail9" => 9,
        "boundary33" => 33,
        "boundary65" => 65,
        "boundary257" => 257,
        "block768" => 768,
        "page4096" => 4096,
        "long24576" => 24_576,
        other => panic!("unknown size {other}"),
    }
}

fn aligned_fixture(
    offset: usize,
    len: usize,
    byte_kind: &str,
) -> (Vec<u8>, std::ops::Range<usize>) {
    let mut storage = vec![0; len + 15];
    let prefix = (offset + 8 - storage.as_ptr() as usize % 8) % 8;
    for (index, byte) in storage.iter_mut().enumerate() {
        *byte = match byte_kind {
            "all_zero" => 0,
            "all_ff" => 0xff,
            "patterned" => (index as u8).wrapping_mul(29).wrapping_add(11),
            "byte_range" => index as u8,
            other => panic!("unknown bytes {other}"),
        };
    }
    (storage, prefix..prefix + len)
}

fn update_in_pict_partition(
    backend: Backend,
    mut state: u32,
    bytes: &[u8],
    partition: &str,
) -> u32 {
    match partition {
        "single" => raw_update(backend, state, bytes),
        "chunks997" => {
            for chunk in bytes.chunks(997) {
                state = raw_update(backend, state, chunk);
            }
            state
        }
        "chunks1" => {
            for chunk in bytes.chunks(1) {
                state = raw_update(backend, state, chunk);
            }
            state
        }
        "chunks7" => {
            for chunk in bytes.chunks(7) {
                state = raw_update(backend, state, chunk);
            }
            state
        }
        "chunks8" => {
            for chunk in bytes.chunks(8) {
                state = raw_update(backend, state, chunk);
            }
            state
        }
        "varied" => {
            let mut offset = 0;
            for width in [1, 8, 3, 997].into_iter().cycle() {
                if offset == bytes.len() {
                    break;
                }
                let end = (offset + width).min(bytes.len());
                state = raw_update(backend, state, &bytes[offset..end]);
                offset = end;
            }
            state
        }
        other => panic!("unknown partition {other}"),
    }
}
