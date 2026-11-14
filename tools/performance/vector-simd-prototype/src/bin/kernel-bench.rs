use std::hint::black_box;
use std::time::{Duration, Instant};

use vector_simd_prototype::{
    intrinsic_with_prepared_query, prepare_query, scalar_reference, scalar_with_prepared_query,
};

const CANDIDATES: usize = 4_096;
const SAMPLES: usize = 9;

fn vectors(dimensions: usize) -> (Vec<f64>, Vec<Vec<f64>>) {
    let query = (0..dimensions)
        .map(|index| {
            let value = i32::try_from((index * 19) % 101).expect("bounded index") - 50;
            f64::from(value)
        })
        .collect();
    let candidates = (0..CANDIDATES)
        .map(|document| {
            (0..dimensions)
                .map(|component| {
                    let value = i32::try_from((document * 17 + component * 13) % 127)
                        .expect("bounded component")
                        - 63;
                    f64::from(value)
                })
                .collect()
        })
        .collect();
    (query, candidates)
}

fn checksum(candidates: &[Vec<f64>], mut evaluate: impl FnMut(&[f64]) -> Option<f64>) -> u64 {
    candidates.iter().fold(0_u64, |sum, vector| {
        let bits = evaluate(vector)
            .expect("benchmark corpus has valid cosine distances")
            .to_bits();
        sum.rotate_left(7) ^ bits
    })
}

fn measure(label: &str, candidates: &[Vec<f64>], mut evaluate: impl FnMut(&[f64]) -> Option<f64>) {
    let mut samples = Vec::with_capacity(SAMPLES);
    let mut observed = 0_u64;
    for _ in 0..SAMPLES {
        let start = Instant::now();
        observed = black_box(checksum(candidates, &mut evaluate));
        samples.push(start.elapsed());
    }
    samples.sort_unstable();
    let median: Duration = samples[SAMPLES / 2];
    println!(
        "{label}: median={:.1}ns/candidate checksum={observed:016x}",
        median.as_nanos() as f64 / CANDIDATES as f64
    );
}

fn main() {
    for dimensions in [16, 768] {
        let (query, candidates) = vectors(dimensions);
        let prepared_query = prepare_query(&query).expect("valid query");
        let reference = checksum(&candidates, |candidate| scalar_reference(candidate, &query));
        let scalar = checksum(&candidates, |candidate| {
            scalar_with_prepared_query(candidate, &prepared_query)
        });
        let intrinsic = checksum(&candidates, |candidate| {
            intrinsic_with_prepared_query(candidate, &prepared_query)
        });
        assert_eq!(
            scalar, reference,
            "scalar kernel drift at {dimensions} dimensions"
        );
        assert_eq!(
            intrinsic, reference,
            "intrinsic kernel drift at {dimensions} dimensions"
        );

        println!("dimensions={dimensions} candidates={CANDIDATES} samples={SAMPLES}");
        measure("frozen-buffer-reference", &candidates, |candidate| {
            scalar_reference(candidate, &query)
        });
        measure("prepared-scalar-pairs", &candidates, |candidate| {
            scalar_with_prepared_query(candidate, &prepared_query)
        });
        measure("prepared-neon-intrinsics", &candidates, |candidate| {
            intrinsic_with_prepared_query(candidate, &prepared_query)
        });
    }
}
