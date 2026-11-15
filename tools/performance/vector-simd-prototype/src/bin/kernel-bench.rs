use std::hint::black_box;
use std::time::{Duration, Instant};

use vector_simd_prototype::{
    intrinsic_with_prepared_factors, intrinsic_with_prepared_query, prepare_factors, prepare_query,
    scalar_pairs_slp_with_prepared_factors, scalar_pairs_slp_with_prepared_query,
    scalar_pairs_with_prepared_factors, scalar_pairs_with_prepared_query, scalar_reference,
    scalar_with_prepared_query,
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

fn checksum_with_factors(
    candidates: &[Vec<f64>],
    factors: &[(f64, f64)],
    mut evaluate: impl FnMut(&[f64], (f64, f64)) -> Option<f64>,
) -> u64 {
    candidates
        .iter()
        .zip(factors)
        .fold(0_u64, |sum, (vector, factors)| {
            let bits = evaluate(vector, *factors)
                .expect("benchmark corpus has valid cosine distances")
                .to_bits();
            sum.rotate_left(7) ^ bits
        })
}

fn sample(
    candidates: &[Vec<f64>],
    expected: u64,
    mut evaluate: impl FnMut(&[f64]) -> Option<f64>,
) -> Duration {
    let start = Instant::now();
    let observed = black_box(checksum(candidates, &mut evaluate));
    let elapsed = start.elapsed();
    assert_eq!(
        observed, expected,
        "timed kernel changed the reference checksum"
    );
    elapsed
}

fn sample_with_factors(
    candidates: &[Vec<f64>],
    factors: &[(f64, f64)],
    expected: u64,
    mut evaluate: impl FnMut(&[f64], (f64, f64)) -> Option<f64>,
) -> Duration {
    let start = Instant::now();
    let observed = black_box(checksum_with_factors(candidates, factors, &mut evaluate));
    let elapsed = start.elapsed();
    assert_eq!(
        observed, expected,
        "timed kernel changed the reference checksum"
    );
    elapsed
}

fn report(label: &str, samples: &[Duration], checksum: u64) {
    let mut ordered = samples.to_vec();
    ordered.sort_unstable();
    let median = ordered[SAMPLES / 2];
    let per_sample = samples
        .iter()
        .map(|duration| format!("{:.1}", duration.as_nanos() as f64 / CANDIDATES as f64))
        .collect::<Vec<_>>()
        .join(",");
    println!(
        "{label}: ns_per_candidate_samples=[{per_sample}] median={:.1} checksum={checksum:016x}",
        median.as_nanos() as f64 / CANDIDATES as f64
    );
}

#[allow(clippy::too_many_lines)]
fn main() {
    for dimensions in [16, 128, 768, 2_048] {
        let (query, candidates) = vectors(dimensions);
        let prepared_query = prepare_query(&query).expect("valid query");
        let candidate_factors = candidates
            .iter()
            .map(|candidate| prepare_factors(candidate).expect("valid candidate"))
            .collect::<Vec<_>>();
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
        let scalar_pairs_cached_factors =
            checksum_with_factors(&candidates, &candidate_factors, |candidate, factors| {
                scalar_pairs_with_prepared_factors(candidate, factors, &prepared_query)
            });
        let intrinsic_cached_factors =
            checksum_with_factors(&candidates, &candidate_factors, |candidate, factors| {
                intrinsic_with_prepared_factors(candidate, factors, &prepared_query)
            });
        assert_eq!(
            scalar_pairs_cached_factors, reference,
            "scalar pair kernel drift at {dimensions} dimensions"
        );
        assert_eq!(
            intrinsic_cached_factors, reference,
            "intrinsic cached-factor kernel drift at {dimensions} dimensions"
        );

        println!("dimensions={dimensions} candidates={CANDIDATES} samples={SAMPLES}");
        let mut samples: [Vec<Duration>; 8] = std::array::from_fn(|_| Vec::with_capacity(SAMPLES));
        for round in 0..SAMPLES {
            for offset in 0..8 {
                match (round + offset) % 8 {
                    0 => samples[0].push(sample(&candidates, reference, |candidate| {
                        scalar_reference(black_box(candidate), black_box(&query))
                    })),
                    1 => samples[1].push(sample(&candidates, reference, |candidate| {
                        scalar_with_prepared_query(
                            black_box(candidate),
                            black_box(prepared_query.as_slice()),
                        )
                    })),
                    2 => samples[2].push(sample(&candidates, reference, |candidate| {
                        scalar_pairs_with_prepared_query(
                            black_box(candidate),
                            black_box(prepared_query.as_slice()),
                        )
                    })),
                    3 => samples[3].push(sample(&candidates, reference, |candidate| {
                        scalar_pairs_slp_with_prepared_query(
                            black_box(candidate),
                            black_box(prepared_query.as_slice()),
                        )
                    })),
                    4 => samples[4].push(sample(&candidates, reference, |candidate| {
                        intrinsic_with_prepared_query(
                            black_box(candidate),
                            black_box(prepared_query.as_slice()),
                        )
                    })),
                    5 => samples[5].push(sample_with_factors(
                        &candidates,
                        &candidate_factors,
                        reference,
                        |candidate, factors| {
                            scalar_pairs_with_prepared_factors(
                                black_box(candidate),
                                black_box(factors),
                                black_box(prepared_query.as_slice()),
                            )
                        },
                    )),
                    6 => samples[6].push(sample_with_factors(
                        &candidates,
                        &candidate_factors,
                        reference,
                        |candidate, factors| {
                            scalar_pairs_slp_with_prepared_factors(
                                black_box(candidate),
                                black_box(factors),
                                black_box(prepared_query.as_slice()),
                            )
                        },
                    )),
                    7 => samples[7].push(sample_with_factors(
                        &candidates,
                        &candidate_factors,
                        reference,
                        |candidate, factors| {
                            intrinsic_with_prepared_factors(
                                black_box(candidate),
                                black_box(factors),
                                black_box(prepared_query.as_slice()),
                            )
                        },
                    )),
                    _ => unreachable!("arm order is reduced modulo eight"),
                }
            }
        }
        for (label, durations) in [
            ("frozen-buffer-reference", &samples[0]),
            ("prepared-scalar-allocating", &samples[1]),
            ("scalar-pairs-factor-calculation", &samples[2]),
            ("scalar-pairs-slpsafe-factor-calculation", &samples[3]),
            ("neon-pairs-factor-calculation", &samples[4]),
            ("scalar-pairs-cached-factors", &samples[5]),
            ("scalar-pairs-slpsafe-cached-factors", &samples[6]),
            ("neon-pairs-cached-factors", &samples[7]),
        ] {
            report(label, durations, reference);
        }
    }
}
