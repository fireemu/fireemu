use super::*;
use proptest::prelude::*;

// Frozen from 76e22cb9e: never call the optimized helpers from this reference.
mod reference {
    use super::DistanceMeasure;
    fn scaled_norm(values: &[f64]) -> Option<f64> {
        let mut scale = 0.0;
        let mut sum = 0.0;
        for value in values {
            if !value.is_finite() {
                return None;
            }
            let absolute = value.abs();
            if absolute == 0.0 {
                continue;
            }
            if scale == 0.0 {
                scale = absolute;
                sum = 1.0;
            } else if absolute > scale {
                let ratio = scale / absolute;
                sum = 1.0 + sum * ratio * ratio;
                scale = absolute;
            } else {
                let ratio = absolute / scale;
                sum += ratio * ratio;
            }
            if !sum.is_finite() {
                return None;
            }
        }
        let norm = scale * sum.sqrt();
        norm.is_finite().then_some(norm)
    }

    fn normalized_components(values: &[f64]) -> Option<Vec<f64>> {
        if values.iter().any(|value| !value.is_finite()) {
            return None;
        }
        let scale = values.iter().map(|value| value.abs()).fold(0.0, f64::max);
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
        if !norm.is_finite() || norm == 0.0 {
            return None;
        }
        values
            .iter()
            .map(|value| {
                let component = (value / scale) / norm;
                component.is_finite().then_some(component)
            })
            .collect()
    }

    fn checked_dot(left: &[f64], right: &[f64]) -> Option<f64> {
        let mut dot = 0.0;
        for (left, right) in left.iter().zip(right) {
            if !left.is_finite() || !right.is_finite() {
                return None;
            }
            let product = left * right;
            if !product.is_finite() {
                return None;
            }
            dot += product;
            if !dot.is_finite() {
                return None;
            }
        }
        Some(dot)
    }

    pub(super) fn vector_distance(
        vector: &[f64],
        query: &[f64],
        measure: DistanceMeasure,
    ) -> Option<f64> {
        if vector.len() != query.len() {
            return None;
        }
        match measure {
            DistanceMeasure::Euclidean => {
                let differences: Option<Vec<f64>> = vector
                    .iter()
                    .zip(query)
                    .map(|(left, right)| {
                        let difference = left - right;
                        difference.is_finite().then_some(difference)
                    })
                    .collect();
                scaled_norm(&differences?)
            }
            DistanceMeasure::Cosine => {
                let left = normalized_components(vector)?;
                let right = normalized_components(query)?;
                let similarity = checked_dot(&left, &right)?;
                Some((1.0 - similarity.clamp(-1.0, 1.0)).clamp(0.0, 2.0))
            }
            DistanceMeasure::DotProduct => checked_dot(vector, query),
        }
    }
}

fn check(left: &[f64], right: &[f64]) {
    for measure in [
        DistanceMeasure::Euclidean,
        DistanceMeasure::Cosine,
        DistanceMeasure::DotProduct,
    ] {
        assert_eq!(
            PreparedVectorDistance::new(right, measure).evaluate(left).map(f64::to_bits),
            reference::vector_distance(left, right, measure).map(f64::to_bits),
            "prepared left={left:?}, right={right:?}, measure={measure:?}"
        );
        assert_eq!(
            vector_distance(left, right, measure).map(f64::to_bits),
            reference::vector_distance(left, right, measure).map(f64::to_bits),
            "left={left:?}, right={right:?}, measure={measure:?}"
        );
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]
    #[test]
    fn vector_bits_match_frozen_reference(pairs in prop::collection::vec((any::<u64>(), any::<u64>()), 0..129)) {
        let left: Vec<_> = pairs.iter().map(|(a, _)| f64::from_bits(*a)).collect();
        let right: Vec<_> = pairs.iter().map(|(_, b)| f64::from_bits(*b)).collect();
        check(&left, &right);
        check(&left, &left);
        let finite: Vec<_> = pairs.iter().map(|(a, _)| f64::from_bits(*a & 0xffef_ffff_ffff_ffff)).collect();
        check(&finite, &vec![0.0; finite.len()]);
        let dense: Vec<_> = pairs.iter().map(|(a, _)| f64::from_bits((a & 0x800f_ffff_ffff_ffff) | 0x3ff0_0000_0000_0000)).collect();
        check(&dense, &vec![0.5; dense.len()]);
        let mut longer = right.clone(); longer.push(f64::MAX);
        check(&left, &longer);
    }

    #[test]
    fn prepared_cosine_matches_frozen_reference_for_arbitrary_f64_bits(
        pairs in prop::collection::vec((any::<u64>(), any::<u64>()), 0..129),
    ) {
        let left: Vec<_> = pairs.iter().map(|(a, _)| f64::from_bits(*a)).collect();
        let right: Vec<_> = pairs.iter().map(|(_, b)| f64::from_bits(*b)).collect();
        prop_assert_eq!(
            PreparedVectorDistance::new(&right, DistanceMeasure::Cosine)
                .evaluate(&left)
                .map(f64::to_bits),
            reference::vector_distance(&left, &right, DistanceMeasure::Cosine)
                .map(f64::to_bits),
        );
    }
}

#[test]
fn vector_extremes_match_frozen_reference() {
    let cases = [
        vec![],
        vec![0.0, -0.0],
        vec![f64::MAX; 2],
        vec![f64::from_bits(1), f64::MIN_POSITIVE],
        vec![1e-300, 1.0, 1e300],
        vec![1e300, 1.0, 1e-300],
        vec![3.0, 3.0, 3.0],
        vec![f64::NAN, 1.0],
        vec![1.0, f64::INFINITY],
        vec![f64::NEG_INFINITY, 1.0],
        vec![1.000_000_000_000_000_2, 1.0],
        vec![f64::MIN_POSITIVE; 2048],
    ];
    for left in &cases {
        check(left, left);
        check(left, &vec![0.0; left.len()]);
        check(left, &left.iter().map(|x| -*x).collect::<Vec<_>>());
        for right in &cases {
            check(left, right);
        }
    }
    check(&[f64::MAX, 1.0], &[-f64::MAX, 1.0]);
    check(&[1.0, f64::MAX], &[1.0, -f64::MAX]);
    check(&[f64::MAX], &[-f64::MAX, 0.0]);
}

#[test]
fn vector_streaming_norm_accepts_an_iterator() {
    assert_eq!(
        scaled_norm([3.0, 4.0].into_iter()).map(f64::to_bits),
        Some(5.0f64.to_bits())
    );
}

#[test]
fn prepared_cosine_query_normalizes_query_components_once_for_many_candidates() {
    NORMALIZED_COMPONENT_CALLS.with(|calls| calls.set(0));
    let query = [1.0, -2.0, 4.0];
    let prepared = PreparedVectorDistance::new(&query, DistanceMeasure::Cosine);
    for candidate in [[3.0, 2.0, -1.0], [-1.0, 0.5, 8.0], [0.25, -4.0, 2.0]] {
        assert!(prepared.evaluate(&candidate).is_some());
    }

    // Three query components are normalized once, then each candidate normalizes its own
    // components once. The old path normalized query components again for every candidate.
    NORMALIZED_COMPONENT_CALLS.with(|calls| assert_eq!(calls.get(), 12));
}

