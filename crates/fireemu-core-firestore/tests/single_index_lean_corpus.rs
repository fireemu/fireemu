//! Replays the single-index Lean corpus through the public planner and field predicate.
//! The Rust build does not need Lean. See verification/lean/single-index/Main.lean
//! for the line format and the README for the counterexamples.

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::index::{
    composite_fields_serve, decide, missing_requirements, plan_scans, validate_aggregation_query,
    CompositeRequirementView, CompositeShapeError, IndexDecision, IndexDefinition, IndexField,
    IndexFieldMode, IndexQueryScope, IndexSet, IndexValidationPolicy, PlannedScan, PlanningContext,
};
use fireemu_core_firestore::query::{
    Direction, FieldOp, FilterExpr, OrderClause, Query, QueryScope, UnaryOp,
};
use fireemu_core_firestore::store::Aggregation;
use fireemu_core_firestore::value::Value;
use fireemu_core_types::edition::{FirestoreApiMode, FirestoreEdition};
use fireemu_core_types::ids::CollectionId;
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-single-index.corpus");
const ASC: IndexFieldMode = IndexFieldMode::Ascending;
const DESC: IndexFieldMode = IndexFieldMode::Descending;
const CONTAINS: IndexFieldMode = IndexFieldMode::Contains;
const COLLECTION: IndexQueryScope = IndexQueryScope::Collection;
const GROUP: IndexQueryScope = IndexQueryScope::CollectionGroup;

fn items(text: &str, delimiter: char) -> impl Iterator<Item = &str> {
    text.split(delimiter).filter(|part| *part != "-")
}

fn path(text: &str) -> FieldPath {
    FieldPath::parse(text).expect("field path")
}

fn collection(text: &str) -> CollectionId {
    CollectionId::try_new(text).expect("collection ID")
}

fn scope(text: &str) -> IndexQueryScope {
    match text {
        "C" => COLLECTION,
        "G" => GROUP,
        _ => panic!("invalid scope {text}"),
    }
}

fn direction(text: &str) -> Direction {
    match text {
        "asc" => Direction::Ascending,
        "desc" => Direction::Descending,
        _ => panic!("invalid direction {text}"),
    }
}

fn mode(text: &str) -> IndexFieldMode {
    match text {
        "asc" => ASC,
        "desc" => DESC,
        "contains" => CONTAINS,
        _ => IndexFieldMode::Vector {
            dimension: text
                .strip_prefix('v')
                .expect("vector mode")
                .parse()
                .expect("vector dimension"),
        },
    }
}

fn clause_list(text: &str) -> Vec<OrderClause> {
    items(text, ',')
        .map(|clause| {
            let (field, dir) = clause.split_once(':').expect("order clause");
            OrderClause {
                field: path(field),
                direction: direction(dir),
            }
        })
        .collect()
}

fn parse_index(text: &str) -> IndexDefinition {
    let [name, which_scope, fields] = text.split('/').collect::<Vec<_>>()[..] else {
        panic!("invalid index {text}");
    };
    IndexDefinition {
        collection_group: collection(name),
        query_scope: scope(which_scope),
        fields: items(fields, ',')
            .map(|field| {
                let (field, which_mode) = field.split_once(':').expect("index field");
                IndexField {
                    path: path(field),
                    mode: mode(which_mode),
                }
            })
            .collect(),
    }
}

fn filter(text: &str, collection: &CollectionId) -> FilterExpr {
    let (field, kind) = text.split_once(':').expect("filter");
    let field = path(field);
    if let Some(op) = match kind {
        "null" => Some(UnaryOp::IsNull),
        "nan" => Some(UnaryOp::IsNan),
        _ => None,
    } {
        return FilterExpr::Unary { field, op };
    }
    let z = Value::String("z".to_owned());
    let (op, value) = match kind {
        "eq" if field.is_document_name() => (
            FieldOp::Equal,
            Value::Reference(format!(
                "projects/demo-app/databases/(default)/documents/{}/d1",
                collection.as_str()
            )),
        ),
        "eq" => (FieldOp::Equal, Value::Integer(1)),
        "eqarray" => (FieldOp::Equal, Value::Array(vec![z])),
        "array" => (FieldOp::ArrayContains, z),
        "any" => (FieldOp::ArrayContainsAny, Value::Array(vec![z])),
        "gt" => (FieldOp::GreaterThan, Value::Integer(1)),
        _ => panic!("invalid filter {text}"),
    };
    FilterExpr::Field { field, op, value }
}

