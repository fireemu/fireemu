//! Snapshot-derived local lexical search shared by REST and gRPC.
#![allow(clippy::result_large_err)]
use crate::{decode::Parent, local::LocalBackend, pipeline::CompiledExecution, rules::ReadGuard};
use fireemu_core_firestore::{
    field_path::FieldPath,
    index::IndexQueryScope,
    pipeline_exec::{self, Unrecorded},
    text_index::{TextIndexCatalog, TextIndexDefinition, TextIndexState},
    text_search::{SearchDocument, SearchIndex, SearchOptions, SearchOrder, SearchQuery},
};
use fireemu_proto_firestore::google::firestore::v1 as pb;
use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tonic::Status;

/// One startup-bound catalog and policy shared by all transports.
#[derive(Clone)]
pub(crate) struct Configuration {
    pub catalog: Arc<Mutex<TextIndexCatalog>>,
    pub production_exact: bool,
    pub warned: Arc<AtomicBool>,
    pub search_cache: Arc<Mutex<SearchCache>>,
}
/// Retain at most one bounded index across both transports. The first observation only
/// records the key so that one-off searches and interleaved writes never retain postings.
#[derive(Default)]
pub(crate) struct SearchCache {
    entry: Option<(CorpusKey, Option<Arc<SearchIndex>>)>,
}

#[derive(PartialEq, Eq)]
struct CorpusKey {
    parent: String,
    database: crate::local::DatabaseSource,
    version: fireemu_core_firestore::store::CommitVersion,
    epoch: u64,
    definition: TextIndexDefinition,
    generation: u64,
}

struct SearchSource<'a> {
    parent: &'a str,
    database: crate::local::DatabaseSource,
    version: fireemu_core_firestore::store::CommitVersion,
    epoch: u64,
    cache: &'a Mutex<SearchCache>,
}

fn is_complete_collection_input(input: &pb::RunQueryRequest) -> bool {
    let Some(pb::run_query_request::QueryType::StructuredQuery(query)) = &input.query_type else {
        return false;
    };
    input.consistency_selector.is_none()
        && input.explain_options.is_none()
        && matches!(query.from.as_slice(), [selector] if !selector.all_descendants && !selector.collection_id.is_empty())
        && query.select.is_none()
        && query.r#where.is_none()
        && query.order_by.is_empty()
        && query.start_at.is_none()
        && query.end_at.is_none()
        && query.offset == 0
        && query.limit.is_none()
        && query.find_nearest.is_none()
}

impl SearchSource<'_> {
    fn index(
        &self,
        definition: &TextIndexDefinition,
        generation: u64,
        documents: &[SearchDocument],
    ) -> Result<Arc<SearchIndex>, fireemu_core_firestore::text_search::SearchError> {
        // The key is used exclusively with this lexical analyzer and complete collection input.
        let make = || {
            SearchIndex::build(
                definition,
                documents,
                fireemu_adapter_support::lexical::tokenize_index,
            )
        };
        if self.parent.len() > 6_144
            || matches!(&definition.language, fireemu_core_firestore::text_index::DefaultTextLanguage::Tag(tag) if tag.len() > 255)
        {
            return make().map(Arc::new);
        }
        let key = CorpusKey {
            parent: self.parent.to_owned(),
            database: self.database,
            version: self.version,
            epoch: self.epoch,
            definition: definition.clone(),
            generation,
        };
        {
            let mut cache = self
                .cache
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            match &cache.entry {
                Some((prior, value)) if *prior == key => {
                    if let Some(index) = value {
                        return Ok(Arc::clone(index));
                    }
                }
                _ => {
                    cache.entry = Some((key, None));
                    drop(cache);
                    return make().map(Arc::new);
                }
            }
        }
        let index = Arc::new(make()?);
        if index.retained_bytes() <= 4 * 1024 * 1024 {
            let mut cache = self
                .cache
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some((prior, slot)) = &mut cache.entry {
                if *prior == key && slot.is_none() {
                    *slot = Some(Arc::clone(&index));
                }
            }
        }
        Ok(index)
    }
}

