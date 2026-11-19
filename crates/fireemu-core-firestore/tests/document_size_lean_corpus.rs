//! Replay of the Lean storage sizes in `verification/lean/document-size` against the public
//! Rust API, with proptest checks of the proved formulas and laws. The Rust tests do not need Lean.

use std::collections::BTreeMap;

use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_firestore::size::{
    document_name_size, document_size, field_value_size, index_entry_size, indexed_value_size,
    IndexEntryScope, SizeContributor, SizeError,
};
use fireemu_core_firestore::value::{GeoPoint, Timestamp, Value};
use fireemu_core_limits::model::EnforcementPrecision;
use fireemu_core_types::ids::{DatabaseId, ProjectId};
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-document-size.corpus");

fn utf8(token: &str) -> String {
    assert_eq!(token.len() % 2, 0, "odd hex length: {token}");
    let bytes = (0..token.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&token[i..i + 2], 16).expect("hex byte"))
        .collect();
    String::from_utf8(bytes).expect("UTF-8")
}

fn key(token: &str) -> String {
    utf8(token.strip_prefix("key:").expect("key: prefix"))
}

fn path(relative: &str) -> DocumentPath {
    DocumentPath::parse(
        &ProjectId::try_new("demo-app").unwrap(),
        &DatabaseId::default_database(),
        relative,
    )
    .expect("valid document path")
}

fn scope(tag: &str) -> IndexEntryScope {
    match tag {
        "sc" => IndexEntryScope::SingleFieldCollection,
        "sg" => IndexEntryScope::SingleFieldCollectionGroup,
        "cc" => IndexEntryScope::CompositeCollection,
        "cg" => IndexEntryScope::CompositeCollectionGroup,
        _ => panic!("unknown index scope: {tag}"),
    }
}

fn parse_entries<'a>(
    tokens: &mut impl Iterator<Item = &'a str>,
    count: usize,
) -> Vec<(String, Value)> {
    (0..count)
        .map(|_| {
            let name = key(tokens.next().expect("field name"));
            (name, parse_value(tokens))
        })
        .collect()
}

fn parse_value<'a>(tokens: &mut impl Iterator<Item = &'a str>) -> Value {
    let token = tokens.next().expect("value token");
    let (tag, arg) = token.split_once(':').unwrap_or((token, ""));
    match (tag, arg) {
        ("null", "") => Value::Null,
        ("bool", "0") => Value::Boolean(false),
        ("bool", "1") => Value::Boolean(true),
        ("int", "") => Value::Integer(i64::MIN),
        ("dbl", "") => Value::Double(f64::NAN),
        ("ts", "") => Value::Timestamp(Timestamp::new(-1, 999_999_999).unwrap()),
        ("geo", "") => Value::GeoPoint(GeoPoint::new(90.0, -180.0).unwrap()),
        ("str", _) => Value::String(utf8(arg)),
        ("ref", _) => Value::Reference(utf8(arg)),
        ("bytes", _) => Value::Bytes(vec![0; arg.parse().expect("byte count")]),
        ("vec", _) => Value::Vector(vec![0.0; arg.parse().expect("vector length")]),
        ("arr", _) => {
            let count: usize = arg.parse().expect("array length");
            Value::Array((0..count).map(|_| parse_value(tokens)).collect())
        }
        ("map", _) => {
            let count = arg.parse().expect("map length");
            let fields: BTreeMap<_, _> = parse_entries(tokens, count).into_iter().collect();
            assert_eq!(fields.len(), count, "duplicate map key");
            Value::Map(fields)
        }
        _ => panic!("unknown value token: {token}"),
    }
}

fn expect_size(expected: &str) -> Result<u64, SizeError> {
    match expected {
        "overflow" => Err(SizeError::Overflow),
        _ => Ok(expected.parse().expect("expected u64 size")),
    }
}