#[test]
fn prepared_cosine_uses_independent_component_pairs_and_keeps_scalar_results() {
    let query = [1.0, -2.0, 4.0, -8.0, 16.0];
    let prepared = PreparedVectorDistance::new(&query, DistanceMeasure::Cosine);
    let candidates = [
        [3.0, 2.0, -1.0, 6.0, 0.5],
        [-1.0, 0.5, 8.0, -2.0, 4.0],
        [0.25, -4.0, 2.0, 1.0, -7.0],
    ];
    PAIRED_COSINE_LANES.with(|lanes| lanes.set(0));
    for candidate in candidates {
        assert_eq!(
            prepared.evaluate(&candidate).map(f64::to_bits),
            reference::vector_distance(&candidate, &query, DistanceMeasure::Cosine)
                .map(f64::to_bits),
        );
    }
    PAIRED_COSINE_LANES.with(|lanes| assert_eq!(lanes.get(), 6));
}

#[test]
fn generated_pict_cases_exercise_store_lifecycle_and_match_frozen_nearest_results() {
    const CASES: &str = "dataset\tcache_state\tread_version\tlifecycle\tvector_case\twidth\n\
small\twarm\tlatest\tunchanged\tnormal\tat-threshold\n\
small\tcold\tlatest\tunchanged\tnormal\tbelow-threshold\n\
small\twarm\tlatest\tunchanged\tnormal\tbelow-threshold\n\
small\tcold\tlatest\tunchanged\tnormal\tat-threshold\n\
small\tcold\tlatest\tunchanged\tnormal\tabove-threshold\n\
over-cap\twarm\tlatest\tunchanged\tnormal\tbelow-threshold\n\
over-cap\twarm\tlatest\tunchanged\tnormal\tat-threshold\n\
small\tcold\thistorical\tunchanged\tnormal\tat-threshold\n\
small\twarm\tlatest\tchanged-commit\tnormal\tat-threshold\n\
small\twarm\thistorical\timport\tnormal\tat-threshold\n\
small\twarm\tlatest\trefused-write\tnormal\tat-threshold\n\
small\twarm\tlatest\tclone-divergence\tnormal\tat-threshold\n\
small\tcold\tlatest\tunchanged\tzero-candidate\tat-threshold\n\
small\twarm\tlatest\tunchanged\tzero-candidate\tat-threshold\n\
small\tcold\tlatest\tunchanged\tzero-query\tat-threshold\n\
small\twarm\tlatest\tunchanged\tzero-query\tat-threshold\n\
small\tcold\thistorical\tchanged-commit\tzero-candidate\tat-threshold\n\
small\tcold\thistorical\trefused-write\tzero-candidate\tat-threshold\n\
over-cap\twarm\thistorical\tchanged-commit\tzero-query\tat-threshold\n\
over-cap\twarm\thistorical\tunchanged\tzero-candidate\tbelow-threshold\n\
over-cap\twarm\thistorical\tunchanged\tzero-candidate\tabove-threshold\n\
small\tcold\tlatest\timport\tzero-query\tat-threshold\n\
over-cap\twarm\thistorical\timport\tzero-candidate\tat-threshold\n\
small\twarm\tlatest\tunchanged\tzero-query\tbelow-threshold\n\
small\tcold\thistorical\trefused-write\tzero-query\tat-threshold\n\
small\tcold\thistorical\tunchanged\tzero-query\tabove-threshold\n\
over-cap\twarm\tlatest\trefused-write\tnormal\tat-threshold";

    let cases = CASES.lines().collect::<Vec<_>>();
    assert_eq!(cases.len(), 28);
    for case in cases.into_iter().skip(1) {
        let fields = case.split('\t').collect::<Vec<_>>();
        assert_eq!(fields.len(), 6, "PICT row {case}");
        run_generated_pict_case(fields.try_into().unwrap_or_else(|_| panic!("PICT row {case}")));
    }
}

