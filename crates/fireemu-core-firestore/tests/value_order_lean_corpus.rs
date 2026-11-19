//! Differential test of `Value::canonical_cmp` against the Lean specification in
//! `verification/lean/firestore-value-order`, through the golden corpus that the Lean
//! executable writes (`lake exe corpus`), plus proptest checks of the order laws that the
//! Lean proofs state (`FVO.cmp_refl`, `FVO.cmp_swap`, `FVO.cmp_le_trans`,
//! `FVO.cmp_lt_trans`, `FVO.cmp_eq_trans`). The Rust build does not need Lean.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use fireemu_core_firestore::value::{GeoPoint, IndexValue, Timestamp, Value};
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-value-order.corpus");

fn hex(token: &str) -> Vec<u8> {
    assert!(token.len() % 2 == 0, "odd hex length: {token}");
    (0..token.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&token[i..i + 2], 16).expect("hex byte"))
        .collect()
}

fn utf8(token: &str) -> String {
    String::from_utf8(hex(token)).expect("UTF-8")
}

fn f64_bits(token: &str) -> f64 {
    assert_eq!(token.len(), 16, "f64 bits: {token}");
    f64::from_bits(u64::from_str_radix(token, 16).expect("f64 bits"))
}

/// Parses one value in the corpus prefix form (see `Main.lean`).
fn parse_value<'a>(tokens: &mut impl Iterator<Item = &'a str>) -> Value {
    let token = tokens.next().expect("value token");
    let (tag, rest) = token.split_once(':').unwrap_or((token, ""));
    match tag {
        "null" => Value::Null,
        "bool" => Value::Boolean(rest == "1"),
        "int" => Value::Integer(rest.parse().expect("i64")),
        "dbl" => Value::Double(f64_bits(rest)),
        "ts" => {
            let (s, n) = rest.split_once(':').expect("ts");
            Value::Timestamp(
                Timestamp::new(s.parse().expect("seconds"), n.parse().expect("nanos"))
                    .expect("valid timestamp"),
            )
        }
        "str" => Value::String(utf8(rest)),
        "bytes" => Value::Bytes(hex(rest)),
        "ref" => Value::Reference(utf8(rest)),
        "geo" => {
            let (la, lo) = rest.split_once(':').expect("geo");
            Value::GeoPoint(GeoPoint::new(f64_bits(la), f64_bits(lo)).expect("valid geo point"))
        }
        "arr" => {
            let n: usize = rest.parse().expect("array length");
            Value::Array((0..n).map(|_| parse_value(tokens)).collect())
        }
        "vec" => {
            let n: usize = rest.parse().expect("vector length");
            Value::Vector(
                (0..n)
                    .map(|_| f64_bits(tokens.next().expect("vector component")))
                    .collect(),
            )
        }
        "map" => {
            let n: usize = rest.parse().expect("map length");
            let mut entries = BTreeMap::new();
            for _ in 0..n {
                let key = tokens.next().expect("map key");
                let key = utf8(key.strip_prefix("key:").expect("key: prefix"));
                let value = parse_value(tokens);
                assert!(entries.insert(key, value).is_none(), "duplicate map key");
            }
            Value::Map(entries)
        }
        other => panic!("unknown value tag {other}"),
    }
}

struct Case {
    line: usize,
    expected: Ordering,
    a: Value,
    b: Value,
}

fn corpus() -> Vec<Case> {
    let mut cases = Vec::new();
    let mut declared = None;
    for (index, line) in CORPUS.lines().enumerate() {
        if let Some(comment) = line.strip_prefix("# ") {
            if let Some(count) = comment.split_once(" pairs.") {
                declared = Some(count.0.parse::<usize>().expect("pair count"));
            }
            continue;
        }
        let mut tokens = line.split(' ');
        let expected = match tokens.next() {
            Some("lt") => Ordering::Less,
            Some("eq") => Ordering::Equal,
            Some("gt") => Ordering::Greater,
            other => panic!("line {}: bad order {other:?}", index + 1),
        };
        let a = parse_value(&mut tokens);
        let b = parse_value(&mut tokens);
        assert!(
            tokens.next().is_none(),
            "line {}: trailing tokens",
            index + 1
        );
        cases.push(Case {
            line: index + 1,
            expected,
            a,
            b,
        });
    }
    assert_eq!(Some(cases.len()), declared, "pair count in the header");
    cases
}