fn context(policy: &str, edition: &str) -> PlanningContext {
    PlanningContext {
        policy: match policy {
            "production" => IndexValidationPolicy::Production,
            "report" => IndexValidationPolicy::ProductionReport,
            "emulator" => IndexValidationPolicy::Emulator,
            _ => panic!("invalid policy {policy}"),
        },
        edition: match edition {
            "standard" => FirestoreEdition::Standard,
            "enterprise" => FirestoreEdition::Enterprise,
            _ => panic!("invalid edition {edition}"),
        },
        api_mode: FirestoreApiMode::Native,
    }
}

fn parsed_query(
    id: &CollectionId,
    query_scope: IndexQueryScope,
    filters: &str,
    orders: &str,
    policy: IndexValidationPolicy,
) -> Query {
    let mut query = Query::new(match query_scope {
        COLLECTION => QueryScope::collection(None, id.clone()),
        GROUP => QueryScope::collection_group(id.clone()),
    });
    let atoms: Vec<_> = items(filters, ',').map(|atom| filter(atom, id)).collect();
    match atoms.len() {
        0 => {}
        1 => query = query.with_filter(atoms.into_iter().next().expect("one filter")),
        _ => query = query.with_filter(FilterExpr::And(atoms)),
    }
    query.order_by = clause_list(orders);
    let result = if policy == IndexValidationPolicy::Emulator {
        query.canonicalize_emulator()
    } else {
        query.canonicalize()
    };
    result.unwrap_or_else(|err| panic!("{filters:?} {orders}: {err:?}"))
}

fn apply_overrides(set: &mut IndexSet, id: &CollectionId, overrides: &str) {
    for operation in items(overrides, ';') {
        if let Some((field, which_scope)) = operation.split_once('!') {
            set.add_exemption(&fireemu_core_firestore::index::SingleFieldExemption {
                collection_group: id.clone(),
                field: path(field),
                query_scope: scope(which_scope),
            });
        } else {
            let (field, config) = operation.split_once('=').expect("override");
            let modes = items(config, ',')
                .map(|entry| {
                    let (which_scope, which_mode) = entry.split_once(':').expect("mode pair");
                    (scope(which_scope), mode(which_mode))
                })
                .collect();
            if field == "*" {
                set.set_default_single_field_indexes(id, modes);
            } else {
                set.set_single_field_indexes(id, &path(field), modes);
            }
        }
    }
}

fn shape(result: Result<(), CompositeShapeError>) -> &'static str {
    match result {
        Ok(()) => "ok",
        Err(CompositeShapeError::TooManyFields) => "fields",
        Err(CompositeShapeError::MultipleArrayFields) => "arrays",
        Err(CompositeShapeError::NotNecessary) => "unnecessary",
    }
}

fn serves(
    index: &IndexDefinition,
    id: &CollectionId,
    query_scope: IndexQueryScope,
    equality: &[FieldPath],
    contains: Option<&FieldPath>,
    order: &[OrderClause],
) -> bool {
    composite_fields_serve(
        &index.fields,
        index.query_scope,
        index.collection_group == *id,
        query_scope == GROUP,
        &CompositeRequirementView {
            equality,
            contains,
            order,
            is_document_name: FieldPath::is_document_name,
        },
        |field| (&field.path, field.mode),
        |order| (&order.field, order.direction),
    )
}