/// A search immediately following collection input. The remaining stages use the existing cursor.
#[derive(Debug, Clone)]
pub struct SearchPlan {
    query: SearchQuery,
    options: SearchOptions,
    score_fields: Vec<String>,
}
fn invalid(message: &str) -> Status {
    Status::invalid_argument(format!("FS_TEXT_QUERY: {message}"))
}
fn unsupported(message: &str) -> Status {
    Status::unimplemented(format!("FS_TEXT_UNSUPPORTED: {message}"))
}
// Only render the bounded function/string shape covered by search diagnostics.
fn render_search_expression(value: &pb::Value, depth: usize, budget: &mut usize) -> Option<String> {
    if depth == 0 || *budget == 0 {
        return None;
    }
    *budget -= 1;
    let rendered = match value.value_type.as_ref()? {
        pb::value::ValueType::StringValue(text) if text.len() <= 4096 => {
            serde_json::to_string(text).ok()?
        }
        pb::value::ValueType::FunctionValue(function)
            if function.options.is_empty()
                && function.name.len() <= 64
                && function
                    .name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_') =>
        {
            let args = function
                .args
                .iter()
                .map(|arg| render_search_expression(arg, depth - 1, budget))
                .collect::<Option<Vec<_>>>()?;
            format!("{}({})", function.name, args.join(", "))
        }
        _ => return None,
    };
    (rendered.len() <= 8192).then_some(rendered)
}
fn is_score(value: &pb::Value) -> bool {
    matches!(&value.value_type, Some(pb::value::ValueType::FunctionValue(f)) if f.name == "score" && f.args.is_empty() && f.options.is_empty())
}
fn count(stage: &pb::pipeline::Stage, key: &str) -> Result<Option<usize>, Status> {
    match stage.options.get(key).map(|v| &v.value_type) {
        None => Ok(None),
        Some(Some(pb::value::ValueType::IntegerValue(n))) if *n >= 0 => usize::try_from(*n)
            .map(Some)
            .map_err(|_| invalid("count exceeds local address space")),
        _ => Err(invalid(
            "offset, limit and retrieval_depth must be nonnegative integers",
        )),
    }
}
/// Decode the SDK's option-based search wire format without registering search-only functions globally.
pub fn decode(stage: &pb::pipeline::Stage) -> Result<SearchPlan, Status> {
    if !stage.args.is_empty() {
        return Err(invalid("search has no positional arguments"));
    }
    for key in stage.options.keys() {
        if !matches!(
            key.as_str(),
            "query"
                | "offset"
                | "limit"
                | "retrieval_depth"
                | "sort"
                | "add_fields"
                | "language_code"
                | "query_enhancement"
        ) {
            return Err(unsupported(&format!("search option {key:?}")));
        }
    }
    let value = stage
        .options
        .get("query")
        .ok_or_else(|| invalid("search requires query"))?;
    let Some(pb::value::ValueType::FunctionValue(function)) = &value.value_type else {
        return Err(unsupported("query must be document_matches(string)"));
    };
    if function.name == "or" {
        if let Some(expression) = render_search_expression(value, 16, &mut 64) {
            return Err(Status::invalid_argument(format!(
                "search(...) only supports 'document_matches' or distance based searches like lte(geo_distance(field(STRING), GEO_POINT), NUMBER) but got {expression}"
            )));
        }
    }
    if function.name != "document_matches"
        || function.args.len() != 1
        || !function.options.is_empty()
    {
        return Err(unsupported(
            "query must be document_matches(string) without function options",
        ));
    }
    let Some(pb::value::ValueType::StringValue(text)) = &function.args[0].value_type else {
        return Err(invalid("document_matches requires a string"));
    };
    let query = SearchQuery::parse(text, fireemu_adapter_support::lexical::tokenize_query)
        .map_err(|e| invalid(&e.to_string()))?;
    let mut options = SearchOptions {
        offset: count(stage, "offset")?.unwrap_or(0),
        limit: count(stage, "limit")?,
        retrieval_depth: count(stage, "retrieval_depth")?,
        ..Default::default()
    };
    if options.retrieval_depth == Some(0) {
        return Err(Status::invalid_argument(
            "search(...): 'retrievalDepth' must be at least 1.",
        ));
    }
    if let Some(value) = stage.options.get("sort") {
        let Some(pb::value::ValueType::ArrayValue(array)) = &value.value_type else {
            return Err(invalid("sort must be an ordering array"));
        };
        let [ordering] = array.values.as_slice() else {
            return Err(unsupported(
                "only one descending score ordering is supported",
            ));
        };
        let Some(pb::value::ValueType::MapValue(map)) = &ordering.value_type else {
            return Err(invalid("sort entry must be an ordering map"));
        };
        if map.fields.len() == 2
            && map.fields.get("expression").is_some_and(is_score)
            && matches!(map.fields.get("direction").and_then(|v|v.value_type.as_ref()),Some(pb::value::ValueType::StringValue(s)) if s == "ascending" || s == "ASCENDING")
        {
            return Err(Status::invalid_argument("search(...) with a document_matches query only supports sorting by score() in descending order."));
        }
        if map.fields.len() != 2
            || !map.fields.get("expression").is_some_and(is_score)
            || !matches!(map.fields.get("direction").and_then(|v|v.value_type.as_ref()),Some(pb::value::ValueType::StringValue(s)) if s == "descending" || s == "DESCENDING")
        {
            return Err(unsupported("only score().descending() is supported"));
        }
        options.order = SearchOrder::ScoreDescending;
    }
    let score_fields = decode_score_fields(stage)?;
    validate_language_option(stage)?;
    if let Some(value) = stage.options.get("query_enhancement") {
        if !matches!(&value.value_type,Some(pb::value::ValueType::StringValue(s)) if s == "disabled")
        {
            return Err(unsupported(
                "query enhancement is not implemented; use disabled",
            ));
        }
    }
    Ok(SearchPlan {
        query,
        options,
        score_fields,
    })
}