#[test]
fn canonical_cmp_matches_the_lean_specification_on_the_golden_corpus() {
    let cases = corpus();
    assert!(cases.len() >= 3_000, "corpus too small: {}", cases.len());
    let mut mismatches = Vec::new();
    for case in &cases {
        let actual = case.a.canonical_cmp(&case.b);
        if actual != case.expected {
            mismatches.push(format!(
                "line {}: expected {:?}, got {actual:?}: {:?} vs {:?}",
                case.line, case.expected, case.a, case.b
            ));
        }
        assert_eq!(
            IndexValue(&case.a).cmp(&IndexValue(&case.b)),
            actual,
            "line {}",
            case.line
        );
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

#[test]
fn golden_corpus_covers_every_order_and_the_documented_equalities() {
    let cases = corpus();
    for wanted in [Ordering::Less, Ordering::Equal, Ordering::Greater] {
        assert!(cases.iter().any(|c| c.expected == wanted), "{wanted:?}");
    }
    let has = |a: &Value, b: &Value, o: Ordering| {
        cases
            .iter()
            .any(|c| c.a.stored_eq(a) && c.b.stored_eq(b) && c.expected == o)
    };
    assert!(has(
        &Value::Double(f64::NAN),
        &Value::Double(-f64::NAN),
        Ordering::Equal
    ));
    assert!(has(
        &Value::Double(-0.0),
        &Value::Double(0.0),
        Ordering::Equal
    ));
    assert!(has(
        &Value::Integer(1),
        &Value::Double(1.0),
        Ordering::Equal
    ));
    assert!(has(
        &Value::Integer(i64::MAX),
        &Value::Double(9_223_372_036_854_775_808.0),
        Ordering::Less
    ));
    assert!(has(
        &Value::Reference("a/b".to_owned()),
        &Value::Reference("a!".to_owned()),
        Ordering::Less
    ));
}

fn edge_double() -> impl Strategy<Value = f64> {
    prop_oneof![
        Just(0.0),
        Just(-0.0),
        Just(1.0),
        Just(-1.0),
        Just(0.5),
        Just(f64::NAN),
        Just(-f64::NAN),
        Just(f64::INFINITY),
        Just(f64::NEG_INFINITY),
        Just(f64::MIN_POSITIVE),
        Just(f64::from_bits(1)),
        Just(f64::MAX),
        Just(9_007_199_254_740_992.0),
        Just(9_007_199_254_740_994.0),
        Just(9_223_372_036_854_775_808.0),
        Just(9_223_372_036_854_774_784.0),
        Just(-9_223_372_036_854_775_808.0),
        Just(-9_223_372_036_854_777_856.0),
        (-3_i32..=3).prop_map(f64::from),
        any::<u64>().prop_map(f64::from_bits),
    ]
}

fn edge_integer() -> impl Strategy<Value = i64> {
    prop_oneof![
        Just(i64::MIN),
        Just(i64::MIN + 1),
        Just(i64::MAX),
        Just(i64::MAX - 1),
        Just(9_007_199_254_740_992),
        Just(9_007_199_254_740_993),
        Just(-9_007_199_254_740_993),
        Just(9_223_372_036_854_774_784),
        -3_i64..=3,
        any::<i64>(),
    ]
}

fn short_text() -> impl Strategy<Value = String> {
    prop::collection::vec(
        prop_oneof![
            Just('a'),
            Just('b'),
            Just('/'),
            Just('!'),
            Just('é'),
            Just('\u{10000}'),
            Just('\u{ffff}')
        ],
        0..4,
    )
    .prop_map(|chars| chars.into_iter().collect())
}

fn geo_coordinate(limit: f64) -> impl Strategy<Value = f64> {
    prop_oneof![
        Just(0.0),
        Just(-0.0),
        Just(1.0),
        Just(-1.0),
        Just(limit),
        Just(-limit)
    ]
}

fn leaf() -> impl Strategy<Value = Value> {
    prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Boolean),
        edge_integer().prop_map(Value::Integer),
        edge_double().prop_map(Value::Double),
        (
            prop_oneof![
                Just(Timestamp::MIN_SECONDS),
                Just(0_i64),
                Just(1),
                Just(Timestamp::MAX_SECONDS)
            ],
            prop_oneof![Just(0_u32), Just(1), Just(999_999_999)]
        )
            .prop_map(|(s, n)| Value::Timestamp(Timestamp::new(s, n).expect("valid"))),
        short_text().prop_map(Value::String),
        prop::collection::vec(prop_oneof![Just(0_u8), Just(1), Just(255)], 0..3)
            .prop_map(Value::Bytes),
        short_text().prop_map(Value::Reference),
        (geo_coordinate(90.0), geo_coordinate(180.0))
            .prop_map(|(la, lo)| Value::GeoPoint(GeoPoint::new(la, lo).expect("valid"))),
        prop::collection::vec(edge_double(), 0..3).prop_map(Value::Vector),
    ]
}

fn value() -> impl Strategy<Value = Value> {
    leaf().prop_recursive(3, 24, 3, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..3).prop_map(Value::Array),
            prop::collection::btree_map(
                prop_oneof![
                    Just(String::new()),
                    Just("a".to_owned()),
                    Just("b".to_owned()),
                    Just("é".to_owned())
                ],
                inner,
                0..3
            )
            .prop_map(Value::Map),
        ]
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(4096))]

    /// `FVO.cmp_refl` and `FVO.cmp_swap`.
    #[test]
    fn canonical_cmp_is_reflexive_and_antisymmetric(a in value(), b in value()) {
        prop_assert_eq!(a.canonical_cmp(&a), Ordering::Equal);
        prop_assert_eq!(b.canonical_cmp(&a), a.canonical_cmp(&b).reverse());
    }

    /// `FVO.cmp_le_trans`, `FVO.cmp_lt_trans` and `FVO.cmp_eq_trans` (all three follow from
    /// the pointwise `FVO.Trans`): `cmp a c` is `cmp a b` then `cmp b c` when neither is
    /// `Greater`.
    #[test]
    fn canonical_cmp_is_transitive(a in value(), b in value(), c in value()) {
        let ab = a.canonical_cmp(&b);
        let bc = b.canonical_cmp(&c);
        if ab != Ordering::Greater && bc != Ordering::Greater {
            prop_assert_eq!(a.canonical_cmp(&c), ab.then(bc));
        }
    }

    /// Sorting by `canonical_cmp` gives a sequence whose every pair is ordered, which fails
    /// for a comparator that is not a total preorder.
    #[test]
    fn sorting_by_canonical_cmp_orders_every_pair(mut values in prop::collection::vec(value(), 0..10)) {
        values.sort_by(Value::canonical_cmp);
        for (i, x) in values.iter().enumerate() {
            for y in &values[i + 1..] {
                prop_assert_ne!(x.canonical_cmp(y), Ordering::Greater, "{:?} {:?}", x, y);
            }
        }
    }
}
