//! Production's missing-index refusals (FS-QUERY-INDEX, recorded 2026-09-24).
//!
//! Production names the index a query needs in one of three forms:
//! - a composite index: `The query requires an index. You can create it here: <console link
//!   with create_composite=<encoded Index>>`, followed by a pointer to the multiple-range-fields
//!   guide when the query has inequality filters on more than one field;
//! - a single-field index that is disabled (an exemption, or the collection-group scope that is
//!   off by default): `The query requires a <SCOPE>_<ASC|DESC|CONTAINS> index for collection <G>
//!   and field <F>. You can create it here: <console link with create_exemption=<encoded Index>>`;
//! - a vector index: `Missing vector index configuration. Please create the required index with
//!   the following gcloud command: gcloud firestore indexes composite create ...`.
//!
//! The console links carry a `google.firestore.admin.v1.Index` message, base64url without
//! padding, whose name ends in `/indexes/_` (composite) or `/fields/<field>` (exemption).

use fireemu_core_firestore::index::{
    IndexDefinition, IndexField, IndexFieldMode, IndexQueryScope, IndexSet,
};
use fireemu_core_firestore::query::{Direction, FieldOp, FilterExpr, OrderClause, Query};
use fireemu_core_firestore::store::Aggregation;
use fireemu_core_firestore::value::Value;
use prost::Message;

/// `google.firestore.admin.v1.Index.IndexField`.
#[derive(Clone, PartialEq, Message)]
struct AdminIndexField {
    #[prost(string, tag = "1")]
    field_path: String,
    #[prost(int32, optional, tag = "2")]
    order: Option<i32>,
    #[prost(int32, optional, tag = "3")]
    array_config: Option<i32>,
}

/// `google.firestore.admin.v1.Index` (the fields the console link carries).
#[derive(Clone, PartialEq, Message)]
struct AdminIndex {
    #[prost(string, tag = "1")]
    name: String,
    #[prost(int32, tag = "2")]
    query_scope: i32,
    #[prost(message, repeated, tag = "3")]
    fields: Vec<AdminIndexField>,
}

const MULTIPLE_RANGE_FIELDS: &str = " .\nThe query contains range and inequality filters on \
multiple fields, please refer to the documentation for index selection best practices: \
https://cloud.google.com/firestore/docs/query-data/multiple-range-fields.";

fn scope_number(scope: IndexQueryScope) -> i32 {
    match scope {
        IndexQueryScope::Collection => 1,
        IndexQueryScope::CollectionGroup => 2,
    }
}

fn admin_field(path: String, mode: IndexFieldMode) -> AdminIndexField {
    let (order, array_config) = match mode {
        IndexFieldMode::Ascending => (Some(1), None),
        IndexFieldMode::Descending => (Some(2), None),
        IndexFieldMode::Contains => (None, Some(1)),
        IndexFieldMode::Vector { .. } => (None, None),
    };
    AdminIndexField {
        field_path: path,
        order,
        array_config,
    }
}

/// base64url without padding, as the console links carry it.
fn blob(index: &AdminIndex) -> String {
    crate::rest::json::base64_encode(&index.encode_to_vec())
        .trim_end_matches('=')
        .replace('+', "-")
        .replace('/', "_")
}

/// `projects/<p>` of a database name `projects/<p>/databases/<d>`.
fn project_of(database: &str) -> &str {
    database
        .strip_prefix("projects/")
        .and_then(|rest| rest.split('/').next())
        .unwrap_or_default()
}

/// The console page of a database's indexes: production names a named database in the link
/// (`/firestore/databases/<d>/indexes`) and leaves `(default)` out (`/firestore/indexes`).
fn console(database: &str) -> String {
    let id = database.rsplit('/').next().unwrap_or_default();
    if id == fireemu_core_types::ids::DatabaseId::DEFAULT || !database.contains("/databases/") {
        format!(
            "https://console.firebase.google.com/v1/r/project/{}/firestore/indexes",
            project_of(database)
        )
    } else {
        format!(
            "https://console.firebase.google.com/v1/r/project/{}/firestore/databases/{id}/indexes",
            project_of(database)
        )
    }
}