#[allow(clippy::too_many_lines)]
fn run_generated_pict_case(
    [dataset, cache_state, read_version, lifecycle, vector_case, width]: [&str; 6],
) {
    let dimensions = match width {
        "below-threshold" => CANDIDATE_NORMALIZATION_MIN_DIMENSIONS - 1,
        "at-threshold" => CANDIDATE_NORMALIZATION_MIN_DIMENSIONS,
        "above-threshold" => CANDIDATE_NORMALIZATION_MIN_DIMENSIONS + 1,
        _ => panic!("unsupported cache eligibility width {width}"),
    };
    let document_count = if dataset == "over-cap" { 4_200 } else { 5 };
    let mut vectors = (0..document_count)
        .map(|index| {
            let id = format!("pict-{index:04}");
            let value = if vector_case == "zero-candidate" && index == document_count - 1 {
                vec![0.0; dimensions]
            } else {
                let base = f64::from(u32::try_from(index % 97).unwrap()) + 1.0;
                (0..dimensions)
                    .map(|component| {
                        let offset = f64::from(u32::try_from(component % 17).unwrap()) / 19.0;
                        base + offset
                    })
                    .collect()
            };
            (id, value)
        })
        .collect::<Vec<_>>();
    let initial_writes = vectors
        .iter()
        .map(|(id, vector)| candidate_cache_write_unpadded(id, vector.clone()))
        .collect::<Vec<_>>();
    let mut state = FirestoreState::new();
    let initial_version = state
        .commit(&initial_writes, None, LogicalInstant::UNIX_EPOCH)
        .unwrap()
        .version;
    let initial_vectors = vectors.clone();
    let query_vector = if vector_case == "zero-query" {
        vec![0.0; dimensions]
    } else {
        (0..dimensions)
            .map(|component| match component {
                0 => 1.0,
                1 => 2.0,
                2 => 3.0,
                _ => 0.0,
            })
            .collect()
    };
    let mut query = candidate_cache_query_unpadded(query_vector.clone());
    if vector_case == "zero-candidate" {
        // The emulator profile skips invalid candidates, allowing exact ranking checks for the
        // remaining documents while strict-profile rejection remains covered by a separate test.
        query.production_refusals = false;
    }

    if cache_state == "warm" {
        let warmup_vector = (0..dimensions)
            .map(|component| match component {
                0 => 1.0,
                1 => 2.0,
                2 => 3.0,
                _ => 0.0,
            })
            .collect();
        let mut warmup = candidate_cache_query_unpadded(warmup_vector);
        if vector_case == "zero-candidate" {
            warmup.production_refusals = false;
        }
        state.run_query(&warmup, None).unwrap();
        assert_eq!(
            state.candidate_normalization_cache.get().is_some(),
            candidate_normalization_cache_eligible(dimensions),
        );
    } else {
        assert!(state.candidate_normalization_cache.get().is_none());
    }
    let original_slot = state.candidate_normalization_cache.get().cloned();

    match lifecycle {
        "unchanged" => {
            let (id, vector) = &vectors[0];
            state
                .commit(
                    &[candidate_cache_write(id, vector.clone())],
                    None,
                    LogicalInstant::from_unix_seconds(1),
                )
                .unwrap();
            assert_eq!(
                state.candidate_normalization_cache.get().is_some(),
                cache_state == "warm" && candidate_normalization_cache_eligible(dimensions),
                "PICT row dataset={dataset}, cache={cache_state}, width={width}, vector_case={vector_case}",
            );
        }
        "changed-commit" => {
            vectors[0].1 = vec![-5.0, 2.0, 3.0];
            state
                .commit(
                    &[candidate_cache_write_unpadded(&vectors[0].0, {
                        let mut vector = vectors[0].1.clone();
                        vector.resize(dimensions, 0.0);
                        vector
                    })],
                    None,
                    LogicalInstant::from_unix_seconds(1),
                )
                .unwrap();
            assert!(state.candidate_normalization_cache.get().is_none());
        }
        "import" => {
            vectors[1].1 = vec![-7.0, 2.0, 3.0];
            state
                .import_documents(
                    vec![ImportedDocument {
                        path: candidate_cache_path(&vectors[1].0),
                        fields: BTreeMap::from([(
                            "embedding".to_owned(),
                            Value::Vector({
                                let mut vector = vectors[1].1.clone();
                                vector.resize(dimensions, 0.0);
                                vector
                            }),
                        )]),
                        create_time: None,
                        update_time: None,
                    }],
                    LogicalInstant::from_unix_seconds(1),
                )
                .unwrap();
            assert!(state.candidate_normalization_cache.get().is_none());
        }
        "refused-write" => {
            let refused = Write {
                op: WriteOp::Verify { path: candidate_cache_path("missing") },
                precondition: Some(Precondition::Exists(true)),
                transforms: Vec::new(),
            };
            assert!(state
                .commit(&[refused], None, LogicalInstant::from_unix_seconds(1))
                .is_err());
            assert_cache_slot_unchanged(&state, original_slot.as_ref());
        }
        "clone-divergence" => {
            assert_eq!(dataset, "small");
            assert_eq!(cache_state, "warm");
            assert_eq!(read_version, "latest");
            assert_eq!(vector_case, "normal");
            assert_eq!(width, "at-threshold");
            let mut left = state.clone();
            let mut right = state;
            let left_vector = candidate_cache_test_vector(vec![7.0, -1.0, 2.0]);
            let right_vector = candidate_cache_test_vector(vec![-4.0, 6.0, 1.0]);
            left.commit(
                &[candidate_cache_write(&vectors[0].0, left_vector.clone())],
                None,
                LogicalInstant::from_unix_seconds(1),
            ).unwrap();
            right.commit(
                &[candidate_cache_write(&vectors[0].0, right_vector.clone())],
                None,
                LogicalInstant::from_unix_seconds(1),
            ).unwrap();
            let mut left_vectors = vectors.clone();
            let mut right_vectors = vectors.clone();
            left_vectors[0].1 = left_vector;
            right_vectors[0].1 = right_vector;
            assert_query_matches_frozen(&left, &query, &left_vectors, None);
            assert_query_matches_frozen(&right, &query, &right_vectors, None);
            assert_eq!(left.version, right.version);
            return;
        }
        _ => panic!("unsupported PICT lifecycle {lifecycle}"),
    }

    let version = match read_version {
        "latest" => None,
        "historical" => Some(initial_version),
        _ => panic!("unsupported PICT read version {read_version}"),
    };
    let slot_before_read = state.candidate_normalization_cache.get().cloned();
    let expected_vectors = if read_version == "historical" {
        &initial_vectors
    } else {
        &vectors
    };
    assert_query_matches_frozen(&state, &query, expected_vectors, version);
    if read_version == "historical" {
        assert_cache_slot_unchanged(&state, slot_before_read.as_ref());
    }
    if dataset == "over-cap" {
        if !candidate_normalization_cache_eligible(dimensions) {
            assert!(state.candidate_normalization_cache.get().is_none());
        }
        if let Some(cache) = state.candidate_normalization_cache.get() {
            assert!(cache.entries.len() <= CANDIDATE_NORMALIZATION_MAX_ROWS);
            assert!(cache.entries.len() < document_count);
        }
    }
}

fn assert_cache_slot_unchanged(
    state: &FirestoreState,
    expected: Option<&Arc<CandidateNormalizationCache>>,
) {
    match (expected, state.candidate_normalization_cache.get()) {
        (Some(expected), Some(actual)) => assert!(Arc::ptr_eq(expected, actual)),
        (None, None) => {}
        _ => panic!("cache slot changed unexpectedly"),
    }
}

fn assert_query_matches_frozen(
    state: &FirestoreState,
    query: &Query,
    vectors: &[(String, Vec<f64>)],
    version: Option<CommitVersion>,
) {
    let nearest = query.find_nearest.as_ref().unwrap();
    if nearest.query_vector.iter().all(|value| *value == 0.0) {
        assert!(state.run_query(query, version).is_err());
        return;
    }
    let actual = state.run_query(query, version).unwrap();
    let query_vector = &nearest.query_vector;
    let dimensions = query_vector.len();
    let mut expected = vectors
        .iter()
        .filter_map(|(id, vector)| {
            let vector = candidate_cache_test_vector_to(vector, dimensions);
            reference::vector_distance(&vector, query_vector, DistanceMeasure::Cosine)
                .map(|distance| (id.as_str(), distance.to_bits()))
        })
        .collect::<Vec<_>>();
    expected.sort_unstable_by(|left, right| {
        f64::from_bits(left.1)
            .partial_cmp(&f64::from_bits(right.1))
            .unwrap()
            .then_with(|| left.0.cmp(right.0))
    });
    expected.truncate(usize::try_from(query.find_nearest.as_ref().unwrap().limit).unwrap());
    assert_eq!(actual.len(), expected.len());
    for (document, (expected_id, expected_bits)) in actual.iter().zip(expected) {
        assert_eq!(document.path.document_id().as_str(), expected_id);
        let Value::Double(actual_distance) = document.fields["distance"] else {
            panic!("nearest result lost its computed distance");
        };
        assert_eq!(actual_distance.to_bits(), expected_bits);
    }
}

fn candidate_cache_path(id: &str) -> DocumentPath {
    use fireemu_core_types::ids::{DatabaseId, ProjectId};
    DocumentPath::parse(
        &ProjectId::try_new("demo-app").unwrap(),
        &DatabaseId::default_database(),
        &format!("cache-items/{id}"),
    )
    .unwrap()
}

fn candidate_cache_test_vector(mut vector: Vec<f64>) -> Vec<f64> {
    if vector.len() < CANDIDATE_NORMALIZATION_MIN_DIMENSIONS {
        vector.resize(CANDIDATE_NORMALIZATION_MIN_DIMENSIONS, 0.0);
    }
    vector
}

