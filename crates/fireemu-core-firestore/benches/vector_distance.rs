//! Micro-benchmark for a `find_nearest` query over stored vectors, for Euclidean and cosine.
//!
//! It times `run_query_with_stats` end to end: candidate selection, the distance of every
//! candidate to the query vector, and the top-k ranking. The distance is evaluated once per
//! candidate, so cosine's per-candidate work shows up directly in the median.

use std::collections::BTreeMap;
use std::hint::black_box;
use std::time::{Duration, Instant};

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_firestore::query::{DistanceMeasure, FindNearest, Query, QueryScope};
use fireemu_core_firestore::store::{FirestoreState, Write, WriteOp};
use fireemu_core_firestore::value::Value;
use fireemu_core_types::ids::{CollectionId, DatabaseId, ProjectId};
use fireemu_core_types::time::LogicalInstant;

const DOCUMENTS: usize = 4_000;
const OVERFLOW_DOCUMENTS: usize = 4_200;
const DIMENSIONS: [usize; 6] = [1, 2, 3, 16, 768, 2_048];
const LIMIT: u32 = 10;
const SAMPLES: usize = 11;
const CANDIDATE_CACHE_BYTES: usize = 8 * 1024 * 1024;
const CANDIDATE_CACHE_ROWS: usize = 4_096;
const CANDIDATE_ENTRY_ESTIMATE: usize = 128;

fn path(index: usize) -> DocumentPath {
    DocumentPath::parse(
        &ProjectId::try_new("demo-app").expect("project id"),
        &DatabaseId::default_database(),
        &format!("vectors/document-{index:05}"),
    )
    .expect("document path")
}

/// Deterministic components with mixed signs and magnitudes, so the norms are not trivial.
fn vector(index: usize, dimensions: usize) -> Vec<f64> {
    (0..dimensions)
        .map(|component| {
            let seed = u32::try_from((index * 31 + component * 17) % 997).expect("below 997");
            let sign = if seed % 2 == 0 { 1.0 } else { -1.0 };
            sign * (f64::from(seed) + 1.0) / 113.0
        })
        .collect()
}

fn seeded_state(documents: usize, dimensions: usize) -> FirestoreState {
    let writes: Vec<Write> = (0..documents)
        .map(|index| Write {
            op: WriteOp::Set {
                path: path(index),
                fields: BTreeMap::from([(
                    "embedding".to_owned(),
                    Value::Vector(vector(index, dimensions)),
                )]),
                update_mask: None,
            },
            precondition: None,
            transforms: Vec::new(),
        })
        .collect();
    let mut state = FirestoreState::new();
    for chunk in writes.chunks(500) {
        state
            .commit(chunk, None, LogicalInstant::UNIX_EPOCH)
            .expect("seed commit");
    }
    state
}

fn find_nearest(dimensions: usize, measure: DistanceMeasure) -> Query {
    Query::new(QueryScope::collection(
        None,
        CollectionId::try_new("vectors").expect("collection id"),
    ))
    .with_find_nearest(FindNearest {
        vector_field: FieldPath::parse("embedding").expect("field path"),
        query_vector: vector(usize::MAX - 7, dimensions),
        distance_measure: measure,
        limit: LIMIT,
        distance_result_field: Some(FieldPath::parse("distance").expect("distance field")),
        distance_threshold: None,
    })
}

fn assert_nearest_result(
    state: &FirestoreState,
    result: &[fireemu_core_firestore::store::Document],
    documents: usize,
    query: &Query,
) {
    let nearest = query.find_nearest.as_ref().expect("nearest query");
    let mut expected = (0..documents)
        .map(|index| {
            let document = state.get(&path(index)).expect("stored benchmark document");
            let Value::Vector(candidate) = &document.fields["embedding"] else {
                panic!("stored vector missing");
            };
            (
                document.path.document_id().as_str().to_owned(),
                fireemu_core_firestore::store::vector_distance(
                    candidate,
                    &nearest.query_vector,
                    nearest.distance_measure,
                )
                .expect("finite reference distance"),
            )
        })
        .collect::<Vec<_>>();
    expected.sort_unstable_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .expect("finite distances")
            .then_with(|| left.0.cmp(&right.0))
    });
    assert_eq!(result.len(), usize::try_from(LIMIT).unwrap());
    for (document, (expected_id, expected_distance)) in result.iter().zip(expected.iter()) {
        assert_eq!(document.path.document_id().as_str(), expected_id);
        let Value::Double(actual_distance) = document.fields["distance"] else {
            panic!("distance result field missing");
        };
        assert_eq!(actual_distance.to_bits(), expected_distance.to_bits());
    }
}