#[test]
fn storage_sizes_match_the_lean_specification_on_the_golden_corpus() {
    let mut lines = CORPUS.lines();
    let (count, _) = lines
        .next()
        .expect("corpus header")
        .strip_prefix("# ")
        .expect("header comment")
        .split_once(" cases. ")
        .expect("declared case count");
    let count: usize = count.parse().expect("number of cases");
    assert_eq!(lines.clone().count(), count);
    assert!(count >= 200, "corpus only has {count} cases");

    for (index, line) in lines.enumerate() {
        let line_number = index + 2;
        let (input, expected) = line.split_once(" => ").expect("case separator");
        let mut tokens = input.split(' ');
        let actual = match tokens.next().expect("operation") {
            "value" => field_value_size(&parse_value(&mut tokens)),
            "fields" => {
                let value = parse_value(&mut tokens);
                assert!(matches!(value, Value::Map(_)), "line {line_number}");
                field_value_size(&value)
            }
            "reference" => {
                let resource = utf8(tokens.next().expect("reference"));
                field_value_size(&Value::Reference(resource))
            }
            "name" => document_name_size(&path(&utf8(tokens.next().expect("path")))),
            "document" => {
                let document = path(&utf8(tokens.next().expect("path")));
                let Value::Map(fields) = parse_value(&mut tokens) else {
                    panic!("line {line_number}: expected document fields");
                };
                let result = document_size(&document, &fields);
                if expected == "overflow" {
                    result.map(|size| size.total)
                } else {
                    let size = result.unwrap_or_else(|error| panic!("line {line_number}: {error}"));
                    let mut expected = expected.split(' ');
                    let total = expect_size(expected.next().expect("total"));
                    let name_bytes = expect_size(expected.next().expect("name bytes")).unwrap();
                    let revision = expected.next().expect("model revision");
                    let precision = match expected.next().expect("precision") {
                        "BoundaryConformance" => EnforcementPrecision::BoundaryConformance,
                        other => panic!("line {line_number}: unknown precision {other}"),
                    };
                    let count: usize = expected.next().expect("count").parse().unwrap();
                    let contributors: Vec<_> = (0..count)
                        .map(|_| SizeContributor {
                            name: key(expected.next().expect("contributor")),
                            bytes: expect_size(expected.next().expect("contributor bytes"))
                                .unwrap(),
                        })
                        .collect();
                    assert!(expected.next().is_none(), "line {line_number}");
                    assert_eq!(Ok(size.total), total, "line {line_number}");
                    assert_eq!(size.name_bytes, name_bytes, "line {line_number}");
                    assert_eq!(size.model_revision, revision, "line {line_number}");
                    assert_eq!(size.precision, precision, "line {line_number}");
                    assert_eq!(
                        size.largest_contributors, contributors,
                        "line {line_number}"
                    );
                    assert!(tokens.next().is_none(), "line {line_number}");
                    continue;
                }
            }
            "indexed" => indexed_value_size(&parse_value(&mut tokens)),
            "index" => {
                let scope = scope(tokens.next().expect("scope"));
                let document = path(&utf8(tokens.next().expect("path")));
                let parent = tokens.next().expect("parent");
                let parent = (parent != "-").then(|| path(&utf8(parent)));
                let count = tokens
                    .next()
                    .expect("index fields")
                    .strip_prefix("map:")
                    .expect("map: prefix")
                    .parse()
                    .expect("index field count");
                let fields = parse_entries(&mut tokens, count);
                let fields: Vec<_> = fields.iter().map(|(k, v)| (k.as_str(), v)).collect();
                index_entry_size(scope, &document, parent.as_ref(), &fields)
            }
            op => panic!("line {line_number}: unknown operation {op}"),
        };
        assert!(
            tokens.next().is_none(),
            "line {line_number}: trailing input"
        );
        assert_eq!(actual, expect_size(expected), "line {line_number}");
    }
}

#[test]
fn empty_single_field_indexes_report_overflow() {
    let document = path("c/d");
    for tag in ["sc", "sg"] {
        assert_eq!(
            index_entry_size(scope(tag), &document, None, &[]),
            Err(SizeError::Overflow)
        );
    }
}