fn candidate_cache_write(id: &str, vector: Vec<f64>) -> Write {
    candidate_cache_write_unpadded(id, candidate_cache_test_vector(vector))
}

fn candidate_cache_write_unpadded(id: &str, vector: Vec<f64>) -> Write {
    Write {
        op: WriteOp::Set {
            path: candidate_cache_path(id),
            fields: BTreeMap::from([("embedding".to_owned(), Value::Vector(vector))]),
            update_mask: None,
        },
        precondition: None,
        transforms: Vec::new(),
    }
}

fn candidate_cache_query(query_vector: Vec<f64>) -> Query {
    candidate_cache_query_unpadded(candidate_cache_test_vector(query_vector))
}

fn candidate_cache_query_unpadded(query_vector: Vec<f64>) -> Query {
    Query::new(QueryScope::collection(
        None,
        CollectionId::try_new("cache-items").unwrap(),
    ))
    .with_find_nearest(crate::query::FindNearest {
        vector_field: FieldPath::parse("embedding").unwrap(),
        query_vector,
        distance_measure: DistanceMeasure::Cosine,
        limit: 3,
        distance_result_field: Some(FieldPath::parse("distance").unwrap()),
        distance_threshold: None,
    })
}

fn assert_candidate_distances(
    documents: &[Document],
    vectors: &[(&str, Vec<f64>)],
    query: &[f64],
) {
    let dimensions = query.len();
    let expected = vectors
        .iter()
        .map(|(id, vector)| {
            let vector = candidate_cache_test_vector_to(vector, dimensions);
            (
                *id,
                reference::vector_distance(&vector, query, DistanceMeasure::Cosine)
                    .unwrap()
                    .to_bits(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(documents.len(), vectors.len());
    let mut expected = expected.into_iter().collect::<Vec<_>>();
    expected.sort_unstable_by(|left, right| {
        f64::from_bits(left.1)
            .partial_cmp(&f64::from_bits(right.1))
            .unwrap()
            .then_with(|| left.0.cmp(right.0))
    });
    for (document, (expected_id, expected_bits)) in documents.iter().zip(expected) {
        assert_eq!(document.path.document_id().as_str(), expected_id);
        let Value::Vector(vector) = &document.fields["embedding"] else {
            panic!("nearest result lost the stored vector");
        };
        assert_eq!(vector.len(), dimensions, "nearest result vector width");
        let Value::Double(actual) = document.fields["distance"] else {
            panic!("nearest result lost its computed distance");
        };
        let vector_reference = reference::vector_distance(vector, query, DistanceMeasure::Cosine)
            .unwrap()
            .to_bits();
        assert_eq!(actual.to_bits(), expected_bits);
        assert_eq!(actual.to_bits(), vector_reference);
    }
}

fn candidate_cache_test_vector_to(vector: &[f64], dimensions: usize) -> Vec<f64> {
    let mut padded = vector.to_vec();
    padded.resize(dimensions, 0.0);
    padded
}

#[test]
fn repeated_latest_cosine_queries_reuse_candidate_factors() {
    let mut state = FirestoreState::new();
    let vectors = [
        ("one", vec![3.0, -2.0, 1.0]),
        ("two", vec![1.0, 4.0, -3.0]),
        ("three", vec![-2.0, 1.0, 5.0]),
    ];
    state
        .commit(
            &vectors
                .iter()
                .map(|(id, vector)| candidate_cache_write(id, vector.clone()))
                .collect::<Vec<_>>(),
            None,
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();
    let query_vector = candidate_cache_test_vector(vec![1.0, 2.0, 3.0]);
    let query = candidate_cache_query(query_vector.clone());

    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let cold = state.run_query(&query, None).unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 4));
    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let warm = state.run_query(&query, None).unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 1));

    assert_candidate_distances(&cold, &vectors, &query_vector);
    assert_candidate_distances(&warm, &vectors, &query_vector);
}

#[test]
fn cosine_nearest_threshold_uses_exact_cached_distance_bits() {
    let mut state = FirestoreState::new();
    let vectors = [
        ("one", vec![3.0, -2.0, 1.0]),
        ("two", vec![1.0, 4.0, -3.0]),
        ("three", vec![-2.0, 1.0, 5.0]),
    ];
    state
        .commit(
            &vectors
                .iter()
                .map(|(id, vector)| candidate_cache_write(id, vector.clone()))
                .collect::<Vec<_>>(),
            None,
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();
    let query_vector = vec![1.0, 2.0, 3.0];
    let boundary = reference::vector_distance(
        &vectors[0].1,
        &query_vector,
        DistanceMeasure::Cosine,
    )
    .unwrap();
    for threshold in [
        f64::from_bits(boundary.to_bits() - 1),
        boundary,
        f64::from_bits(boundary.to_bits() + 1),
    ] {
        let mut query = candidate_cache_query(query_vector.clone());
        query
            .find_nearest
            .as_mut()
            .unwrap()
            .distance_threshold = Some(threshold);
        let result = state.run_query(&query, None).unwrap();
        let mut expected = vectors
            .iter()
            .filter_map(|(id, vector)| {
                let distance = reference::vector_distance(
                    vector,
                    &query_vector,
                    DistanceMeasure::Cosine,
                )?;
                (distance <= threshold).then_some((*id, distance.to_bits()))
            })
            .collect::<Vec<_>>();
        expected.sort_unstable_by(|left, right| {
            f64::from_bits(left.1)
                .partial_cmp(&f64::from_bits(right.1))
                .unwrap()
                .then_with(|| left.0.cmp(right.0))
        });
        assert_eq!(result.len(), expected.len());
        for (document, (expected_id, expected_bits)) in result.iter().zip(expected) {
            assert_eq!(document.path.document_id().as_str(), expected_id);
            let Value::Double(actual) = document.fields["distance"] else {
                panic!("nearest result lost its computed distance");
            };
            assert_eq!(actual.to_bits(), expected_bits);
        }
    }
}

#[test]
fn changed_commit_invalidates_latest_cache_and_historical_queries_bypass_it() {
    let mut state = FirestoreState::new();
    let mut vectors = vec![
        ("one", vec![3.0, -2.0, 1.0]),
        ("two", vec![1.0, 4.0, -3.0]),
        ("three", vec![-2.0, 1.0, 5.0]),
    ];
    let first_version = state
        .commit(
            &vectors
                .iter()
                .map(|(id, vector)| candidate_cache_write(id, vector.clone()))
                .collect::<Vec<_>>(),
            None,
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap()
        .version;
    let query_vector = candidate_cache_test_vector(vec![1.0, 2.0, 3.0]);
    let query = candidate_cache_query(query_vector.clone());
    state.run_query(&query, None).unwrap();
    assert!(state.candidate_normalization_cache.get().is_some());

    vectors[0].1 = vec![-5.0, 2.0, 3.0];
    state
        .commit(
            &[candidate_cache_write(vectors[0].0, vectors[0].1.clone())],
            None,
            LogicalInstant::from_unix_seconds(1),
        )
        .unwrap();
    assert!(state.candidate_normalization_cache.get().is_none());

    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let latest = state.run_query(&query, None).unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 4));
    assert_candidate_distances(&latest, &vectors, &query_vector);

    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let historical = state.run_query(&query, Some(first_version)).unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 4));
    let original = [
        ("one", vec![3.0, -2.0, 1.0]),
        ("two", vec![1.0, 4.0, -3.0]),
        ("three", vec![-2.0, 1.0, 5.0]),
    ];
    assert_candidate_distances(&historical, &original, &query_vector);
}