#[allow(clippy::too_many_lines)]
fn main() {
    for dimensions in DIMENSIONS {
        let state = seeded_state(DOCUMENTS, dimensions);
        for (name, measure) in [
            ("euclidean", DistanceMeasure::Euclidean),
            ("cosine", DistanceMeasure::Cosine),
        ] {
            let query = find_nearest(dimensions, measure);
            if measure == DistanceMeasure::Cosine {
                let started = Instant::now();
                let cold = state
                    .run_query_with_stats(black_box(&query), None)
                    .expect("cold measured query");
                println!(
                    "find_nearest phase=cold measure={name} documents={DOCUMENTS} dimensions={dimensions} limit={LIMIT} elapsed={:.3}ms",
                    duration_ms(started.elapsed()),
                );
                assert_nearest_result(&state, &cold.0, DOCUMENTS, &query);
                black_box(cold);
            }
            let mut samples = Vec::with_capacity(SAMPLES);
            for _ in 0..SAMPLES {
                let started = Instant::now();
                let result = state
                    .run_query_with_stats(black_box(&query), None)
                    .expect("measured query");
                samples.push(started.elapsed());
                assert_nearest_result(&state, &result.0, DOCUMENTS, &query);
                assert_eq!(result.0.len(), LIMIT as usize);
                black_box(result);
            }
            samples.sort_unstable();
            println!(
                "find_nearest phase=warm measure={name} documents={DOCUMENTS} dimensions={dimensions} limit={LIMIT} samples={SAMPLES} min={:.3}ms median={:.3}ms",
                duration_ms(samples[0]),
                duration_ms(samples[SAMPLES / 2]),
            );
            if measure == DistanceMeasure::Cosine {
                let write = Write {
                    op: WriteOp::Set {
                        path: path(0),
                        fields: BTreeMap::from([(
                            "embedding".to_owned(),
                            Value::Vector(vector(1, dimensions)),
                        )]),
                        update_mask: None,
                    },
                    precondition: None,
                    transforms: Vec::new(),
                };
                let mut after_write = state.clone();
                after_write
                    .commit(
                        std::slice::from_ref(&write),
                        None,
                        LogicalInstant::from_unix_seconds(1),
                    )
                    .expect("write before query");
                let started = Instant::now();
                let changed = after_write
                    .run_query_with_stats(black_box(&query), None)
                    .expect("query after write");
                println!(
                    "find_nearest phase=after-write measure={name} documents={DOCUMENTS} dimensions={dimensions} limit={LIMIT} elapsed={:.3}ms",
                    duration_ms(started.elapsed()),
                );
                assert_nearest_result(&after_write, &changed.0, DOCUMENTS, &query);
                black_box(changed);

                let mut samples = Vec::with_capacity(5);
                for _ in 0..5 {
                    let mut changed_state = state.clone();
                    let started = Instant::now();
                    changed_state
                        .commit(
                            black_box(std::slice::from_ref(&write)),
                            None,
                            LogicalInstant::from_unix_seconds(1),
                        )
                        .expect("write in measured interval");
                    let result = changed_state
                        .run_query_with_stats(black_box(&query), None)
                        .expect("query in measured interval");
                    samples.push(started.elapsed());
                    assert_nearest_result(&changed_state, &result.0, DOCUMENTS, &query);
                    black_box(result);
                }
                samples.sort_unstable();
                println!(
                    "find_nearest phase=write-plus-query measure={name} documents={DOCUMENTS} dimensions={dimensions} samples=5 median={:.3}ms",
                    duration_ms(samples[2]),
                );
                benchmark_candidate_variants(dimensions, DOCUMENTS);
            }
        }
    }

    let overflow = seeded_state(OVERFLOW_DOCUMENTS, 16);
    let query = find_nearest(16, DistanceMeasure::Cosine);
    let started = Instant::now();
    let cold = overflow
        .run_query_with_stats(&query, None)
        .expect("over-cap cold query");
    println!(
        "find_nearest phase=over-cap-cold documents={OVERFLOW_DOCUMENTS} dimensions=16 cache_rows={CANDIDATE_CACHE_ROWS} uncached_rows={} elapsed={:.3}ms",
        OVERFLOW_DOCUMENTS - CANDIDATE_CACHE_ROWS,
        duration_ms(started.elapsed()),
    );
    assert_nearest_result(&overflow, &cold.0, OVERFLOW_DOCUMENTS, &query);
    let mut samples = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let started = Instant::now();
        let result = overflow
            .run_query_with_stats(black_box(&query), None)
            .expect("over-cap warm query");
        samples.push(started.elapsed());
        assert_nearest_result(&overflow, &result.0, OVERFLOW_DOCUMENTS, &query);
        black_box(result);
    }
    samples.sort_unstable();
    println!(
        "find_nearest phase=over-cap-warm documents={OVERFLOW_DOCUMENTS} dimensions=16 cache_rows={CANDIDATE_CACHE_ROWS} uncached_rows={} samples={SAMPLES} median={:.3}ms",
        OVERFLOW_DOCUMENTS - CANDIDATE_CACHE_ROWS,
        duration_ms(samples[SAMPLES / 2]),
    );
}

