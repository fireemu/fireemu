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
    ctx: (String, String),
    filters: Vec<(String, String)>,
    orders: Vec<(FieldPath, Direction)>,
    production: Option<(bool, String)>,
    expect: String,
    /// The Lean base (4fcd8a7a3) answer, rendered like `expect` but led by `base`.
    base: String,
    /// The stage-B guard the Lean head says fires: `none`, `a`, `b` or `c`.
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

fn corpus_decision(corpus: &Corpus, c: &CorpusCase) -> IndexDecision {
    let filters = c
        .filters
        .iter()
        .map(|(k, f)| filter(k, f, &c.collection))
        .collect();
    let q = build_query(&c.collection, c.group, filters, &c.orders);
    decide(&q, &corpus.configs[c.config], &context(&c.ctx.0, &c.ctx.1))
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
        let actual = render_decision(&corpus_decision(&corpus, c));
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
/// planner's answer is the Lean base model's (the 4fcd8a7a3 decision), and the guards fire
/// only on Standard, at collection scope, under the production rules.
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
                let actual = render_decision(&corpus_decision(&corpus, c));
                if actual != c.base {
                    failures.push(format!(
                        "case {} {}:
  base: {}
  rust: {actual}",
                        c.number, c.label, c.base
                    ));
                }
            }
            "a" | "b" | "c" => {
                assert!(
                    !c.group && c.ctx.1 == "standard" && c.ctx.0 != "emulator",
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
    for guard in ["a", "b", "c"] {
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
    assert_eq!(rows.len(), 101, "production rows in the corpus");
    for c in rows {
        let (verdict, row) = c.production.as_ref().expect("production row");
        assert_eq!(
            served(&corpus_decision(&corpus, c)),
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
        decide(&shape_query(s, eq, contains), &alone, &standard()),
        IndexDecision::UseIndex { index } if &index == member
    )
}

/// Whether the stage-B rules may apply to the shape's query: collection scope and a filter that
/// is a conjunction of plain equalities and the plain array-contains (no range).
fn recorded_shape(s: &Shape) -> bool {
    !s.group && order_shapes()[s.order].0.is_empty()
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
/// on its own and the ascending automatic index of every other equality field (production F1).
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
    if !(recorded_shape(s) && s.contains && name_only) {
        return false;
    }
    if nm == IndexFieldMode::Descending {
        return enabled("tags", IndexFieldMode::Contains) && s.eq.iter().all(|f| enabled(f, nm));
    }
    set.composites().iter().any(|member| {
        subsets().any(|subset| {
            composite_serves_alone(s, member, &subset, true)
                && s.eq
                    .iter()
                    .all(|f| subset.contains(f) || enabled(f, IndexFieldMode::Ascending))
        })
    })
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
    if set.composites().contains(member) && !leading.is_empty() {
        let carries = member
            .fields
            .get(leading.len())
            .is_some_and(|f| f.path == fp("tags") && f.mode == IndexFieldMode::Contains);
        // Only merge (b) takes a composite carrying the array field.
        if carries {
            assert!(
                s.contains
                    && recorded_shape(s)
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
            nm == IndexFieldMode::Ascending || recorded_shape(s),
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
        if served(&decide(&q, &set, &standard())) {
            let mut more = composites.clone();
            more.insert(position.min(more.len()), extra);
            prop_assert!(served(&decide(&q, &index_set(&more, &overrides), &standard())));
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
/// `__name__` ordered, ascending (F1). With `__name__` descending, or with an explicit order on
/// another field, production's answer is not recorded and the merge stays refused, as before.
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
/// serves it by the enabled mode as before. The opposite direction (ascending requested, only
/// the descending mode enabled) has no recorded verdict and is served as before.
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
    // Unrecorded neighbour: ascending requested with only the descending mode enabled.
    let mut desc_only = IndexSet::default();
    desc_only.set_single_field_indexes(
        &qx,
        &fp("a"),
        vec![(IndexQueryScope::Collection, IndexFieldMode::Descending)],
    );
    let name_asc = [(FieldPath::document_name(), Direction::Ascending)];
    let neighbour = build_query("qx", false, vec![filter("eq", "a", "qx")], &name_asc);
    assert!(matches!(
        decide(&neighbour, &desc_only, &context("production", "standard")),
        IndexDecision::UseIndex { .. }
    ));
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

/// The first merge attempt keeps its pre-stage-B (4fcd8a7a3) answer on a shared path (ruling
/// 11): `a == 1 AND tags == [1] AND tags array-contains 1` covers `tags` by path, so one member
/// on `tags` serves both filters there. Coverage by filter kind applies only inside the
/// stage-B merges, which need distinct paths. The shape is unrecorded (no production verdict).
#[test]
fn the_first_merge_attempt_keeps_its_answer_on_a_shared_path() {
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
    // (i) Only `a ASC` and `tags CONTAINS`, `__name__` ascending: the contains member covers
    // the path `tags`.
    let mut set = IndexSet::default();
    modes_only(&mut set, "a", &[IndexFieldMode::Ascending], c);
    modes_only(&mut set, "tags", &[IndexFieldMode::Contains], c);
    let q = qx_query(filters(), &name_asc, false);
    assert_eq!(
        decide(&q, &set, &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx C a:asc,__name__:asc"),
                parse_index("qx C tags:contains,__name__:asc"),
            ]
        }
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
    // (ii) and (iii) Built-in modes: the ordered member on `tags` covers the path, in either
    // direction, and the contains member does not join.
    for (orders, a, tags) in [
        (
            &name_asc,
            "qx C a:asc,__name__:asc",
            "qx C tags:asc,__name__:asc",
        ),
        (
            &name_desc,
            "qx C a:desc,__name__:desc",
            "qx C tags:desc,__name__:desc",
        ),
    ] {
        let q = qx_query(filters(), orders, false);
        assert_eq!(
            decide(&q, &IndexSet::default(), &standard()),
            IndexDecision::MergeIndexes {
                indexes: vec![parse_index(a), parse_index(tags)]
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

/// The single-equality refusal (c) is exactly the recorded shape. Every neighbour keeps its
/// pre-stage-B answer and has no production verdict (unrecorded): collection-group scope, an
/// order naming the equality field, and Enterprise.
#[test]
fn the_single_equality_refusal_keeps_every_unrecorded_neighbour() {
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
        IndexDecision::UseIndex {
            index: parse_index("qx G a:asc,__name__:desc")
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
            IndexDecision::UseIndex {
                index: parse_index("qx C a:asc,__name__:desc")
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

/// The merges (a) and (b) are collection-scope rules: at collection-group scope both keep the
/// pre-stage-B refusal. (a) is for a plain array-contains only. Any number of equalities may
/// join. An ascending merge of automatic members keeps its pre-stage-B member order, and so
/// does a merge the automatic members already served (the non-exempt composite, imc).
#[test]
fn the_merges_keep_their_recorded_boundaries_and_member_order() {
    let name_desc = [(FieldPath::document_name(), Direction::Descending)];
    let g = IndexQueryScope::CollectionGroup;
    // (a) at collection-group scope: refused.
    let mut group = IndexSet::default();
    modes_only(&mut group, "a", &[IndexFieldMode::Descending], g);
    modes_only(&mut group, "tags", &[IndexFieldMode::Contains], g);
    let q = qx_query(
        vec![filter("eq", "a", "qx"), filter("contains", "tags", "qx")],
        &name_desc,
        true,
    );
    assert!(matches!(
        decide(&q, &group, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // (b) at collection-group scope: refused.
    let mut group_f1 = IndexSet::default();
    modes_only(&mut group_f1, "a", &[], g);
    modes_only(&mut group_f1, "tags", &[], g);
    // `b ASC` at group scope, so that only the scope guard refuses (Codex round 2, Should 1).
    modes_only(&mut group_f1, "b", &[IndexFieldMode::Ascending], g);
    let mut composite = parse_index("qx G a:asc,tags:contains");
    composite.query_scope = g;
    group_f1.add_composite(composite);
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &[],
        true,
    );
    assert!(matches!(
        decide(&q, &group_f1, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // (a) with array-contains-any: refused, as before.
    let any = FilterExpr::Field {
        field: fp("tags"),
        op: FieldOp::ArrayContainsAny,
        value: Value::Array(vec![Value::Integer(1)]),
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
    // The non-exempt composite (imc): the automatic members serve, as before stage B.
    let mut imc = IndexSet::default();
    imc.add_composite(parse_index("qx C a:asc,tags:contains"));
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &[],
        false,
    );
    assert_eq!(
        decide(&q, &imc, &standard()),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index("qx C a:asc,__name__:asc"),
                parse_index("qx C b:asc,__name__:asc"),
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

/// Refusal (c) is for exactly one plain equality and nothing else (ruling 10 item 1, Codex
/// round 2 Must 1). Each neighbour reaching the same normalized arm keeps its pre-stage-B
/// answer and has no production verdict.
#[test]
fn the_single_equality_refusal_tests_the_whole_query() {
    let set = f2_set();
    let ctx = standard();
    let name = || name_reference("qx");
    let neighbours: Vec<(&str, Vec<FilterExpr>)> = vec![
        (
            "is null",
            vec![FilterExpr::Unary {
                field: fp("a"),
                op: UnaryOp::IsNull,
            }],
        ),
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
            "one-element in",
            vec![field_filter(
                "a",
                FieldOp::In,
                Value::Array(vec![Value::Integer(1)]),
            )],
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
    // A count aggregation over the recorded query keeps its pre-stage-B answer too.
    let q = qx_query(vec![filter("eq", "a", "qx")], &name_desc(), false);
    assert_eq!(
        validate_aggregation_query(&q, &[Aggregation::Count { up_to: None }], &set, &ctx),
        automatic_a_asc_name_desc()
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

/// Merge (b) is for a plain array-contains in a conjunction of plain equalities (ruling 10
/// item 2): array-contains-any on the F1 set, an OR arm and Enterprise keep their answers.
/// Its only composite member is the one carrying the array field (ruling 10 item 3 applied
/// to (b)).
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
    // A count aggregation is not the recorded query either.
    assert!(matches!(
        validate_aggregation_query(&q, &[Aggregation::Count { up_to: None }], &set, &standard()),
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

/// Merge (a) uses automatic members only, on Standard, for the recorded query (ruling 10
/// item 3, Codex round 2 Must 3; Opus round 2 Should 2).
#[test]
fn merge_a_keeps_to_the_recorded_query() {
    let joined = || vec![filter("eq", "a", "qx"), filter("contains", "tags", "qx")];
    // Exempt `a` with a configured `(a ASC, __name__ DESC)`: refused, as before.
    let mut composite = IndexSet::default();
    modes_only(&mut composite, "a", &[], IndexQueryScope::Collection);
    composite.add_composite(parse_index("qx C a:asc,__name__:desc"));
    let q = qx_query(joined(), &name_desc(), false);
    assert!(matches!(
        decide(&q, &composite, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
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

/// Merge (b) applies only where the array field has no automatic contains index at collection
/// scope, as in the recorded F1 set (`tags` exempt). With only `a` exempt the base refusal stays
/// (Opus round 3, Should 1; unrecorded).
#[test]
fn merge_b_needs_the_array_field_without_its_automatic_index() {
    let mut set = IndexSet::default();
    modes_only(&mut set, "a", &[], IndexQueryScope::Collection);
    set.add_composite(parse_index("qx C a:asc,tags:contains"));
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
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

/// Merge (b) takes its carrier only as recorded: a collection-scoped composite, and only when
/// exactly one configured composite qualifies (coordinator ruling 12). A collection-group
/// carrier, or two carriers, keep the pre-stage-B refusal (unrecorded).
#[test]
fn merge_b_needs_exactly_one_collection_scoped_carrier() {
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
    let mut composite = parse_index("qx G a:asc,tags:contains");
    composite.query_scope = IndexQueryScope::CollectionGroup;
    group_carrier.add_composite(composite);
    assert!(matches!(
        decide(&f1(), &group_carrier, &standard()),
        IndexDecision::MissingRequired { .. }
    ));
    // `(b ASC, tags CONTAINS)` is a second carrier (it would not complete: `a` is exempt), and
    // neither serves the query alone.
    let mut two = f1_set();
    two.add_composite(parse_index("qx C b:asc,tags:contains"));
    assert!(matches!(
        decide(&f1(), &two, &standard()),
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
fn a_collection_group_query_never_reaches_the_overrides() {
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

/// The carrier of merge (b) has ascending prefix fields, as the recorded `(a ASC, tags
/// CONTAINS)`; a descending prefix field keeps the pre-stage-B refusal (Codex round 4,
/// coordinator ruling 13; unrecorded). An explicit trailing `__name__ ASC` is the recorded
/// index itself (production lists it so); a trailing `__name__ DESC` never serves the ascending
/// query.
#[test]
fn merge_b_needs_an_ascending_carrier() {
    let q = qx_query(
        vec![
            filter("eq", "a", "qx"),
            filter("eq", "b", "qx"),
            filter("contains", "tags", "qx"),
        ],
        &[],
        false,
    );
    let with = |composite: &str| {
        let mut set = IndexSet::default();
        modes_only(&mut set, "a", &[], IndexQueryScope::Collection);
        modes_only(&mut set, "tags", &[], IndexQueryScope::Collection);
        set.add_composite(parse_index(composite));
        decide(&q, &set, &standard())
    };
    for composite in [
        "qx C a:desc,tags:contains,__name__:asc",
        "qx C a:desc,tags:contains",
        "qx C a:asc,tags:contains,__name__:desc",
    ] {
        assert!(
            matches!(with(composite), IndexDecision::MissingRequired { .. }),
            "{composite}"
        );
    }
    let explicit = "qx C a:asc,tags:contains,__name__:asc";
    assert_eq!(
        with(explicit),
        IndexDecision::MergeIndexes {
            indexes: vec![
                parse_index(explicit),
                parse_index("qx C b:asc,__name__:asc")
            ]
        }
    );
}