#[test]
fn replacing_an_existing_field_can_shrink_a_map() {
    let mut fields = BTreeMap::from([(
        "k".into(),
        Value::GeoPoint(GeoPoint::new(0.0, 0.0).unwrap()),
    )]);
    assert_eq!(field_value_size(&Value::Map(fields.clone())), Ok(18));
    fields.insert("k".into(), Value::Null);
    assert_eq!(field_value_size(&Value::Map(fields)), Ok(3));
}

#[test]
fn document_size_reports_sizes_above_one_mib() {
    let fields = BTreeMap::from([("b".into(), Value::Bytes(vec![0; 1_048_523]))]);
    assert_eq!(
        document_size(&path("c/d"), &fields).unwrap().total,
        1_048_577
    );
}

fn string_bytes(s: &str) -> u64 {
    u64::try_from(s.len()).unwrap() + 1
}

/// Generate a value with its unbounded charge calculated independently of the Rust API.
fn sized_value() -> impl Strategy<Value = (Value, u64)> {
    prop_oneof![
        Just((Value::Null, 1)),
        any::<bool>().prop_map(|v| (Value::Boolean(v), 1)),
        any::<i64>().prop_map(|v| (Value::Integer(v), 8)),
        any::<u64>().prop_map(|v| (Value::Double(f64::from_bits(v)), 8)),
        (-1000..1000i64, 0..1_000_000_000u32)
            .prop_map(|(s, n)| (Value::Timestamp(Timestamp::new(s, n).unwrap()), 8)),
        Just((Value::GeoPoint(GeoPoint::new(1.0, -1.0).unwrap()), 16)),
        "[aé猫🐈]{0,900}".prop_map(|s| {
            let size = string_bytes(&s);
            (Value::String(s), size)
        }),
        (0..1600usize).prop_map(|n| (Value::Bytes(vec![0; n]), u64::try_from(n).unwrap())),
        (0..200usize).prop_map(|n| (Value::Vector(vec![0.0; n]), u64::try_from(n).unwrap() * 8)),
        ("[aé]{1,1500}", "[0-9]{1,6}").prop_map(|(c, d)| {
            let size = 16 + string_bytes(&c) + string_bytes(&d);
            (
                Value::Reference(format!(
                    "projects/documents/databases/documents/documents/{c}/{d}"
                )),
                size,
            )
        }),
    ]
    .prop_recursive(4, 32, 5, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..5).prop_map(|items| {
                let (values, charges): (Vec<_>, Vec<u64>) = items.into_iter().unzip();
                (Value::Array(values), charges.into_iter().sum())
            }),
            prop::collection::btree_map("[aé猫🐈]{0,6}", inner, 0..5).prop_map(|fields| {
                let mut size = 0;
                let fields = fields
                    .into_iter()
                    .map(|(key, (value, charge))| {
                        size += string_bytes(&key) + charge;
                        (key, value)
                    })
                    .collect();
                (Value::Map(fields), size)
            }),
        ]
    })
}