/// The one field of a requirement a single-field index would serve: one ordered or
/// array-contains field followed only by `__name__` in the direction the automatic index
/// implies.
fn single_field(requirement: &IndexDefinition) -> Option<(String, IndexFieldMode)> {
    let fields = &requirement.fields;
    let first = fields.first()?;
    if first.path.is_document_name() || matches!(first.mode, IndexFieldMode::Vector { .. }) {
        return None;
    }
    let implied = match first.mode {
        IndexFieldMode::Descending => IndexFieldMode::Descending,
        _ => IndexFieldMode::Ascending,
    };
    let rest_is_implied_name = match &fields[1..] {
        [] => true,
        [name] => name.path.is_document_name() && name.mode == implied,
        _ => false,
    };
    rest_is_implied_name.then(|| (first.path.canonical(), first.mode))
}

fn vector_message(database: &str, requirement: &IndexDefinition) -> String {
    let scope = match requirement.query_scope {
        IndexQueryScope::Collection => "COLLECTION",
        IndexQueryScope::CollectionGroup => "COLLECTION_GROUP",
    };
    // The implied `__name__` tiebreak is not configured; a `__name__` vector field is.
    let configs: Vec<String> = requirement
        .fields
        .iter()
        .filter(|field| {
            !field.path.is_document_name() || matches!(field.mode, IndexFieldMode::Vector { .. })
        })
        .map(|field| match field.mode {
            IndexFieldMode::Ascending => format!("--field-config=order=ASCENDING,field-path={}", field.path.canonical()),
            IndexFieldMode::Descending => format!("--field-config=order=DESCENDING,field-path={}", field.path.canonical()),
            IndexFieldMode::Contains => format!("--field-config=array-config=CONTAINS,field-path={}", field.path.canonical()),
            IndexFieldMode::Vector { dimension } => format!(
                "--field-config=vector-config='{{\"dimension\":\"{dimension}\",\"flat\": \"{{}}\"}}',field-path={}",
                field.path.canonical()
            ),
        })
        .collect();
    format!(
        "Missing vector index configuration. Please create the required index with the following gcloud command: gcloud firestore indexes composite create --project={} --collection-group={} --query-scope={scope} {}",
        project_of(database),
        requirement.collection_group.as_str(),
        configs.join(" ")
    )
}

/// Production's refusal text for a query on `database` (`projects/<p>/databases/<d>`) that
/// needs `requirement`; `multiple_inequalities` is whether the query has inequality filters on
/// more than one field.
#[must_use]
pub fn missing_index_message(
    database: &str,
    requirement: &IndexDefinition,
    multiple_inequalities: bool,
) -> String {
    if requirement
        .fields
        .iter()
        .any(|field| matches!(field.mode, IndexFieldMode::Vector { .. }))
    {
        return vector_message(database, requirement);
    }
    let group = requirement.collection_group.as_str();
    let scope = scope_number(requirement.query_scope);
    if let Some((path, mode)) = single_field(requirement) {
        let kind = match (requirement.query_scope, mode) {
            (IndexQueryScope::Collection, IndexFieldMode::Descending) => "COLLECTION_DESC",
            (IndexQueryScope::Collection, IndexFieldMode::Contains) => "COLLECTION_CONTAINS",
            (IndexQueryScope::Collection, _) => "COLLECTION_ASC",
            (IndexQueryScope::CollectionGroup, IndexFieldMode::Descending) => {
                "COLLECTION_GROUP_DESC"
            }
            (IndexQueryScope::CollectionGroup, IndexFieldMode::Contains) => {
                "COLLECTION_GROUP_CONTAINS"
            }
            (IndexQueryScope::CollectionGroup, _) => "COLLECTION_GROUP_ASC",
        };
        let index = AdminIndex {
            name: format!("{database}/collectionGroups/{group}/fields/{path}"),
            query_scope: scope,
            fields: vec![admin_field(path.clone(), mode)],
        };
        return format!(
            "The query requires a {kind} index for collection {group} and field {path}. You can create it here: {}?create_exemption={}",
            console(database),
            blob(&index)
        );
    }
    let index = AdminIndex {
        name: format!("{database}/collectionGroups/{group}/indexes/_"),
        query_scope: scope,
        fields: requirement
            .fields
            .iter()
            .map(|field| admin_field(field.path.canonical(), field.mode))
            .collect(),
    };
    let mut message = format!(
        "The query requires an index. You can create it here: {}?create_composite={}",
        console(database),
        blob(&index)
    );
    if multiple_inequalities {
        message.push_str(MULTIPLE_RANGE_FIELDS);
    }
    message
}

