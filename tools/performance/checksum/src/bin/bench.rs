use std::hint::black_box;
use std::time::Instant;

use checksum_hardware_experiment::{
    object_digests, object_digests_chunks_997, object_digests_chunks_997_from_raw_state,
    object_digests_from_raw_state, raw_update, selection, Backend,
};

const SIZES: [usize; 7] = [0, 7, 8, 64, 4096, 1024 * 1024, 30 * 1024 * 1024];
const SAMPLES: usize = 11;

fn main() {
    println!("record_type\tbackend\tpath\tworkload\tbytes\tpartition\tsample\titerations\tnanoseconds\tcrc32c\tmd5_hex");
    for size in SIZES {
        let bytes = patterned_bytes(size);
        for sample in 0..SAMPLES {
            for backend in rotated_backends(size.wrapping_add(sample)) {
                measure(
                    backend,
                    &bytes,
                    "crc32c",
                    "one_shot",
                    sample,
                    iterations(size),
                );
                measure(
                    backend,
                    &bytes,
                    "crc32c",
                    "chunks_997",
                    sample,
                    iterations(size),
                );
                measure(
                    backend,
                    &bytes,
                    "object_digests",
                    "one_shot",
                    sample,
                    iterations(size),
                );
                measure(
                    backend,
                    &bytes,
                    "object_digests",
                    "chunks_997",
                    sample,
                    iterations(size),
                );
            }
        }
    }
    eprintln!("hardware_feature={}", selected_feature());
}

fn measure(
    backend: Backend,
    bytes: &[u8],
    workload: &str,
    partition: &str,
    sample: usize,
    iters: usize,
) {
    let expected = object_digests(Backend::Scalar, bytes);
    let warmup_one_shot = object_digests(backend, bytes);
    let warmup_chunked = object_digests_chunks_997(backend, bytes);
    assert_eq!(
        warmup_one_shot,
        expected,
        "preflight one-shot mismatch for {}",
        backend.label()
    );
    assert_eq!(
        warmup_chunked,
        expected,
        "preflight chunked mismatch for {}",
        backend.label()
    );
    let selector = selection(backend);
    let start = Instant::now();
    let mut observed_crc = 0;
    let mut observed_md5 = [0; 16];
    for _ in 0..iters {
        match (workload, partition) {
            ("crc32c", "one_shot") => {
                observed_crc = !raw_update(backend, black_box(u32::MAX), black_box(bytes));
                black_box(observed_crc);
            }
            ("crc32c", "chunks_997") => {
                let mut state = black_box(u32::MAX);
                for chunk in black_box(bytes).chunks(997) {
                    state = raw_update(backend, state, chunk);
                }
                observed_crc = !state;
                black_box(observed_crc);
            }
            ("object_digests", "one_shot") => {
                (observed_md5, observed_crc) =
                    object_digests_from_raw_state(backend, black_box(bytes), black_box(u32::MAX));
                black_box((observed_md5, observed_crc));
            }
            ("object_digests", "chunks_997") => {
                (observed_md5, observed_crc) = object_digests_chunks_997_from_raw_state(
                    backend,
                    black_box(bytes),
                    black_box(u32::MAX),
                );
                black_box((observed_md5, observed_crc));
            }
            _ => unreachable!(),
        }
    }
    let elapsed = start.elapsed().as_nanos();
    assert_eq!(
        observed_crc,
        expected.1,
        "checksum mismatch for {} {} {} bytes",
        backend.label(),
        workload,
        bytes.len()
    );
    if workload == "object_digests" {
        assert_eq!(
            observed_md5,
            expected.0,
            "MD5 mismatch for {} {} bytes",
            backend.label(),
            bytes.len()
        );
    }
    let md5_hex = if workload == "object_digests" {
        to_hex(&observed_md5)
    } else {
        String::from("-")
    };
    println!(
        "sample\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{:08x}\t{}",
        backend.label(),
        selector.path,
        workload,
        bytes.len(),
        partition,
        sample,
        iters,
        elapsed,
        observed_crc,
        md5_hex
    );
}

fn iterations(size: usize) -> usize {
    match size {
        0..=64 => 20_000,
        4096 => 1_000,
        1_048_576 => 30,
        _ => 3,
    }
}

fn rotated_backends(size: usize) -> [Backend; 4] {
    let backends = Backend::ALL;
    let offset = size % backends.len();
    [
        backends[offset],
        backends[(offset + 1) % 4],
        backends[(offset + 2) % 4],
        backends[(offset + 3) % 4],
    ]
}

fn patterned_bytes(len: usize) -> Vec<u8> {
    (0..len)
        .map(|index| (index.wrapping_mul(31) + 7) as u8)
        .collect()
}

fn selected_feature() -> &'static str {
    selection(Backend::RustIntrinsic).path
}

fn to_hex(bytes: &[u8]) -> String {
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut result, "{byte:02x}").expect("writing into String cannot fail");
    }
    result
}
