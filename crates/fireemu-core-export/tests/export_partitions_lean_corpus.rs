//! Checks the Lean reference against managed export partition selection and file inventory.

use std::collections::BTreeMap;

use fireemu_core_export::firestore::{ExportDocument, FirestoreExportError};
use fireemu_core_export::leveldb::read_log;
use fireemu_core_export::managed::{
    partitions, read_managed_output, read_overall, read_partition_outputs, write_managed_export,
    Partition,
};

const CASES: &str = include_str!("fixtures/lean-export-partitions.corpus");

fn collection_filters(case: &str) -> Vec<String> {
    match case {
        "none" => Vec::new(),
        "single" => vec!["posts".into()],
        "multi" => vec!["users".into(), "posts".into(), "不存在".into()],
        "duplicate" => vec!["posts".into(), "posts".into()],
        _ => panic!("unexpected collection case {case}"),
    }
}

fn namespace_filters(case: &str) -> Vec<String> {
    match case {
        "absent" => Vec::new(),
        "empty" => vec![String::new()],
        "named" => vec!["outside".into()],
        "multi" => vec!["z".into(), String::new(), "a".into()],
        "duplicate" => vec![String::new(), String::new()],
        _ => panic!("unexpected namespace case {case}"),
    }
}

fn fixture(case: &str) -> Vec<ExportDocument> {
    match case {
        "empty" => Vec::new(),
        "populated" => [
            vec![("posts", "p2")],
            vec![("users", "使用者"), ("posts", "p1")],
            vec![("users", "使用者")],
            vec![("cities", "c1")],
        ]
        .into_iter()
        .map(|path| ExportDocument {
            project: "demo-app".to_owned(),
            path: path
                .into_iter()
                .map(|(collection, document)| (collection.to_owned(), document.to_owned()))
                .collect(),
            fields: BTreeMap::new(),
        })
        .collect(),
        _ => panic!("unexpected document case {case}"),
    }
}

fn parse_partition(text: &str) -> Partition {
    match text {
        "all" => Partition::AllKinds,
        _ if text.starts_with("kind:") => Partition::Kind(text[5..].to_owned()),
        _ if text.starts_with("ns:") => Partition::Namespace(text[3..].to_owned()),
        _ => panic!("malformed partition: {text}"),
    }
}

fn check_outputs(
    export: &fireemu_core_export::managed::ManagedExport,
    expected_parts: &[Partition],
    expected_selection: &[&str],
    overall: Option<&[fireemu_core_export::managed::OverallEntry]>,
    row: &str,
) {
    let mut totals = (0, 0);
    for (ordinal, files) in export.files[1..].chunks_exact(2).enumerate() {
        let (metadata_path, metadata) = &files[0];
        let (output_path, output) = &files[1];
        let output_name = output_path.rsplit_once('/').unwrap().1;
        assert_eq!(read_partition_outputs(metadata).unwrap(), [output_name]);

        let actual = read_managed_output(output).expect(row);
        let expected_paths = expected_selection[ordinal]
            .split(',')
            .filter(|path| *path != "-")
            .collect::<Vec<_>>();
        assert!(
            actual.iter().all(|entity| entity.database == "named"),
            "{row}"
        );
        assert_eq!(
            actual
                .iter()
                .map(|entity| entity.document.relative_path())
                .collect::<Vec<_>>(),
            expected_paths,
            "{row}"
        );
        assert_eq!(output.is_empty(), expected_paths.is_empty(), "{row}");
        let payload_bytes = read_log(output)
            .unwrap()
            .iter()
            .map(|record| u64::try_from(record.len()).unwrap())
            .sum::<u64>();
        let document_count = u64::try_from(expected_paths.len()).unwrap();
        if let Some(entries) = overall {
            let entry = &entries[ordinal];
            assert_eq!(entry.partition, expected_parts[ordinal], "{row}");
            assert_eq!(&entry.metadata_file, metadata_path, "{row}");
            assert_eq!(entry.documents, document_count, "{row}");
            assert_eq!(entry.bytes, payload_bytes, "{row}");
        }
        totals.0 += document_count;
        totals.1 += payload_bytes;
    }
    assert_eq!((export.documents, export.bytes), totals, "{row}");
}

#[test]
fn replay_ordered_partition_and_output_inventories() {
    let mut cases = CASES.lines();
    assert_eq!(
        cases.next(),
        Some(
            "# COLLECTIONS NAMESPACES DOCUMENTS PARTITIONS FILES SELECTIONS OVERALL, tab separated"
        )
    );
    let mut count = 0;
    for row in cases {
        let columns = row.split('\t').collect::<Vec<_>>();
        let [collection_case, namespace_case, document_case, parts, files, selected, overall] =
            columns.as_slice()
        else {
            panic!("malformed corpus row: {row}");
        };
        let collections = collection_filters(collection_case);
        let namespaces = namespace_filters(namespace_case);
        let documents = fixture(document_case);
        let expected_parts = parts.split(',').map(parse_partition).collect::<Vec<_>>();
        let expected_files = files.split(',').collect::<Vec<_>>();
        let expected_selection = selected.split(';').collect::<Vec<_>>();
        assert_eq!(
            partitions(&collections, &namespaces),
            expected_parts,
            "{row}"
        );
        let export = write_managed_export(
            "export",
            "named",
            &collections,
            &namespaces,
            (10, 20),
            &documents,
        )
        .expect(row);
        assert_eq!(
            export
                .files
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            expected_files,
            "{row}"
        );
        assert_eq!(expected_selection.len(), expected_parts.len(), "{row}");
        let overall = match *overall {
            "ok" => Some(read_overall(&export.files[0].1).expect(row)),
            "duplicate" => {
                let error = read_overall(&export.files[0].1).expect_err(row);
                assert!(
                    matches!(error, FirestoreExportError::Shape(message) if message.ends_with("twice")),
                    "{row}"
                );
                None
            }
            _ => panic!("unexpected overall result in {row}"),
        };
        if let Some(entries) = &overall {
            assert_eq!(entries.len(), expected_parts.len(), "{row}");
        }

        check_outputs(
            &export,
            &expected_parts,
            &expected_selection,
            overall.as_deref(),
            row,
        );
        count += 1;
    }
    assert_eq!(count, 40);
}
