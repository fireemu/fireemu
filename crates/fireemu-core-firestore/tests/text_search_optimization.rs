//! Candidate selection and depth through the indexed search path.

use std::collections::BTreeMap;

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::index::IndexQueryScope;
use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_firestore::text_index::{
    DefaultTextLanguage, LanguageOverridePolicy, TextIndexDefinition, TextIndexState,
    TextIndexType, TextIndexedField, TextMatchType,
};
use fireemu_core_firestore::text_search::{
    SearchDocument, SearchError, SearchIndex, SearchOptions, SearchOrder, SearchQuery,
};
use fireemu_core_firestore::value::Value;
use fireemu_core_types::ids::{CollectionId, DatabaseId, ProjectId};
use fireemu_core_types::time::LogicalInstant;

fn words(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_owned).collect()
}

fn document(name: &str, text: &str, created: i128) -> SearchDocument {
    SearchDocument {
        path: DocumentPath::parse(
            &ProjectId::try_new("demo-test").unwrap(),
            &DatabaseId::default_database(),
            &format!("docs/{name}"),
        )
        .unwrap(),
        fields: BTreeMap::from([("title".into(), Value::String(text.into()))]),
        created_at: LogicalInstant::from_nanos(created),
    }
}

fn corpus(include_conjuncts: bool) -> SearchIndex {
    let definition = TextIndexDefinition {
        id: "lexical".into(),
        collection_id: CollectionId::try_new("docs").unwrap(),
        query_scope: IndexQueryScope::Collection,
        api_scope: "ANY_API".into(),
        fields: vec![TextIndexedField {
            path: FieldPath::parse("title").unwrap(),
            index_type: TextIndexType::Tokenized,
            match_type: TextMatchType::MatchGlobally,
        }],
        language: DefaultTextLanguage::Autodetect,
        language_override: LanguageOverridePolicy::Disabled,
        state: TextIndexState::Ready,
    };
    let mut docs = vec![
        document("z-alt", "ambercobalt", 30),
        document("a-alt", "ambercobalt", 30),
    ];
    if include_conjuncts {
        docs.extend([
            document("overlap", "amber cobalt ambercobalt", 20),
            document("rich", "amber cobalt amber cobalt amber cobalt", 10),
        ]);
    }
    docs.extend((1..=96).map(|i| document(&format!("irrelevant-{i}"), "background", 99)));
    SearchIndex::build(&definition, &docs, words).unwrap()
}

fn search_names(index: &SearchIndex, text: &str, depth: Option<usize>) -> Vec<String> {
    index
        .search(
            &SearchQuery::parse(text, words).unwrap(),
            &SearchOptions {
                retrieval_depth: depth,
                order: SearchOrder::ScoreDescending,
                ..SearchOptions::default()
            },
        )
        .unwrap()
        .into_iter()
        .map(|hit| hit.path.relative())
        .collect()
}

#[test]
fn postings_union_keeps_alternatives_once_and_depth_precedes_relevance() {
    let index = corpus(true);
    assert_eq!(
        search_names(&index, "amber cobalt", None),
        ["docs/rich", "docs/overlap", "docs/a-alt", "docs/z-alt"]
    );
    assert_eq!(
        search_names(&index, "amber cobalt", Some(2)),
        ["docs/a-alt", "docs/z-alt"]
    );
    assert_eq!(
        search_names(&index, "\"amber cobalt\" -ambercobalt", Some(1)),
        ["docs/rich"]
    );
}

#[test]
fn missing_positive_postings_preserve_composition_and_zero_depth_validates_fields() {
    let index = corpus(false);
    assert_eq!(
        search_names(&index, "amber cobalt", None),
        ["docs/a-alt", "docs/z-alt"]
    );
    assert_eq!(
        index.search(
            &SearchQuery::parse("unknown:\"amber cobalt\"", words).unwrap(),
            &SearchOptions {
                retrieval_depth: Some(0),
                ..SearchOptions::default()
            }
        ),
        Err(SearchError::UnknownField("unknown".into()))
    );
}