#[test]
fn transaction_nearest_queries_bypass_latest_cache_at_matching_and_older_versions() {
    let mut state = FirestoreState::new();
    let original = [("one", vec![1.0, 0.0]), ("two", vec![0.5, 1.0])];
    state
        .commit(
            &original
                .iter()
                .map(|(id, vector)| candidate_cache_write(id, vector.clone()))
                .collect::<Vec<_>>(),
            None,
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();
    let query_vector = candidate_cache_test_vector(vec![1.0, 0.0]);
    let query = candidate_cache_query(query_vector.clone());
    state.run_query(&query, None).unwrap();
    let first_cache = state
        .candidate_normalization_cache
        .get()
        .expect("latest query warmed the candidate cache")
        .clone();

    let transaction = state
        .begin_transaction(true, LogicalInstant::UNIX_EPOCH)
        .unwrap();
    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let (same_version, _) = state
        .run_query_in_transaction_with_stats(&transaction, &query)
        .unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), original.len() + 1));
    assert_candidate_distances(&same_version, &original, &query_vector);
    assert!(std::sync::Arc::ptr_eq(
        &first_cache,
        state.candidate_normalization_cache.get().unwrap(),
    ));

    let changed = [("one", vec![0.0, 100.0]), original[1].clone()];
    state
        .commit(
            &[candidate_cache_write("one", changed[0].1.clone())],
            None,
            LogicalInstant::from_unix_seconds(1),
        )
        .unwrap();
    assert!(state.candidate_normalization_cache.get().is_none());
    let latest = state.run_query(&query, None).unwrap();
    assert_candidate_distances(&latest, &changed, &query_vector);
    let latest_cache = state
        .candidate_normalization_cache
        .get()
        .expect("changed latest query repopulated the cache")
        .clone();

    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let (older_version, _) = state
        .run_query_in_transaction_with_stats(&transaction, &query)
        .unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), original.len() + 1));
    assert_candidate_distances(&older_version, &original, &query_vector);
    assert!(std::sync::Arc::ptr_eq(
        &latest_cache,
        state.candidate_normalization_cache.get().unwrap(),
    ));
}

#[test]
fn detached_cache_slots_prevent_same_version_clone_divergence() {
    let mut base = FirestoreState::new();
    let original = [
        ("one", vec![3.0, -2.0, 1.0]),
        ("two", vec![1.0, 4.0, -3.0]),
        ("three", vec![-2.0, 1.0, 5.0]),
    ];
    base.commit(
        &original
            .iter()
            .map(|(id, vector)| candidate_cache_write(id, vector.clone()))
            .collect::<Vec<_>>(),
        None,
        LogicalInstant::UNIX_EPOCH,
    )
    .unwrap();
    let query_vector = candidate_cache_test_vector(vec![1.0, 2.0, 3.0]);
    let query = candidate_cache_query(query_vector.clone());
    base.run_query(&query, None).unwrap();

    let mut branch_a = base.clone();
    let mut branch_b = base;
    let vector_a = vec![7.0, -1.0, 2.0];
    let vector_b = vec![-4.0, 6.0, 1.0];
    branch_a
        .commit(
            &[candidate_cache_write("one", vector_a.clone())],
            None,
            LogicalInstant::from_unix_seconds(1),
        )
        .unwrap();
    branch_b
        .commit(
            &[candidate_cache_write("one", vector_b.clone())],
            None,
            LogicalInstant::from_unix_seconds(1),
        )
        .unwrap();
    assert!(branch_a.candidate_normalization_cache.get().is_none());
    assert!(branch_b.candidate_normalization_cache.get().is_none());

    let result_a = branch_a.run_query(&query, None).unwrap();
    let result_b = branch_b.run_query(&query, None).unwrap();
    let expected_a = [("one", vector_a), original[1].clone(), original[2].clone()];
    let expected_b = [("one", vector_b), original[1].clone(), original[2].clone()];
    assert_candidate_distances(&result_a, &expected_a, &query_vector);
    assert_candidate_distances(&result_b, &expected_b, &query_vector);
    assert_eq!(branch_a.version, branch_b.version);
}

#[test]
fn failed_strict_nearest_query_does_not_publish_partial_cache() {
    let mut state = FirestoreState::new();
    state
        .commit(
            &[
                candidate_cache_write("nonzero", vec![1.0, 2.0, 3.0]),
                candidate_cache_write("zero", vec![0.0, -0.0, 0.0]),
            ],
            None,
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();
    let query = candidate_cache_query(vec![1.0, 2.0, 3.0]);

    assert!(state.run_query(&query, None).is_err());
    assert!(state.candidate_normalization_cache.get().is_none());
}

#[test]
fn cached_field_identity_includes_the_structural_vector_field() {
    let mut state = FirestoreState::new();
    let docs = [
        (
            "one",
            candidate_cache_test_vector(vec![3.0, -2.0, 1.0]),
            candidate_cache_test_vector(vec![9.0, 1.0, -4.0]),
        ),
        (
            "two",
            candidate_cache_test_vector(vec![1.0, 4.0, -3.0]),
            candidate_cache_test_vector(vec![-2.0, 6.0, 1.0]),
        ),
        (
            "three",
            candidate_cache_test_vector(vec![-2.0, 1.0, 5.0]),
            candidate_cache_test_vector(vec![4.0, -3.0, 7.0]),
        ),
    ];
    let writes = docs
        .iter()
        .map(|(id, embedding, alternate)| Write {
            op: WriteOp::Set {
                path: candidate_cache_path(id),
                fields: BTreeMap::from([
                    ("embedding".to_owned(), Value::Vector(embedding.clone())),
                    ("nested".to_owned(), Value::Map(BTreeMap::from([(
                        "embedding".to_owned(),
                        Value::Vector(alternate.clone()),
                    )]))),
                ]),
                update_mask: None,
            },
            precondition: None,
            transforms: Vec::new(),
        })
        .collect::<Vec<_>>();
    state
        .commit(&writes, None, LogicalInstant::UNIX_EPOCH)
        .unwrap();
    let query_vector = candidate_cache_test_vector(vec![1.0, 2.0, 3.0]);
    let ordinary = candidate_cache_query(query_vector.clone());
    state.run_query(&ordinary, None).unwrap();

    let alternate_query = Query::new(QueryScope::collection(
        None,
        CollectionId::try_new("cache-items").unwrap(),
    ))
    .with_find_nearest(crate::query::FindNearest {
        vector_field: FieldPath::parse("nested.embedding").unwrap(),
        query_vector: query_vector.clone(),
        distance_measure: DistanceMeasure::Cosine,
        limit: 3,
        distance_result_field: Some(FieldPath::parse("distance").unwrap()),
        distance_threshold: None,
    });
    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let result = state.run_query(&alternate_query, None).unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 4));
    let mut expected = docs
        .iter()
        .map(|(id, _, alternate)| {
            (
                *id,
                reference::vector_distance(alternate, &query_vector, DistanceMeasure::Cosine)
                    .unwrap()
                    .to_bits(),
            )
        })
        .collect::<Vec<_>>();
    expected.sort_unstable_by(|left, right| {
        f64::from_bits(left.1)
            .partial_cmp(&f64::from_bits(right.1))
            .unwrap()
            .then_with(|| left.0.cmp(right.0))
    });
    assert_eq!(result.len(), expected.len());
    for (document, (expected_id, expected_bits)) in result.iter().zip(expected) {
        assert_eq!(document.path.document_id().as_str(), expected_id);
        let Value::Map(nested) = &document.fields["nested"] else {
            panic!("nested vector map is missing");
        };
        let Value::Vector(vector) = &nested["embedding"] else {
            panic!("nested vector is missing");
        };
        let Value::Double(actual) = document.fields["distance"] else {
            panic!("nearest result lost its computed distance");
        };
        let vector_reference =
            reference::vector_distance(vector, &query_vector, DistanceMeasure::Cosine)
                .unwrap()
                .to_bits();
        assert_eq!(actual.to_bits(), expected_bits);
        assert_eq!(actual.to_bits(), vector_reference);
    }
}