fn validate_language_option(stage: &pb::pipeline::Stage) -> Result<(), Status> {
    if let Some(value) = stage.options.get("language_code") {
        let Some(pb::value::ValueType::StringValue(language)) = &value.value_type else {
            return Err(invalid("language_code must be a language tag"));
        };
        if language == "auto" || !fireemu_core_firestore::text_index::is_language_tag(language) {
            return Err(Status::invalid_argument(format!(
                "Unsupported language_code: {language}"
            )));
        }
    }
    Ok(())
}

fn decode_score_fields(stage: &pb::pipeline::Stage) -> Result<Vec<String>, Status> {
    let mut score_fields = Vec::new();
    if let Some(value) = stage.options.get("add_fields") {
        let Some(pb::value::ValueType::MapValue(map)) = &value.value_type else {
            return Err(invalid("add_fields must be an alias map"));
        };
        if map.fields.is_empty() {
            return Err(invalid("add_fields must not be empty"));
        }
        for (alias, value) in &map.fields {
            let field = FieldPath::parse(alias).map_err(|_| invalid("invalid score alias"))?;
            if field.segments().len() != 1 || field.canonical() != *alias || alias.starts_with("__")
            {
                return Err(unsupported(
                    "score aliases must be simple nonreserved top-level fields",
                ));
            }
            if !is_score(value) {
                return Err(unsupported("add_fields supports only score()"));
            }
            score_fields.push(alias.clone());
        }
    }
    Ok(score_fields)
}

/// Execute against one admitted document snapshot. The read guard captures the catalog
/// while the database is locked, so reset cannot mix epochs and catalog mutations cannot
/// mix definitions within the result. No catalog lock is held while taking admission.
pub(crate) fn execute(
    local: &LocalBackend,
    parent: &Parent,
    compiled: CompiledExecution,
    guard: ReadGuard<'_>,
    unrecorded: Unrecorded,
) -> Result<Vec<pb::ExecutePipelineResponse>, Status> {
    execute_at_snapshot(local, parent, compiled, guard, unrecorded, || {})
}

#[allow(clippy::too_many_lines)]
fn execute_at_snapshot(
    local: &LocalBackend,
    parent: &Parent,
    compiled: CompiledExecution,
    guard: ReadGuard<'_>,
    unrecorded: Unrecorded,
    after_snapshot: impl FnOnce(),
) -> Result<Vec<pb::ExecutePipelineResponse>, Status> {
    let runtime = crate::pipeline_timezone::runtime_for_stages(local, &compiled.stages);
    let plan = compiled
        .search
        .as_ref()
        .ok_or_else(|| Status::internal("missing search plan"))?;
    let (config, collection) = configuration(local, &compiled)?;
    let captured = Mutex::new(None);
    let capture = |db: &fireemu_core_firestore::store::FirestoreState,
                   version: Option<fireemu_core_firestore::store::CommitVersion>,
                   check: crate::rules::ReadCheck<'_>| {
        guard(db, version, check)?;
        let mut catalog = config
            .catalog
            .lock()
            .map_err(|_| Status::internal("text index catalog is poisoned"))?;
        local.advance_text_builds_at_snapshot(
            parent.project.as_str(),
            parent.database.as_str(),
            db,
            &mut catalog,
            // A search observes its collection's builds directly: a build fireemu cannot complete
            // faithfully refuses the search instead of leaving it without a READY index (M1).
            crate::admin::index_rest::NativeTextSelection {
                collection: Some(&collection),
                direct: true,
                ..Default::default()
            },
        )?;
        let definitions = catalog
            .entries()
            .filter(|(p, d, def)| {
                *p == parent.project.as_str()
                    && *d == parent.database.as_str()
                    && def.collection_id.as_str() == collection
                    && def.query_scope == IndexQueryScope::Collection
                    && def.api_scope == "ANY_API"
                    && def.state == TextIndexState::Ready
            })
            .map(|(p, d, definition)| {
                (
                    definition.clone(),
                    catalog
                        .build(p, d, &definition.id)
                        .map(|build| build.generation),
                )
            })
            .collect::<Vec<_>>();
        local.check_native_text_epoch(&catalog, |p, d, def| {
            p == parent.project.as_str()
                && d == parent.database.as_str()
                && definitions
                    .iter()
                    .any(|(selected, _)| selected.id == def.id)
        })?;
        if definitions.is_empty() {
            return Err(Status::failed_precondition(
                "FS_TEXT_INDEX: a READY collection text index is required",
            ));
        }
        *captured
            .lock()
            .map_err(|_| Status::internal("text index capture is poisoned"))? = Some(definitions);
        Ok(())
    };
    let barrier = local.barrier();
    let epoch = barrier.epoch();
    let (responses, snapshot) = local.run_text_search_source(&compiled.input, &capture)?;
    let source = snapshot
        .source_identity()
        .filter(|_| {
            (32..=4_096).contains(&responses.len()) && is_complete_collection_input(&compiled.input)
        })
        .map(|(database, version)| SearchSource {
            parent: &compiled.input.parent,
            database,
            version,
            epoch,
            cache: &config.search_cache,
        });
    let definitions = captured
        .into_inner()
        .map_err(|_| Status::internal("text index capture is poisoned"))?
        .ok_or_else(|| Status::internal("text index catalog was not captured"))?;
    after_snapshot();
    let execution_time = responses.iter().find_map(|response| response.read_time);
    let (originals, hits) = search_snapshot(&responses, definitions, plan, source.as_ref())?;
    if !config.warned.swap(true, Ordering::Relaxed) {
        fireemu_adapter_support::eprintln_at!(fireemu_adapter_support::term::Level::Info, "[firestore] text search uses fireemu-lexical-v1: approximate BM25, language-neutral tokenization; no stemming, synonyms, typo correction or language autodetection");
    }
    let mut cursor =
        pipeline_exec::Cursor::new_in_with_runtime(compiled.stages, unrecorded, runtime);
    let mut rows = Vec::new();
    for hit in hits {
        if cursor.is_exhausted() {
            break;
        }
        let document = originals
            .get(&hit.path)
            .ok_or_else(|| Status::internal("text hit has no source document"))?;
        let mut row = crate::pipeline::document_row(document)?;
        for alias in &plan.score_fields {
            row.fields.insert(
                alias.clone(),
                fireemu_core_firestore::value::Value::Double(hit.score),
            );
        }
        rows.extend(
            cursor
                .push(row)
                .map_err(|error| crate::pipeline::eval_status(&error))?,
        );
    }
    rows.extend(
        cursor
            .finish()
            .map_err(|error| crate::pipeline::eval_status(&error))?,
    );
    let results = rows.iter().map(crate::pipeline::row_document).collect();
    let responses = crate::pipeline::pack_results(results, execution_time);
    if barrier.epoch() != epoch {
        return Err(Status::unavailable("session reset during text search"));
    }
    Ok(responses)
}

