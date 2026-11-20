use fireemu_core_types::edition::{
    DatabaseCapabilities, EditionError, FeatureCapability, FirestoreApiMode, FirestoreEdition,
};
use fireemu_core_types::ids::LimitCatalogId;

fn status(value: FeatureCapability) -> &'static str {
    match value {
        FeatureCapability::Unsupported => "unsupported",
        FeatureCapability::Preview => "preview",
        FeatureCapability::GeneralAvailability => "ga",
    }
}

#[test]
fn firestore_capabilities_and_rejection_precedence_follow_the_lean_table() {
    let mut lines = include_str!("fixtures/lean-firestore-edition.corpus").lines();
    assert_eq!(lines.next(), Some("# edition|api|catalog|result"));
    let mut count = 0;
    for row in lines {
        let fields: Vec<_> = row.split('|').collect();
        let [edition, mode, catalog, expected]: [&str; 4] = fields.try_into().expect("four fields");
        let edition = FirestoreEdition::parse_config_str(edition).unwrap();
        let mode = FirestoreApiMode::parse_config_str(mode).unwrap();
        let catalog = LimitCatalogId::try_new(catalog).unwrap();
        let result = DatabaseCapabilities::try_new(edition, mode, catalog.clone());
        let actual = match result {
            Ok(capabilities) => {
                assert_eq!(capabilities.edition, edition);
                assert_eq!(capabilities.api_mode, mode);
                assert_eq!(capabilities.limit_catalog_id, catalog);
                format!(
                    "ok:{}:{}:{}:{}",
                    capabilities.core_operations,
                    capabilities.pipeline_operations,
                    status(capabilities.text_search),
                    status(capabilities.geospatial_search),
                )
            }
            Err(EditionError::InvalidCombination {
                edition: actual_edition,
                api_mode,
            }) => {
                assert_eq!(actual_edition, edition);
                assert_eq!(api_mode, mode);
                "invalid-combination".to_owned()
            }
            Err(EditionError::CatalogEditionMismatch {
                edition: actual_edition,
                catalog: actual_catalog,
            }) => {
                assert_eq!(actual_edition, edition);
                assert_eq!(actual_catalog, catalog);
                "catalog-mismatch".to_owned()
            }
        };
        assert_eq!(actual, expected, "{row}");
        count += 1;
    }
    assert_eq!(count, 16);
}