#[test]
fn imports_invalidate_cache_and_noop_or_refused_commits_preserve_it() {
    let mut state = FirestoreState::new();
    let vectors = [
        ("one", vec![3.0, -2.0, 1.0]),
        ("two", vec![1.0, 4.0, -3.0]),
        ("three", vec![-2.0, 1.0, 5.0]),
    ];
    let writes = vectors
        .iter()
        .map(|(id, vector)| candidate_cache_write(id, vector.clone()))
        .collect::<Vec<_>>();
    state
        .commit(&writes, None, LogicalInstant::UNIX_EPOCH)
        .unwrap();
    let query_vector = candidate_cache_test_vector(vec![1.0, 2.0, 3.0]);
    let query = candidate_cache_query(query_vector.clone());
    state.run_query(&query, None).unwrap();
    assert!(state.candidate_normalization_cache.get().is_some());

    let unchanged = candidate_cache_write("one", vectors[0].1.clone());
    state
        .commit(
            &[unchanged],
            None,
            LogicalInstant::from_unix_seconds(1),
        )
        .unwrap();
    assert!(state.candidate_normalization_cache.get().is_some());
    let refused = Write {
        op: WriteOp::Verify {
            path: candidate_cache_path("missing"),
        },
        precondition: Some(Precondition::Exists(true)),
        transforms: Vec::new(),
    };
    assert!(state
        .commit(
            &[refused],
            None,
            LogicalInstant::from_unix_seconds(2),
        )
        .is_err());
    assert!(state.candidate_normalization_cache.get().is_some());

    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    state.run_query(&query, None).unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 1));

    state
        .import_documents(
            vec![ImportedDocument {
                path: candidate_cache_path("two"),
                fields: BTreeMap::from([(
                    "embedding".to_owned(),
                    Value::Vector(candidate_cache_test_vector(vec![-7.0, 2.0, 3.0])),
                )]),
                create_time: None,
                update_time: None,
            }],
            LogicalInstant::from_unix_seconds(3),
        )
        .unwrap();
    assert!(state.candidate_normalization_cache.get().is_none());
    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let imported = state.run_query(&query, None).unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 4));
    assert_candidate_distances(
        &imported,
        &[
            vectors[0].clone(),
            ("two", vec![-7.0, 2.0, 3.0]),
            vectors[2].clone(),
        ],
        &query_vector,
    );
}

#[test]
fn candidate_factor_cache_hits_keep_cached_invalid_normalization() {
    let mut state = FirestoreState::new();
    let vectors = [
        ("invalid", vec![0.0, -0.0]),
        ("one", vec![3.0, 1.0]),
        ("two", vec![1.0, 4.0]),
    ];
    state
        .commit(
            &vectors
                .iter()
                .map(|(id, vector)| candidate_cache_write(id, vector.clone()))
                .collect::<Vec<_>>(),
            None,
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();
    let query_vector = candidate_cache_test_vector(vec![1.0, 2.0]);
    let mut query = candidate_cache_query(query_vector.clone());
    query.production_refusals = false;

    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let cold = state.run_query(&query, None).unwrap();
    assert_candidate_distances(&cold, &vectors[1..], &query_vector);
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 4));

    let cached = state
        .candidate_normalization_cache
        .get()
        .expect("successful query publishes the partial cache");
    assert!(cached.entries.capacity() < CANDIDATE_NORMALIZATION_MAX_ROWS);
    assert_eq!(
        cached.lookup(
            &FieldPath::parse("embedding").unwrap(),
            &candidate_cache_path("invalid"),
            state.get(&candidate_cache_path("invalid")).unwrap().version,
        ),
        CandidateNormalizationLookup::Hit(None),
    );
    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let warm = state.run_query(&query, None).unwrap();
    assert_candidate_distances(&warm, &vectors[1..], &query_vector);
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 1));
}

#[test]
fn small_dimension_queries_skip_candidate_cache_lookup_and_publication() {
    let field = FieldPath::parse("embedding").unwrap();
    let mut seeded = FirestoreState::new();
    seeded
        .commit(
            &[candidate_cache_write_unpadded("one", vec![1.0, 0.0])],
            None,
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();
    let path = candidate_cache_path("one");
    let version = seeded.get(&path).unwrap().version;
    let mut poisoned = CandidateNormalizationCache::new(&field);
    assert!(poisoned.admit(&path, version, Some((2.0, 1.0))));
    let poisoned = Arc::new(poisoned.finish().unwrap());
    seeded
        .candidate_normalization_cache
        .set(poisoned.clone())
        .unwrap();

    let query_vector = vec![1.0, 0.0];
    let query = candidate_cache_query_unpadded(query_vector.clone());
    CANDIDATE_NORMALIZATION_CACHE_LOOKUPS.with(|lookups| lookups.set(0));
    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let result = seeded.run_query(&query, None).unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 2));
    CANDIDATE_NORMALIZATION_CACHE_LOOKUPS.with(|lookups| assert_eq!(lookups.get(), 0));
    assert_candidate_distances(&result, &[("one", vec![1.0, 0.0])], &query_vector);
    assert!(Arc::ptr_eq(
        seeded.candidate_normalization_cache.get().unwrap(),
        &poisoned,
    ));

    let mut cold = FirestoreState::new();
    cold.commit(
        &[candidate_cache_write_unpadded("one", vec![1.0, 0.0])],
        None,
        LogicalInstant::UNIX_EPOCH,
    )
    .unwrap();
    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let cold_result = cold.run_query(&query, None).unwrap();
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 2));
    assert_candidate_distances(&cold_result, &[("one", vec![1.0, 0.0])], &query_vector);
    assert!(cold.candidate_normalization_cache.get().is_none());
}

