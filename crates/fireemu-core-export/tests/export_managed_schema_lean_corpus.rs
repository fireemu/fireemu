//! Replay managed export metadata order and scalar type codes against the Lean reference.

use fireemu_core_export::firestore::{write_managed_entity, ExportDocument};
use fireemu_core_export::leveldb::write_log;
use fireemu_core_export::managed::write_managed_export;
use fireemu_core_export::wire::{Reader, WireType};
use fireemu_core_firestore::value::Value;
use proptest::prelude::*;

fn document(collection: &str, id: &str, fields: &[(&str, Value)]) -> ExportDocument {
    ExportDocument {
        project: "demo-export".to_owned(),
        path: vec![
            ("parent".to_owned(), "first".to_owned()),
            (collection.to_owned(), id.to_owned()),
        ],
        fields: fields
            .iter()
            .map(|(name, value)| ((*name).to_owned(), value.clone()))
            .collect(),
    }
}

fn find_message(bytes: &[u8], tag: u32) -> &[u8] {
    let mut reader = Reader::new(bytes);
    while let Some((field, wire)) = reader.field().unwrap() {
        if field == tag && wire == WireType::Delimited {
            return reader.delimited().unwrap();
        }
        reader.skip(field, wire).unwrap();
    }
    panic!("missing field {tag}");
}

fn property(bytes: &[u8]) -> String {
    let mut reader = Reader::new(bytes);
    assert_eq!(reader.field().unwrap(), Some((1, WireType::Delimited)));
    let name = reader.string().unwrap();
    let shape = find_message(bytes, 2);
    let mut reader = Reader::new(shape);
    let mut repeated = false;
    let mut codes = Vec::new();
    while let Some(tag) = reader.field().unwrap() {
        match tag {
            (1, WireType::Varint) => repeated = reader.varint().unwrap() == 1,
            (2, WireType::Delimited) => codes.extend_from_slice(reader.delimited().unwrap()),
            _ => panic!("unexpected scalar schema field {tag:?}"),
        }
    }
    let flag = if repeated { "yes" } else { "no" };
    let codes = codes
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",");
    format!("{name}:{flag}:{codes}")
}

fn schema(metadata: &[u8]) -> String {
    let mut reader = Reader::new(find_message(find_message(metadata, 2), 3));
    let mut properties = Vec::new();
    while let Some((field, wire)) = reader.field().unwrap() {
        if field == 2 && wire == WireType::Delimited {
            properties.push(property(reader.delimited().unwrap()));
        } else {
            reader.skip(field, wire).unwrap();
        }
    }
    properties.join(";")
}

#[test]
fn scalar_schema_matches_lean() {
    let mut rows = include_str!("fixtures/lean-export-managed-schema.corpus").lines();
    assert_eq!(rows.next(), Some("# mode|order|shape|family|schema"));
    assert_eq!(rows.clone().count(), 48);
    for row in rows {
        let [mode, order, shape, family, expected] = row.split('|').collect::<Vec<_>>()[..] else {
            panic!("bad row {row:?}");
        };
        let member = match family {
            "scalar" => Value::Integer(1),
            "array" => Value::Array(vec![Value::Boolean(true), Value::Integer(2)]),
            "empty-array" => Value::Array(Vec::new()),
            _ => panic!("{row}"),
        };
        let mut first = vec![(if shape == "shared" { "z" } else { "q" }, member)];
        let mut second = vec![
            ("a", Value::Null),
            (
                "z",
                Value::Array(vec![
                    Value::Integer(3),
                    Value::Boolean(false),
                    Value::Integer(4),
                ]),
            ),
        ];
        if shape == "disjoint" {
            first.push(("z", Value::Double(0.5)));
            second.push(("zz", Value::Double(0.5)));
        }
        let second_collection = if mode == "exclude" {
            "outside"
        } else {
            "items"
        };
        let mut documents = vec![
            document("items", "z-doc", &first),
            document(second_collection, "a-doc", &second),
        ];
        if order == "reverse" {
            documents.reverse();
        }
        let (collections, namespaces) = match mode {
            "kind" | "exclude" => (vec!["items".to_owned(), "missing".to_owned()], Vec::new()),
            "all" => (Vec::new(), Vec::new()),
            "namespace" => (vec!["items".to_owned()], vec!["outside".to_owned()]),
            _ => panic!("{row}"),
        };
        let export = write_managed_export(
            "backup",
            "d",
            &collections,
            &namespaces,
            (10, 20),
            &documents,
        )
        .expect(row);
        assert_eq!(schema(&export.files[1].1), expected, "{row}");
        if matches!(mode, "kind" | "exclude") {
            let mut many_collections = collections;
            many_collections.extend((0..20).map(|i| format!("omitted-{i}")));
            documents.extend((0..520).map(|i| document("outside", &format!("other-{i}"), &[])));
            let export = write_managed_export(
                "backup",
                "d",
                &many_collections,
                &namespaces,
                (10, 20),
                &documents,
            )
            .expect(row);
            assert_eq!(schema(&export.files[1].1), expected, "grouped {row}");
        }
    }
}

