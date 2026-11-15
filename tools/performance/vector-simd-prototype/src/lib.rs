#![forbid(unsafe_op_in_unsafe_fn)]

fn factors(values: &[f64]) -> Option<(f64, f64)> {
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
    if !norm.is_finite() || norm == 0.0 {
        return None;
    }
    Some((scale, norm))
}

/// Computes the normalization factors a production candidate cache would retain.
pub fn prepare_factors(values: &[f64]) -> Option<(f64, f64)> {
    factors(values)
}

fn normalize(value: f64, (scale, norm): (f64, f64)) -> Option<f64> {
    let component = (value / scale) / norm;
    component.is_finite().then_some(component)
}

fn scalar_normalized(values: &[f64], factors: (f64, f64)) -> Option<Vec<f64>> {
    values
        .iter()
        .map(|value| normalize(*value, factors))
        .collect()
}

fn scalar_similarity(left: &[f64], right: &[f64]) -> Option<f64> {
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
    Some(dot)
}

/// Frozen buffer-based cosine reference used to check the intrinsic prototype.
pub fn scalar_reference(vector: &[f64], query: &[f64]) -> Option<f64> {
    if vector.len() != query.len() {
        return None;
    }
    let vector = scalar_normalized(vector, factors(vector)?)?;
    let query = scalar_normalized(query, factors(query)?)?;
    Some((1.0 - scalar_similarity(&vector, &query)?.clamp(-1.0, 1.0)).clamp(0.0, 2.0))
}

/// Prepares the normalized query components once for repeated candidate evaluation.
pub fn prepare_query(query: &[f64]) -> Option<Vec<f64>> {
    scalar_normalized(query, factors(query)?)
}

/// Scalar candidate kernel with the same prepared-query contract as the production path.
pub fn scalar_with_prepared_query(vector: &[f64], query: &[f64]) -> Option<f64> {
    if vector.len() != query.len() {
        return None;
    }
    let normalized = scalar_normalized(vector, factors(vector)?)?;
    Some((1.0 - scalar_similarity(&normalized, query)?.clamp(-1.0, 1.0)).clamp(0.0, 2.0))
}