/// Production's refusal of a query whose index was deleted: the ordinary refusal, except that
/// the link to create the index again carries the deleted index's id.
#[must_use]
pub fn deleted_index_message(
    database: &str,
    index_id: &str,
    requirement: &IndexDefinition,
) -> String {
    format!(
        "The query requires an index. You can create it here: {}?create_composite={}",
        console(database),
        blob(&named_index(database, index_id, requirement))
    )
}

/// Display order from FS-QUERY-INDEX-MERGE observation 2a. Keep the planner's
/// canonical index definition for matching Admin indexes and for the config fragment.
pub(crate) fn observation_2a_suggestion(
    query: &Query,
    aggregations: &[Aggregation],
    indexes: &IndexSet,
    requirement: &IndexDefinition,
) -> Option<IndexDefinition> {
    let (name, fields) = requirement.fields.split_last()?;
    if !name.path.is_document_name() {
        return None;
    }
    if let [equality] = fields {
        return descending_equality_suggestion(
            query,
            aggregations,
            indexes,
            requirement,
            equality,
            name,
        );
    }
    let (contains, equalities) = fields.split_last()?;
    if !recorded_array_suggestion(
        query,
        aggregations,
        requirement.query_scope,
        name.mode,
        contains,
        equalities,
    ) {
        return None;
    }
    let mut suggestion = requirement.clone();
    suggestion.fields[..fields.len()].rotate_right(1);
    Some(suggestion)
}

fn descending_equality_suggestion(
    query: &Query,
    aggregations: &[Aggregation],
    indexes: &IndexSet,
    requirement: &IndexDefinition,
    equality: &IndexField,
    name: &IndexField,
) -> Option<IndexDefinition> {
    // Row 16 has an explicit descending order on the equality field. Row 17 orders that
    // field ascending, and production lists its ascending field just once.
    let scope = IndexQueryScope::Collection;
    if requirement.query_scope != scope
        || !aggregations.is_empty()
        || equality.mode != IndexFieldMode::Ascending
        || name.mode != IndexFieldMode::Descending
        || !matches!(
            &query.order_by[..],
            [OrderClause { field, direction: Direction::Descending }] if *field == equality.path
        )
        || !matches!(
            &query.filter,
            Some(FilterExpr::Field { field, op: FieldOp::Equal, value })
                if *field == equality.path && ordinary_value(value)
        )
    {
        return None;
    }
    let modes = indexes.single_field_modes(&requirement.collection_group, &equality.path);
    if !modes.contains(&(scope, IndexFieldMode::Ascending))
        || modes.contains(&(scope, IndexFieldMode::Descending))
    {
        return None;
    }
    let mut suggestion = requirement.clone();
    suggestion.fields.insert(
        1,
        IndexField {
            path: equality.path.clone(),
            mode: IndexFieldMode::Descending,
        },
    );
    Some(suggestion)
}

fn ordinary_value(value: &Value) -> bool {
    !matches!(value, Value::Null) && !matches!(value, Value::Double(number) if number.is_nan())
}