#[test]
fn candidate_cache_eligibility_runs_queries_at_511_512_and_513_dimensions() {
    for (dimensions, should_use_cache) in [(511, false), (512, true), (513, true)] {
        assert_eq!(CANDIDATE_NORMALIZATION_MIN_DIMENSIONS, 512);
        assert_eq!(candidate_normalization_cache_eligible(dimensions), should_use_cache);
        let mut vector = vec![1.0, -2.0, 3.0];
        vector.resize(dimensions, 0.0);
        let mut query_vector = vec![2.0, 1.0, -1.0];
        query_vector.resize(dimensions, 0.0);
        let mut state = FirestoreState::new();
        state
            .commit(
                &[candidate_cache_write_unpadded("one", vector.clone())],
                None,
                LogicalInstant::UNIX_EPOCH,
            )
            .unwrap();
        let query = candidate_cache_query_unpadded(query_vector.clone());

        CANDIDATE_NORMALIZATION_CACHE_LOOKUPS.with(|lookups| lookups.set(0));
        NORMALIZATION_CALLS.with(|calls| calls.set(0));
        let cold = state.run_query(&query, None).unwrap();
        assert_candidate_distances(&cold, &[("one", vector.clone())], &query_vector);
        NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 2));
        CANDIDATE_NORMALIZATION_CACHE_LOOKUPS.with(|lookups| assert_eq!(lookups.get(), 0));
        assert_eq!(
            state.candidate_normalization_cache.get().is_some(),
            should_use_cache,
        );

        CANDIDATE_NORMALIZATION_CACHE_LOOKUPS.with(|lookups| lookups.set(0));
        NORMALIZATION_CALLS.with(|calls| calls.set(0));
        let warm = state.run_query(&query, None).unwrap();
        assert_candidate_distances(&warm, &[("one", vector)], &query_vector);
        if should_use_cache {
            NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 1));
            CANDIDATE_NORMALIZATION_CACHE_LOOKUPS.with(|lookups| assert_eq!(lookups.get(), 1));
        } else {
            NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 2));
            CANDIDATE_NORMALIZATION_CACHE_LOOKUPS.with(|lookups| assert_eq!(lookups.get(), 0));
        }
    }
}