#[derive(Clone)]
enum CandidatePayload {
    Factors((f64, f64)),
    Components(Vec<f64>),
}

fn normalization_factors(values: &[f64]) -> Option<(f64, f64)> {
    let mut scale = 0.0_f64;
    for value in values {
        if !value.is_finite() {
            return None;
        }
        scale = f64::max(scale, value.abs());
    }
    if scale == 0.0 {
        return None;
    }
    let norm = values
        .iter()
        .map(|value| {
            let scaled = value / scale;
            scaled * scaled
        })
        .sum::<f64>()
        .sqrt();
    (norm.is_finite() && norm != 0.0).then_some((scale, norm))
}

fn normalized_components(values: &[f64]) -> Option<Vec<f64>> {
    let factors = normalization_factors(values)?;
    values
        .iter()
        .map(|value| {
            let component = (*value / factors.0) / factors.1;
            component.is_finite().then_some(component)
        })
        .collect()
}

fn candidate_distance_factors(
    vector: &[f64],
    factors: (f64, f64),
    query: &[f64],
    paired: bool,
) -> Option<f64> {
    if vector.len() != query.len() {
        return None;
    }
    let component = |value: f64| {
        let value = (value / factors.0) / factors.1;
        value.is_finite().then_some(value)
    };
    let mut dot = 0.0;
    if paired {
        for (left, right) in vector.chunks_exact(2).zip(query.chunks_exact(2)) {
            let normalized = [component(left[0])?, component(left[1])?];
            let products = [normalized[0] * right[0], normalized[1] * right[1]];
            for product in products {
                if !product.is_finite() {
                    return None;
                }
                dot += product;
                if !dot.is_finite() {
                    return None;
                }
            }
        }
        if vector.len() % 2 == 1 {
            let index = vector.len() - 1;
            let product = component(vector[index])? * query[index];
            if !product.is_finite() {
                return None;
            }
            dot += product;
            if !dot.is_finite() {
                return None;
            }
        }
    } else {
        for (value, query) in vector.iter().zip(query) {
            let product = component(*value)? * query;
            if !product.is_finite() {
                return None;
            }
            dot += product;
            if !dot.is_finite() {
                return None;
            }
        }
    }
    Some((1.0 - dot.clamp(-1.0, 1.0)).clamp(0.0, 2.0))
}

fn candidate_distance_components(left: &[f64], right: &[f64]) -> Option<f64> {
    if left.len() != right.len() {
        return None;
    }
    let mut dot = 0.0;
    for (left, right) in left.iter().zip(right) {
        let product = left * right;
        if !product.is_finite() {
            return None;
        }
        dot += product;
        if !dot.is_finite() {
            return None;
        }
    }
    Some((1.0 - dot.clamp(-1.0, 1.0)).clamp(0.0, 2.0))
}

fn build_candidate_cache(
    candidates: &[Vec<f64>],
    dimensions: usize,
    components: bool,
) -> (Vec<CandidatePayload>, usize) {
    let mut entries = Vec::new();
    let mut bytes = 0usize;
    for candidate in candidates {
        // Match the production cache's conservative DocumentPath clone charge for this
        // fixed-depth benchmark path; allocator metadata remains outside the estimate.
        let path_bytes = 64_usize
            .saturating_add(7 * std::mem::size_of::<String>())
            .saturating_add(std::mem::size_of::<(String, String)>());
        let payload_bytes = if components {
            dimensions.saturating_mul(std::mem::size_of::<f64>())
        } else {
            std::mem::size_of::<(f64, f64)>()
        };
        let charge = CANDIDATE_ENTRY_ESTIMATE
            .saturating_add(path_bytes)
            .saturating_add(payload_bytes);
        if entries.len() == CANDIDATE_CACHE_ROWS
            || bytes.saturating_add(charge) > CANDIDATE_CACHE_BYTES
        {
            break;
        }
        let payload = if components {
            CandidatePayload::Components(normalized_components(candidate).expect("finite vector"))
        } else {
            CandidatePayload::Factors(normalization_factors(candidate).expect("finite vector"))
        };
        bytes = bytes.saturating_add(charge);
        entries.push(payload);
    }
    (entries, bytes)
}

