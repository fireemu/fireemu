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
    decide, IndexDecision, IndexDefinition, IndexField, IndexFieldMode, IndexQueryScope, IndexSet,
    IndexValidationPolicy, PlanningContext,
};
use fireemu_core_firestore::query::{
    Direction, FieldOp, FilterExpr, OrderClause, Query, QueryScope, UnaryOp,
};
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

#[test]
fn every_recorded_production_verdict_matches_the_planner() {
    let corpus = parse_corpus();
    let rows: Vec<&CorpusCase> = corpus
        .cases
        .iter()
        .filter(|c| c.production.is_some())
        .collect();
    assert_eq!(rows.len(), 77, "production rows in the corpus");
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
fn composite_serves_alone(s: &Shape, member: &IndexDefinition, eq: &[&str]) -> bool {
    let mut alone = IndexSet::default();
    alone.set_default_single_field_indexes(&coll("qx"), Vec::new());
    alone.add_composite(member.clone());
    matches!(
        decide(&shape_query(s, eq, false), &alone, &standard()),
        IndexDecision::UseIndex { index } if &index == member
    )
}

/// The declarative merge condition (`IM.MergeSpec`): at least two wanted fields, no explicit
/// order on an equality field, and members covering every wanted field, where a member is a
/// configured composite that on its own serves some of the equality filters with the same
/// order, the enabled automatic index of an equality field in the requested `__name__`
/// direction (nothing but `__name__` ordered), or the array field's enabled contains index
/// (nothing but `__name__` ordered, ascending).
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
    let mut covered: BTreeSet<&str> = BTreeSet::new();
    for member in set.composites() {
        for mask in 1u32..(1 << s.eq.len()) {
            let subset: Vec<&str> =
                s.eq.iter()
                    .enumerate()
                    .filter(|(i, _)| mask & (1 << i) != 0)
                    .map(|(_, f)| *f)
                    .collect();
            if composite_serves_alone(s, member, &subset) {
                covered.extend(subset);
            }
        }
    }
    if only_name_ordered(&q) {
        let nm = name_mode(name_direction(&q));
        for f in &s.eq {
            if set
                .single_field_modes(&coll("qx"), &fp(f))
                .contains(&(group_scope, nm))
            {
                covered.insert(f);
            }
        }
        if s.contains
            && nm == IndexFieldMode::Ascending
            && set
                .single_field_modes(&coll("qx"), &fp("tags"))
                .contains(&(group_scope, IndexFieldMode::Contains))
        {
            covered.insert("tags");
        }
    }
    let mut wanted_fields: BTreeSet<&str> = s.eq.iter().copied().collect();
    if s.contains {
        wanted_fields.insert("tags");
    }
    covered == wanted_fields
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
    // composite can also equal an automatic index, which then counts as either).
    if set.composites().contains(member) && !leading.is_empty() {
        assert!(
            composite_serves_alone(s, member, &leading),
            "member {member:?} does not serve {leading:?}"
        );
        return leading.into_iter().map(str::to_owned).collect();
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
        assert!(s.contains && name == "tags" && nm == IndexFieldMode::Ascending);
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

/// The Lean counterexamples to completeness against the broader per-member rule (the planner's
/// own single-index rule, `IM.BroadSpec`), pinned as the planner decides them today. Each is a
/// finding with no recorded production verdict; see the README.
#[test]
fn findings_against_the_single_index_rule_are_refused_today() {
    let ctx = standard();
    let qx = coll("qx");
    // F1: a composite that carries the array field never joins a merge.
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
    let mut a_tags_only = f1.clone();
    a_tags_only.set_single_field_indexes(&qx, &fp("b"), Vec::new());
    // The composite serves `a == 1 AND tags array-contains 1` on its own.
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
    assert!(matches!(
        decide(&f1_query, &f1, &ctx),
        IndexDecision::MissingRequired { .. }
    ));

    // F2: the single-index rule serves `a == 1 ORDER BY __name__ DESC` with `a`'s ascending
    // index, but a merge needs `a`'s descending one.
    let mut f2 = IndexSet::default();
    f2.set_single_field_indexes(
        &qx,
        &fp("a"),
        vec![(IndexQueryScope::Collection, IndexFieldMode::Ascending)],
    );
    let name_desc = [(FieldPath::document_name(), Direction::Descending)];
    let one = build_query("qx", false, vec![filter("eq", "a", "qx")], &name_desc);
    assert!(matches!(
        decide(&one, &f2, &ctx),
        IndexDecision::UseIndex { .. }
    ));
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

    // F3: the single-index rule serves `tags array-contains 1 ORDER BY __name__ DESC` with the
    // contains index, but a merge takes the contains index only for an ascending name.
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
    assert!(matches!(
        decide(&joined, &f3, &ctx),
        IndexDecision::MissingRequired { .. }
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
