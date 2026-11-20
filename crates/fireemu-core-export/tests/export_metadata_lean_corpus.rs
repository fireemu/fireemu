//! Differential replay of Lean manifest and Storage metadata decisions.

use fireemu_core_export::json::Json;
use fireemu_core_export::metadata::{ExportMetadata, Section};
use fireemu_core_export::storage::ObjectMetadata;

const CORPUS: &str = include_str!("fixtures/lean-export-metadata.corpus");

fn section(section: &Section) -> String {
    let sidecar = section
        .metadata_file
        .as_ref()
        .map_or_else(|| "-".into(), |s| format!("+{s}"));
    format!("{}~{}~{sidecar}", section.version, section.path)
}

fn manifest_signature(manifest: &ExportMetadata) -> String {
    let sections: Vec<_> = manifest
        .sections
        .iter()
        .map(|(product, item)| format!("{}:{}", product.key(), section(item)))
        .collect();
    let deferred: Vec<_> = manifest.deferred().into_iter().map(|p| p.key()).collect();
    let extension = manifest.extension.as_ref().map_or_else(
        || "-".to_owned(),
        |value| {
            let records: Vec<_> = manifest
                .named_databases()
                .iter()
                .map(|(name, item)| format!("{name}:{}", section(item)))
                .collect();
            format!("+{}:{}", value.version, records.join(","))
        },
    );
    format!(
        "{};{};{};{extension}",
        manifest.version,
        sections.join(","),
        deferred.join(",")
    )
}

fn object_signature(object: &ObjectMetadata) -> String {
    let custom: Vec<_> = object
        .custom_metadata
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    let extras: Vec<_> = object
        .extra
        .iter()
        .map(|(k, v)| {
            let Json::Int(n) = v else {
                panic!("unexpected extra metadata: {v:?}");
            };
            format!("{k}={n}")
        })
        .collect();
    format!(
        "{};{};{};{};{};{};{};{}",
        object.name,
        object.bucket,
        object.size,
        object.generation,
        object.metageneration,
        object.download_tokens.join(","),
        custom.join(","),
        extras.join(",")
    )
}

#[test]
fn manifest_sections_and_typed_storage_metadata_match_lean() {
    let mut lines = CORPUS.lines();
    let declared: usize = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases"))
        .expect("case count")
        .parse()
        .expect("numeric count");
    assert_eq!(declared, lines.clone().count());
    assert!(declared > 680);
    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        let [kind, _, _, _, _, input, outcome, expected] = fields.as_slice() else {
            panic!("invalid case: {line}");
        };
        match (*kind, *outcome) {
            ("manifest", "ok") => {
                let value = ExportMetadata::parse(input).unwrap_or_else(|e| panic!("{line}: {e}"));
                assert_eq!(manifest_signature(&value), *expected, "{line}");
                let has_named_databases = !value.named_databases().is_empty();
                if value.extension.is_none() || has_named_databases {
                    let reparsed = ExportMetadata::parse(&value.to_json()).expect("round trip");
                    assert_eq!(reparsed, value, "{line}");
                }
            }
            ("manifest", "err") => {
                assert_eq!(
                    ExportMetadata::parse(input).expect_err(line).0,
                    *expected,
                    "{line}"
                );
            }
            ("storage", "ok") => {
                let value = ObjectMetadata::parse(input).unwrap_or_else(|e| panic!("{line}: {e}"));
                let (projection, serialized_size) =
                    expected.rsplit_once(';').expect("size projection");
                assert_eq!(object_signature(&value), projection, "{line}");
                let reparsed = ObjectMetadata::parse(&value.to_json()).expect("round trip");
                let mut normalized = value;
                normalized.size = serialized_size.parse().expect("serialized size");
                assert_eq!(reparsed, normalized, "{line}");
            }
            ("storage", "err") => {
                assert_eq!(
                    ObjectMetadata::parse(input).expect_err(line).0,
                    *expected,
                    "{line}"
                );
            }
            _ => panic!("invalid case: {line}"),
        }
    }
}