fn candidate_variant_results(
    candidates: &[Vec<f64>],
    query: &[f64],
    cache: &[CandidatePayload],
    components: bool,
    paired: bool,
) -> Vec<u64> {
    candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| {
            let distance = if index < cache.len() {
                match &cache[index] {
                    CandidatePayload::Factors(factors) => {
                        candidate_distance_factors(candidate, *factors, query, paired)
                    }
                    CandidatePayload::Components(values) if components => {
                        candidate_distance_components(values, query)
                    }
                    CandidatePayload::Components(_) => unreachable!("cache mode mismatch"),
                }
            } else {
                let factors = normalization_factors(candidate)?;
                candidate_distance_factors(candidate, factors, query, paired)
            };
            distance.map(f64::to_bits)
        })
        .map(Option::unwrap_or_default)
        .collect()
}

fn candidate_variant_cold(
    candidates: &[Vec<f64>],
    query: &[f64],
    dimensions: usize,
    components: bool,
    paired: bool,
) -> (Vec<u64>, usize, usize) {
    let (cache, bytes) = build_candidate_cache(candidates, dimensions, components);
    let results = candidate_variant_results(candidates, query, &cache, components, paired);
    (results, cache.len(), bytes)
}

fn benchmark_candidate_variants(dimensions: usize, documents: usize) {
    let candidates = (0..documents)
        .map(|index| vector(index, dimensions))
        .collect::<Vec<_>>();
    let query = normalized_components(&vector(usize::MAX - 7, dimensions)).expect("query vector");
    let reference = candidates
        .iter()
        .map(|candidate| {
            fireemu_core_firestore::store::vector_distance(
                black_box(candidate),
                &vector(usize::MAX - 7, dimensions),
                DistanceMeasure::Cosine,
            )
            .expect("reference distance")
            .to_bits()
        })
        .collect::<Vec<_>>();

    let mut query_samples = Vec::with_capacity(SAMPLES);
    let query_only = candidates
        .iter()
        .map(|candidate| {
            let factors = normalization_factors(candidate).expect("finite candidate");
            candidate_distance_factors(candidate, factors, &query, false)
                .expect("finite distance")
                .to_bits()
        })
        .collect::<Vec<_>>();
    assert_eq!(query_only, reference, "query-cache-only bits changed");
    for _ in 0..SAMPLES {
        let started = Instant::now();
        let results = candidates
            .iter()
            .map(|candidate| {
                let factors = normalization_factors(candidate).expect("finite candidate");
                candidate_distance_factors(candidate, factors, &query, false)
                    .expect("finite distance")
                    .to_bits()
            })
            .collect::<Vec<_>>();
        query_samples.push(started.elapsed());
        black_box(results);
    }
    query_samples.sort_unstable();
    println!(
        "candidate-arithmetic mode=query-components-only documents={documents} dimensions={dimensions} median={:.3}ms",
        duration_ms(query_samples[SAMPLES / 2]),
    );

    for (name, use_components, paired) in [
        ("factor-cache", false, false),
        ("component-cache", true, false),
        ("factor-cache-paired", false, true),
    ] {
        let mut cold_samples = Vec::with_capacity(SAMPLES);
        let mut metadata = None;
        for _ in 0..SAMPLES {
            let started = Instant::now();
            let (cold, current_admitted, current_bytes) =
                candidate_variant_cold(&candidates, &query, dimensions, use_components, paired);
            cold_samples.push(started.elapsed());
            assert_eq!(cold, reference, "{name} cold bits changed");
            metadata = Some((current_admitted, current_bytes));
            black_box(cold);
        }
        cold_samples.sort_unstable();
        let (admitted, bytes) = metadata.expect("at least one cache sample");
        let (cache, _) = build_candidate_cache(&candidates, dimensions, use_components);
        let mut warm_samples = Vec::with_capacity(SAMPLES);
        for _ in 0..SAMPLES {
            let started = Instant::now();
            let results =
                candidate_variant_results(&candidates, &query, &cache, use_components, paired);
            warm_samples.push(started.elapsed());
            assert_eq!(results, reference, "{name} warm bits changed");
            black_box(results);
        }
        warm_samples.sort_unstable();
        println!(
            "candidate-arithmetic mode={name} documents={documents} dimensions={dimensions} admitted={admitted} retained_estimated_bytes={bytes} cap_bytes={CANDIDATE_CACHE_BYTES} cold_median={:.3}ms warm_median={:.3}ms",
            duration_ms(cold_samples[SAMPLES / 2]),
            duration_ms(warm_samples[SAMPLES / 2]),
        );
    }
}

fn duration_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}