fn recorded_array_suggestion(
    query: &Query,
    aggregations: &[Aggregation],
    scope: IndexQueryScope,
    name_mode: IndexFieldMode,
    contains: &IndexField,
    equalities: &[IndexField],
) -> bool {
    if contains.mode != IndexFieldMode::Contains
        || !equalities
            .iter()
            .all(|field| field.mode == IndexFieldMode::Ascending)
        || !query
            .order_by
            .iter()
            .all(|order| order.field.is_document_name())
    {
        return false;
    }
    let count = matches!(aggregations, [Aggregation::Count { up_to: None }]);
    let bounds = match (scope, name_mode, aggregations.is_empty(), count) {
        (IndexQueryScope::Collection, IndexFieldMode::Descending, true, _)
        | (IndexQueryScope::Collection, IndexFieldMode::Descending, _, true) => 2..=2,
        (IndexQueryScope::CollectionGroup, IndexFieldMode::Ascending, true, _) => 1..=2,
        _ => return false,
    };
    let Some(FilterExpr::And(children)) = &query.filter else {
        return false;
    };
    if !bounds.contains(&equalities.len()) || children.len() != equalities.len() + 1 {
        return false;
    }
    let array_matches = |child: &FilterExpr| match child {
        FilterExpr::Field { field, op, value } if *field == contains.path => match op {
            FieldOp::ArrayContains => ordinary_value(value),
            FieldOp::ArrayContainsAny if !count && equalities.len() == 2 => {
                matches!(value, Value::Array(values) if matches!(&values[..], [value] if ordinary_value(value)))
            }
            _ => false,
        },
        _ => false,
    };
    children.iter().any(array_matches)
        && equalities.iter().all(|equality| {
            children.iter().any(|child| {
                matches!(child, FilterExpr::Field { field, op: FieldOp::Equal, value }
                if *field == equality.path && ordinary_value(value))
            })
        })
}

fn named_index(database: &str, index_id: &str, requirement: &IndexDefinition) -> AdminIndex {
    let group = requirement.collection_group.as_str();
    AdminIndex {
        name: format!("{database}/collectionGroups/{group}/indexes/{index_id}"),
        query_scope: scope_number(requirement.query_scope),
        fields: requirement
            .fields
            .iter()
            .map(|field| admin_field(field.path.canonical(), field.mode))
            .collect(),
    }
}

/// Production's refusal of a query whose index an Admin create is still building: the console
/// link carries the index itself, its server-assigned id and the implied `__name__` included.
#[must_use]
pub fn building_index_message(
    database: &str,
    index_id: &str,
    requirement: &IndexDefinition,
) -> String {
    format!(
        "The query requires an index. That index is currently building and cannot be used yet. See its status here: {}?create_composite={}",
        console(database),
        blob(&named_index(database, index_id, requirement))
    )
}

/// What production answers a plan-only Explain of a query that needs a missing index.
pub const PLAN_ONLY_MISSING_INDEX: &str = "no matching index found.";

