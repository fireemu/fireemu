//! Replays the normalized index definition checks shared by startup and the Admin service.

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::index::{
    CompositeShapeError, IndexDefinition, IndexField, IndexFieldMode, IndexQueryScope,
};
use fireemu_core_types::ids::CollectionId;
use std::collections::BTreeSet;

const CORPUS: &str = include_str!("fixtures/lean-firestore-index-config.corpus");

fn entry(scope: &str, count: usize, layout: &str) -> IndexDefinition {
    let fields = (0..count)
        .map(|position| IndexField {
            path: if layout == "name" && position == 0 {
                FieldPath::document_name()
            } else {
                FieldPath::parse(&format!("field{position}")).unwrap()
            },
            mode: match (layout, position) {
                ("array" | "two-arrays", 0) | ("two-arrays", 1) => IndexFieldMode::Contains,
                ("vector", 0) => IndexFieldMode::Vector { dimension: 16 },
                _ => IndexFieldMode::Ascending,
            },
        })
        .collect();
    IndexDefinition {
        collection_group: CollectionId::try_new("leanShapes").unwrap(),
        query_scope: match scope {
            "collection" => IndexQueryScope::Collection,
            "group" => IndexQueryScope::CollectionGroup,
            _ => panic!("unknown scope {scope}"),
        },
        fields,
    }
}

#[test]
fn deploy_and_emulator_index_shape_checks_agree_with_lean() {
    let mut rows = CORPUS.lines();
    assert_eq!(rows.next(), Some("# 100 cases."));
    let mut seen = BTreeSet::new();
    for line in rows {
        let fields: Vec<_> = line.split('\t').collect();
        let [id, profile, scope, count, layout, expected] = fields.as_slice() else {
            panic!("invalid row: {line}");
        };
        assert!(seen.insert(*id), "duplicate row {id}");
        let index = entry(scope, count.parse().unwrap(), layout);
        let result = index.check_capacity().and_then(|()| match *profile {
            "emu" => Ok(()),
            "deploy" => index.check_necessary(),
            _ => panic!("unknown profile {profile}"),
        });
        assert_eq!(
            result,
            match *expected {
                "ok" => Ok(()),
                "too-many" => Err(CompositeShapeError::TooManyFields),
                "multiple-arrays" => Err(CompositeShapeError::MultipleArrayFields),
                "unnecessary" => Err(CompositeShapeError::NotNecessary),
                _ => panic!("unknown verdict {expected}"),
            },
            "{id}",
        );
    }
    assert_eq!(seen.len(), 100);
}