proptest! {
    /// `field_value_size_exact`, `value_overflow_iff` and `indexed_value_size_exact`.
    #[test]
    fn bounded_values_have_the_specified_charges((value, size) in sized_value()) {
        let index_charge = if matches!(value, Value::Reference(_)) { size } else { size.min(1500) };
        prop_assert_eq!(field_value_size(&value), Ok(size));
        prop_assert_eq!(indexed_value_size(&value), Ok(index_charge));
    }

    /// `array_concat_size` and `array_size_monotone` below the overflow bound.
    #[test]
    fn concatenating_arrays_adds_their_sizes(
        left in prop::collection::vec(sized_value(), 0..6),
        right in prop::collection::vec(sized_value(), 0..6),
    ) {
        let (mut left, left_sizes): (Vec<_>, Vec<u64>) = left.into_iter().unzip();
        let (right, right_sizes): (Vec<_>, Vec<u64>) = right.into_iter().unzip();
        let a = field_value_size(&Value::Array(left.clone())).unwrap();
        let b = field_value_size(&Value::Array(right.clone())).unwrap();
        left.extend(right);
        let joined = field_value_size(&Value::Array(left)).unwrap();
        prop_assert_eq!(joined, a + b);
        prop_assert_eq!(joined, left_sizes.into_iter().chain(right_sizes).sum::<u64>());
        prop_assert!(joined >= a);
    }

    /// `disjoint_map_union_size`, `map_size_monotone`, `document_size_exact`,
    /// `document_overflow_iff` and `document_size_monotone` on bounded disjoint maps.
    #[test]
    fn disjoint_fields_add_their_sizes_to_maps_and_documents(
        left in prop::collection::btree_map("a[aé猫🐈]{0,6}", sized_value(), 0..6),
        right in prop::collection::btree_map("b[aé猫🐈]{0,6}", sized_value(), 0..6),
        c in "[aé猫]{1,10}",
        d in "[0-9]{1,10}",
    ) {
        let expected_fields: u64 = left.iter().chain(&right)
            .map(|(k, (_, n))| string_bytes(k) + n)
            .sum();
        let mut left: BTreeMap<_, _> = left.into_iter().map(|(k, (v, _))| (k, v)).collect();
        let right: BTreeMap<_, _> = right.into_iter().map(|(k, (v, _))| (k, v)).collect();
        let a = field_value_size(&Value::Map(left.clone())).unwrap();
        let b = field_value_size(&Value::Map(right.clone())).unwrap();
        let document = path(&format!("{c}/{d}"));
        let before = document_size(&document, &left).unwrap().total;
        left.extend(right);
        let after = document_size(&document, &left).unwrap();
        let joined = field_value_size(&Value::Map(left)).unwrap();
        prop_assert_eq!(joined, a + b);
        prop_assert!(joined >= a);
        prop_assert_eq!(joined, expected_fields);
        let name = 16 + string_bytes(&c) + string_bytes(&d);
        prop_assert_eq!(document_name_size(&document), Ok(name));
        prop_assert_eq!(after.name_bytes, name);
        prop_assert_eq!(after.total, name + expected_fields + 32);
        prop_assert_eq!(after.total, before + b);
        prop_assert!(after.total >= before);
    }

    /// `index_entry_size_within_bound` for each scope, with and without a parent.
    #[test]
    fn bounded_index_entries_have_the_specified_charges(
        fields in prop::collection::vec(("[aé猫🐈]{0,8}", sized_value()), 0..5),
        with_parent in any::<bool>(),
    ) {
        let parent = with_parent.then(|| path("c/d"));
        let document = if with_parent { path("c/d/e/f") } else { path("e/f") };
        let name = if with_parent { 24 } else { 20 };
        let parent_bytes = if with_parent { 20 } else { 0 };
        let entries: Vec<_> = fields.iter().map(|(k, (v, _))| (k.as_str(), v)).collect();
        let charges: Vec<_> = fields.iter().map(|(k, (v, n))| {
            let bytes = if matches!(v, Value::Reference(_)) { *n } else { (*n).min(1500) };
            (string_bytes(k), bytes)
        }).collect();
        let first = charges.first().map(|(k, v)| k + v);
        let all: u64 = charges.iter().map(|(_, v)| v).sum();
        for (tag, expected) in [
            ("sc", first.map(|n| name + parent_bytes + n + 32).ok_or(SizeError::Overflow)),
            ("sg", first.map(|n| name + n + 48).ok_or(SizeError::Overflow)),
            ("cc", Ok(name + parent_bytes + all + 32)),
            ("cg", Ok(name + all + 32)),
        ] {
            prop_assert_eq!(index_entry_size(scope(tag), &document, parent.as_ref(), &entries), expected);
        }
    }
}
