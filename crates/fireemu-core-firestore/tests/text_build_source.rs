//! Source selection for text index builds.

use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_firestore::store::{FirestoreState, ImportedDocument};
use fireemu_core_types::ids::{CollectionId, DatabaseId, ProjectId};
use fireemu_core_types::time::LogicalInstant;
use std::collections::BTreeMap;
use std::sync::Arc;

#[test]
fn collection_group_build_uses_the_live_source_in_document_path_order() {
    let project = ProjectId::try_new("demo-app").unwrap();
    let path = |name| DocumentPath::parse(&project, &DatabaseId::default_database(), name).unwrap();
    let group = CollectionId::try_new("items").unwrap();
    let mut state = FirestoreState::new();
    state
        .import_documents(
            [
                "items/a",
                "other/a",
                "parents/a/items/b",
                "items/a!/items/c",
            ]
            .map(|name| ImportedDocument {
                path: path(name),
                fields: BTreeMap::new(),
                create_time: None,
                update_time: None,
            })
            .to_vec(),
            LogicalInstant::UNIX_EPOCH,
        )
        .unwrap();
    let selected = state.live_collection_group_handles(&group);
    assert_eq!(
        selected.iter().map(|doc| &doc.path).collect::<Vec<_>>(),
        state
            .documents()
            .iter()
            .filter(|doc| doc.path.collection_id() == &group)
            .map(|doc| &doc.path)
            .collect::<Vec<_>>()
    );
    for document in selected {
        assert!(Arc::ptr_eq(
            &document,
            &state.get_shared(&document.path).unwrap()
        ));
    }
}