#[test]
fn small_dimension_query_preserves_a_valid_high_dimension_cache_slot() {
    let mut high_vector = vec![1.0, -2.0, 3.0];
    high_vector.resize(512, 0.0);
    let mut low_vector = vec![3.0, 1.0, -2.0];
    low_vector.resize(511, 0.0);
    let mut state = FirestoreState::new();
    state
        .commit(
            &[
                candidate_cache_write_unpadded("high", high_vector.clone()),
                candidate_cache_write_unpadded("low", low_vector.clone()),
            ],
            None,
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();
    let mut high_query = vec![1.0, 2.0, -1.0];
    high_query.resize(512, 0.0);
    let high_query = candidate_cache_query_unpadded(high_query);
    let high_result = state.run_query(&high_query, None).unwrap();
    assert_candidate_distances(
        &high_result,
        &[("high", high_vector.clone())],
        &high_query.find_nearest.as_ref().unwrap().query_vector,
    );
    let cached = state
        .candidate_normalization_cache
        .get()
        .expect("eligible query builds the candidate cache")
        .clone();
    assert_eq!(cached.entries.len(), 1);

    let mut low_query = vec![2.0, -1.0, 1.0];
    low_query.resize(511, 0.0);
    let low_query = candidate_cache_query_unpadded(low_query.clone());
    CANDIDATE_NORMALIZATION_CACHE_LOOKUPS.with(|lookups| lookups.set(0));
    NORMALIZATION_CALLS.with(|calls| calls.set(0));
    let result = state.run_query(&low_query, None).unwrap();
    assert_candidate_distances(&result, &[("low", low_vector)], &low_query.find_nearest.as_ref().unwrap().query_vector);
    NORMALIZATION_CALLS.with(|calls| assert_eq!(calls.get(), 2));
    CANDIDATE_NORMALIZATION_CACHE_LOOKUPS.with(|lookups| assert_eq!(lookups.get(), 0));
    assert!(Arc::ptr_eq(
        state.candidate_normalization_cache.get().unwrap(),
        &cached,
    ));
    assert_eq!(cached.entries.len(), 1);
}

#[test]
fn candidate_factor_cache_starts_without_a_large_reserved_row_buffer() {
    let field = FieldPath::parse("embedding").unwrap();
    let cache = CandidateNormalizationCache::new(&field);
    assert_eq!(cache.entries.capacity(), 0);
    assert!(cache.estimated_bytes < 1_024);
}

#[test]
fn candidate_factor_cache_never_publishes_an_over_budget_builder() {
    let field = FieldPath::parse("embedding").unwrap();
    let mut cache = CandidateNormalizationCache::new(&field);
    assert!(cache.admit(
        &candidate_cache_path("one"),
        CommitVersion::from_value(1),
        Some((1.0, 1.0)),
    ));
    cache.estimated_bytes = CANDIDATE_NORMALIZATION_MAX_ESTIMATED_BYTES + 1;
    assert!(cache.finish().is_none());
}

#[test]
fn candidate_factor_cache_discards_synthetic_over_budget_capacity_growth() {
    let field = FieldPath::parse("embedding").unwrap();
    let mut cache = CandidateNormalizationCache::new(&field);
    assert!(cache.admit(
        &candidate_cache_path("one"),
        CommitVersion::from_value(1),
        Some((1.0, 1.0)),
    ));
    let old_capacity = cache.entries.capacity();
    let entry_bytes = core::mem::size_of::<CandidateNormalizationEntry>();
    let over_budget_capacity = old_capacity.saturating_add(
        CANDIDATE_NORMALIZATION_MAX_ESTIMATED_BYTES / entry_bytes + 1,
    );
    assert!(!cache.account_capacity_growth(old_capacity, over_budget_capacity));
    assert!(cache.poisoned);
    assert_eq!(cache.entries.capacity(), 0);
    assert!(cache.estimated_bytes <= CANDIDATE_NORMALIZATION_MAX_ESTIMATED_BYTES);
    assert!(cache.finish().is_none());
}

#[test]
fn candidate_factor_cache_respects_the_fixed_row_and_byte_caps() {
    let mut cache = CandidateNormalizationCache::new(&FieldPath::parse("embedding").unwrap());
    let mut admitted = 0;
    for index in 0..=CANDIDATE_NORMALIZATION_MAX_ROWS {
        let path = candidate_cache_path(&format!("row-{index:04}"));
        if cache.admit(&path, CommitVersion::from_value(1), Some((1.0, 1.0))) {
            admitted += 1;
        } else {
            break;
        }
    }
    assert_eq!(admitted, CANDIDATE_NORMALIZATION_MAX_ROWS);
    assert!(cache.entries.len() <= CANDIDATE_NORMALIZATION_MAX_ROWS);
    assert!(cache.estimated_bytes <= CANDIDATE_NORMALIZATION_MAX_ESTIMATED_BYTES);
    let path = candidate_cache_path(&format!("row-{:04}", admitted - 1));
    let cache = cache.finish().unwrap();
    assert_eq!(
        cache.lookup(
            &FieldPath::parse("embedding").unwrap(),
            &path,
            CommitVersion::from_value(1),
        ),
        CandidateNormalizationLookup::Hit(Some((1.0, 1.0))),
    );
    assert_eq!(
        cache.lookup(
            &FieldPath::parse("embedding").unwrap(),
            &path,
            CommitVersion::from_value(2),
        ),
        CandidateNormalizationLookup::Miss,
    );
    assert_eq!(
        cache.lookup(
            &FieldPath::parse("other").unwrap(),
            &path,
            CommitVersion::from_value(1),
        ),
        CandidateNormalizationLookup::Miss,
    );
}

#[test]
fn candidate_factor_cache_rejects_long_paths_at_the_byte_cap() {
    use fireemu_core_types::ids::{DatabaseId, ProjectId};
    let project = ProjectId::try_new("demo-app").unwrap();
    let database = DatabaseId::default_database();
    let mut relative = (0..49)
        .flat_map(|level| {
            [
                format!("collection{level}{}", "x".repeat(44)),
                format!("document{level}{}", "y".repeat(44)),
            ]
        })
        .collect::<Vec<_>>()
        .join("/");
    relative.push_str("/leaf/");
    let base = relative;
    let mut cache = CandidateNormalizationCache::new(&FieldPath::parse("embedding").unwrap());
    let mut admitted = 0;
    for index in 0..CANDIDATE_NORMALIZATION_MAX_ROWS {
        let path = DocumentPath::parse(
            &project,
            &database,
            &format!("{base}d{index:04}"),
        )
        .unwrap();
        if !cache.admit(&path, CommitVersion::from_value(1), Some((1.0, 1.0))) {
            break;
        }
        admitted += 1;
    }
    assert!(admitted > 0);
    assert!(admitted < CANDIDATE_NORMALIZATION_MAX_ROWS);
    assert!(cache.estimated_bytes <= CANDIDATE_NORMALIZATION_MAX_ESTIMATED_BYTES);
}

#[test]
fn vector_threshold_adjacent_bits_rank_and_projection() {
    use fireemu_core_types::ids::{DatabaseId, ProjectId};
    let mut state = FirestoreState::new();
    let project = ProjectId::try_new("demo-app").unwrap();
    let left = vec![1e150, 3e149, 7e148];
    let query_vector = vec![0.0; 3];
    let distance =
        reference::vector_distance(&left, &query_vector, DistanceMeasure::Euclidean).unwrap();
    for (id, vector) in [
        ("b", left.clone()),
        ("a", left),
        ("wrong", vec![1.0]),
        ("overflow", vec![f64::MAX; 3]),
        ("invalid", vec![f64::INFINITY; 3]),
    ] {
        state
            .commit(
                &[Write {
                    op: WriteOp::Set {
                        path: DocumentPath::parse(
                            &project,
                            &DatabaseId::default_database(),
                            &format!("items/{id}"),
                        )
                        .unwrap(),
                        fields: BTreeMap::from([("embedding".to_owned(), Value::Vector(vector))]),
                        update_mask: None,
                    },
                    precondition: None,
                    transforms: vec![],
                }],
                None,
                LogicalInstant::UNIX_EPOCH,
            )
            .unwrap();
    }
    for (threshold, expected) in [
        (f64::from_bits(distance.to_bits() - 1), 0),
        (distance, 2),
        (f64::from_bits(distance.to_bits() + 1), 2),
    ] {
        let mut query = Query::new(QueryScope::collection(
            None,
            CollectionId::try_new("items").unwrap(),
        ))
        .with_find_nearest(crate::query::FindNearest {
            vector_field: FieldPath::parse("embedding").unwrap(),
            query_vector: query_vector.clone(),
            distance_measure: DistanceMeasure::Euclidean,
            limit: 2,
            distance_result_field: Some(FieldPath::parse("distance").unwrap()),
            distance_threshold: Some(threshold),
        });
        query.projection = Some(vec![FieldPath::parse("distance").unwrap()]);
        let docs = state
            .run_query(&query.clone().canonicalize().unwrap(), None)
            .unwrap();
        assert_eq!(docs.len(), expected);
        for (doc, id) in docs.iter().zip(["a", "b"]) {
            assert_eq!(doc.path.document_id().as_str(), id);
            assert_eq!(doc.fields.len(), 1);
            let Value::Double(actual) = doc.fields["distance"] else {
                panic!("missing distance");
            };
            assert_eq!(actual.to_bits(), distance.to_bits());
        }
        query.find_nearest.as_mut().unwrap().limit = 1;
        let docs = state
            .run_query(&query.canonicalize().unwrap(), None)
            .unwrap();
        assert_eq!(docs.len(), expected.min(1));
        if let Some(doc) = docs.first() {
            assert_eq!(doc.path.document_id().as_str(), "a");
        }
    }
}

fn special_component() -> impl Strategy<Value = f64> {
    prop_oneof![
        Just(f64::NAN),
        Just(f64::INFINITY),
        Just(f64::NEG_INFINITY),
        Just(0.0),
        Just(-0.0),
        Just(f64::MAX),
        Just(-f64::MAX),
        Just(f64::MIN_POSITIVE),
        Just(f64::from_bits(1)),
        Just(1e-300),
        Just(-1e-300),
        Just(1e300),
        Just(-1e300),
        Just(1.0),
        Just(-1.0),
        any::<u64>().prop_map(f64::from_bits),
        -1000.0f64..1000.0,
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2048))]
    #[test]
    fn generated_matched_vectors_match_frozen_reference(
        (left, right) in (0usize..=12).prop_flat_map(|len| (
            prop::collection::vec(special_component(), len),
            prop::collection::vec(special_component(), len),
        )),
    ) {
        check(&left, &right);
        check(&right, &left);
        check(&left, &left);
    }

    #[test]
    fn generated_mismatched_vectors_are_refused_like_the_reference(
        left in prop::collection::vec(special_component(), 0..=12),
        right in prop::collection::vec(special_component(), 0..=12),
    ) {
        prop_assume!(left.len() != right.len());
        for measure in [DistanceMeasure::Euclidean, DistanceMeasure::Cosine, DistanceMeasure::DotProduct] {
            prop_assert_eq!(vector_distance(&left, &right, measure), None);
            prop_assert_eq!(
                PreparedVectorDistance::new(&right, measure).evaluate(&left),
                None
            );
        }
    }
}
