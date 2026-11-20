//! Replays retrieval depth and relevance order through the public search API.

use std::collections::BTreeMap;

use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::index::IndexQueryScope;
use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_firestore::text_index::{
    DefaultTextLanguage, LanguageOverridePolicy, TextIndexDefinition, TextIndexState,
    TextIndexType, TextIndexedField, TextMatchType,
};
use fireemu_core_firestore::text_search::{
    SearchDocument, SearchIndex, SearchOptions, SearchOrder, SearchQuery,
};
use fireemu_core_firestore::value::Value;
use fireemu_core_types::ids::{CollectionId, DatabaseId, ProjectId};
use fireemu_core_types::time::LogicalInstant;

fn words(value: &str) -> Vec<String> {
    value.split_whitespace().map(str::to_owned).collect()
}

fn document(name: &str, time: i128, occurrences: usize) -> SearchDocument {
    SearchDocument {
        path: DocumentPath::parse(
            &ProjectId::try_new("demo-model").unwrap(),
            &DatabaseId::default_database(),
            &format!("docs/{name}"),
        )
        .unwrap(),
        fields: BTreeMap::from([("text".into(), Value::String("fern ".repeat(occurrences)))]),
        created_at: LogicalInstant::from_nanos(time),
    }
}

fn corpus(source: &str) -> SearchIndex {
    let definition = TextIndexDefinition {
        id: "lexical".into(),
        collection_id: CollectionId::try_new("docs").unwrap(),
        query_scope: IndexQueryScope::Collection,
        api_scope: "ANY_API".into(),
        fields: vec![TextIndexedField {
            path: FieldPath::parse("text").unwrap(),
            index_type: TextIndexType::Tokenized,
            match_type: TextMatchType::MatchGlobally,
        }],
        language: DefaultTextLanguage::Autodetect,
        language_override: LanguageOverridePolicy::Disabled,
        state: TextIndexState::Ready,
    };
    let mut documents: Vec<_> = source
        .split(',')
        .map(|row| {
            let columns: Vec<_> = row.split(':').collect();
            let [name, age, count] = columns.as_slice() else {
                panic!("unexpected source item {row}");
            };
            document(name, age.parse().unwrap(), count.parse().unwrap())
        })
        .collect();
    documents.extend((0..68).map(|i| document(&format!("no-token-{i}"), 40, 0)));
    SearchIndex::build(&definition, &documents, words).unwrap()
}

fn numeric_choice(label: &str) -> Option<usize> {
    match label {
        "all" => None,
        "zero" => Some(0),
        "one" => Some(1),
        "two" => Some(2),
        "three" => Some(3),
        _ => panic!("unexpected numeric choice {label}"),
    }
}

#[test]
fn depth_selects_newest_before_relevance_and_pagination() {
    let mut corpus_rows = include_str!("fixtures/lean-firestore-search-ranking.corpus").lines();
    assert_eq!(
        corpus_rows.next(),
        Some("# shape|depth|order|offset|limit|source|page")
    );
    assert_eq!(corpus_rows.clone().count(), 288);
    let query = SearchQuery::parse("fern", words).unwrap();
    let mut indexes = BTreeMap::new();
    for line in corpus_rows {
        let columns: Vec<_> = line.split('|').collect();
        let [shape, depth, order, offset, limit, source, answer] = columns.as_slice() else {
            panic!("unexpected corpus line {line}");
        };
        let index = indexes.entry(*shape).or_insert_with(|| corpus(source));
        let options = SearchOptions {
            retrieval_depth: numeric_choice(depth),
            order: if *order == "score" {
                SearchOrder::ScoreDescending
            } else {
                SearchOrder::CreationDescending
            },
            offset: offset.parse().unwrap(),
            limit: numeric_choice(limit),
        };
        let hits: Vec<_> = index
            .search(&query, &options)
            .unwrap()
            .into_iter()
            .map(|hit| hit.path.relative())
            .collect();
        let expected: Vec<_> = answer
            .split(',')
            .filter(|name| *name != "-")
            .map(|name| format!("docs/{name}"))
            .collect();
        assert_eq!(hits, expected, "{line}");
    }
}
