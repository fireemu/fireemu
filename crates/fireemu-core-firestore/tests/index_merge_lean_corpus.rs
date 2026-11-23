//! Differential test of the index planner's merge decision against the Lean model and
//! specification in `verification/lean/index-merge`, through the golden corpus that the Lean
//! executable writes (`lake exe corpus`), and proptest statements of the properties the Lean
//! proofs establish (`IM.merged_sound`, `IM.merged_iff_spec`, `IM.merged_refuses_few`,
//! `IM.merged_refuses_eq_ordered`, `IM.decide_mono`, `IM.decide_served_perm`). The corpus
//! also carries the production verdicts of `IM.productionRows`. The Rust build does not need
//! Lean.

use std::collections::BTreeSet;

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::index::{
    decide, validate_aggregation_query, IndexDecision, IndexDefinition, IndexField, IndexFieldMode,
    IndexQueryScope, IndexSet, IndexValidationPolicy, PlanningContext,
};
use fireemu_core_firestore::query::{
    Direction, FieldOp, FilterExpr, OrderClause, Query, QueryScope, UnaryOp,
};
use fireemu_core_firestore::store::Aggregation;
use fireemu_core_firestore::value::Value;
use fireemu_core_types::edition::{FirestoreApiMode, FirestoreEdition};
use fireemu_core_types::ids::CollectionId;
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-index-merge.corpus");

fn fp(name: &str) -> FieldPath {
    FieldPath::parse(name).expect("field path")
}

fn coll(name: &str) -> CollectionId {
    CollectionId::try_new(name).expect("collection id")
}

fn scope(tag: &str) -> IndexQueryScope {
    match tag {
        "C" => IndexQueryScope::Collection,
        "G" => IndexQueryScope::CollectionGroup,
        other => panic!("scope {other}"),
    }
}

fn mode(tag: &str) -> IndexFieldMode {
    match tag {
        "asc" => IndexFieldMode::Ascending,
        "desc" => IndexFieldMode::Descending,
        "contains" => IndexFieldMode::Contains,
        other => panic!("mode {other}"),
    }
}

fn modes(spec: &str) -> Vec<(IndexQueryScope, IndexFieldMode)> {
    if spec == "-" {
        return Vec::new();
    }
    spec.split(',')
        .map(|m| {
            let (s, m) = m.split_once(':').expect("scope:mode");
            (scope(s), mode(m))
        })
        .collect()
}