/// A missing-index refusal of a plan-only Explain (`explainOptions` without `analyze`) in
/// production's words; every other status is returned unchanged.
#[must_use]
pub fn for_explain(
    options: Option<&fireemu_proto_firestore::google::firestore::v1::ExplainOptions>,
    status: tonic::Status,
) -> tonic::Status {
    let plan_only = options.is_some_and(|options| !options.analyze);
    let missing_index = status
        .metadata()
        .get("fireemu-reason")
        .is_some_and(|reason| reason == "FS_GW_MISSING_INDEX");
    if !(plan_only && missing_index) {
        return status;
    }
    let mut refused = tonic::Status::failed_precondition(PLAN_ONLY_MISSING_INDEX);
    if let Ok(v) = "FS_GW_MISSING_INDEX".parse() {
        refused.metadata_mut().insert("fireemu-reason", v);
    }
    refused
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_named_database_is_named_in_the_console_link_and_a_building_index_is_named_by_id() {
        // Recorded against production on 2026-09-24 (FS-CONFIG-LIFECYCLE exploration).
        let database = "projects/fireemu-oracle-query/databases/cfgx0924k";
        let requirement = IndexDefinition {
            collection_group: fireemu_core_types::ids::CollectionId::try_new("items").unwrap(),
            query_scope: IndexQueryScope::Collection,
            fields: vec![
                fireemu_core_firestore::index::IndexField {
                    path: fireemu_core_firestore::field_path::FieldPath::parse("a").unwrap(),
                    mode: IndexFieldMode::Ascending,
                },
                fireemu_core_firestore::index::IndexField {
                    path: fireemu_core_firestore::field_path::FieldPath::parse("b").unwrap(),
                    mode: IndexFieldMode::Descending,
                },
                fireemu_core_firestore::index::IndexField {
                    path: fireemu_core_firestore::field_path::FieldPath::document_name(),
                    mode: IndexFieldMode::Descending,
                },
            ],
        };
        assert_eq!(
            building_index_message(database, "CICAgOjXh4EK", &requirement),
            "The query requires an index. That index is currently building and cannot be used yet. See its status here: https://console.firebase.google.com/v1/r/project/fireemu-oracle-query/firestore/databases/cfgx0924k/indexes?create_composite=Cl1wcm9qZWN0cy9maXJlZW11LW9yYWNsZS1xdWVyeS9kYXRhYmFzZXMvY2ZneDA5MjRrL2NvbGxlY3Rpb25Hcm91cHMvaXRlbXMvaW5kZXhlcy9DSUNBZ09qWGg0RUsQARoFCgFhEAEaBQoBYhACGgwKCF9fbmFtZV9fEAI"
        );
        assert!(missing_index_message(database, &requirement, false).starts_with(
            "The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/fireemu-oracle-query/firestore/databases/cfgx0924k/indexes?create_composite="
        ));
    }
    use fireemu_core_firestore::field_path::FieldPath;
    use fireemu_core_types::ids::CollectionId;

    const DATABASE: &str = "projects/fireemu-oracle-query/databases/(default)";

    fn field(path: &str, mode: IndexFieldMode) -> IndexField {
        IndexField {
            path: FieldPath::parse(path).unwrap(),
            mode,
        }
    }

    fn requirement(
        group: &str,
        scope: IndexQueryScope,
        fields: Vec<IndexField>,
    ) -> IndexDefinition {
        IndexDefinition {
            collection_group: CollectionId::try_new(group).unwrap(),
            query_scope: scope,
            fields,
        }
    }

    #[test]
    #[allow(clippy::too_many_lines)]
    fn observation_2a_link_shapes_keep_the_configuration_requirement() {
        use crate::gateway::Gateway;
        use fireemu_core_firestore::index::{IndexSet, IndexValidationPolicy, PlanningContext};
        use fireemu_core_firestore::query::{
            Direction, DistanceMeasure, FieldOp, FilterExpr, FindNearest, OrderClause, Query,
            QueryScope,
        };
        use fireemu_core_firestore::store::Aggregation;
        use fireemu_core_firestore::value::Value;
        use fireemu_core_types::edition::{FirestoreApiMode, FirestoreEdition};
        use IndexFieldMode::{Ascending, Contains, Descending};

        let table = include_str!("../tests/fixtures/index-merge-obs2-p9.tsv");
        assert_eq!(table.lines().count(), 23);
        let gateway = Gateway {
            ctx: PlanningContext {
                edition: FirestoreEdition::Standard,
                api_mode: FirestoreApiMode::Native,
                policy: IndexValidationPolicy::Production,
            },
            enforce_limits: true,
            indexes: IndexSet::default(),
        };
        let atom = |path, op, value| FilterExpr::Field {
            field: FieldPath::parse(path).unwrap(),
            op,
            value,
        };
        let id = CollectionId::try_new("shapes").unwrap();
        for row in table.lines().skip(1) {
            let columns: Vec<_> = row.split('\t').collect();
            let [scope, shape, name_direction, modes] = columns.as_slice() else {
                panic!("bad row: {row}");
            };
            let group = *scope == "group";
            let scope = if group {
                IndexQueryScope::CollectionGroup
            } else {
                IndexQueryScope::Collection
            };
            let query_scope = if group {
                QueryScope::collection_group(id.clone())
            } else {
                QueryScope::collection(None, id.clone())
            };
            let mut indexes = IndexSet::default();
            let count = [Aggregation::Count { up_to: None }];
            let aggregations = if matches!(*shape, "count" | "countAny") {
                count.as_slice()
            } else {
                &[]
            };
            let mut query = Query::new(query_scope);
            let vector = *shape == "vectorEquality";
            let equality_ordered = matches!(*shape, "descEquality" | "ascEquality") || vector;
            let key_mode = if vector {
                IndexFieldMode::Vector { dimension: 1 }
            } else if *name_direction == "asc" {
                Ascending
            } else {
                Descending
            };
            let mut columns = vec![field("a", Ascending)];
            if equality_ordered {
                let direction = if *shape == "ascEquality" {
                    Direction::Ascending
                } else {
                    Direction::Descending
                };
                let field = FieldPath::parse("a").unwrap();
                let mut effective = vec![(scope, Ascending)];
                if *modes == "both" {
                    effective.push((scope, Descending));
                }
                if group {
                    effective.push((IndexQueryScope::Collection, Ascending));
                    if *modes == "both" {
                        effective.push((IndexQueryScope::Collection, Descending));
                    }
                }
                indexes.set_single_field_indexes(&id, &field, effective);
                query = query
                    .with_filter(atom("a", FieldOp::Equal, Value::Integer(1)))
                    .with_order(OrderClause { field, direction });
                if *shape == "ascEquality" {
                    query = query.with_order(OrderClause {
                        field: FieldPath::parse("__name__").unwrap(),
                        direction: Direction::Descending,
                    });
                }
                if vector {
                    query = query.with_find_nearest(FindNearest {
                        vector_field: FieldPath::document_name(),
                        query_vector: vec![1.0],
                        distance_measure: DistanceMeasure::Euclidean,
                        limit: 1,
                        distance_result_field: None,
                        distance_threshold: None,
                    });
                }
            } else {
                let op = if *shape == "range" {
                    FieldOp::LessThan
                } else {
                    FieldOp::Equal
                };
                let membership = match *shape {
                    "any" | "countAny" => atom(
                        "tags",
                        FieldOp::ArrayContainsAny,
                        Value::Array(vec![Value::Integer(1)]),
                    ),
                    "nullContains" => atom("tags", FieldOp::ArrayContains, Value::Null),
                    _ => atom("tags", FieldOp::ArrayContains, Value::Integer(1)),
                };
                let direction = if key_mode == Ascending {
                    Direction::Ascending
                } else {
                    Direction::Descending
                };
                let mut filters = vec![
                    atom("a", op, Value::Integer(1)),
                    atom("b", FieldOp::Equal, Value::Integer(2)),
                    membership,
                ];
                if *shape == "keyContains" {
                    filters.push(atom(
                        "__name__",
                        FieldOp::Equal,
                        Value::Reference(format!("{DATABASE}/documents/shapes/x")),
                    ));
                }
                query = query.with_filter(FilterExpr::And(filters));
                if matches!(*shape, "range" | "orderedContains") {
                    query = query.with_order(OrderClause {
                        field: FieldPath::parse("a").unwrap(),
                        direction,
                    });
                }
                query = query.with_order(OrderClause {
                    field: FieldPath::parse("__name__").unwrap(),
                    direction,
                });
                columns.push(field("b", Ascending));
                columns.push(field("tags", Contains));
            }
            columns.push(field("__name__", key_mode));
            let original = requirement("shapes", scope, columns);
            let before = original.indexes_json_fragment();
            let expected = if *shape == "descEquality" && !group && *modes == "ascendingOnly" {
                Some(vec![
                    field("a", Ascending),
                    field("a", Descending),
                    field("__name__", Descending),
                ])
            } else if (!group
                && key_mode == Descending
                && matches!(*shape, "contains" | "any" | "count"))
                || (group && key_mode == Ascending && matches!(*shape, "contains" | "any"))
            {
                Some(vec![
                    field("tags", Contains),
                    field("a", Ascending),
                    field("b", Ascending),
                    field("__name__", key_mode),
                ])
            } else {
                None
            };
            let query = query.canonicalize().unwrap();
            let actual = observation_2a_suggestion(&query, aggregations, &indexes, &original);
            assert_eq!(actual.map(|link| link.fields), expected, "{row}");
            assert_eq!(original.indexes_json_fragment(), before);
            if vector {
                let status = gateway
                    .validate_query_with_indexes(&query, &indexes)
                    .expect_err("the required vector index is absent")
                    .to_status_in(DATABASE);
                assert_eq!(status.code(), tonic::Code::FailedPrecondition, "{row}");
                assert_eq!(
                    status.message(),
                    missing_index_message(DATABASE, &original, false),
                    "{row}"
                );
            }
        }
    }

    // Links recorded from production on 2026-09-24 (fireemu-oracle-query, raw answers).
    #[test]
    fn a_composite_requirement_links_the_encoded_index() {
        let message = missing_index_message(
            DATABASE,
            &requirement(
                "flt",
                IndexQueryScope::Collection,
                vec![
                    field("q", IndexFieldMode::Ascending),
                    field("z", IndexFieldMode::Ascending),
                    field("__name__", IndexFieldMode::Ascending),
                ],
            ),
            false,
        );
        assert_eq!(
            message,
            "The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/fireemu-oracle-query/firestore/indexes?create_composite=ClBwcm9qZWN0cy9maXJlZW11LW9yYWNsZS1xdWVyeS9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvZmx0L2luZGV4ZXMvXxABGgUKAXEQARoFCgF6EAEaDAoIX19uYW1lX18QAQ"
        );
    }

    #[test]
    fn multiple_inequality_fields_add_the_guide() {
        let message = missing_index_message(
            DATABASE,
            &requirement(
                "qx",
                IndexQueryScope::Collection,
                vec![
                    field("b", IndexFieldMode::Ascending),
                    field("a", IndexFieldMode::Ascending),
                    field("__name__", IndexFieldMode::Ascending),
                ],
            ),
            true,
        );
        assert!(message.ends_with(" .\nThe query contains range and inequality filters on multiple fields, please refer to the documentation for index selection best practices: https://cloud.google.com/firestore/docs/query-data/multiple-range-fields."));
    }

    #[test]
    fn a_disabled_single_field_index_links_an_exemption() {
        let message = missing_index_message(
            DATABASE,
            &requirement(
                "pk",
                IndexQueryScope::Collection,
                vec![
                    field("a", IndexFieldMode::Ascending),
                    field("__name__", IndexFieldMode::Ascending),
                ],
            ),
            false,
        );
        assert!(message.starts_with("The query requires a COLLECTION_ASC index for collection pk and field a. You can create it here: https://console.firebase.google.com/v1/r/project/fireemu-oracle-query/firestore/indexes?create_exemption="));
        let group_desc = missing_index_message(
            DATABASE,
            &requirement(
                "qg",
                IndexQueryScope::CollectionGroup,
                vec![
                    field("n", IndexFieldMode::Descending),
                    field("__name__", IndexFieldMode::Descending),
                ],
            ),
            false,
        );
        assert!(group_desc.starts_with(
            "The query requires a COLLECTION_GROUP_DESC index for collection qg and field n."
        ));
        let contains = missing_index_message(
            DATABASE,
            &requirement(
                "qg",
                IndexQueryScope::CollectionGroup,
                vec![
                    field("tags", IndexFieldMode::Contains),
                    field("__name__", IndexFieldMode::Ascending),
                ],
            ),
            false,
        );
        assert!(contains.starts_with(
            "The query requires a COLLECTION_GROUP_CONTAINS index for collection qg and field tags."
        ));
    }

    #[test]
    fn a_name_descending_or_mixed_direction_requirement_stays_composite() {
        for fields in [
            vec![field("__name__", IndexFieldMode::Descending)],
            vec![
                field("n", IndexFieldMode::Descending),
                field("__name__", IndexFieldMode::Ascending),
            ],
        ] {
            let message = missing_index_message(
                DATABASE,
                &requirement("qn", IndexQueryScope::Collection, fields),
                false,
            );
            assert!(message.starts_with("The query requires an index. You can create it here:"));
        }
    }

    #[test]
    fn a_vector_requirement_names_the_gcloud_command() {
        let message = missing_index_message(
            DATABASE,
            &requirement(
                "qvec",
                IndexQueryScope::Collection,
                vec![
                    field("n", IndexFieldMode::Ascending),
                    field("emb", IndexFieldMode::Vector { dimension: 3 }),
                ],
            ),
            false,
        );
        assert_eq!(
            message,
            "Missing vector index configuration. Please create the required index with the following gcloud command: gcloud firestore indexes composite create --project=fireemu-oracle-query --collection-group=qvec --query-scope=COLLECTION --field-config=order=ASCENDING,field-path=n --field-config=vector-config='{\"dimension\":\"3\",\"flat\": \"{}\"}',field-path=emb"
        );
    }
}