fn search_snapshot(
    responses: &[pb::RunQueryResponse],
    definitions: Vec<(TextIndexDefinition, Option<u64>)>,
    plan: &SearchPlan,
    source: Option<&SearchSource<'_>>,
) -> Result<
    (
        BTreeMap<fireemu_core_firestore::path::DocumentPath, pb::Document>,
        Vec<fireemu_core_firestore::text_search::SearchHit>,
    ),
    Status,
> {
    let mut originals = BTreeMap::new();
    let mut documents = Vec::new();
    for document in responses
        .iter()
        .filter_map(|response| response.document.as_ref())
    {
        let row = crate::pipeline::document_row(document)?;
        let path = row
            .path
            .clone()
            .ok_or_else(|| Status::internal("search input without a document name"))?;
        documents.push(SearchDocument {
            path: path.clone(),
            fields: row.fields,
            created_at: document.create_time.as_ref().map_or(
                fireemu_core_types::time::LogicalInstant::UNIX_EPOCH,
                crate::encode::decode_instant,
            ),
        });
        originals.insert(path, document.clone());
    }
    let mut chosen = None;
    let mut last_error = None;
    for (definition, generation) in definitions {
        if !plan.query.is_covered_by(&definition) {
            continue;
        }
        let index = match (source, generation) {
            (Some(source), Some(generation)) => source.index(&definition, generation, &documents),
            _ => SearchIndex::build(
                &definition,
                &documents,
                fireemu_adapter_support::lexical::tokenize_index,
            )
            .map(Arc::new),
        }
        .map_err(|error| invalid(&error.to_string()))?;
        match index.search(&plan.query, &plan.options) {
            Ok(hits) => {
                chosen = Some(hits);
                break;
            }
            Err(error @ fireemu_core_firestore::text_search::SearchError::UnknownField(_)) => {
                last_error = Some(error);
            }
            Err(error) => return Err(invalid(&error.to_string())),
        }
    }
    let hits = chosen.ok_or_else(|| {
        Status::failed_precondition(format!(
            "FS_TEXT_INDEX: no READY index covers the requested fields: {last_error:?}"
        ))
    })?;
    Ok((originals, hits))
}