fn check_index(
    entry: &str,
    id: &CollectionId,
    query_scope: IndexQueryScope,
    equality: &[FieldPath],
    contains: Option<&FieldPath>,
    order: &[OrderClause],
    label: &str,
) -> IndexDefinition {
    let [index, accepted, capacity, necessary] = entry.split('~').collect::<Vec<_>>()[..] else {
        panic!("invalid checked index {entry}");
    };
    let index = parse_index(index);
    assert_eq!(
        serves(&index, id, query_scope, equality, contains, order),
        match accepted {
            "0" => false,
            "1" => true,
            _ => panic!("invalid acceptance marker {accepted}"),
        },
        "{label}: {entry}"
    );
    assert_eq!(shape(index.check_capacity()), capacity, "{label}: {entry}");
    assert_eq!(
        shape(index.check_necessary()),
        necessary,
        "{label}: {entry}"
    );
    index
}

fn rows() -> Vec<&'static str> {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .expect("corpus header")
        .strip_prefix("# lean-single-index ")
        .expect("corpus name and case count")
        .parse()
        .expect("integer case count");
    let rows: Vec<_> = lines.collect();
    assert_eq!(rows.len(), count);
    assert!(count >= 400, "case count {count}");
    rows
}

#[expect(
    clippy::too_many_lines,
    reason = "Keep corpus decoding and all public planner checks for each row together"
)]
fn replay(line: &str) {
    let [label, id, query_scope, policy, edition, filters, order, aggregates, overrides, composites, equality, membership, requirement_order, suggested, base, head] =
        line.split('|').collect::<Vec<_>>()[..]
    else {
        panic!("invalid corpus line {line}");
    };
    let ctx = context(policy, edition);
    let id = collection(id);
    let query_scope = scope(query_scope);
    let query = parsed_query(&id, query_scope, filters, order, ctx.policy);
    assert_eq!(query.dnf().len(), 1, "{line}");
    let aggregations: Vec<_> = items(aggregates, ',')
        .map(|entry| match entry.split_once(':').expect("aggregation") {
            ("count", "") => Aggregation::Count { up_to: None },
            ("sum", field) => Aggregation::Sum(path(field)),
            ("avg", field) => Aggregation::Avg(path(field)),
            _ => panic!("invalid aggregation {entry}"),
        })
        .collect();
    let equality: Vec<_> = items(equality, ',').map(path).collect();
    let membership = items(membership, ',').next().map(path);
    let requirement_order = clause_list(requirement_order);
    if aggregations.is_empty() {
        let effective_order: Vec<_> = query
            .effective_order_by()
            .into_iter()
            .filter(|clause| !equality.contains(&clause.field))
            .collect();
        assert_eq!(effective_order, requirement_order, "{line}");
    }

    let mut set = IndexSet::default();
    apply_overrides(&mut set, &id, overrides);
    let checked = |entry| {
        check_index(
            entry,
            &id,
            query_scope,
            &equality,
            membership.as_ref(),
            &requirement_order,
            label,
        )
    };
    let suggested = checked(suggested);
    for entry in items(composites, ';') {
        set.add_composite(checked(entry));
    }
    let actual = if aggregations.is_empty() {
        decide(&query, &set, &ctx)
    } else {
        validate_aggregation_query(&query, &aggregations, &set, &ctx)
    };
    if base != head {
        let expected = parse_index(base.strip_prefix("use:").expect("pre-refusal index"));
        let before_refusal = PlanningContext {
            edition: FirestoreEdition::Enterprise,
            ..ctx
        };
        let actual_base = if aggregations.is_empty() {
            decide(&query, &set, &before_refusal)
        } else {
            validate_aggregation_query(&query, &aggregations, &set, &before_refusal)
        };
        assert_eq!(
            actual_base,
            IndexDecision::UseIndex { index: expected },
            "{line}"
        );
    }
    let (kind, indexes) = head.split_once(':').expect("head decision");
    let (expected_scans, expected_missing) = match (kind, actual) {
        ("use", IndexDecision::UseIndex { index }) => {
            assert_eq!(index, parse_index(indexes), "{line}");
            (Some(vec![PlannedScan::Index(index)]), vec![])
        }
        ("merge", IndexDecision::MergeIndexes { indexes: members }) => {
            let expected: Vec<_> = items(indexes, ';').map(parse_index).collect();
            assert_eq!(members, expected, "{line}");
            (Some(vec![PlannedScan::Merge(members)]), vec![])
        }
        ("missing", IndexDecision::MissingRequired { requirement }) => {
            assert_eq!(requirement, parse_index(indexes), "{line}");
            assert_eq!(requirement, suggested, "{line}");
            (None, vec![requirement])
        }
        ("assumed", IndexDecision::AssumedIndex { requirement }) => {
            assert_eq!(requirement, parse_index(indexes), "{line}");
            assert_eq!(requirement, suggested, "{line}");
            (
                Some(vec![PlannedScan::Index(requirement.clone())]),
                vec![requirement],
            )
        }
        ("fullscan", IndexDecision::FullScanAllowed { plan }) => {
            assert_eq!(plan.missing_index, parse_index(indexes), "{line}");
            assert_eq!(plan.missing_index, suggested, "{line}");
            let suffix = if query_scope == GROUP {
                " (collection group)"
            } else {
                ""
            };
            assert_eq!(
                plan.collection_scope,
                format!("{}{suffix}", id.as_str()),
                "{line}"
            );
            assert_eq!(plan.diagnostics, ["FS_ENT_FULL_COLLECTION_SCAN"], "{line}");
            (None, vec![plan.missing_index])
        }
        (_, actual) => panic!("{line}: expected {head} (base {base}), got {actual:?}"),
    };
    assert_eq!(
        plan_scans(&query, &aggregations, &set, &ctx),
        expected_scans,
        "{line}"
    );
    assert_eq!(
        missing_requirements(&query, &aggregations, &set, &ctx),
        expected_missing,
        "{line}"
    );
}