#[test]
fn managed_selection_preserves_first_encoding_error_and_skips_unselected_documents() {
    let invalid = |name: &str| [("reference", Value::Reference(name.to_owned()))];
    let mut documents = vec![
        document("first", "a", &invalid("document-order-error")),
        document("second", "b", &invalid("partition-order-error")),
        document("safe", "c", &[]),
    ];
    documents.extend((0..520).map(|i| document("unselected", &format!("other-{i}"), &[])));
    let names = |values: &[&str]| {
        values
            .iter()
            .map(ToString::to_string)
            .chain((0..20).map(|i| format!("omitted-{i}")))
            .collect::<Vec<_>>()
    };
    let expected = write_managed_entity(&documents[1], "d").unwrap_err();
    assert_ne!(
        expected,
        write_managed_entity(&documents[0], "d").unwrap_err()
    );
    assert_eq!(
        write_managed_export(
            "backup",
            "d",
            &names(&["second", "first"]),
            &[],
            (10, 20),
            &documents
        ),
        Err(expected)
    );
    let exported = write_managed_export(
        "backup",
        "d",
        &names(&["safe", "missing"]),
        &[],
        (10, 20),
        &documents,
    )
    .unwrap();
    assert_eq!(exported.documents, 1);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]
    #[test]
    fn managed_data_bytes_match_batch_framing(
        kinds in proptest::collection::vec(0..8_u8, 16..22),
        groups in proptest::collection::vec(0..10_u8, 2..64),
        use_many_documents in any::<bool>(),
        fragment_a_record in any::<bool>(),
    ) {
        let mut documents = Vec::new();
        for (index, group) in groups.into_iter().enumerate() {
            let payload = if index == 0 && fragment_a_record {
                "é".repeat(20_000)
            } else {
                format!("記録-{index}")
            };
            documents.push(document(
                &group.to_string(),
                &index.to_string(),
                &[("value", Value::String(payload))],
            ));
        }
        if use_many_documents {
            documents.extend((0..520).map(|i| document("outside", &format!("other-{i}"), &[])));
        }
        let filters = kinds.iter().map(u8::to_string).collect::<Vec<_>>();
        let export = write_managed_export("backup", "named", &filters, &[], (10, 20), &documents)
            .unwrap();
        let (mut count, mut bytes) = (0, 0);
        for (ordinal, filter) in filters.iter().enumerate() {
            let records = documents.iter()
                .filter(|document| &document.path.last().unwrap().0 == filter)
                .map(|document| write_managed_entity(document, "named").unwrap())
                .collect::<Vec<_>>();
            count += records.len() as u64;
            bytes += records.iter().map(|record| record.len() as u64).sum::<u64>();
            let (name, actual) = &export.files[2 + 2 * ordinal];
            prop_assert_eq!(name, &format!("all_namespaces/kind_{filter}/output-{ordinal}"));
            prop_assert_eq!(actual, &write_log(&records));
        }
        prop_assert_eq!(export.documents, count);
        prop_assert_eq!(export.bytes, bytes);
    }
}