fn configuration(
    local: &LocalBackend,
    compiled: &CompiledExecution,
) -> Result<(Configuration, String), Status> {
    let config = local.text_search_configuration()?.ok_or_else(|| {
        Status::failed_precondition("FS_TEXT_INDEX: no local text index catalog is attached")
    })?;
    if config.production_exact {
        return Err(Status::unimplemented("FS_TEXT_UNOBSERVED: lexical search and ranking have no recorded production equivalence; productionExact refuses execution"));
    }
    let collection = match &compiled.input.query_type {
        Some(pb::run_query_request::QueryType::StructuredQuery(query)) => query
            .from
            .first()
            .map(|selector| selector.collection_id.clone())
            .ok_or_else(|| invalid("missing collection"))?,
        _ => return Err(invalid("missing collection input")),
    };
    Ok((config, collection))
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;
    use crate::{gateway::Gateway, pipeline, rules::allow_all_reads};
    use fireemu_core_firestore::{
        index::{IndexSet, IndexValidationPolicy, PlanningContext},
        text_index::{
            DefaultTextLanguage, LanguageOverridePolicy, TextIndexDefinition, TextIndexType,
            TextIndexedField, TextMatchType,
        },
    };
    use fireemu_core_session::clock::VirtualClock;
    use fireemu_core_types::{
        edition::{FirestoreApiMode, FirestoreEdition},
        ids::CollectionId,
        time::LogicalInstant,
    };
    use serde_json::json;
    const DB: &str = "projects/demo-app/databases/(default)";

    fn fixture() -> (LocalBackend, Arc<Mutex<TextIndexCatalog>>, Parent) {
        let local = LocalBackend::new(
            Gateway {
                enforce_limits: false,
                ctx: PlanningContext {
                    edition: FirestoreEdition::Enterprise,
                    api_mode: FirestoreApiMode::Native,
                    policy: IndexValidationPolicy::Emulator,
                },
                indexes: IndexSet::default(),
            },
            Arc::new(Mutex::new(VirtualClock::new(
                LogicalInstant::from_unix_seconds(1_788_004_860),
            ))),
            7,
        );
        let mut catalog = TextIndexCatalog::default();
        catalog
            .add(
                "demo-app",
                "(default)",
                TextIndexDefinition {
                    id: "text".into(),
                    collection_id: CollectionId::try_new("products").unwrap(),
                    query_scope: IndexQueryScope::Collection,
                    api_scope: "ANY_API".into(),
                    fields: vec![TextIndexedField {
                        path: FieldPath::parse("title").unwrap(),
                        index_type: TextIndexType::Tokenized,
                        match_type: TextMatchType::MatchGlobally,
                    }],
                    language: DefaultTextLanguage::Tag("en".into()),
                    language_override: LanguageOverridePolicy::Disabled,
                    state: TextIndexState::Ready,
                },
            )
            .unwrap();
        let catalog = Arc::new(Mutex::new(catalog));
        local.set_text_indexes(catalog.clone(), false).unwrap();
        seed(&local, "before", "after");
        (
            local,
            catalog,
            crate::decode::parse_parent(&format!("{DB}/documents")).unwrap(),
        )
    }
    fn seed(local: &LocalBackend, title: &str, body: &str) {
        seed_named(local, "a", title, body);
    }
    fn seed_named(local: &LocalBackend, name: &str, title: &str, body: &str) {
        local
            .commit(&pb::CommitRequest {
                database: DB.into(),
                writes: vec![pb::Write {
                    operation: Some(pb::write::Operation::Update(pb::Document {
                        name: format!("{DB}/documents/products/{name}"),
                        fields: [("title", title), ("body", body)]
                            .into_iter()
                            .map(|(key, text)| {
                                (
                                    key.into(),
                                    pb::Value {
                                        value_type: Some(pb::value::ValueType::StringValue(
                                            text.into(),
                                        )),
                                    },
                                )
                            })
                            .collect(),
                        ..Default::default()
                    })),
                    ..Default::default()
                }],
                ..Default::default()
            })
            .unwrap();
    }
    fn compiled(parent: &Parent) -> CompiledExecution {
        let request = crate::rest::pipeline_json::request_from_json(DB, &json!({"structuredPipeline":{"pipeline":{"stages":[
            {"name":"collection","args":[{"referenceValue":"/products"}]},
            {"name":"search","options":{"query":{"functionValue":{"name":"document_matches","args":[{"stringValue":"before"}]}}}}
        ]}}})).unwrap();
        pipeline::compile_pipeline(&request, parent, Unrecorded::OfficialEmulator).unwrap()
    }
    #[test]
    fn pipeline_search_follows_same_version_public_state_replacements() {
        // Corpus sizes exercise the cache threshold. Each tuple also selects whether
        // the mutator returns an error and whether the search has an offset and limit.
        for (count, fails, paged) in [
            (40, false, false),
            (40, true, true),
            (32, true, false),
            (31, false, true),
            (31, true, false),
            (32, false, true),
        ] {
            let (local, _, parent) = fixture();
            let (replacement, _, _) = fixture();
            for i in 0..count {
                let name = if i == 0 {
                    "a".to_owned()
                } else {
                    format!("d{i:02}")
                };
                seed_named(&local, &name, "alpha", "body");
                seed_named(&replacement, &name, "beta", "body");
            }
            let search = |term, uncached| {
                let mut plan = compiled(&parent);
                let search = plan.search.as_mut().unwrap();
                search.query =
                    SearchQuery::parse(term, fireemu_adapter_support::lexical::tokenize_query)
                        .unwrap();
                if paged {
                    search.options.offset = 3;
                    search.options.limit = Some(7);
                }
                if uncached {
                    let Some(pb::run_query_request::QueryType::StructuredQuery(query)) =
                        &mut plan.input.query_type
                    else {
                        panic!("missing collection query")
                    };
                    query.limit = Some(1000);
                }
                execute(
                    &local,
                    &parent,
                    plan,
                    &allow_all_reads,
                    Unrecorded::OfficialEmulator,
                )
                .unwrap()
            };
            let alpha = search("alpha", true);
            let rows = alpha.iter().map(|batch| batch.results.len()).sum::<usize>();
            assert_eq!(rows, if paged { 7 } else { count });
            for _ in 0..3 {
                assert_eq!(search("alpha", false), alpha);
            }
            let state = replacement
                .with_snapshot(&parent, |db, _, _, _| db.clone())
                .unwrap();
            let handle = local.database_handle(&parent).unwrap();
            let outcome = handle.with(|db| {
                assert_eq!(state.current_version(), db.current_version());
                *db = state;
                if fails {
                    Err(Status::aborted("caller stopped after replacement"))
                } else {
                    Ok(())
                }
            });
            assert_eq!(outcome.is_err(), fails);
            for _ in 0..3 {
                let old = search("alpha", false);
                assert!(old.iter().all(|batch| batch.results.is_empty()));
                let new = search("beta", false);
                assert_eq!(new, search("beta", true));
                assert_eq!(
                    new.iter().map(|batch| batch.results.len()).sum::<usize>(),
                    rows
                );
            }
        }
    }

    #[test]
    fn repeated_search_reuses_only_an_admitted_unchanged_corpus() {
        let (local, catalog, parent) = fixture();
        for n in 1..40 {
            seed_named(&local, &format!("d{n}"), "other", "before");
        }
        let run = || {
            execute(
                &local,
                &parent,
                compiled(&parent),
                &allow_all_reads,
                Unrecorded::OfficialEmulator,
            )
            .unwrap()
        };
        let cached = || {
            local
                .text_search_configuration()
                .unwrap()
                .unwrap()
                .search_cache
                .lock()
                .unwrap()
                .entry
                .as_ref()
                .and_then(|(_, index)| index.clone())
        };
        assert_eq!(run()[0].results.len(), 1);
        assert!(cached().is_none());
        assert_eq!(run()[0].results.len(), 1);
        let first = cached().expect("second identical source retains the index");
        assert_eq!(run()[0].results.len(), 1);
        assert!(Arc::ptr_eq(&first, &cached().unwrap()));

        let refused = execute(
            &local,
            &parent,
            compiled(&parent),
            &|_, _, _| Err(Status::permission_denied("denied")),
            Unrecorded::OfficialEmulator,
        )
        .unwrap_err();
        assert_eq!(refused.code(), tonic::Code::PermissionDenied);
        assert!(Arc::ptr_eq(&first, &cached().unwrap()));
        seed(&local, "other", "after");
        assert!(run().iter().all(|response| response.results.is_empty()));
        assert!(cached().is_none());

        let mut definitions = catalog.lock().unwrap();
        let mut replacement = definitions
            .get("demo-app", "(default)", "text")
            .unwrap()
            .clone();
        replacement.fields[0].path = FieldPath::parse("body").unwrap();
        definitions.remove("demo-app", "(default)", "text");
        definitions
            .add("demo-app", "(default)", replacement)
            .unwrap();
        drop(definitions);
        assert_eq!(run()[0].results.len(), 39);
        assert!(cached().is_none());
        assert_eq!(run()[0].results.len(), 39);
        assert!(!Arc::ptr_eq(&first, &cached().unwrap()));

        let mut filtered = compiled(&parent);
        let Some(pb::run_query_request::QueryType::StructuredQuery(source)) =
            &mut filtered.input.query_type
        else {
            panic!("structured query")
        };
        source.limit = Some(1);
        let result = execute(
            &local,
            &parent,
            filtered,
            &allow_all_reads,
            Unrecorded::OfficialEmulator,
        )
        .unwrap();
        assert!(result.iter().all(|response| response.results.is_empty()));
    }
    #[test]
    fn repeated_terms_and_score_ties_match_an_uncached_source() {
        let (local, _, parent) = fixture();
        for i in 1..40 {
            seed_named(
                &local,
                &format!("d{i}"),
                if i % 3 == 0 { "other other" } else { "other" },
                "after",
            );
        }
        let run = |plan| {
            execute(
                &local,
                &parent,
                plan,
                &allow_all_reads,
                Unrecorded::OfficialEmulator,
            )
            .unwrap()
        };
        for _ in 0..2 {
            run(compiled(&parent));
        }
        let mut scored = compiled(&parent);
        let search = scored.search.as_mut().unwrap();
        search.query =
            SearchQuery::parse("other", fireemu_adapter_support::lexical::tokenize_query).unwrap();
        search.options.order = SearchOrder::ScoreDescending;
        search.options.offset = 3;
        search.options.limit = Some(19);
        search.score_fields.push("score".into());
        let mut uncached = scored.clone();
        let Some(pb::run_query_request::QueryType::StructuredQuery(source)) =
            &mut uncached.input.query_type
        else {
            panic!("collection query")
        };
        source.limit = Some(1000);
        let cached = run(scored);
        assert_eq!(cached, run(uncached));
        let rows = &cached[0].results;
        assert_eq!(rows.len(), 19);
        assert_ne!(
            rows.first().unwrap().fields["score"],
            rows.last().unwrap().fields["score"]
        );
    }
    #[test]
    fn search_cache_distinguishes_nested_sources_and_restored_database_incarnations() {
        let (local, _, parent) = fixture();
        let (replacement, _, _) = fixture();
        for i in 1..40 {
            let name = format!("d{i}");
            seed_named(&local, &name, "other", "after");
            seed_named(&replacement, &name, "before", "after");
            let nested = format!("a/products/d{i}");
            seed_named(&local, &nested, "before", "after");
            seed_named(&replacement, &nested, "other", "after");
        }
        let run = |nested| {
            let mut plan = compiled(&parent);
            if nested {
                plan.input.parent = format!("{DB}/documents/products/a");
            }
            execute(
                &local,
                &parent,
                plan,
                &allow_all_reads,
                Unrecorded::OfficialEmulator,
            )
            .unwrap()
            .iter()
            .map(|response| response.results.len())
            .sum::<usize>()
        };
        for _ in 0..3 {
            assert_eq!(run(false), 1);
        }
        assert_eq!(run(true), 39);
        for _ in 0..3 {
            assert_eq!(run(false), 1);
        }
        let scope = fireemu_core_session::tenancy::Scope::Project("demo-app".into());
        local
            .restore_scope(&scope, &replacement.snapshot_scope(&scope))
            .unwrap();
        assert_eq!(run(false), 40);
        assert_eq!(run(true), 0);
    }
    #[test]
    fn search_cache_leaves_large_postings_ephemeral() {
        use std::fmt::Write;
        let (local, _, parent) = fixture();
        let mut title = "before".to_string();
        for n in 0..700 {
            write!(title, " token{n}").unwrap();
        }
        for n in 1..32 {
            seed_named(&local, &format!("d{n}"), &title, "after");
        }
        for _ in 0..2 {
            let result = execute(
                &local,
                &parent,
                compiled(&parent),
                &allow_all_reads,
                Unrecorded::OfficialEmulator,
            )
            .unwrap();
            assert_eq!(result.iter().map(|r| r.results.len()).sum::<usize>(), 32);
        }
        let config = local.text_search_configuration().unwrap().unwrap();
        assert!(matches!(
            &config.search_cache.lock().unwrap().entry,
            Some((_, None))
        ));
    }
    #[test]
    fn text_search_evaluates_request_scoped_timestamp() {
        use fireemu_core_firestore::field_path::FieldPath;
        use fireemu_core_firestore::pipeline_exec::{Expr, Placement, Stage};
        let (local, _, parent) = fixture();
        let mut pipeline = compiled(&parent);
        pipeline.stages.push(Stage::Select {
            aliases: vec![(
                FieldPath::parse("now").unwrap(),
                Expr::call("current_timestamp", vec![], Placement::Value).unwrap(),
            )],
            keeps_name: false,
        });
        let responses = execute(
            &local,
            &parent,
            pipeline,
            &allow_all_reads,
            Unrecorded::OfficialEmulator,
        )
        .unwrap();
        assert!(
            format!("{responses:?}").contains("1788004860"),
            "{responses:?}"
        );
    }

    #[test]
    fn text_search_suffix_uses_the_regex_resolver() {
        use fireemu_core_firestore::field_path::FieldPath;
        use fireemu_core_firestore::pipeline_exec::{Expr, Placement, Stage};
        use fireemu_core_firestore::value::Value;
        let (local, _, parent) = fixture();
        let mut pipeline = compiled(&parent);
        pipeline.stages.push(Stage::Select {
            aliases: vec![(
                FieldPath::parse("matched").unwrap(),
                Expr::call(
                    "regex_contains",
                    vec![
                        Expr::Constant(Value::String("abc".to_owned())),
                        Expr::Constant(Value::String("b".to_owned())),
                    ],
                    Placement::Value,
                )
                .unwrap(),
            )],
            keeps_name: false,
        });
        let responses = execute(
            &local,
            &parent,
            pipeline,
            &allow_all_reads,
            Unrecorded::Refuse,
        )
        .unwrap();
        assert_eq!(
            responses[0].results[0].fields["matched"].value_type,
            Some(pb::value::ValueType::BooleanValue(true))
        );
    }

    #[test]
    fn catalog_replacement_and_write_after_capture_cannot_mix_with_the_frozen_source() {
        let (local, catalog, parent) = fixture();
        let result = execute_at_snapshot(
            &local,
            &parent,
            compiled(&parent),
            &allow_all_reads,
            Unrecorded::OfficialEmulator,
            || {
                let mut catalog = catalog.lock().unwrap();
                let mut next = catalog
                    .get("demo-app", "(default)", "text")
                    .unwrap()
                    .clone();
                next.fields[0].path = FieldPath::parse("body").unwrap();
                catalog.remove("demo-app", "(default)", "text");
                catalog.add("demo-app", "(default)", next).unwrap();
                drop(catalog);
                seed(&local, "after", "before");
            },
        )
        .unwrap();
        assert_eq!(
            result[0].results[0].fields["title"].value_type,
            Some(pb::value::ValueType::StringValue("before".into()))
        );
        let next = execute(
            &local,
            &parent,
            compiled(&parent),
            &allow_all_reads,
            Unrecorded::OfficialEmulator,
        )
        .unwrap();
        assert_eq!(
            next[0].results[0].fields["title"].value_type,
            Some(pb::value::ValueType::StringValue("after".into()))
        );
    }
    #[test]
    fn production_option_refusals_match_recorded_rest_and_grpc_contracts() {
        let requests: serde_json::Value = serde_json::from_str(include_str!(
            "../../../conformance/fs-ent-text-refusal-requests.json"
        ))
        .unwrap();
        let production: serde_json::Value = serde_json::from_str(include_str!(
            "../../../conformance/fs-ent-text-production.json"
        ))
        .unwrap();
        let parent = crate::decode::parse_parent(&format!("{DB}/documents")).unwrap();
        let mut checked = 0;
        for program in requests["programs"].as_array().unwrap() {
            for step in program["steps"].as_array().unwrap() {
                let body = &step["body"];
                let request = crate::rest::pipeline_json::request_from_json(DB, body).unwrap();
                let Err(error) = pipeline::compile_pipeline(&request, &parent, Unrecorded::Refuse)
                else {
                    panic!("production refused {}", step["id"]);
                };
                let grpc = step["transport"] == "grpc";
                let shape = if grpc {
                    crate::pipeline_shape::shape_of_request(&request)
                } else {
                    let (_, order) =
                        crate::rest::json_syntax::parse_with_key_order(body.to_string().as_bytes())
                            .unwrap();
                    crate::pipeline_shape::shape_of_json(body, &order)
                };
                let actual =
                    crate::pipeline_shape::RefusalGate::Recorded(shape, DB.into()).answer(error);
                let expected = &production["programs"][program["id"].as_str().unwrap()]["steps"]
                    [step["id"].as_str().unwrap()];
                let message = if grpc {
                    expected["message"].as_str().unwrap()
                } else {
                    expected["body"][0]["error"]["message"].as_str().unwrap()
                };
                assert_eq!(
                    actual.code(),
                    tonic::Code::InvalidArgument,
                    "{}",
                    step["id"]
                );
                assert_eq!(actual.message(), message, "{}", step["id"]);
                checked += 1;
            }
        }
        assert_eq!(checked, 9);
    }

    #[test]
    fn production_search_batches_all_hits_in_one_response() {
        let (local, _, parent) = fixture();
        seed_named(&local, "b", "before", "after");
        let responses = execute(
            &local,
            &parent,
            compiled(&parent),
            &allow_all_reads,
            Unrecorded::OfficialEmulator,
        )
        .unwrap();
        // Both production REST and gRPC recordings return these small hit sets in one batch.
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].results.len(), 2);
        assert!(responses[0].execution_time.is_some());
    }

    #[test]
    fn search_batches_split_large_documents_without_losing_hits() {
        let (local, _, parent) = fixture();
        let body = "x".repeat(600_000);
        seed_named(&local, "a", "before", &body);
        seed_named(&local, "b", "before", &body);
        let responses = execute(
            &local,
            &parent,
            compiled(&parent),
            &allow_all_reads,
            Unrecorded::OfficialEmulator,
        )
        .unwrap();
        assert_eq!(responses.len(), 2);
        assert_eq!(
            responses
                .iter()
                .map(|response| response.results.len())
                .sum::<usize>(),
            2
        );
        assert!(responses
            .iter()
            .all(|response| prost::Message::encoded_len(response) <= 1_048_576));
        let names: Vec<_> = responses
            .iter()
            .flat_map(|response| &response.results)
            .map(|document| document.name.as_str())
            .collect();
        assert_eq!(
            names,
            [
                format!("{DB}/documents/products/b"),
                format!("{DB}/documents/products/a")
            ]
        );
    }

    #[test]
    fn reset_after_capture_refuses_the_previous_epoch_instead_of_returning_stale_results() {
        let (local, _, parent) = fixture();
        let error = execute_at_snapshot(
            &local,
            &parent,
            compiled(&parent),
            &allow_all_reads,
            Unrecorded::OfficialEmulator,
            || {
                let barrier = local.barrier();
                let _exclusive = barrier.exclusive();
                local.reset();
            },
        )
        .unwrap_err();
        assert_eq!(error.code(), tonic::Code::Unavailable);
        assert!(error.message().contains("reset"));
    }
}