/// `<collection> <C|G> <field>:<mode>,...`
fn parse_index(text: &str) -> IndexDefinition {
    let mut parts = text.split_whitespace();
    let collection = coll(parts.next().expect("collection"));
    let query_scope = scope(parts.next().expect("scope"));
    let fields = parts
        .next()
        .map(|list| {
            list.split(',')
                .map(|f| {
                    let (path, m) = f.rsplit_once(':').expect("field:mode");
                    IndexField {
                        path: fp(path),
                        mode: mode(m),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    assert!(parts.next().is_none(), "trailing index text in {text}");
    IndexDefinition {
        collection_group: collection,
        query_scope,
        fields,
    }
}

fn render_mode(m: IndexFieldMode) -> &'static str {
    match m {
        IndexFieldMode::Ascending => "asc",
        IndexFieldMode::Descending => "desc",
        IndexFieldMode::Contains => "contains",
        IndexFieldMode::Vector { .. } => "vector",
    }
}

fn render_index(i: &IndexDefinition) -> String {
    let fields: Vec<String> = i
        .fields
        .iter()
        .map(|f| format!("{}:{}", f.path.canonical(), render_mode(f.mode)))
        .collect();
    format!(
        "{} {} {}",
        i.collection_group.as_str(),
        match i.query_scope {
            IndexQueryScope::Collection => "C",
            IndexQueryScope::CollectionGroup => "G",
        },
        fields.join(",")
    )
}

fn render_decision(d: &IndexDecision) -> String {
    match d {
        IndexDecision::UseIndex { index } => format!("expect use {}", render_index(index)),
        IndexDecision::MergeIndexes { indexes } => format!(
            "expect merge {}",
            indexes
                .iter()
                .map(render_index)
                .collect::<Vec<_>>()
                .join(" ; ")
        ),
        IndexDecision::MissingRequired { requirement } => {
            format!("expect missing {}", render_index(requirement))
        }
        IndexDecision::AssumedIndex { requirement } => {
            format!("expect assumed {}", render_index(requirement))
        }
        IndexDecision::FullScanAllowed { plan } => {
            format!("expect fullscan {}", render_index(&plan.missing_index))
        }
        other => format!("unexpected {other:?}"),
    }
}

fn served(d: &IndexDecision) -> bool {
    matches!(
        d,
        IndexDecision::UseIndex { .. } | IndexDecision::MergeIndexes { .. }
    )
}

fn context(policy: &str, edition: &str) -> PlanningContext {
    PlanningContext {
        edition: match edition {
            "standard" => FirestoreEdition::Standard,
            "enterprise" => FirestoreEdition::Enterprise,
            other => panic!("edition {other}"),
        },
        api_mode: FirestoreApiMode::Native,
        policy: match policy {
            "production" => IndexValidationPolicy::Production,
            "report" => IndexValidationPolicy::ProductionReport,
            "emulator" => IndexValidationPolicy::Emulator,
            other => panic!("policy {other}"),
        },
    }
}

fn name_reference(collection: &str) -> Value {
    Value::Reference(format!(
        "projects/demo-app/databases/(default)/documents/{collection}/d1"
    ))
}

/// One filter of the corpus (`eq`, `isnull`, `contains`, `gt`) on a collection.
fn filter(kind: &str, field: &str, collection: &str) -> FilterExpr {
    let path = fp(field);
    let value = if path.is_document_name() {
        name_reference(collection)
    } else {
        Value::Integer(1)
    };
    match kind {
        "eq" => FilterExpr::Field {
            field: path,
            op: FieldOp::Equal,
            value,
        },
        "isnull" => FilterExpr::Unary {
            field: path,
            op: UnaryOp::IsNull,
        },
        "contains" => FilterExpr::Field {
            field: path,
            op: FieldOp::ArrayContains,
            value,
        },
        "containsany" => FilterExpr::Field {
            field: path,
            op: FieldOp::ArrayContainsAny,
            value: Value::Array(vec![value]),
        },
        "gt" => FilterExpr::Field {
            field: path,
            op: FieldOp::GreaterThan,
            value,
        },
        other => panic!("filter {other}"),
    }
}

fn build_query(
    collection: &str,
    group: bool,
    filters: Vec<FilterExpr>,
    orders: &[(FieldPath, Direction)],
) -> Query {
    let id = coll(collection);
    let mut q = Query::new(if group {
        QueryScope::collection_group(id)
    } else {
        QueryScope::collection(None, id)
    });
    match filters.len() {
        0 => {}
        1 => q = q.with_filter(filters.into_iter().next().expect("one filter")),
        _ => q = q.with_filter(FilterExpr::And(filters)),
    }
    for (field, direction) in orders {
        q = q.with_order(OrderClause {
            field: field.clone(),
            direction: *direction,
        });
    }
    q.canonicalize().expect("corpus queries are canonical")
}

#[derive(Default)]
struct CorpusCase {
    number: String,
    label: String,
    config: usize,
    collection: String,
    group: bool,
    source: String,
    ctx: (String, String),
    filters: Vec<(String, String)>,
    orders: Vec<(FieldPath, Direction)>,
    production: Option<(bool, String)>,
    expect: String,
    /// The Lean base (4fcd8a7a3) answer, rendered like `expect` but led by `base`.
    base: String,
    /// The stage-B guard selected by the Lean head.
    guard: String,
}

struct Corpus {
    configs: Vec<IndexSet>,
    cases: Vec<CorpusCase>,
}

fn parse_corpus() -> Corpus {
    let mut configs = Vec::new();
    let mut cases = Vec::new();
    let mut set: Option<IndexSet> = None;
    let mut case: Option<CorpusCase> = None;
    for line in CORPUS.lines() {
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        let (head, rest) = line.split_once(' ').unwrap_or((line, ""));
        if let Some(s) = set.as_mut() {
            match head {
                "default" => {
                    let (c, m) = rest.split_once(' ').expect("default");
                    s.set_default_single_field_indexes(&coll(c), modes(m));
                }
                "override" => {
                    let mut p = rest.split_whitespace();
                    let c = coll(p.next().expect("collection"));
                    let f = fp(p.next().expect("field"));
                    s.set_single_field_indexes(&c, &f, modes(p.next().expect("modes")));
                }
                "composite" => s.add_composite(parse_index(rest)),
                "endconfig" => configs.push(set.take().expect("open config")),
                other => panic!("config line {other}"),
            }
            continue;
        }
        if head == "config" {
            assert_eq!(rest.parse::<usize>().expect("config id"), configs.len());
            set = Some(IndexSet::default());
            continue;
        }
        if head == "case" {
            let (number, label) = rest.split_once(' ').expect("case label");
            case = Some(CorpusCase {
                number: number.to_owned(),
                label: label.to_owned(),
                ..CorpusCase::default()
            });
            continue;
        }
        let c = case.as_mut().expect("open case");
        match head {
            "uses" => c.config = rest.parse().expect("config number"),
            "query" => {
                let (name, g) = rest.split_once(' ').expect("query");
                name.clone_into(&mut c.collection);
                c.group = g == "G";
            }
            "source" => rest.clone_into(&mut c.source),
            "ctx" => {
                let (p, e) = rest.split_once(' ').expect("ctx");
                c.ctx = (p.to_owned(), e.to_owned());
            }
            "filter" => {
                let (k, f) = rest.split_once(' ').expect("filter");
                c.filters.push((k.to_owned(), f.to_owned()));
            }
            "order" => {
                let (f, d) = rest.split_once(' ').expect("order");
                c.orders.push((
                    fp(f),
                    if d == "asc" {
                        Direction::Ascending
                    } else {
                        Direction::Descending
                    },
                ));
            }
            "production" => {
                let (verdict, row) = rest.split_once(' ').expect("production");
                c.production = Some((verdict == "served", row.to_owned()));
            }
            "expect" => line.clone_into(&mut c.expect),
            "base" => format!("expect {rest}").clone_into(&mut c.base),
            "guard" => rest.clone_into(&mut c.guard),
            "end" => cases.push(case.take().expect("open case")),
            other => panic!("case line {other}"),
        }
    }
    assert!(
        set.is_none() && case.is_none(),
        "corpus ends inside a block"
    );
    Corpus { configs, cases }
}

fn corpus_decision(corpus: &Corpus, c: &CorpusCase, ctx: PlanningContext) -> IndexDecision {
    let filters = match c.source.as_str() {
        "" | "count" | "sharedArray" => c
            .filters
            .iter()
            .map(|(k, f)| {
                if c.source == "sharedArray" && k == "eq" && f == "tags" {
                    eq_tags_array()
                } else {
                    filter(k, f, &c.collection)
                }
            })
            .collect(),
        "in1" | "or2" => {
            let [(kind, field)] = c.filters.as_slice() else {
                panic!("non-plain source must project to a single equality");
            };
            assert_eq!(kind, "eq", "{}", c.label);
            if c.source == "in1" {
                vec![field_filter(
                    field,
                    FieldOp::In,
                    Value::Array(vec![Value::Integer(1)]),
                )]
            } else {
                vec![FilterExpr::Or(vec![
                    field_filter(field, FieldOp::Equal, Value::Integer(0)),
                    field_filter(field, FieldOp::Equal, Value::Integer(1)),
                ])]
            }
        }
        other => panic!("unrecognized equality source {other}"),
    };
    let q = build_query(&c.collection, c.group, filters, &c.orders);
    let set = &corpus.configs[c.config];
    if c.source == "count" {
        validate_aggregation_query(&q, &[Aggregation::Count { up_to: None }], set, &ctx)
    } else {
        decide(&q, set, &ctx)
    }
}

#[test]
fn every_corpus_case_matches_the_lean_model() {
    let corpus = parse_corpus();
    assert!(
        corpus.cases.len() > 5000,
        "corpus has {} cases",
        corpus.cases.len()
    );
    let mut failures = Vec::new();
    for c in &corpus.cases {
        let decision = corpus_decision(&corpus, c, context(&c.ctx.0, &c.ctx.1));
        let actual = render_decision(&decision);
        if actual != c.expect {
            failures.push(format!(
                "case {} {}:\n  lean: {}\n  rust: {actual}",
                c.number, c.label, c.expect
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        corpus.cases.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// `IM.head_eq_base_outside_guards` replayed on Rust: wherever no stage-B guard fires, the
/// planner's answer is the Lean base model's (the 4fcd8a7a3 decision). The guards fire
/// only on Standard under the production rules.
#[test]
fn every_corpus_case_without_a_guard_matches_the_base_model() {
    let corpus = parse_corpus();
    let mut failures = Vec::new();
    let mut counts = std::collections::BTreeMap::<&str, usize>::new();
    for c in &corpus.cases {
        *counts.entry(c.guard.as_str()).or_default() += 1;
        assert!(
            c.base.starts_with("expect "),
            "case {} has no base line",
            c.number
        );
        match c.guard.as_str() {
            "none" => {
                let actual =
                    render_decision(&corpus_decision(&corpus, c, context(&c.ctx.0, &c.ctx.1)));
                if actual != c.base {
                    failures.push(format!(
                        "case {} {}:
  base: {}
  rust: {actual}",
                        c.number, c.label, c.base
                    ));
                }
            }
            "a" | "b" | "c" | "reverse" | "shared" | "carrier" | "groupOrdered" | "arrayFirst" => {
                let base = match corpus_decision(&corpus, c, context("production", "enterprise")) {
                    IndexDecision::FullScanAllowed { plan } if c.ctx.0 == "report" => {
                        IndexDecision::AssumedIndex {
                            requirement: plan.missing_index,
                        }
                    }
                    IndexDecision::FullScanAllowed { plan } => IndexDecision::MissingRequired {
                        requirement: plan.missing_index,
                    },
                    decision => decision,
                };
                assert_eq!(render_decision(&base), c.base, "{}", c.label);
                assert!(
                    (!c.group || matches!(c.guard.as_str(), "a" | "b" | "c" | "arrayFirst"))
                        && c.ctx.1 == "standard"
                        && c.ctx.0 != "emulator",
                    "case {} {}: guard {} off the gate",
                    c.number,
                    c.label,
                    c.guard
                );
                assert_ne!(
                    c.base, c.expect,
                    "case {}: a guard that changes nothing",
                    c.number
                );
            }
            other => panic!("case {}: guard {other}", c.number),
        }
    }
    assert!(
        failures.is_empty(),
        "{} cases differ from the base:\n{}",
        failures.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    for guard in [
        "a",
        "b",
        "c",
        "reverse",
        "shared",
        "carrier",
        "groupOrdered",
        "arrayFirst",
    ] {
        assert!(
            counts.get(guard).is_some_and(|n| *n > 0),
            "no case for guard {guard}"
        );
    }
}

#[test]
fn every_recorded_production_verdict_matches_the_planner() {
    let corpus = parse_corpus();
    let rows: Vec<&CorpusCase> = corpus
        .cases
        .iter()
        .filter(|c| c.production.is_some())
        .collect();
    assert_eq!(rows.len(), 249, "production rows in the corpus");
    for c in rows {
        let (verdict, row) = c.production.as_ref().expect("production row");
        assert_eq!(
            served(&corpus_decision(&corpus, c, context(&c.ctx.0, &c.ctx.1))),
            *verdict,
            "production row {row}"
        );
    }
}

#[test]
fn the_corpus_covers_every_decision_kind_and_merge_shape() {
    let corpus = parse_corpus();
    let kinds: BTreeSet<&str> = corpus
        .cases
        .iter()
        .map(|c| c.expect.split_whitespace().nth(1).expect("kind"))
        .collect();
    assert_eq!(
        kinds,
        BTreeSet::from(["assumed", "fullscan", "merge", "missing", "use"])
    );
    // The pairwise rows of the coverage ledger's PICT model (`pictRows` in `Main.lean`).
    assert_eq!(
        corpus
            .cases
            .iter()
            .filter(|c| c.label.starts_with("pict/"))
            .count(),
        105
    );
    let merges: Vec<&CorpusCase> = corpus
        .cases
        .iter()
        .filter(|c| c.expect.starts_with("expect merge"))
        .collect();
    // Members that are composites, automatic ordered indexes and automatic contains indexes.
    assert!(merges
        .iter()
        .any(|c| c.expect.contains("tags:contains,__name__:asc")));
    assert!(merges.iter().any(|c| c.expect.contains(",__name__:desc")));
    assert!(merges.iter().any(|c| c.expect.contains(",e:asc")));
    assert!(merges.iter().any(|c| c.expect.matches(" ; ").count() >= 2));
}

// ---------------------------------------------------------------------------------------------
// Properties (proptest). The field universe is a, b, c (equality fields), tags (the array
// field) and e (the ordered field) on collection `qx`; random composites also use `other` and
// the collection-group scope.

const EQ_FIELDS: [&str; 3] = ["a", "b", "c"];
const ALL_FIELDS: [&str; 6] = ["a", "b", "c", "tags", "e", "__name__"];

#[derive(Clone, Debug)]
struct Shape {
    eq: Vec<&'static str>,
    contains: bool,
    /// Index into `order_shapes()`.
    order: usize,
    group: bool,
}

/// Extra filters (kind, field) and explicit orders of a query shape.
type OrderShape = (
    Vec<(&'static str, &'static str)>,
    Vec<(&'static str, Direction)>,
);

/// The same order shapes as `orderShapes` in `Main.lean`, without the ones that order an
/// equality field (`equality_ordered` is tested on its own) or a field before `__name__`
/// with the opposite direction.
fn order_shapes() -> Vec<OrderShape> {
    use Direction::{Ascending as A, Descending as D};
    vec![
        (vec![], vec![]),
        (vec![], vec![("__name__", A)]),
        (vec![], vec![("__name__", D)]),
        (vec![], vec![("e", A)]),
        (vec![], vec![("e", D)]),
        (vec![], vec![("e", A), ("__name__", D)]),
        (vec![("gt", "e")], vec![]),
        (vec![("gt", "e")], vec![("e", D)]),
        (vec![("gt", "__name__")], vec![]),
        (vec![("gt", "__name__")], vec![("__name__", D)]),
    ]
}

fn shape_query(s: &Shape, eq: &[&str], contains: bool) -> Query {
    let (extra, orders) = &order_shapes()[s.order];
    let mut filters: Vec<FilterExpr> = eq.iter().map(|f| filter("eq", f, "qx")).collect();
    if contains {
        filters.push(filter("contains", "tags", "qx"));
    }
    filters.extend(extra.iter().map(|(k, f)| filter(k, f, "qx")));
    let orders: Vec<(FieldPath, Direction)> = orders.iter().map(|(f, d)| (fp(f), *d)).collect();
    build_query("qx", s.group, filters, &orders)
}

fn standard() -> PlanningContext {
    context("production", "standard")
}

fn shape_strategy() -> impl Strategy<Value = Shape> {
    (
        proptest::sample::subsequence(EQ_FIELDS.to_vec(), 0..=3),
        any::<bool>(),
        0..order_shapes().len(),
        prop::bool::weighted(0.25),
    )
        .prop_map(|(eq, contains, order, group)| Shape {
            eq,
            contains,
            order,
            group,
        })
}

fn mode_strategy() -> impl Strategy<Value = IndexFieldMode> {
    prop_oneof![
        3 => Just(IndexFieldMode::Ascending),
        2 => Just(IndexFieldMode::Descending),
        1 => Just(IndexFieldMode::Contains),
    ]
}

fn composite_strategy() -> impl Strategy<Value = IndexDefinition> {
    (
        prop::collection::vec(
            (
                proptest::sample::select(ALL_FIELDS.to_vec()),
                mode_strategy(),
            ),
            1..=4,
        ),
        prop::bool::weighted(0.1),
        prop::bool::weighted(0.15),
    )
        .prop_map(|(fields, other, group_scope)| IndexDefinition {
            collection_group: coll(if other { "other" } else { "qx" }),
            query_scope: if group_scope {
                IndexQueryScope::CollectionGroup
            } else {
                IndexQueryScope::Collection
            },
            // A path appears once (the repeated-path case is
            // `a_composite_repeating_a_field_is_a_one_member_merge`).
            fields: fields
                .into_iter()
                .scan(BTreeSet::new(), |seen, field| {
                    Some(seen.insert(field.0).then_some(field))
                })
                .flatten()
                .map(|(f, m)| IndexField {
                    path: fp(f),
                    // `__name__` is never an array field.
                    mode: if f == "__name__" && m == IndexFieldMode::Contains {
                        IndexFieldMode::Ascending
                    } else {
                        m
                    },
                })
                .collect(),
        })
}

const SCOPED_MODES: [(IndexQueryScope, IndexFieldMode); 6] = [
    (IndexQueryScope::Collection, IndexFieldMode::Ascending),
    (IndexQueryScope::Collection, IndexFieldMode::Descending),
    (IndexQueryScope::Collection, IndexFieldMode::Contains),
    (IndexQueryScope::CollectionGroup, IndexFieldMode::Ascending),
    (IndexQueryScope::CollectionGroup, IndexFieldMode::Descending),
    (IndexQueryScope::CollectionGroup, IndexFieldMode::Contains),
];

/// Per field of `a, b, c, tags, e`: inherit (`None`) or an explicit subset of the six modes.
type ModeOverrides = Vec<Option<Vec<(IndexQueryScope, IndexFieldMode)>>>;

fn overrides_strategy() -> impl Strategy<Value = ModeOverrides> {
    prop::collection::vec(
        prop::option::weighted(
            0.35,
            proptest::sample::subsequence(SCOPED_MODES.to_vec(), 0..=6),
        ),
        5,
    )
}

fn index_set(composites: &[IndexDefinition], overrides: &ModeOverrides) -> IndexSet {
    let mut set = IndexSet::default();
    for c in composites {
        set.add_composite(c.clone());
    }
    for (field, modes) in ["a", "b", "c", "tags", "e"].iter().zip(overrides) {
        if let Some(modes) = modes {
            set.set_single_field_indexes(&coll("qx"), &fp(field), modes.clone());
        }
    }
    set
}

/// The direction the order shape asks of `__name__`.
fn name_direction(q: &Query) -> Direction {
    q.effective_order_by()
        .iter()
        .find(|o| o.field.is_document_name())
        .map_or(Direction::Ascending, |o| o.direction)
}

fn name_mode(direction: Direction) -> IndexFieldMode {
    match direction {
        Direction::Ascending => IndexFieldMode::Ascending,
        Direction::Descending => IndexFieldMode::Descending,
    }
}

fn only_name_ordered(q: &Query) -> bool {
    q.effective_order_by()
        .iter()
        .all(|o| o.field.is_document_name())
}

/// Whether `member`, alone in an index set where every automatic index is disabled, serves the
/// query of `eq` (plus the array filter when `contains`) and the shape's order and ranges:
/// the single-index rule, used as the per-member condition of the declarative specification.
fn composite_serves_alone(
    s: &Shape,
    member: &IndexDefinition,
    eq: &[&str],
    contains: bool,
) -> bool {
    let mut alone = IndexSet::default();
    alone.set_default_single_field_indexes(&coll("qx"), Vec::new());
    alone.add_composite(member.clone());
    matches!(
        decide(&shape_query(s, eq, contains), &alone, &context("production", "enterprise")),
        IndexDecision::UseIndex { index } if &index == member
    )
}

/// The recorded merge shapes within this generator's plain equality and contains language.
fn recorded_shape(s: &Shape, q: &Query) -> bool {
    order_shapes()[s.order].0.is_empty()
        && (!s.group
            || (s.order == 0 && s.eq.len() == 2)
            || (s.eq.len() == 1 && name_direction(q) == Direction::Descending))
}

/// The declarative merge condition (`IM.MergeSpec`): at least two wanted fields, no explicit
/// order on an equality field, and either the pre-stage-B condition (members covering every
/// wanted field by path, where a member is a configured composite that on its own serves some
/// of the equality filters with the same order, the enabled automatic index of an equality
/// field in the requested `__name__` direction, or, ascending, the array field's enabled
/// contains index; the automatic members only with nothing but `__name__` ordered), or, for
/// the recorded shape with nothing but `__name__` ordered, one of the stage-B merges: (a)
/// descending, the contains index and the descending automatic index of every equality field
/// (production F3); (b) ascending, one composite serving some equalities and the array filter
/// on its own and the ascending automatic index of every other equality field (production F1),
/// Observation 2b adds the configured descending-name equality member and the plain
/// two-equality carrier cases. Other ascending shapes still require a unique ascending carrier.
fn merge_spec(s: &Shape, set: &IndexSet) -> bool {
    let q = shape_query(s, &s.eq, s.contains);
    let wanted = s.eq.len() + usize::from(s.contains);
    if wanted < 2 {
        return false;
    }
    let group_scope = if s.group {
        IndexQueryScope::CollectionGroup
    } else {
        IndexQueryScope::Collection
    };
    let enabled = |f: &str, mode: IndexFieldMode| {
        set.single_field_modes(&coll("qx"), &fp(f))
            .contains(&(group_scope, mode))
    };
    let subsets = || {
        (1u32..(1 << s.eq.len())).map(|mask| {
            s.eq.iter()
                .enumerate()
                .filter(|(i, _)| mask & (1 << i) != 0)
                .map(|(_, f)| *f)
                .collect::<Vec<&str>>()
        })
    };
    let mut covered: BTreeSet<&str> = BTreeSet::new();
    for member in set.composites() {
        for subset in subsets() {
            if composite_serves_alone(s, member, &subset, false) {
                covered.extend(subset.iter().copied());
            }
        }
    }
    let name_only = only_name_ordered(&q);
    let nm = name_mode(name_direction(&q));
    if name_only {
        for f in &s.eq {
            if enabled(f, nm) {
                covered.insert(f);
            }
        }
        if s.contains
            && nm == IndexFieldMode::Ascending
            && enabled("tags", IndexFieldMode::Contains)
        {
            covered.insert("tags");
        }
    }
    let mut wanted_fields: BTreeSet<&str> = s.eq.iter().copied().collect();
    if s.contains {
        wanted_fields.insert("tags");
    }
    if covered == wanted_fields {
        return true;
    }
    if !(recorded_shape(s, &q) && s.contains && name_only) {
        return false;
    }
    if nm == IndexFieldMode::Descending {
        let equality_member = !s.group
            && s.eq.len() == 1
            && s.order == 2
            && set
                .composites()
                .contains(&parse_index(&format!("qx C {}:asc,__name__:desc", s.eq[0])));
        return enabled("tags", IndexFieldMode::Contains)
            && (s.eq.iter().all(|f| enabled(f, nm)) || equality_member);
    }
    if s.order == 0 && s.eq.len() == 2 {
        let carries = |f: &str, scope, mode| {
            set.composites().iter().any(|i| i.collection_group == coll("qx") && i.query_scope == scope
                && matches!(&i.fields[..], [prefix, member, tail @ ..] if prefix.path == fp(f)
                    && prefix.mode == mode && member.path == fp("tags") && member.mode == IndexFieldMode::Contains
                    && (tail.is_empty() || matches!(tail, [name] if name.path.is_document_name() && name.mode == IndexFieldMode::Ascending))))
        };
        let asc = IndexFieldMode::Ascending;
        let collection = IndexQueryScope::Collection;
        if !s.group && s.eq.iter().all(|f| carries(f, collection, asc)) {
            return true;
        }
        if s.eq.iter().enumerate().any(|(n, f)| {
            enabled(s.eq[1 - n], asc)
                && (carries(f, IndexQueryScope::CollectionGroup, asc)
                    || (!s.group
                        && (carries(f, collection, asc)
                            || carries(f, collection, IndexFieldMode::Descending))))
        }) {
            return true;
        }
        if s.group {
            return false;
        }
    }
    let carriers = carrier_prefixes(s, set);
    let [prefix] = carriers.as_slice() else {
        return false;
    };
    s.eq.iter()
        .all(|f| prefix.contains(f) || enabled(f, IndexFieldMode::Ascending))
}

// The generated composites use distinct fields, so their ordered prefixes can be
// replayed as canonical query filters.
fn carrier_prefixes(s: &Shape, set: &IndexSet) -> Vec<Vec<&'static str>> {
    set.composites()
        .iter()
        .filter_map(|member| {
            let prefix: Vec<&str> = member
                .fields
                .iter()
                .map_while(|f| {
                    let ordered = matches!(
                        f.mode,
                        IndexFieldMode::Ascending | IndexFieldMode::Descending
                    );
                    s.eq.iter()
                        .find(|e| ordered && fp(e) == f.path)
                        .map(|e| (*e, f.mode))
                })
                .map(|(e, _)| e)
                .collect();
            let ascending = member.fields[..prefix.len()]
                .iter()
                .all(|f| f.mode == IndexFieldMode::Ascending);
            let carries = member
                .fields
                .get(prefix.len())
                .is_some_and(|f| f.path == fp("tags") && f.mode == IndexFieldMode::Contains);
            (member.query_scope == IndexQueryScope::Collection
                && !prefix.is_empty()
                && ascending
                && carries
                && composite_serves_alone(s, member, &prefix, true))
            .then_some(prefix)
        })
        .collect()
}

/// Checks one merge member against `IM.merged_sound`: a configured composite that serves its
/// leading equality fields with the query's order, or an enabled automatic index; returns the
/// wanted fields it covers.
fn member_cover(s: &Shape, set: &IndexSet, member: &IndexDefinition) -> BTreeSet<String> {
    let q = shape_query(s, &s.eq, s.contains);
    let group_scope = if s.group {
        IndexQueryScope::CollectionGroup
    } else {
        IndexQueryScope::Collection
    };
    let nm = name_mode(name_direction(&q));
    let leading: Vec<&str> = member
        .fields
        .iter()
        .take_while(|f| {
            s.eq.iter().any(|e| fp(e) == f.path)
                && matches!(
                    f.mode,
                    IndexFieldMode::Ascending | IndexFieldMode::Descending
                )
        })
        .map(|f| {
            *s.eq
                .iter()
                .find(|e| fp(e) == f.path)
                .expect("an equality field")
        })
        .collect();
    // A configured composite that leads with equality fields is a composite member (a
    // composite can also equal an automatic index, which then counts as either); when the
    // array field follows them it serves the array filter too.
    // The descending-prefix carrier reports its implied ASC name explicitly in Explain.
    let implicit_carrier = matches!(&member.fields[..], [prefix, array, name]
        if prefix.mode == IndexFieldMode::Descending && array.mode == IndexFieldMode::Contains
            && name.path.is_document_name() && name.mode == IndexFieldMode::Ascending)
        && set.composites().iter().any(|i| {
            i.collection_group == member.collection_group
                && i.query_scope == member.query_scope
                && i.fields == member.fields[..2]
        });
    if (set.composites().contains(member) || implicit_carrier) && !leading.is_empty() {
        let carries = member
            .fields
            .get(leading.len())
            .is_some_and(|f| f.path == fp("tags") && f.mode == IndexFieldMode::Contains);
        // Only merge (b) takes a composite carrying the array field.
        if carries {
            assert!(
                s.contains
                    && recorded_shape(s, &q)
                    && only_name_ordered(&q)
                    && name_direction(&q) == Direction::Ascending,
                "carrying member outside (b): {member:?}"
            );
        }
        assert!(
            composite_serves_alone(s, member, &leading, carries),
            "member {member:?} does not serve {leading:?}"
        );
        let mut cover: BTreeSet<String> = leading.into_iter().map(str::to_owned).collect();
        if carries {
            cover.insert("tags".to_owned());
        }
        return cover;
    }
    // An automatic member: (field mode, __name__ nm) with that mode enabled in the scope.
    assert!(
        only_name_ordered(&q),
        "automatic member with an order: {member:?}"
    );
    assert_eq!(member.collection_group, coll("qx"));
    assert_eq!(member.query_scope, group_scope);
    assert_eq!(member.fields.len(), 2, "{member:?}");
    let (field, second) = (&member.fields[0], &member.fields[1]);
    assert!(
        second.path.is_document_name() && second.mode == nm,
        "{member:?}"
    );
    let enabled = set.single_field_modes(&coll("qx"), &field.path);
    assert!(
        enabled.contains(&(group_scope, field.mode)),
        "{member:?} not enabled"
    );
    let name = field.path.canonical();
    if field.mode == IndexFieldMode::Contains {
        assert!(s.contains && name == "tags");
        assert!(
            nm == IndexFieldMode::Ascending || recorded_shape(s, &q),
            "{member:?}"
        );
    } else {
        assert_eq!(field.mode, nm, "{member:?}");
        assert!(s.eq.contains(&name.as_str()), "{member:?}");
    }
    BTreeSet::from([name])
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// `IM.merged_sound`: every member is configured or an enabled automatic index, serves a
    /// subset of the wanted fields with the same order suffix, and together they cover all.
    #[test]
    fn merge_members_are_sound_and_cover_every_wanted_field(
        s in shape_strategy(),
        composites in prop::collection::vec(composite_strategy(), 0..6),
        overrides in overrides_strategy(),
    ) {
        let set = index_set(&composites, &overrides);
        let q = shape_query(&s, &s.eq, s.contains);
        if let IndexDecision::MergeIndexes { indexes } = decide(&q, &set, &standard()) {
            let mut covered = BTreeSet::new();
            for member in &indexes {
                covered.extend(member_cover(&s, &set, member));
            }
            let mut wanted: BTreeSet<String> = s.eq.iter().map(|f| (*f).to_owned()).collect();
            if s.contains {
                wanted.insert("tags".to_owned());
            }
            prop_assert_eq!(covered, wanted);
        }
    }

    /// `IM.merged_iff_spec` through `decide`: a merge is chosen exactly when the declarative
    /// condition holds and no single index serves the query.
    #[test]
    fn merge_happens_exactly_when_the_declarative_condition_holds(
        s in shape_strategy(),
        composites in prop::collection::vec(composite_strategy(), 0..6),
        overrides in overrides_strategy(),
    ) {
        let set = index_set(&composites, &overrides);
        let q = shape_query(&s, &s.eq, s.contains);
        let decision = decide(&q, &set, &standard());
        let spec = merge_spec(&s, &set);
        match decision {
            IndexDecision::MergeIndexes { .. } => prop_assert!(spec, "merged without the spec"),
            IndexDecision::UseIndex { .. } => {}
            ref other => prop_assert!(!spec, "spec holds but {other:?}"),
        }
    }

    /// `IM.decide_mono`: adding a composite or enabling a single-field mode never turns a
    /// served query into a refused one.
    #[test]
    fn adding_indexes_never_refuses_a_served_query(
        s in shape_strategy(),
        composites in prop::collection::vec(composite_strategy(), 0..6),
        overrides in overrides_strategy(),
        extra in composite_strategy(),
        position in 0usize..7,
        field in 0usize..5,
        enable in proptest::sample::select(SCOPED_MODES.to_vec()),
    ) {
        let set = index_set(&composites, &overrides);
        let q = shape_query(&s, &s.eq, s.contains);
        let before = decide(&q, &set, &standard());
        if served(&before) {
            let mut more = composites.clone();
            more.insert(position.min(more.len()), extra);
            let extended = index_set(&more, &overrides);
            // The plain F1 case admits both carriers. Other query shapes retain the earlier
            // exactly-one-carrier guard.
            let adding_second_carrier =
                matches!(before, IndexDecision::MergeIndexes { .. })
                && !(s.order == 0 && s.eq.len() == 2)
                && s.contains && !s.group && recorded_shape(&s, &q)
                && name_direction(&q) == Direction::Ascending
                && carrier_prefixes(&s, &set).len() == 1
                && carrier_prefixes(&s, &extended).len() == 2;
            let after = decide(&q, &extended, &standard());
            if !served(&after) {
                prop_assert!(adding_second_carrier && only_name_ordered(&q));
                prop_assert!(!merge_spec(&s, &extended));
                prop_assert!(matches!(after, IndexDecision::MissingRequired { .. }), "unexpected {after:?}");
            }
            let mut enabled = overrides.clone();
            let name = ["a", "b", "c", "tags", "e"][field];
            let mut modes = set.single_field_modes(&coll("qx"), &fp(name));
            if !modes.contains(&enable) {
                modes.push(enable);
            }
            enabled[field] = Some(modes);
            prop_assert!(served(&decide(&q, &index_set(&composites, &enabled), &standard())));
        }
    }

    /// `IM.decide_served_perm`: whether a query is served does not depend on the order in
    /// which the composites were added (the members chosen may; see the corpus cases
    /// `finding/members-depend-on-order`).
    #[test]
    fn being_served_does_not_depend_on_composite_order(
        s in shape_strategy(),
        composites in prop::collection::vec(composite_strategy(), 0..6),
        overrides in overrides_strategy(),
        rotation in 0usize..6,
    ) {
        let q = shape_query(&s, &s.eq, s.contains);
        let first = served(&decide(&q, &index_set(&composites, &overrides), &standard()));
        let mut reversed = composites.clone();
        reversed.reverse();
        let mut rotated = composites.clone();
        if !rotated.is_empty() {
            let k = rotation % rotated.len();
            rotated.rotate_left(k);
        }
        prop_assert_eq!(first, served(&decide(&q, &index_set(&reversed, &overrides), &standard())));
        prop_assert_eq!(first, served(&decide(&q, &index_set(&rotated, &overrides), &standard())));
    }

    /// `IM.merged_refuses_eq_ordered` and `IM.merged_refuses_few`: an explicit order on an
    /// equality field, or fewer than two wanted fields, never merges.
    #[test]
    fn documented_refusals_never_merge(
        s in shape_strategy(),
        composites in prop::collection::vec(composite_strategy(), 0..6),
        overrides in overrides_strategy(),
        ordered in 0usize..3,
    ) {
        let set = index_set(&composites, &overrides);
        if s.eq.len() + usize::from(s.contains) < 2 {
            let q = shape_query(&s, &s.eq, s.contains);
            let merged = matches!(decide(&q, &set, &standard()), IndexDecision::MergeIndexes { .. });
            prop_assert!(!merged);
        }
        if !s.eq.is_empty() {
            let field = s.eq[ordered % s.eq.len()];
            let mut filters: Vec<FilterExpr> = s.eq.iter().map(|f| filter("eq", f, "qx")).collect();
            if s.contains {
                filters.push(filter("contains", "tags", "qx"));
            }
            let q = build_query("qx", s.group, filters, &[(fp(field), Direction::Ascending)]);
            let merged = matches!(decide(&q, &set, &standard()), IndexDecision::MergeIndexes { .. });
            prop_assert!(!merged);
        }
    }
}

/// The members chosen depend on the order composites were added, while the decision to serve
/// does not (`IM.members_depend_on_order`).
#[test]
fn merge_members_follow_composite_insertion_order() {
    let q = build_query(
        "qx",
        false,
        vec![filter("eq", "a", "qx"), filter("eq", "b", "qx")],
        &[(fp("e"), Direction::Ascending)],
    );
    let a_e = parse_index("qx C a:asc,e:asc");
    let a_desc_e = parse_index("qx C a:desc,e:asc");
    let b_e = parse_index("qx C b:asc,e:asc");
    let set = |order: &[&IndexDefinition]| {
        let mut set = IndexSet::default();
        for i in order {
            set.add_composite((*i).clone());
        }
        set
    };
    let first = decide(&q, &set(&[&a_e, &a_desc_e, &b_e]), &standard());
    let second = decide(&q, &set(&[&a_desc_e, &a_e, &b_e]), &standard());
    assert_eq!(
        first,
        IndexDecision::MergeIndexes {
            indexes: vec![a_e.clone(), b_e.clone()]
        }
    );
    assert_eq!(
        second,
        IndexDecision::MergeIndexes {
            indexes: vec![a_desc_e, b_e]
        }
    );
}

/// The production verdicts of the index-merge observation (conformance/fs-query-index-merge-production.json,
/// recorded 2026-11-19 in fireemu-oracle-query `(default)`, identical in both recordings): the
/// Lean model's former counterexamples F1 and F3 to completeness against the single-index rule
/// are served by production, F2 is refused, and a single equality ordered by `__name__`
/// descending is refused when only the field's ascending mode is enabled.
#[test]
fn the_index_merge_observation_verdicts() {
    let ctx = standard();
    let qx = coll("qx");
    // F1 (exempt-with-composite#f1-equalities-and-contains): the composite carrying the array
    // field joins the merge as the member for `a` and `tags`; plan
    // `(a ASC, tags ARRAY_CONTAINS, __name__ ASC)`, `(b ASC, __name__ ASC)`.
    let mut f1 = IndexSet::default();
    f1.set_single_field_indexes(&qx, &fp("a"), Vec::new());
    f1.set_single_field_indexes(&qx, &fp("tags"), Vec::new());
    let a_tags = parse_index("qx C a:asc,tags:contains");
    f1.add_composite(a_tags.clone());
    let f1_query = build_query(
        "qx",
        false,
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &[],
    );
    assert_eq!(
        decide(&f1_query, &f1, &ctx),
        IndexDecision::MergeIndexes {
            indexes: vec![a_tags.clone(), parse_index("qx C b:asc,__name__:asc")]
        }
    );
    // The composite alone serves `a == 1 AND tags array-contains 1` (a-and-contains).
    let mut a_tags_only = f1.clone();
    a_tags_only.set_single_field_indexes(&qx, &fp("b"), Vec::new());
    let alone = build_query(
        "qx",
        false,
        vec![filter("eq", "a", "qx"), filter("contains", "tags", "qx")],
        &[],
    );
    assert_eq!(
        decide(&alone, &a_tags_only, &ctx),
        IndexDecision::UseIndex { index: a_tags }
    );

    // F2 (ascending-only): with only `a ASC` enabled, both `a == 1 ORDER BY __name__ DESC`
    // (a-alone-name-desc) and `a == 1 AND b == 1 ORDER BY __name__ DESC` are refused, with the
    // index `(a ASC, __name__ DESC)` suggested for the first.
    let mut f2 = IndexSet::default();
    f2.set_single_field_indexes(
        &qx,
        &fp("a"),
        vec![(IndexQueryScope::Collection, IndexFieldMode::Ascending)],
    );
    let name_desc = [(FieldPath::document_name(), Direction::Descending)];
    let one = build_query("qx", false, vec![filter("eq", "a", "qx")], &name_desc);
    assert_eq!(
        decide(&one, &f2, &ctx),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx C a:asc,__name__:desc")
        }
    );
    let two = build_query(
        "qx",
        false,
        vec![filter("eq", "a", "qx"), filter("eq", "b", "qx")],
        &name_desc,
    );
    assert!(matches!(
        decide(&two, &f2, &ctx),
        IndexDecision::MissingRequired { .. }
    ));
    // a-alone-name-asc is served by `a ASC` (recorded).
    let name_asc = [(FieldPath::document_name(), Direction::Ascending)];
    let asc = build_query("qx", false, vec![filter("eq", "a", "qx")], &name_asc);
    assert_eq!(
        decide(&asc, &f2, &ctx),
        IndexDecision::UseIndex {
            index: parse_index("qx C a:asc,__name__:asc")
        }
    );

    // F3 (builtin): `a == 1 AND tags array-contains 1 ORDER BY __name__ DESC` is a merge of
    // `(tags ARRAY_CONTAINS, __name__ DESC)` and `(a DESC, __name__ DESC)`, in that order.
    let f3 = IndexSet::default();
    let contains_desc = build_query(
        "qx",
        false,
        vec![filter("contains", "tags", "qx")],
        &name_desc,
    );
    assert!(matches!(
        decide(&contains_desc, &f3, &ctx),
        IndexDecision::UseIndex { .. }
    ));
    let joined = build_query(
        "qx",
        false,
        vec![filter("eq", "a", "qx"), filter("contains", "tags", "qx")],
        &name_desc,
    );
    assert_eq!(
        decide(&joined, &f3, &ctx),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx C tags:contains,__name__:desc"),
                parse_index("qx C a:desc,__name__:desc"),
            ]
        }
    );
}

/// A composite carrying the array field joins a merge only in the recorded shape: nothing but
/// `__name__` ordered, ascending (F1). A descending name or an explicit order on
/// an additional field keeps the refusal.
#[test]
fn a_composite_carrying_the_array_field_joins_only_in_the_recorded_shape() {
    let qx = coll("qx");
    let mut set = IndexSet::default();
    set.set_single_field_indexes(&qx, &fp("a"), Vec::new());
    set.set_single_field_indexes(&qx, &fp("tags"), Vec::new());
    set.add_composite(parse_index("qx C a:asc,tags:contains"));
    let filters = || {
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ]
    };
    let desc = build_query(
        "qx",
        false,
        filters(),
        &[(FieldPath::document_name(), Direction::Descending)],
    );
    assert!(matches!(
        decide(&desc, &set, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // An explicit order on another field: the composite carries the array field and the order.
    let mut ordered = IndexSet::default();
    ordered.set_single_field_indexes(&qx, &fp("a"), Vec::new());
    ordered.set_single_field_indexes(&qx, &fp("tags"), Vec::new());
    ordered.add_composite(parse_index("qx C a:asc,tags:contains,e:asc"));
    ordered.add_composite(parse_index("qx C b:asc,e:asc"));
    let by_e = build_query("qx", false, filters(), &[(fp("e"), Direction::Ascending)]);
    assert!(matches!(
        decide(&by_e, &ordered, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
}

/// The refusal of a single equality ordered by `__name__` in the direction of a disabled mode
/// is production's: the report policy serves it as an assumed index, the emulator policy
/// serves it by the enabled mode. Both directions were recorded at collection scope.
#[test]
fn the_disabled_name_direction_refusal_is_production_only() {
    let qx = coll("qx");
    let mut asc_only = IndexSet::default();
    asc_only.set_single_field_indexes(
        &qx,
        &fp("a"),
        vec![(IndexQueryScope::Collection, IndexFieldMode::Ascending)],
    );
    let name_desc = [(FieldPath::document_name(), Direction::Descending)];
    let one = build_query("qx", false, vec![filter("eq", "a", "qx")], &name_desc);
    assert!(matches!(
        decide(&one, &asc_only, &context("report", "standard")),
        IndexDecision::AssumedIndex { .. }
    ));
    assert_eq!(
        decide(&one, &asc_only, &context("emulator", "standard")),
        IndexDecision::UseIndex {
            index: parse_index("qx C a:asc,__name__:desc")
        }
    );
    let mut desc_only = IndexSet::default();
    modes_only(
        &mut desc_only,
        "a",
        &[IndexFieldMode::Descending],
        IndexQueryScope::Collection,
    );
    for orders in [
        vec![],
        vec![(FieldPath::document_name(), Direction::Ascending)],
    ] {
        let query = build_query("qx", false, vec![filter("eq", "a", "qx")], &orders);
        assert_eq!(
            decide(&query, &desc_only, &standard()),
            IndexDecision::MissingRequired {
                requirement: parse_index("qx C a:asc,__name__:asc"),
            }
        );
        assert_eq!(
            decide(&query, &desc_only, &context("emulator", "standard")),
            IndexDecision::UseIndex {
                index: parse_index("qx C a:desc,__name__:asc"),
            }
        );
    }
}

/// A composite that repeats an equality field is a merge of one member (`IM.one_member_merge`).
#[test]
fn a_composite_repeating_a_field_is_a_one_member_merge() {
    let repeated = parse_index("qx C a:asc,a:asc,b:asc");
    let mut set = IndexSet::default();
    set.set_default_single_field_indexes(&coll("qx"), Vec::new());
    set.add_composite(repeated.clone());
    let q = build_query(
        "qx",
        false,
        vec![filter("eq", "a", "qx"), filter("eq", "b", "qx")],
        &[],
    );
    assert_eq!(
        decide(&q, &set, &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![repeated]
        }
    );
    // One wanted field never merges, although `(a, a)` would cover it
    // (`IM.repeated_single_equality_refused`).
    let mut single = IndexSet::default();
    single.set_default_single_field_indexes(&coll("qx"), Vec::new());
    single.add_composite(parse_index("qx C a:asc,a:asc"));
    let one = build_query("qx", false, vec![filter("eq", "a", "qx")], &[]);
    assert!(matches!(
        decide(&one, &single, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
}

#[test]
fn corpus_names_sort_like_field_paths() {
    // The Lean model numbers fields in `FieldPath` order; the corpus relies on it.
    let names = [
        "a",
        "b",
        "c",
        "category",
        "city",
        "d",
        "e",
        "e0",
        "e1",
        "e10",
        "editors_pick",
    ];
    let mut paths: Vec<FieldPath> = names.iter().map(|n| fp(n)).collect();
    paths.sort();
    let sorted: Vec<String> = paths.iter().map(FieldPath::canonical).collect();
    assert_eq!(sorted, names);
}

// ---- Ruling 9: coverage by filter kind, and the recorded boundaries of stage B -------------

fn qx_query(filters: Vec<FilterExpr>, orders: &[(FieldPath, Direction)], group: bool) -> Query {
    build_query("qx", group, filters, orders)
}

/// `tags == [1]`: an equality on the array field itself.
fn eq_tags_array() -> FilterExpr {
    FilterExpr::Field {
        field: fp("tags"),
        op: FieldOp::Equal,
        value: Value::Array(vec![Value::Integer(1)]),
    }
}

fn modes_only(set: &mut IndexSet, field: &str, modes: &[IndexFieldMode], scope: IndexQueryScope) {
    set.set_single_field_indexes(
        &coll("qx"),
        &fp(field),
        modes.iter().map(|m| (scope, *m)).collect(),
    );
}

/// Rows 8 and 9 separate the shared path's filter kinds. Merge8 records the missing
/// equality member when only the contains mode is enabled.
#[test]
fn observation_2a_p5_uses_separate_shared_path_members_when_available() {
    let c = IndexQueryScope::Collection;
    let filters = || {
        vec![
            filter("eq", "a", "qx"),
            eq_tags_array(),
            filter("contains", "tags", "qx"),
        ]
    };
    let name_asc = [(FieldPath::document_name(), Direction::Ascending)];
    let name_desc = [(FieldPath::document_name(), Direction::Descending)];
    let mut set = IndexSet::default();
    modes_only(&mut set, "tags", &[IndexFieldMode::Contains], c);
    for mode in [IndexFieldMode::Ascending, IndexFieldMode::Descending] {
        modes_only(&mut set, "a", &[mode], c);
        for (atoms, suggestion) in [
            (filters(), "qx C tags:contains,a:asc,tags:asc,__name__:asc"),
            (
                vec![eq_tags_array(), filter("contains", "tags", "qx")],
                "qx C tags:contains,tags:asc,__name__:asc",
            ),
        ] {
            let q = qx_query(atoms, &name_asc, false);
            assert_eq!(
                decide(&q, &set, &standard()),
                IndexDecision::MissingRequired {
                    requirement: parse_index(suggestion)
                }
            );
        }
    }
    let shared = vec![eq_tags_array(), filter("contains", "tags", "qx")];
    let q = qx_query(shared.clone(), &[], false);
    let base = IndexDecision::UseIndex {
        index: parse_index("qx C tags:contains,__name__:asc"),
    };
    assert_eq!(decide(&q, &set, &standard()), base);
    assert_eq!(
        decide(
            &qx_query(shared, &name_asc, false),
            &set,
            &context("emulator", "standard")
        ),
        base
    );
    // The descending mirror (`a DESC` and `tags CONTAINS`) was refused and stays refused.
    let mut desc = IndexSet::default();
    modes_only(&mut desc, "a", &[IndexFieldMode::Descending], c);
    modes_only(&mut desc, "tags", &[IndexFieldMode::Contains], c);
    let q = qx_query(filters(), &name_desc, false);
    assert!(matches!(
        decide(&q, &desc, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // The contains member comes first, followed by the ordinary equality and the array equality.
    for (orders, a, tags, membership) in [
        (
            &name_asc,
            "qx C a:asc,__name__:asc",
            "qx C tags:asc,__name__:asc",
            "qx C tags:contains,__name__:asc",
        ),
        (
            &name_desc,
            "qx C a:desc,__name__:desc",
            "qx C tags:desc,__name__:desc",
            "qx C tags:contains,__name__:desc",
        ),
    ] {
        let q = qx_query(filters(), orders, false);
        assert_eq!(
            decide(&q, &IndexSet::default(), &standard()),
            IndexDecision::MergeIndexes {
                indexes: vec![parse_index(membership), parse_index(a), parse_index(tags)]
            },
            "{orders:?}"
        );
    }
    // A composite carrying the array field after `a` covers `a` only in the first attempt; the
    // stage-B merge (b) does not take a shared path, so this stays refused.
    let mut set = IndexSet::default();
    modes_only(&mut set, "a", &[], c);
    modes_only(&mut set, "tags", &[], c);
    set.add_composite(parse_index("qx C a:asc,tags:contains"));
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            eq_tags_array(),
            filter("contains", "tags", "qx"),
        ],
        &[],
        false,
    );
    assert!(matches!(
        decide(&q, &set, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
}

/// Replay the observation 2a refusal shapes and their near misses through the public planner.
#[test]
fn observation_2a_p1_pict_matches_automatic_name_direction() {
    let generated = include_str!("fixtures/index-merge-obs2-p1.tsv");
    assert_eq!(generated.lines().count(), 78);
    for row in generated.lines().skip(1) {
        let [shape, scope_tag, enabled, name, profile, composite]: [&str; 6] =
            row.split('\t').collect::<Vec<_>>().try_into().unwrap();
        let group = scope_tag == "group";
        let index_scope = if group { "G" } else { "C" };
        let mut set = IndexSet::default();
        let enabled_modes = match enabled {
            "ascOnly" => modes(&format!("{index_scope}:asc")),
            "descOnly" => modes(&format!("{index_scope}:desc")),
            "both" => modes(&format!("{index_scope}:asc,{index_scope}:desc")),
            _ => panic!("unknown mode: {enabled}"),
        };
        // The other OR arm has a matching automatic mode, to isolate the P1 gate.
        set.set_single_field_indexes(
            &coll("qx"),
            &fp("b"),
            modes(&format!("{index_scope}:{name}")),
        );
        set.set_single_field_indexes(&coll("qx"), &fp("a"), enabled_modes);
        let order = if name == "asc" {
            Direction::Ascending
        } else {
            Direction::Descending
        };
        let name_order = (FieldPath::document_name(), order);
        let orders = match shape {
            "count" if name == "asc" => Vec::new(),
            "orderDesc" => vec![(fp("a"), Direction::Descending)],
            "orderAscName" => vec![(fp("a"), Direction::Ascending), name_order],
            "orderAscField" | "countOrderField" => vec![(fp("a"), order)],
            _ => vec![name_order],
        };
        let filters = obs2_equality_filters(shape);
        if composite == "serves" {
            set.add_composite(parse_index(&format!(
                "qx {index_scope} a:{name},__name__:{name}"
            )));
        }
        let q = qx_query(filters, &orders, group);
        let ctx = if profile == "enterprise" {
            context("production", "enterprise")
        } else {
            context(profile, "standard")
        };
        let decision = match shape {
            "count" | "cappedCount" | "countOrderField" | "countNull" => {
                validate_aggregation_query(
                    &q,
                    &[Aggregation::Count {
                        up_to: (shape == "cappedCount").then_some(1),
                    }],
                    &set,
                    &ctx,
                )
            }
            _ => decide(&q, &set, &ctx),
        };
        let prohibited_asc_fallback = enabled == "ascOnly"
            && name == "desc"
            && matches!(
                shape,
                "eq" | "orderDesc" | "orderAscName" | "in1" | "or2" | "isNull" | "count"
            );
        let prohibited_desc_fallback = enabled == "descOnly" && name == "asc" && shape == "eq";
        let refusal =
            (prohibited_asc_fallback || prohibited_desc_fallback) && composite == "absent";
        let suggestion = parse_index(&format!("qx {index_scope} a:asc,__name__:{name}"));
        if refusal && profile == "production" {
            assert_eq!(
                decision,
                IndexDecision::MissingRequired {
                    requirement: suggestion
                },
                "{row:?}"
            );
        } else if refusal && profile == "report" {
            assert_eq!(
                decision,
                IndexDecision::AssumedIndex {
                    requirement: suggestion
                },
                "{row:?}"
            );
        } else {
            assert!(
                matches!(decision, IndexDecision::UseIndex { .. }),
                "{row:?}: {decision:?}"
            );
        }
    }
}

fn obs2_equality_filters(shape: &str) -> Vec<FilterExpr> {
    let exact_a = |value| field_filter("a", FieldOp::Equal, Value::Integer(value));
    match shape {
        "in1" => vec![field_filter(
            "a",
            FieldOp::In,
            Value::Array(vec![Value::Integer(1)]),
        )],
        "in2" => vec![field_filter(
            "a",
            FieldOp::In,
            Value::Array(vec![Value::Integer(0), Value::Integer(1)]),
        )],
        "or2" => vec![FilterExpr::Or(vec![exact_a(0), exact_a(1)])],
        "or3" => vec![FilterExpr::Or(vec![exact_a(0), exact_a(1), exact_a(2)])],
        "crossFieldOr" => vec![FilterExpr::Or(vec![exact_a(1), filter("eq", "b", "qx")])],
        "isNull" | "countNull" => vec![filter("isnull", "a", "qx")],
        "isNan" => vec![FilterExpr::Unary {
            field: fp("a"),
            op: UnaryOp::IsNan,
        }],
        "eq" | "orderDesc" | "orderAscName" | "count" | "cappedCount" | "orderAscField"
        | "countOrderField" => vec![exact_a(1)],
        _ => panic!("unknown shape: {shape}"),
    }
}

/// Observation 2a: the added merge shapes and the exact members of each recorded plan.
#[test]
fn observation_2a_p2_to_p6_pict_matches_recorded_merge_members() {
    let rows = include_str!("fixtures/index-merge-obs2-merges.tsv");
    assert_eq!(rows.lines().count(), 56);
    for row in rows.lines().skip(1) {
        let [shape, scope, catalog, policy]: [&str; 4] =
            row.split('\t').collect::<Vec<_>>().try_into().unwrap();
        let group = scope == "group";
        let ctx = context(policy, "standard");
        let set = obs2_merge_catalog(catalog, group);
        let q = obs2_merge_query(shape, group);
        let aggs: &[Aggregation] = if shape == "count" {
            &[Aggregation::Count { up_to: None }]
        } else {
            &[]
        };
        let result = if aggs.is_empty() {
            decide(&q, &set, &ctx)
        } else {
            validate_aggregation_query(&q, aggs, &set, &ctx)
        };
        let expected = obs2_merge_members(shape, scope, catalog);
        if policy == "emulator" || (policy == "report" && expected.is_none()) {
            assert!(
                matches!(result, IndexDecision::AssumedIndex { .. }),
                "{row:?}"
            );
        } else if let Some(indexes) = expected {
            assert_eq!(result, IndexDecision::MergeIndexes { indexes }, "{row:?}");
        } else {
            assert!(
                matches!(result, IndexDecision::MissingRequired { .. }),
                "{row:?}"
            );
        }
    }
}

fn obs2_merge_catalog(catalog: &str, group: bool) -> IndexSet {
    let mut set = if matches!(catalog, "carrierExempt" | "mixedExempt") {
        f1_set()
    } else {
        IndexSet::default()
    };
    let asc = "qx C a:asc,tags:contains";
    let desc = "qx C a:desc,tags:contains,__name__:asc";
    let extra: &[_] = match catalog {
        "carrierEnabled" | "sharedCarrier" => &[asc],
        "twoCarriers" => &[asc, "qx C b:asc,tags:contains"],
        "descendingCarrier" | "mixedExempt" => &[desc],
        "groupCarrier" => &["qx G a:asc,tags:contains"],
        "wrongNameCarrier" => &["qx C a:asc,tags:contains,__name__:desc"],
        "mixedCarriers" => &[asc, desc],
        "otherCollectionCarrier" => &["other C a:desc,tags:contains,__name__:asc"],
        _ => &[],
    };
    for index in extra {
        set.add_composite(parse_index(index));
    }
    if catalog == "sharedCarrier" {
        modes_only(&mut set, "a", &[], IndexQueryScope::Collection);
    }
    if group {
        modes_only(
            &mut set,
            "a",
            &[IndexFieldMode::Descending],
            IndexQueryScope::CollectionGroup,
        );
        modes_only(
            &mut set,
            "tags",
            &[IndexFieldMode::Contains],
            IndexQueryScope::CollectionGroup,
        );
    }
    if catalog == "sparseShared" {
        modes_only(
            &mut set,
            "tags",
            &[IndexFieldMode::Contains],
            IndexQueryScope::Collection,
        );
    }
    set
}

fn obs2_merge_query(shape: &str, group: bool) -> Query {
    let mut filters = vec![filter("eq", "a", "qx")];
    if matches!(
        shape,
        "count" | "noOrderAny" | "twoEqNameAsc" | "twoEqContains"
    ) {
        filters.push(filter("eq", "b", "qx"));
    }
    if matches!(shape, "sharedAsc" | "sharedDesc") {
        filters.push(eq_tags_array());
    }
    match shape {
        "twoEqNameAsc" => {}
        "descAny" | "noOrderAny" => filters.push(field_filter(
            "tags",
            FieldOp::ArrayContainsAny,
            Value::Array(vec![Value::Integer(1)]),
        )),
        _ => filters.push(filter("contains", "tags", "qx")),
    }
    let name_asc = [(FieldPath::document_name(), Direction::Ascending)];
    let name_desc = name_desc();
    let orders: &[_] = match shape {
        "descPlain" | "descAny" | "sharedDesc" => &name_desc,
        "twoEqNameAsc" | "oneEqNameAsc" | "sharedAsc" => &name_asc,
        _ => &[],
    };
    qx_query(filters, orders, group)
}

fn obs2_merge_members(shape: &str, scope: &str, catalog: &str) -> Option<Vec<IndexDefinition>> {
    let dir = if matches!(shape, "descPlain" | "descAny" | "sharedDesc") {
        "desc"
    } else {
        "asc"
    };
    if (shape == "descAny" && scope == "group") || catalog == "sharedCarrier" {
        return None;
    }
    if matches!(catalog, "carrierExempt" | "carrierEnabled") {
        return Some(vec![
            parse_index("qx C a:asc,tags:contains"),
            parse_index("qx C b:asc,__name__:asc"),
        ]);
    }
    if catalog == "mixedExempt" {
        return Some(vec![
            parse_index("qx C a:desc,tags:contains,__name__:asc"),
            parse_index("qx C b:asc,__name__:asc"),
        ]);
    }
    let scope = if scope == "group" { "G" } else { "C" };
    let a = format!("qx {scope} a:{dir},__name__:{dir}");
    let b = format!("qx {scope} b:{dir},__name__:{dir}");
    let tags = format!("qx {scope} tags:contains,__name__:{dir}");
    let ordered_tags = format!("qx {scope} tags:{dir},__name__:{dir}");
    let order = match shape {
        "twoEqNameAsc" => vec![&b, &a],
        "twoEqContains"
            if matches!(
                catalog,
                "twoCarriers"
                    | "descendingCarrier"
                    | "groupCarrier"
                    | "wrongNameCarrier"
                    | "mixedCarriers"
            ) =>
        {
            vec![&a, &b, &tags]
        }
        "twoEqContains" => vec![&tags, &b, &a],
        "sharedAsc" if catalog == "sparseShared" => vec![&a, &tags],
        "sharedAsc" | "sharedDesc" => vec![&tags, &a, &ordered_tags],
        _ => vec![&tags, &a],
    };
    Some(order.iter().map(|spec| parse_index(spec)).collect())
}

/// Rows 16–17 and 38–39: ordering the equality field and group scope do not make the
/// ascending-only mode serve a descending name. Enterprise keeps the base scan.
#[test]
fn observation_2a_p1_refuses_group_and_equality_orders_under_production_rules() {
    let name_desc = [(FieldPath::document_name(), Direction::Descending)];
    // Collection-group scope with only the group-scoped ascending mode.
    let mut group = IndexSet::default();
    modes_only(
        &mut group,
        "a",
        &[IndexFieldMode::Ascending],
        IndexQueryScope::CollectionGroup,
    );
    let q = qx_query(vec![filter("eq", "a", "qx")], &name_desc, true);
    assert_eq!(
        decide(&q, &group, &standard()),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx G a:asc,__name__:desc")
        }
    );
    let mut asc_only = IndexSet::default();
    modes_only(
        &mut asc_only,
        "a",
        &[IndexFieldMode::Ascending],
        IndexQueryScope::Collection,
    );
    // `ORDER BY a DESC` and `ORDER BY a ASC, __name__ DESC` name the equality field.
    for orders in [
        vec![(fp("a"), Direction::Descending)],
        vec![
            (fp("a"), Direction::Ascending),
            (FieldPath::document_name(), Direction::Descending),
        ],
    ] {
        let q = qx_query(vec![filter("eq", "a", "qx")], &orders, false);
        assert_eq!(
            decide(&q, &asc_only, &standard()),
            IndexDecision::MissingRequired {
                requirement: parse_index("qx C a:asc,__name__:desc")
            },
            "{orders:?}"
        );
    }
    // Enterprise keeps the automatic index.
    let q = qx_query(vec![filter("eq", "a", "qx")], &name_desc, false);
    assert_eq!(
        decide(&q, &asc_only, &context("production", "enterprise")),
        IndexDecision::UseIndex {
            index: parse_index("qx C a:asc,__name__:desc")
        }
    );
}

/// Group members serve the plain two-equality query. Other forms retain their recorded boundaries and member order.
#[test]
fn the_merges_keep_their_recorded_boundaries_and_member_order() {
    let name_desc = [(FieldPath::document_name(), Direction::Descending)];
    let g = IndexQueryScope::CollectionGroup;
    // The group query uses both members at group scope.
    let mut group_f1 = IndexSet::default();
    modes_only(&mut group_f1, "a", &[], g);
    modes_only(&mut group_f1, "tags", &[], g);
    // The other equality has ascending indexes at collection and group scope.
    group_f1.set_single_field_indexes(&coll("qx"), &fp("b"), modes("C:asc,G:asc"));
    group_f1.add_composite(parse_index("qx G a:asc,tags:contains"));
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &[],
        true,
    );
    assert_eq!(
        decide(&q, &group_f1, &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx G a:asc,tags:contains"),
                parse_index("qx G b:asc,__name__:asc")
            ]
        }
    );
    let descending = q.clone().with_order(OrderClause {
        field: FieldPath::document_name(),
        direction: Direction::Descending,
    });
    assert_eq!(
        decide(&descending, &group_f1, &standard()),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx G tags:contains,a:asc,b:asc,__name__:desc")
        }
    );
    assert!(matches!(
        validate_aggregation_query(
            &q,
            &[Aggregation::Count { up_to: None }],
            &group_f1,
            &standard()
        ),
        IndexDecision::MissingRequired { .. }
    ));
    // Multi-element array-contains-any was not recorded.
    let any = FilterExpr::Field {
        field: fp("tags"),
        op: FieldOp::ArrayContainsAny,
        value: Value::Array(vec![Value::Integer(1), Value::Integer(2)]),
    };
    let q = qx_query(vec![filter("eq", "a", "qx"), any], &name_desc, false);
    assert!(matches!(
        decide(&q, &IndexSet::default(), &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // (a) with three equalities: served, the contains member first.
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("eq", "c", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &name_desc,
        false,
    );
    assert_eq!(
        decide(&q, &IndexSet::default(), &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx C tags:contains,__name__:desc"),
                parse_index("qx C a:desc,__name__:desc"),
                parse_index("qx C b:desc,__name__:desc"),
                parse_index("qx C c:desc,__name__:desc"),
            ]
        }
    );
    // Ascending merge of automatic members: the equality members first, as before stage B.
    let q = qx_query(
        vec![filter("eq", "a", "qx"), filter("contains", "tags", "qx")],
        &[],
        false,
    );
    assert_eq!(
        decide(&q, &IndexSet::default(), &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx C a:asc,__name__:asc"),
                parse_index("qx C tags:contains,__name__:asc"),
            ]
        }
    );
}

// ---- Rulings 10 and 11: the stage-B rules apply to the whole query as the client wrote it ---

fn name_desc() -> [(FieldPath, Direction); 1] {
    [(FieldPath::document_name(), Direction::Descending)]
}

fn field_filter(field: &str, op: FieldOp, value: Value) -> FilterExpr {
    FilterExpr::Field {
        field: fp(field),
        op,
        value,
    }
}

/// Only the collection-scoped `a ASC`: the recorded F2 set.
fn f2_set() -> IndexSet {
    let mut set = IndexSet::default();
    modes_only(
        &mut set,
        "a",
        &[IndexFieldMode::Ascending],
        IndexQueryScope::Collection,
    );
    set
}

/// The recorded F1 set: `a` and `tags` exempt, `(a ASC, tags CONTAINS)` configured.
fn f1_set() -> IndexSet {
    let c = IndexQueryScope::Collection;
    let mut set = IndexSet::default();
    modes_only(&mut set, "a", &[], c);
    modes_only(&mut set, "tags", &[], c);
    set.add_composite(parse_index("qx C a:asc,tags:contains"));
    set
}

fn automatic_a_asc_name_desc() -> IndexDecision {
    IndexDecision::UseIndex {
        index: parse_index("qx C a:asc,__name__:desc"),
    }
}

/// Observation 2a extends (c) to rows 12, 14, 15 and 18. Unrecorded forms reaching the same
/// normalized arm still keep the base answer.
#[test]
fn the_single_equality_refusal_tests_the_whole_query() {
    let set = f2_set();
    let ctx = standard();
    let name = || name_reference("qx");
    let neighbours: Vec<(&str, Vec<FilterExpr>)> = vec![
        (
            "is nan",
            vec![FilterExpr::Unary {
                field: fp("a"),
                op: UnaryOp::IsNan,
            }],
        ),
        (
            "== null",
            vec![field_filter("a", FieldOp::Equal, Value::Null)],
        ),
        (
            "== NaN",
            vec![field_filter("a", FieldOp::Equal, Value::Double(f64::NAN))],
        ),
        (
            "repeated equality",
            vec![
                field_filter("a", FieldOp::Equal, Value::Integer(1)),
                field_filter("a", FieldOp::Equal, Value::Integer(2)),
            ],
        ),
        (
            "key equality",
            vec![
                filter("eq", "a", "qx"),
                field_filter("__name__", FieldOp::Equal, name()),
            ],
        ),
        (
            "key range",
            vec![
                filter("eq", "a", "qx"),
                field_filter("__name__", FieldOp::LessThan, name()),
            ],
        ),
    ];
    for (label, filters) in neighbours {
        let q = qx_query(filters, &name_desc(), false);
        assert_eq!(
            decide(&q, &set, &ctx),
            automatic_a_asc_name_desc(),
            "{label}"
        );
    }
    // `a == 1 OR b == 2`: every arm served, as before.
    let or = FilterExpr::Or(vec![filter("eq", "a", "qx"), filter("eq", "b", "qx")]);
    let q = qx_query(vec![or], &name_desc(), false);
    assert!(served(&decide(&q, &set, &ctx)), "or");
    // Row 12: an unlimited count is subject to the same refusal.
    let q = qx_query(vec![filter("eq", "a", "qx")], &name_desc(), false);
    assert_eq!(
        validate_aggregation_query(&q, &[Aggregation::Count { up_to: None }], &set, &ctx),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx C a:asc,__name__:desc")
        }
    );
    // The recorded query itself is refused.
    assert!(matches!(
        decide(&q, &set, &ctx),
        IndexDecision::MissingRequired { .. }
    ));
}

/// With a composite that serves the query, refusal (c) does not change the reported index:
/// the automatic `(a ASC, __name__ DESC)` stays, as before (Codex round 2, Should 2).
#[test]
fn the_single_equality_refusal_keeps_the_plan_when_a_composite_serves() {
    let mut set = f2_set();
    set.add_composite(parse_index("qx C a:desc,__name__:desc"));
    let q = qx_query(vec![filter("eq", "a", "qx")], &name_desc(), false);
    assert_eq!(decide(&q, &set, &standard()), automatic_a_asc_name_desc());
}

/// Beyond the recorded (b) forms, multi-element array-contains-any, an OR arm, Enterprise
/// and a capped count keep their answers. The first merge member must carry the array field.
#[test]
fn merge_b_keeps_to_the_recorded_query() {
    let set = f1_set();
    let any = field_filter(
        "tags",
        FieldOp::ArrayContainsAny,
        Value::Array(vec![Value::Integer(1), Value::Integer(2)]),
    );
    let q = qx_query(
        vec![filter("eq", "a", "qx"), filter("eq", "b", "qx"), any],
        &[],
        false,
    );
    assert!(matches!(
        decide(&q, &set, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    let f1_and = || {
        FilterExpr::And(vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ])
    };
    let q = qx_query(
        vec![FilterExpr::Or(vec![f1_and(), filter("eq", "c", "qx")])],
        &[],
        false,
    );
    assert!(matches!(
        decide(&q, &set, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    let q = qx_query(vec![f1_and()], &[], false);
    assert!(matches!(
        decide(&q, &set, &context("production", "enterprise")),
        IndexDecision::FullScanAllowed { .. }
    ));
    // Row 21 is an unlimited count. A capped count keeps the earlier refusal.
    assert!(matches!(
        validate_aggregation_query(
            &q,
            &[Aggregation::Count { up_to: Some(1) }],
            &set,
            &standard()
        ),
        IndexDecision::MissingRequired { .. }
    ));
    // The count and singleton ANY extensions cover the recorded no-order forms.
    let explicit_name = [(FieldPath::document_name(), Direction::Ascending)];
    let explicit_count = qx_query(vec![f1_and()], &explicit_name, false);
    assert!(matches!(
        validate_aggregation_query(
            &explicit_count,
            &[Aggregation::Count { up_to: None }],
            &set,
            &standard()
        ),
        IndexDecision::MissingRequired { .. }
    ));
    let explicit_any = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("containsany", "tags", "qx"),
        ],
        &explicit_name,
        false,
    );
    assert!(matches!(
        decide(&explicit_any, &set, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // `b` exempt with a configured `(b ASC, __name__ ASC)`: the second member would be a
    // composite, which production was not recorded merging with the carrying one.
    let mut composite_b = set.clone();
    modes_only(&mut composite_b, "b", &[], IndexQueryScope::Collection);
    composite_b.add_composite(parse_index("qx C b:asc,__name__:asc"));
    assert!(matches!(
        decide(&q, &composite_b, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // A composite member must carry the array field and serve on its own: `(a ASC)` alone,
    // or `(a ASC, tags CONTAINS, e ASC)` (an extra field the query does not order), leaves the
    // merge refused (cargo-mutants run 5).
    for composite in ["qx C a:asc", "qx C a:asc,tags:contains,e:asc"] {
        let mut other = IndexSet::default();
        modes_only(&mut other, "a", &[], IndexQueryScope::Collection);
        modes_only(&mut other, "tags", &[], IndexQueryScope::Collection);
        other.add_composite(parse_index(composite));
        assert!(
            matches!(
                decide(&q, &other, &standard()),
                IndexDecision::MissingRequired { .. }
            ),
            "{composite}"
        );
    }
    // A composite of the array field alone, `(tags CONTAINS)`, with `tags` exempt: no equality
    // prefix, so it is no member of (b); refused, as before.
    let mut array_only = IndexSet::default();
    modes_only(&mut array_only, "tags", &[], IndexQueryScope::Collection);
    array_only.add_composite(parse_index("qx C tags:contains"));
    assert!(matches!(
        decide(&q, &array_only, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // The recorded query is served.
    assert!(matches!(
        decide(&q, &set, &standard()),
        IndexDecision::MergeIndexes { .. }
    ));
}

/// The recorded collection descending-name merge accepts an explicitly configured equality member.
#[test]
fn merge_a_keeps_to_the_recorded_query() {
    let joined = || vec![filter("eq", "a", "qx"), filter("contains", "tags", "qx")];
    // Merge6: the contains member precedes the configured equality member.
    let mut composite = IndexSet::default();
    modes_only(&mut composite, "a", &[], IndexQueryScope::Collection);
    composite.add_composite(parse_index("qx C a:asc,__name__:desc"));
    let q = qx_query(joined(), &name_desc(), false);
    assert_eq!(
        decide(&q, &composite, &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx C tags:contains,__name__:desc"),
                parse_index("qx C a:asc,__name__:desc")
            ]
        }
    );
    let asc = qx_query(
        joined(),
        &[(FieldPath::document_name(), Direction::Ascending)],
        false,
    );
    assert_eq!(
        decide(&asc, &composite, &standard()),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx C tags:contains,a:asc,__name__:asc")
        }
    );
    let any = qx_query(
        vec![filter("eq", "a", "qx"), filter("containsany", "tags", "qx")],
        &name_desc(),
        false,
    );
    assert_eq!(
        decide(&any, &composite, &standard()),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx C a:asc,tags:contains,__name__:desc")
        }
    );
    // Enterprise with the built-in modes: the full scan, as before.
    assert!(matches!(
        decide(
            &q,
            &IndexSet::default(),
            &context("production", "enterprise")
        ),
        IndexDecision::FullScanAllowed { .. }
    ));
    // An OR arm: refused, as before.
    let or = FilterExpr::Or(vec![FilterExpr::And(joined()), filter("eq", "b", "qx")]);
    let q = qx_query(vec![or], &name_desc(), false);
    assert!(matches!(
        decide(&q, &IndexSet::default(), &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // A key equality, a repeated equality on `a`, or a second array-contains (which query
    // validation refuses before planning) is not the recorded query: refused, as before.
    let others = [
        (
            "key equality",
            field_filter("__name__", FieldOp::Equal, name_reference("qx")),
        ),
        (
            "repeated equality",
            field_filter("a", FieldOp::Equal, Value::Integer(2)),
        ),
        (
            "second array-contains",
            field_filter("e", FieldOp::ArrayContains, Value::Integer(1)),
        ),
    ];
    for (label, extra) in others {
        let mut filters = joined();
        filters.push(extra);
        let q = qx_query(filters, &name_desc(), false);
        assert!(
            matches!(
                decide(&q, &IndexSet::default(), &standard()),
                IndexDecision::MissingRequired { .. }
            ),
            "{label}"
        );
    }
    // The recorded query is served.
    let q = qx_query(joined(), &name_desc(), false);
    assert!(matches!(
        decide(&q, &IndexSet::default(), &standard()),
        IndexDecision::MergeIndexes { .. }
    ));
}

// ---- Ruling 12: the canonical query, and one collection-scoped carrier for (b) --------------

/// The gate judges the canonical query (coordinator ruling 12): a repeated identical equality,
/// a singleton `or` and an explicit `ORDER BY __name__ ASC` are the recorded query itself, so
/// they reach the override like it.
#[test]
fn the_canonical_forms_of_the_recorded_queries_reach_the_overrides() {
    let set = f2_set();
    let twice = qx_query(
        vec![filter("eq", "a", "qx"), filter("eq", "a", "qx")],
        &name_desc(),
        false,
    );
    let singleton_or = qx_query(
        vec![FilterExpr::Or(vec![filter("eq", "a", "qx")])],
        &name_desc(),
        false,
    );
    for (label, q) in [
        ("repeated identical", twice),
        ("singleton or", singleton_or),
    ] {
        assert!(
            matches!(
                decide(&q, &set, &standard()),
                IndexDecision::MissingRequired { .. }
            ),
            "{label}"
        );
    }
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &[(FieldPath::document_name(), Direction::Ascending)],
        false,
    );
    assert_eq!(
        decide(&q, &f1_set(), &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx C a:asc,tags:contains"),
                parse_index("qx C b:asc,__name__:asc"),
            ]
        }
    );
}

/// The forms the Opus round-3 review probed collapse to the recorded queries under
/// canonicalization (wrappers of one child and identical repeated filters removed) and reach the
/// overrides like them (coordinator ruling 12 addition).
#[test]
fn the_probed_canonical_forms_reach_the_overrides() {
    let a = || filter("eq", "a", "qx");
    let t = || filter("contains", "tags", "qx");
    let b = || filter("eq", "b", "qx");
    for (label, f) in [
        ("a == 1 AND a == 1", FilterExpr::And(vec![a(), a()])),
        ("or(a == 1)", FilterExpr::Or(vec![a()])),
        ("or(a == 1, a == 1)", FilterExpr::Or(vec![a(), a()])),
        (
            "and(and(a == 1))",
            FilterExpr::And(vec![FilterExpr::And(vec![a()])]),
        ),
        (
            "and(a == 1, and())",
            FilterExpr::And(vec![a(), FilterExpr::And(vec![])]),
        ),
    ] {
        let q = qx_query(vec![f], &name_desc(), false);
        assert!(
            matches!(
                decide(&q, &f2_set(), &standard()),
                IndexDecision::MissingRequired { .. }
            ),
            "{label}"
        );
    }
    let f3 = IndexDecision::MergeIndexes {
        indexes: vec![
            parse_index("qx C tags:contains,__name__:desc"),
            parse_index("qx C a:desc,__name__:desc"),
        ],
    };
    for (label, f) in [
        (
            "or(and(a, tags))",
            FilterExpr::Or(vec![FilterExpr::And(vec![a(), t()])]),
        ),
        ("a AND a AND tags", FilterExpr::And(vec![a(), a(), t()])),
    ] {
        let q = qx_query(vec![f], &name_desc(), false);
        assert_eq!(decide(&q, &IndexSet::default(), &standard()), f3, "{label}");
    }
    let q = qx_query(
        vec![FilterExpr::Or(vec![FilterExpr::And(vec![a(), b(), t()])])],
        &[],
        false,
    );
    assert_eq!(
        decide(&q, &f1_set(), &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx C a:asc,tags:contains"),
                parse_index("qx C b:asc,__name__:asc"),
            ]
        }
    );
}

/// Having an automatic contains index does not disable a serving carrier (row 32).
#[test]
fn observation_2a_p6_enabling_contains_preserves_the_carrier_merge() {
    let mut set = f1_set();
    let q = obs2_merge_query("twoEqContains", false);
    let expected = IndexDecision::MergeIndexes {
        indexes: obs2_merge_members("twoEqContains", "collection", "carrierExempt").unwrap(),
    };
    assert_eq!(decide(&q, &set, &standard()), expected);
    modes_only(
        &mut set,
        "tags",
        &[IndexFieldMode::Contains],
        IndexQueryScope::Collection,
    );
    assert_eq!(decide(&q, &set, &standard()), expected);
}

/// Merge3 records both ascending carriers. Merge7 and merge8 serve a collection F1
/// with a group carrier, without recording an Explain member list for it.
#[test]
fn merge_b_serves_with_two_collection_carriers_or_one_group_carrier() {
    let f1 = || {
        qx_query(
            vec![
                filter("eq", "a", "qx"),
                filter("eq", "b", "qx"),
                filter("contains", "tags", "qx"),
            ],
            &[],
            false,
        )
    };
    let c = IndexQueryScope::Collection;
    let mut group_carrier = IndexSet::default();
    modes_only(&mut group_carrier, "a", &[], c);
    modes_only(&mut group_carrier, "tags", &[], c);
    group_carrier.set_single_field_indexes(&coll("qx"), &fp("b"), modes("C:asc,G:asc"));
    group_carrier.add_composite(parse_index("qx G a:asc,tags:contains"));
    assert!(served(&decide(&f1(), &group_carrier, &standard())));
    assert_eq!(
        validate_aggregation_query(
            &f1(),
            &[Aggregation::Count { up_to: None }],
            &group_carrier,
            &standard()
        ),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx C a:asc,b:asc,tags:contains,__name__:asc")
        }
    );
    // Restoring either exempt field in merge8's igy catalog keeps the base refusal.
    for field in ["a", "tags"] {
        let mut restored = group_carrier.clone();
        restored.clear_single_field_override(&coll("qx"), &fp(field));
        assert_eq!(
            decide(&f1(), &restored, &standard()),
            IndexDecision::MissingRequired {
                requirement: parse_index("qx C a:asc,b:asc,tags:contains,__name__:asc")
            }
        );
    }
    let mut two = f1_set();
    assert!(served(&decide(&f1(), &two, &standard())));
    two.add_composite(parse_index("qx C b:asc,tags:contains"));
    assert!(served(&decide(&f1(), &two, &standard())));
    modes_only(&mut two, "b", &[], c);
    let plan = IndexDecision::MergeIndexes {
        indexes: vec![
            parse_index("qx C b:asc,tags:contains"),
            parse_index("qx C a:asc,tags:contains"),
        ],
    };
    for ctx in [standard(), context("report", "standard")] {
        assert_eq!(decide(&f1(), &two, &ctx), plan);
        assert_eq!(
            validate_aggregation_query(&f1(), &[Aggregation::Count { up_to: None }], &two, &ctx),
            plan
        );
    }
    let desc = f1().with_order(OrderClause {
        field: FieldPath::document_name(),
        direction: Direction::Descending,
    });
    assert!(matches!(
        decide(&desc, &two, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    let any = obs2_merge_query("noOrderAny", false);
    assert!(matches!(
        decide(&any, &two, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // A composite carrying every equality serves the query alone (the base answer).
    let mut larger = IndexSet::default();
    modes_only(&mut larger, "a", &[], c);
    modes_only(&mut larger, "tags", &[], c);
    larger.add_composite(parse_index("qx C a:asc,b:asc,tags:contains"));
    assert_eq!(
        decide(&f1(), &larger, &standard()),
        IndexDecision::UseIndex {
            index: parse_index("qx C a:asc,b:asc,tags:contains")
        }
    );
}

/// The scope guard of the stage-B rules on its own: a collection-group query whose
/// collection-scoped configuration would complete (b) and (a) through the collection-scoped
/// lookups keeps the pre-stage-B refusal (Codex round 3, Should 1).
#[test]
fn collection_members_do_not_serve_the_group_merge() {
    let f1 = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &[],
        true,
    );
    assert!(matches!(
        decide(&f1, &f1_set(), &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    let f3 = qx_query(
        vec![filter("eq", "a", "qx"), filter("contains", "tags", "qx")],
        &name_desc(),
        true,
    );
    assert!(matches!(
        decide(&f3, &IndexSet::default(), &standard()),
        IndexDecision::MissingRequired { .. }
    ));
}

/// A descending-prefix carrier joins on its ascending name, even with an ascending
/// carrier on the same field. Descending name cannot reverse the implicit suffix.
#[test]
fn merge_b_prefers_the_descending_prefix_and_requires_its_name_direction() {
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &[],
        false,
    );
    let desc = parse_index("qx C a:desc,tags:contains");
    for mixed in [false, true] {
        let mut set = IndexSet::default();
        modes_only(&mut set, "a", &[], IndexQueryScope::Collection);
        modes_only(&mut set, "tags", &[], IndexQueryScope::Collection);
        if mixed {
            set.add_composite(parse_index("qx C a:asc,tags:contains"));
        }
        set.add_composite(desc.clone());
        assert_eq!(
            decide(&q, &set, &standard()),
            IndexDecision::MergeIndexes {
                indexes: vec![
                    parse_index("qx C a:desc,tags:contains,__name__:asc"),
                    parse_index("qx C b:asc,__name__:asc")
                ]
            }
        );
        let count = validate_aggregation_query(
            &q,
            &[Aggregation::Count { up_to: None }],
            &set,
            &standard(),
        );
        let expected_count = if mixed {
            IndexDecision::MergeIndexes {
                indexes: vec![
                    parse_index("qx C a:asc,tags:contains"),
                    parse_index("qx C b:asc,__name__:asc"),
                ],
            }
        } else {
            IndexDecision::MissingRequired {
                requirement: parse_index("qx C a:asc,b:asc,tags:contains,__name__:asc"),
            }
        };
        assert_eq!(count, expected_count);
        let reverse = obs2_merge_query("descPlain", false);
        assert_eq!(
            decide(&reverse, &set, &standard()),
            IndexDecision::MissingRequired {
                requirement: parse_index("qx C tags:contains,a:asc,__name__:desc")
            }
        );
        assert!(matches!(
            decide(&reverse, &set, &context("emulator", "standard")),
            IndexDecision::UseIndex { .. }
        ));
        let two_desc = q.clone().with_order(OrderClause {
            field: FieldPath::document_name(),
            direction: Direction::Descending,
        });
        assert!(matches!(
            decide(&two_desc, &set, &standard()),
            IndexDecision::MissingRequired { .. }
        ));
        let base = decide(&reverse, &set, &context("emulator", "standard"));
        set.add_composite(parse_index("qx C a:desc,tags:contains,__name__:desc"));
        assert_eq!(decide(&reverse, &set, &standard()), base);
    }
    for (carrier, expected) in [
        ("qx C a:asc,tags:contains,__name__:asc", true),
        ("qx C a:asc,tags:contains,__name__:desc", false),
        ("qx C a:desc,tags:contains,__name__:asc", true),
    ] {
        let mut set = IndexSet::default();
        modes_only(&mut set, "a", &[], IndexQueryScope::Collection);
        modes_only(&mut set, "tags", &[], IndexQueryScope::Collection);
        set.add_composite(parse_index(carrier));
        if expected {
            assert_eq!(
                decide(&q, &set, &standard()),
                IndexDecision::MergeIndexes {
                    indexes: vec![parse_index(carrier), parse_index("qx C b:asc,__name__:asc")]
                }
            );
        } else {
            assert!(matches!(
                decide(&q, &set, &standard()),
                IndexDecision::MissingRequired { .. }
            ));
        }
    }
}

/// Accepted generalisations of (b) (coordinator ruling 13 addition; candidates for the second
/// observation): each meets every condition the recorded F1 row states and only removes a
/// strict refusal. The test pins the current answers.
#[test]
fn merge_b_accepted_generalisations_are_pinned() {
    let c = IndexQueryScope::Collection;
    let f1 = |extra: &[&str]| {
        let mut filters = vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ];
        filters.extend(extra.iter().map(|f| filter("eq", f, "qx")));
        qx_query(filters, &[], false)
    };
    let carrier = || parse_index("qx C a:asc,tags:contains");
    // `tags` with ordered modes but no CONTAINS, not exempt.
    let mut ordered_tags = IndexSet::default();
    modes_only(&mut ordered_tags, "a", &[], c);
    modes_only(
        &mut ordered_tags,
        "tags",
        &[IndexFieldMode::Ascending, IndexFieldMode::Descending],
        c,
    );
    ordered_tags.add_composite(carrier());
    let f1_plan = IndexDecision::MergeIndexes {
        indexes: vec![carrier(), parse_index("qx C b:asc,__name__:asc")],
    };
    assert_eq!(decide(&f1(&[]), &ordered_tags, &standard()), f1_plan);
    // `tags CONTAINS` enabled only at collection-group scope.
    let mut group_contains = IndexSet::default();
    modes_only(&mut group_contains, "a", &[], c);
    modes_only(
        &mut group_contains,
        "tags",
        &[IndexFieldMode::Contains],
        IndexQueryScope::CollectionGroup,
    );
    group_contains.add_composite(carrier());
    assert_eq!(decide(&f1(&[]), &group_contains, &standard()), f1_plan);
    // A carrier with a two-field ordered prefix `(a ASC, b ASC, tags CONTAINS)`, `c` automatic.
    let mut two_field = IndexSet::default();
    modes_only(&mut two_field, "a", &[], c);
    modes_only(&mut two_field, "tags", &[], c);
    let wide = parse_index("qx C a:asc,b:asc,tags:contains");
    two_field.add_composite(wide.clone());
    assert_eq!(
        decide(&f1(&["c"]), &two_field, &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![wide, parse_index("qx C c:asc,__name__:asc")]
        }
    );
}

#[test]
fn group_ordered_composite_refuses_only_the_recorded_collection_reads() {
    let group = parse_index("qx G a:asc,__name__:desc");
    let mut set = IndexSet::default();
    modes_only(&mut set, "a", &[], IndexQueryScope::Collection);
    set.add_composite(group.clone());
    for (filters, order) in [
        (vec![filter("eq", "a", "qx")], name_desc().to_vec()),
        (
            vec![],
            vec![
                (fp("a"), Direction::Ascending),
                (fp("__name__"), Direction::Descending),
            ],
        ),
    ] {
        let q = qx_query(filters.clone(), &order, false);
        assert_eq!(
            decide(&q, &set, &standard()),
            IndexDecision::MissingRequired {
                requirement: parse_index("qx C a:asc,__name__:desc")
            }
        );
        let base = IndexDecision::UseIndex {
            index: group.clone(),
        };
        assert_eq!(decide(&q, &set, &context("emulator", "standard")), base);
        assert_eq!(
            decide(&qx_query(filters, &order, true), &set, &standard()),
            base
        );
        assert_eq!(
            validate_aggregation_query(
                &q,
                &[Aggregation::Count { up_to: None }],
                &set,
                &standard()
            ),
            base
        );
    }
}

#[test]
fn wide_carrier_refusal_suggests_the_array_field_first() {
    let mut set = IndexSet::default();
    for field in ["a", "b", "tags"] {
        modes_only(&mut set, field, &[], IndexQueryScope::Collection);
    }
    set.add_composite(parse_index("qx C a:asc,b:asc,tags:contains"));
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("eq", "c", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &name_desc(),
        false,
    );
    assert_eq!(
        decide(&q, &set, &standard()),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx C tags:contains,a:asc,b:asc,c:asc,__name__:desc")
        }
    );
    let capped = validate_aggregation_query(
        &q,
        &[Aggregation::Count { up_to: Some(1) }],
        &set,
        &standard(),
    );
    assert_eq!(
        capped,
        IndexDecision::MissingRequired {
            requirement: parse_index("qx C a:asc,b:asc,c:asc,tags:contains,__name__:desc")
        }
    );
}

#[test]
fn shared_ascending_refusal_is_collection_only_and_ignores_unrelated_composites() {
    // fs-query-index-merge8/shapes/shared-path-ascending-only#shared-path-name-asc
    let mut set = IndexSet::default();
    set.set_single_field_indexes(&coll("qx"), &fp("tags"), modes("C:contains,G:contains"));
    set.add_composite(parse_index("qx C a:asc,b:asc"));
    for (group, expected) in [
        (
            false,
            IndexDecision::MissingRequired {
                requirement: parse_index("qx C tags:contains,tags:asc,__name__:asc"),
            },
        ),
        (
            true,
            IndexDecision::UseIndex {
                index: parse_index("qx G tags:contains,__name__:asc"),
            },
        ),
    ] {
        let q = qx_query(
            vec![eq_tags_array(), filter("contains", "tags", "qx")],
            &[(fp("__name__"), Direction::Ascending)],
            group,
        );
        assert_eq!(decide(&q, &set, &standard()), expected);
    }
}

#[test]
fn shared_ascending_refusal_leaves_a_count_at_its_base_answer() {
    // fs-query-index-merge8/shapes/shared-path-ascending-only#shared-path-name-asc is a plain
    // query; a count of the same shape is unrecorded and keeps the base answer (served).
    let mut set = IndexSet::default();
    set.set_single_field_indexes(&coll("qx"), &fp("tags"), modes("C:contains"));
    let q = qx_query(
        vec![eq_tags_array(), filter("contains", "tags", "qx")],
        &[(fp("__name__"), Direction::Ascending)],
        false,
    );
    assert!(matches!(
        decide(&q, &set, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    let count =
        validate_aggregation_query(&q, &[Aggregation::Count { up_to: None }], &set, &standard());
    assert!(
        !matches!(count, IndexDecision::MissingRequired { .. }),
        "{count:?}"
    );
}

#[test]
fn descending_member_refusal_requires_a_read_and_both_exemptions() {
    // fs-query-index-merge7/shapes/descending-prefix-carrier#a-and-contains-name-desc
    let q = obs2_merge_query("descPlain", false);
    let mut set = IndexSet::default();
    let scope = IndexQueryScope::Collection;
    modes_only(&mut set, "a", &[], scope);
    modes_only(&mut set, "tags", &[], scope);
    let index = parse_index("qx C a:desc,tags:contains");
    set.add_composite(index.clone());
    let expected = IndexDecision::UseIndex { index };
    assert_eq!(
        validate_aggregation_query(&q, &[Aggregation::Count { up_to: None }], &set, &standard()),
        expected
    );
    modes_only(&mut set, "tags", &[IndexFieldMode::Contains], scope);
    assert_eq!(decide(&q, &set, &standard()), expected);
}

#[test]
fn unordered_pair_carrier_excludes_counts_with_singleton_array_contains_any() {
    // Change the membership operator in fs-query-index-merge3/shapes/carrier-contains-automatic#count-a-b-and-contains.
    let mut set = IndexSet::default();
    modes_only(&mut set, "a", &[], IndexQueryScope::Collection);
    set.add_composite(parse_index("qx C a:asc,tags:contains"));
    assert_eq!(
        validate_aggregation_query(
            &obs2_merge_query("noOrderAny", false),
            &[Aggregation::Count { up_to: None }],
            &set,
            &standard(),
        ),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx C a:asc,b:asc,tags:contains,__name__:asc")
        }
    );
}

#[test]
fn group_carrier_with_a_descending_alternative_keeps_the_base_refusal() {
    // Merge7 recorded one group carrier. Neither carrier alone covers the base requirement.
    let mut set = IndexSet::default();
    set.add_composite(parse_index("qx G a:asc,tags:contains"));
    set.add_composite(parse_index("qx G a:desc,tags:contains"));
    modes_only(
        &mut set,
        "b",
        &[IndexFieldMode::Ascending],
        IndexQueryScope::CollectionGroup,
    );
    assert_eq!(
        decide(&obs2_merge_query("twoEqContains", true), &set, &standard()),
        IndexDecision::MissingRequired {
            requirement: parse_index("qx G a:asc,b:asc,tags:contains,__name__:asc")
        }
    );
}

#[test]
fn shared_path_with_builtin_equality_modes_keeps_the_base_merge() {
    let mut set = IndexSet::default();
    modes_only(
        &mut set,
        "tags",
        &[IndexFieldMode::Contains],
        IndexQueryScope::Collection,
    );
    let query = qx_query(
        vec![
            filter("eq", "a", "qx"),
            field_filter(
                "tags",
                FieldOp::Equal,
                Value::Array(vec![Value::Integer(1), Value::Integer(2)]),
            ),
            filter("contains", "tags", "qx"),
        ],
        &[(fp("__name__"), Direction::Ascending)],
        false,
    );
    assert_eq!(
        decide(&query, &set, &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx C a:asc,__name__:asc"),
                parse_index("qx C tags:contains,__name__:asc")
            ]
        }
    );
}

#[test]
fn reverse_automatic_array_first_requires_a_missing_plan() {
    // Add a serving composite to fs-query-index-merge6/shapes/composite-member#a-and-contains-name-asc.
    let mut set = IndexSet::default();
    modes_only(&mut set, "a", &[], IndexQueryScope::Collection);
    set.add_composite(parse_index("qx C a:asc,__name__:desc"));
    let index = parse_index("qx C a:asc,tags:contains,__name__:asc");
    set.add_composite(index.clone());
    assert_eq!(
        decide(&obs2_merge_query("oneEqNameAsc", false), &set, &standard()),
        IndexDecision::UseIndex { index }
    );
}

#[test]
fn wide_carrier_array_first_checks_member_mode_prefix_and_remainder() {
    // Vary one condition of fs-query-index-merge5/shapes/two-field-prefix#a-b-c-and-contains-name-desc.
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("eq", "c", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &name_desc(),
        false,
    );
    let equality_first = IndexDecision::MissingRequired {
        requirement: parse_index("qx C a:asc,b:asc,c:asc,tags:contains,__name__:desc"),
    };
    let exempt: &[&str] = &["a", "b", "tags"];
    let carrier = "qx C a:asc,b:asc,tags:contains";
    for (index, fields) in [
        ("qx C a:asc,b:asc,tags:asc", exempt),
        ("qx C a:asc,tags:contains", exempt),
        ("qx C a:desc,b:asc,tags:contains", exempt),
        (carrier, &["b", "tags"]),
        (carrier, &["a", "b", "c", "tags"]),
    ] {
        let mut set = IndexSet::default();
        for field in fields {
            modes_only(&mut set, field, &[], IndexQueryScope::Collection);
        }
        set.add_composite(parse_index(index));
        assert_eq!(
            decide(&q, &set, &standard()),
            equality_first,
            "{index} {fields:?}"
        );
    }
}

#[test]
fn group_pair_array_first_requires_a_missing_plan() {
    // Add a serving composite to fs-query-index-merge7/shapes/group-carrier#group-a-b-and-contains-name-desc.
    let q = obs2_merge_query("twoEqContains", true).with_order(OrderClause {
        field: fp("__name__"),
        direction: Direction::Descending,
    });
    let mut set = IndexSet::default();
    modes_only(
        &mut set,
        "b",
        &[IndexFieldMode::Ascending],
        IndexQueryScope::CollectionGroup,
    );
    set.add_composite(parse_index("qx G a:asc,tags:contains"));
    let index = parse_index("qx G a:asc,b:asc,tags:contains,__name__:desc");
    set.add_composite(index.clone());
    assert_eq!(
        decide(&q, &set, &standard()),
        IndexDecision::UseIndex { index }
    );
}