#[test]
fn single_index_lean_corpus() {
    for row in rows() {
        replay(row);
    }
}

#[test]
fn rust_accepts_group_and_noncanonical_composite_keys() {
    let cases = rows();
    for label in [
        "finding/group-composite",
        "finding/name-before-order",
        "finding/first-name-wins",
        "finding/implicit-equality-name",
        "finding/implicit-array-name",
    ] {
        let row = cases
            .iter()
            .find(|row| row.split('|').next() == Some(label))
            .unwrap();
        assert!(row.rsplit('|').next().unwrap().starts_with("use:"));
        replay(row);
    }
}

#[test]
fn rust_automatic_overlap_repeated_order_and_stage_b_refusal() {
    let cases = rows();
    for (label, expected) in [
        ("finding/overlap", "use:items/C/tags:contains,__name__:asc"),
        ("finding/repeated-order", "use:items/C/a:asc,__name__:asc"),
        (
            "finding/head-asc-only",
            "missing:items/C/a:asc,__name__:desc",
        ),
        (
            "finding/head-composite-prevents-refusal",
            "use:items/C/a:asc,__name__:desc",
        ),
        ("capacity/101", "fullscan:"),
    ] {
        let row = cases
            .iter()
            .find(|row| row.split('|').next() == Some(label))
            .unwrap();
        assert!(row.rsplit('|').next().unwrap().starts_with(expected));
        replay(row);
    }
}

fn indexed(decision: &IndexDecision) -> bool {
    matches!(
        decision,
        IndexDecision::UseIndex { .. } | IndexDecision::MergeIndexes { .. }
    )
}

fn flip_mode(mode: IndexFieldMode) -> IndexFieldMode {
    match mode {
        ASC => DESC,
        DESC => ASC,
        mode => mode,
    }
}