fn normalize_pairs_scalar(values: &[f64], factors: (f64, f64), query: &[f64]) -> Option<f64> {
    let mut dot = 0.0;
    let mut pairs = values.chunks_exact(2);
    let mut query_pairs = query.chunks_exact(2);
    for (left, right) in pairs.by_ref().zip(query_pairs.by_ref()) {
        let products = [
            normalize(left[0], factors)? * right[0],
            normalize(left[1], factors)? * right[1],
        ];
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
    if let (Some(&left), Some(&right)) =
        (pairs.remainder().first(), query_pairs.remainder().first())
    {
        let product = normalize(left, factors)? * right;
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

fn normalize_pairs_scalar_slp(values: &[f64], factors: (f64, f64), query: &[f64]) -> Option<f64> {
    let mut dot = 0.0;
    let mut pairs = values.chunks_exact(2);
    let mut query_pairs = query.chunks_exact(2);
    for (left, right) in pairs.by_ref().zip(query_pairs.by_ref()) {
        let scaled = [left[0] / factors.0, left[1] / factors.0];
        let normalized = [scaled[0] / factors.1, scaled[1] / factors.1];
        if !normalized[0].is_finite() || !normalized[1].is_finite() {
            return None;
        }
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
    if let (Some(&left), Some(&right)) =
        (pairs.remainder().first(), query_pairs.remainder().first())
    {
        let product = normalize(left, factors)? * right;
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

/// Nonallocating scalar pair kernel using the same prepared-query contract as NEON.
pub fn scalar_pairs_with_prepared_query(vector: &[f64], query: &[f64]) -> Option<f64> {
    if vector.len() != query.len() {
        return None;
    }
    let vector_factors = factors(vector)?;
    scalar_pairs_with_prepared_factors(vector, vector_factors, query)
}

/// Scalar pair kernel with both query components and candidate factors prepared.
pub fn scalar_pairs_with_prepared_factors(
    vector: &[f64],
    vector_factors: (f64, f64),
    query: &[f64],
) -> Option<f64> {
    if vector.len() != query.len() {
        return None;
    }
    let similarity = normalize_pairs_scalar(vector, vector_factors, query)?;
    Some((1.0 - similarity.clamp(-1.0, 1.0)).clamp(0.0, 2.0))
}

/// Safe scalar pair kernel that exposes independent normalization lanes to LLVM SLP.
pub fn scalar_pairs_slp_with_prepared_query(vector: &[f64], query: &[f64]) -> Option<f64> {
    if vector.len() != query.len() {
        return None;
    }
    let vector_factors = factors(vector)?;
    scalar_pairs_slp_with_prepared_factors(vector, vector_factors, query)
}

/// Safe SLP pair kernel with both query components and candidate factors prepared.
pub fn scalar_pairs_slp_with_prepared_factors(
    vector: &[f64],
    vector_factors: (f64, f64),
    query: &[f64],
) -> Option<f64> {
    if vector.len() != query.len() {
        return None;
    }
    let similarity = normalize_pairs_scalar_slp(vector, vector_factors, query)?;
    Some((1.0 - similarity.clamp(-1.0, 1.0)).clamp(0.0, 2.0))
}

#[cfg(target_arch = "aarch64")]
#[target_feature(enable = "neon")]
/// # Safety
/// The caller must run this only when AArch64 NEON is available.
unsafe fn normalize_pair_neon(values: &[f64; 2], factors: (f64, f64)) -> [f64; 2] {
    use core::arch::aarch64::{vdivq_f64, vdupq_n_f64, vld1q_f64, vst1q_f64};

    // SAFETY: callers check NEON availability; input and output are each exactly two f64 lanes.
    unsafe {
        let input = vld1q_f64(values.as_ptr());
        let scale = vdupq_n_f64(factors.0);
        let norm = vdupq_n_f64(factors.1);
        let scaled = vdivq_f64(input, scale);
        let normalized = vdivq_f64(scaled, norm);
        let mut output = [0.0; 2];
        vst1q_f64(output.as_mut_ptr(), normalized);
        output
    }
}

#[cfg(target_arch = "aarch64")]
fn normalize_pairs_neon(values: &[f64], factors: (f64, f64), query: &[f64]) -> Option<f64> {
    let mut dot = 0.0;
    let mut pairs = values.chunks_exact(2);
    let mut query_pairs = query.chunks_exact(2);
    for (left, right) in pairs.by_ref().zip(query_pairs.by_ref()) {
        let left: &[f64; 2] = left.try_into().expect("exact pair chunk");
        let right: &[f64; 2] = right.try_into().expect("exact pair chunk");
        // SAFETY: `intrinsic_with_prepared_factors` dispatches here only after detecting NEON.
        let normalized = unsafe { normalize_pair_neon(left, factors) };
        if !normalized[0].is_finite() || !normalized[1].is_finite() {
            return None;
        }
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
    if let (Some(&left), Some(&right)) =
        (pairs.remainder().first(), query_pairs.remainder().first())
    {
        let product = normalize(left, factors)? * right;
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

/// Runtime-dispatched NEON prototype. Non-AArch64 targets use the same scalar pair kernel.
pub fn intrinsic_prototype(vector: &[f64], query: &[f64]) -> Option<f64> {
    if vector.len() != query.len() {
        return None;
    }
    let query_components = prepare_query(query)?;
    intrinsic_with_prepared_query(vector, &query_components)
}

/// Candidate kernel with query normalization removed from the measured loop.
pub fn intrinsic_with_prepared_query(vector: &[f64], query_components: &[f64]) -> Option<f64> {
    if vector.len() != query_components.len() {
        return None;
    }
    let vector_factors = factors(vector)?;
    intrinsic_with_prepared_factors(vector, vector_factors, query_components)
}

/// NEON/scalar pair kernel with both query components and candidate factors prepared.
pub fn intrinsic_with_prepared_factors(
    vector: &[f64],
    vector_factors: (f64, f64),
    query_components: &[f64],
) -> Option<f64> {
    if vector.len() != query_components.len() {
        return None;
    }
    #[cfg(target_arch = "aarch64")]
    let similarity = {
        if std::arch::is_aarch64_feature_detected!("neon") {
            normalize_pairs_neon(vector, vector_factors, query_components)?
        } else {
            normalize_pairs_scalar(vector, vector_factors, query_components)?
        }
    };
    #[cfg(not(target_arch = "aarch64"))]
    let similarity = normalize_pairs_scalar(vector, vector_factors, query_components)?;
    Some((1.0 - similarity.clamp(-1.0, 1.0)).clamp(0.0, 2.0))
}

#[cfg(test)]
mod tests {
    use super::{
        factors, intrinsic_prototype, intrinsic_with_prepared_factors,
        intrinsic_with_prepared_query, prepare_query, scalar_pairs_slp_with_prepared_factors,
        scalar_pairs_slp_with_prepared_query, scalar_pairs_with_prepared_factors, scalar_reference,
        scalar_with_prepared_query,
    };

    fn assert_same(vector: &[f64], query: &[f64]) {
        let expected = scalar_reference(vector, query).map(f64::to_bits);
        assert_eq!(
            intrinsic_prototype(vector, query).map(f64::to_bits),
            expected,
            "vector={vector:?} query={query:?}",
        );
        let prepared = prepare_query(query);
        assert_eq!(
            prepared.as_ref().and_then(|query_components| {
                scalar_pairs_slp_with_prepared_query(vector, query_components).map(f64::to_bits)
            }),
            expected,
            "scalar SLP vector={vector:?} query={query:?}",
        );
        assert_eq!(
            prepared
                .as_ref()
                .and_then(|query| { scalar_with_prepared_query(vector, query).map(f64::to_bits) }),
            prepared.as_ref().and_then(|query| {
                intrinsic_with_prepared_query(vector, query).map(f64::to_bits)
            }),
            "prepared vector={vector:?} query={query:?}",
        );
    }

    #[test]
    fn intrinsic_matches_frozen_reference_for_special_values_and_dimensions() {
        let special = [
            0.0,
            -0.0,
            f64::MIN_POSITIVE,
            f64::from_bits(1),
            f64::MAX,
            -f64::MAX,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NAN,
            1.0,
            -3.0,
        ];
        for dimensions in [0, 1, 2, 3, 4, 5, 16, 768] {
            for offset in 0..special.len() {
                let vector = (0..dimensions)
                    .map(|index| special[(index + offset) % special.len()])
                    .collect::<Vec<_>>();
                let query = (0..dimensions)
                    .map(|index| special[(index * 3 + offset + 1) % special.len()])
                    .collect::<Vec<_>>();
                assert_same(&vector, &query);
            }
        }
        assert_same(&[1.0, 2.0], &[1.0]);
    }

    #[test]
    fn intrinsic_matches_frozen_reference_for_arbitrary_bit_patterns() {
        let mut state = 0x9e37_79b9_7f4a_7c15_u64;
        for dimensions in [1, 2, 3, 7, 16, 65, 768] {
            for _ in 0..128 {
                let mut next = || {
                    state ^= state << 13;
                    state ^= state >> 7;
                    state ^= state << 17;
                    f64::from_bits(state)
                };
                let vector = (0..dimensions).map(|_| next()).collect::<Vec<_>>();
                let query = (0..dimensions).map(|_| next()).collect::<Vec<_>>();
                assert_same(&vector, &query);
            }
        }
    }

    #[test]
    fn pair_kernels_match_for_finite_nonzero_high_dimensions() {
        let mut state = 0xd1b5_4a32_d192_ed03_u64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let centered = i32::try_from(state % 20_001).expect("bounded value") - 10_000;
            f64::from(centered) / 10_000.0
        };

        for dimensions in [128, 129, 2_047, 2_048] {
            let query = (0..dimensions).map(|_| next()).collect::<Vec<_>>();
            let query_components = prepare_query(&query).expect("finite nonzero query");
            for _ in 0..16 {
                let vector = (0..dimensions).map(|_| next()).collect::<Vec<_>>();
                let expected = scalar_reference(&vector, &query)
                    .expect("generated finite vectors have valid cosine distances")
                    .to_bits();
                let candidate_factors = factors(&vector).expect("finite nonzero candidate");
                assert_eq!(
                    scalar_pairs_with_prepared_factors(
                        &vector,
                        candidate_factors,
                        &query_components,
                    )
                    .map(f64::to_bits),
                    Some(expected),
                    "scalar pairs at {dimensions} dimensions",
                );
                assert_eq!(
                    scalar_pairs_slp_with_prepared_factors(
                        &vector,
                        candidate_factors,
                        &query_components,
                    )
                    .map(f64::to_bits),
                    Some(expected),
                    "scalar SLP pairs at {dimensions} dimensions",
                );
                assert_eq!(
                    intrinsic_with_prepared_factors(&vector, candidate_factors, &query_components,)
                        .map(f64::to_bits),
                    Some(expected),
                    "NEON pairs at {dimensions} dimensions",
                );
            }
        }
    }
}