proptest! {
    #[test]
    fn composite_explicit_agrees_with_scan_keys_and_reversal(
        n in 0usize..4,
        has_array in any::<bool>(),
        asc in any::<bool>(),
        name_asc in any::<bool>(),
        group in any::<bool>(),
        permute in any::<bool>(),
        mutation in 0u8..6,
    ) {
        let id = collection("items");
        let scope = if group { GROUP } else { COLLECTION };
        let equality: Vec<_> = ["a", "b", "c"][..n].iter().map(|f| path(f)).collect();
        let array = has_array.then(|| path("tags"));
        let direction = if asc { Direction::Ascending } else { Direction::Descending };
        let tie = if name_asc { Direction::Ascending } else { Direction::Descending };
        let order = [
            OrderClause { field: path("n"), direction },
            OrderClause { field: FieldPath::document_name(), direction: tie },
        ];
        let mut fixed: Vec<_> = equality.iter().cloned().map(|path| IndexField { path, mode: DESC }).collect();
        if permute {
            fixed.reverse();
        }
        let mut fields = fixed;
        if let Some(path) = &array {
            fields.push(IndexField { path: path.clone(), mode: if mutation == 1 { ASC } else { CONTAINS } });
        }
        fields.push(IndexField {
            path: order[0].field.clone(),
            mode: if asc == (mutation == 2) { DESC } else { ASC },
        });
        fields.push(IndexField {
            path: order[1].field.clone(),
            mode: if name_asc == (mutation == 3) { DESC } else { ASC },
        });
        if mutation == 4 && n != 0 {
            fields[0].mode = CONTAINS;
        }
        let mut index = IndexDefinition { collection_group: id.clone(), query_scope: scope, fields };
        if mutation == 5 {
            index.collection_group = collection("different");
        }
        let accepted = serves(&index, &id, scope, &equality, array.as_ref(), &order);
        let valid = match mutation {
            0 => true,
            1 => !has_array,
            4 => n == 0,
            _ => false,
        };
        prop_assert_eq!(accepted, valid);
        for field in &mut index.fields {
            field.mode = flip_mode(field.mode);
        }
        let reversed = order.map(|clause| OrderClause { direction: clause.direction.reversed(), ..clause });
        prop_assert_eq!(serves(&index, &id, scope, &equality, array.as_ref(), &reversed), accepted);
        index.query_scope = COLLECTION;
        prop_assert!(!serves(&index, &id, GROUP, &equality, array.as_ref(), &reversed));
    }

    #[test]
    fn single_field_modes_and_composites_agree_on_separate_needs(
        which in 0u8..4,
        group in any::<bool>(),
        descending in any::<bool>(),
        opposite in any::<bool>(),
        modes in 0u8..8,
    ) {
        let id = collection("items");
        let scope = if group { GROUP } else { COLLECTION };
        let tie = if descending { "desc" } else { "asc" };
        let field_dir = if opposite { if descending { "asc" } else { "desc" } } else { tie };
        let (filter, explicit) = match which {
            0 => ("a:eq", format!("__name__:{tie}")),
            1 => ("a:array", format!("__name__:{tie}")),
            2 => ("-", format!("a:{field_dir},__name__:{tie}")),
            _ => ("a:eqarray,a:array", format!("__name__:{tie}")),
        };
        let ctx = context("emulator", "standard");
        let query = parsed_query(&id, scope, filter, &explicit, ctx.policy);
        let mut set = IndexSet::default();
        let enabled: Vec<_> = [ASC, DESC, CONTAINS].into_iter().enumerate()
            .filter(|(bit, _)| modes & (1u8 << *bit) != 0)
            .map(|(_, mode)| (scope, mode)).collect();
        let ordered = if field_dir == "asc" { ASC } else { DESC };
        let want = match which {
            0 => modes & 3 != 0,
            1 | 3 => modes & 4 != 0,
            _ => !opposite && enabled.contains(&(scope, ordered)),
        };
        let other_scope = if group { COLLECTION } else { GROUP };
        set.set_single_field_indexes(&id, &path("a"),
            enabled.iter().map(|(_, mode)| (other_scope, *mode)).collect());
        prop_assert!(!indexed(&decide(&query, &set, &ctx)));
        set.set_single_field_indexes(&id, &path("a"), enabled);
        let actual = decide(&query, &set, &ctx);
        prop_assert_eq!(indexed(&actual), want);
        if let IndexDecision::UseIndex { index } = actual {
            prop_assert_eq!(index.query_scope, scope);
            let equality = if which == 0 || which == 3 { vec![path("a")] } else { vec![] };
            let contains = (which == 1 || which == 3).then(|| path("a"));
            let order: Vec<_> = query.effective_order_by().into_iter()
                .filter(|o| !equality.contains(&o.field)).collect();
            prop_assert_eq!(serves(&index, &id, scope, &equality, contains.as_ref(), &order), which != 3);
        }
    }

    #[test]
    fn capacity_and_necessity_follow_the_shape_contract(
        width in 0usize..104,
        arrays in 0usize..4,
        has_name in any::<bool>(),
        vector in any::<bool>(),
    ) {
        let mut fields: Vec<_> = (0..width).map(|i| IndexField {
            path: path(&format!("f{i}")),
            mode: if i < arrays { CONTAINS } else { ASC },
        }).collect();
        if has_name {
            fields.push(IndexField { path: FieldPath::document_name(), mode: ASC });
        }
        if vector {
            fields.push(IndexField { path: path("vector"), mode: IndexFieldMode::Vector { dimension: 3 } });
        }
        let index = IndexDefinition {
            collection_group: collection("items"),
            query_scope: COLLECTION,
            fields,
        };
        let length = width + usize::from(has_name) + usize::from(vector);
        let capacity = if length > 100 {
            Err(CompositeShapeError::TooManyFields)
        } else if width.min(arrays) > 1 {
            Err(CompositeShapeError::MultipleArrayFields)
        } else {
            Ok(())
        };
        prop_assert_eq!(index.check_capacity(), capacity);
        prop_assert_eq!(index.check_necessary().is_ok(), length >= 2 || has_name || vector);
    }

    #[test]
    fn suggested_index_serves_and_indexing_is_monotone(
        n in 1usize..4,
        which in 0u8..3,
        production in 0u8..3,
        enterprise in any::<bool>(),
        group in any::<bool>(),
        add_composite_first in any::<bool>(),
    ) {
        let ctx = context(
            ["production", "report", "emulator"][usize::from(production)],
            if enterprise { "enterprise" } else { "standard" },
        );
        let id = collection("items");
        let scope = if group { GROUP } else { COLLECTION };
        let mut filter = ["a:eq", "b:eq", "c:eq"][..n].join(",");
        if which == 1 {
            filter.push_str(",tags:array");
        }
        let order = if which == 2 { "n:desc,__name__:asc" } else { "__name__:asc" };
        let query = parsed_query(&id, scope, &filter, order, ctx.policy);
        let mut set = IndexSet::default();
        set.set_default_single_field_indexes(&id, vec![]);
        let missing = missing_requirements(&query, &[], &set, &ctx);
        prop_assert_eq!(missing.len(), 1);
        let suggested = missing.into_iter().next().unwrap();
        prop_assert_eq!(suggested.check_capacity(), Ok(()));
        prop_assert_eq!(suggested.check_necessary(), Ok(()));
        if add_composite_first {
            set.add_composite(suggested.clone());
            prop_assert!(indexed(&decide(&query, &set, &ctx)));
        }
        set.set_single_field_indexes(&id, &path("a"), vec![(scope, ASC)]);
        let after_asc = indexed(&decide(&query, &set, &ctx));
        prop_assert!(!add_composite_first || after_asc);
        set.set_single_field_indexes(&id, &path("a"), vec![(scope, ASC), (scope, DESC)]);
        prop_assert!(!after_asc || indexed(&decide(&query, &set, &ctx)));
        set.add_composite(suggested);
        prop_assert!(indexed(&decide(&query, &set, &ctx)));
    }
}
