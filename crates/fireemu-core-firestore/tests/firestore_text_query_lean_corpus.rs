//! Replays lexical query membership and creation-order pagination.

use std::collections::BTreeMap;

use fireemu_adapter_support::lexical::{tokenize_index, tokenize_query};
use fireemu_core_firestore::field_path::FieldPath;
use fireemu_core_firestore::index::IndexQueryScope;
use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_firestore::text_index::{
    DefaultTextLanguage, LanguageOverridePolicy, TextIndexDefinition, TextIndexState,
    TextIndexType, TextIndexedField, TextMatchType,
};
use fireemu_core_firestore::text_search::{
    SearchDocument, SearchError, SearchIndex, SearchOptions, SearchQuery,
};
use fireemu_core_firestore::value::Value;
use fireemu_core_types::ids::{CollectionId, DatabaseId, ProjectId};
use fireemu_core_types::time::LogicalInstant;

const CASES: &str = include_str!("fixtures/lean-firestore-text-query.corpus");

const ENGLISH: &[(&str, &str, &str, i128)] = &[
    ("adj", "blue", "red fox", 8),
    ("both", "red fox", "red", 7),
    ("joined", "redfox", "", 6),
    ("reverse", "fox red", "", 5),
    ("sep", "red blue fox", "", 4),
    ("split", "red", "fox", 4),
    ("only", "red", "", 3),
];

const LATIN: &[(&str, &str, &str, i128)] = &[
    ("accent", "CAFÉ Straße", "", 2),
    ("folded", "cafe strasse", "", 1),
    ("dotted", "İzmir", "", 0),
];

fn definition() -> TextIndexDefinition {
    TextIndexDefinition {
        id: "text".into(),
        collection_id: CollectionId::try_new("docs").unwrap(),
        query_scope: IndexQueryScope::Collection,
        api_scope: "ANY_API".into(),
        fields: ["title", "body"]
            .into_iter()
            .map(|field| TextIndexedField {
                path: FieldPath::parse(field).unwrap(),
                index_type: TextIndexType::Tokenized,
                match_type: TextMatchType::MatchGlobally,
            })
            .collect(),
        language: DefaultTextLanguage::Autodetect,
        language_override: LanguageOverridePolicy::Disabled,
        state: TextIndexState::Ready,
    }
}

fn index(name: &str, definition: &TextIndexDefinition) -> SearchIndex {
    let docs = match name {
        "english" => ENGLISH.to_vec(),
        "latin" => LATIN.to_vec(),
        "mixed" => [ENGLISH, LATIN].concat(),
        _ => panic!("unknown corpus {name}"),
    };
    let documents = docs
        .into_iter()
        .rev()
        .map(|(id, title, body, time)| SearchDocument {
            path: DocumentPath::parse(
                &ProjectId::try_new("demo-app").unwrap(),
                &DatabaseId::try_new("(default)").unwrap(),
                &format!("docs/{id}"),
            )
            .unwrap(),
            fields: BTreeMap::from([
                ("title".into(), Value::String(title.into())),
                ("body".into(), Value::String(body.into())),
            ]),
            created_at: LogicalInstant::from_nanos(time),
        })
        .collect::<Vec<_>>();
    SearchIndex::build(definition, &documents, tokenize_index).unwrap()
}

fn options(name: &str) -> SearchOptions {
    match name {
        "all" => SearchOptions::default(),
        "window" => SearchOptions {
            offset: 1,
            limit: Some(2),
            ..SearchOptions::default()
        },
        "depth" => SearchOptions {
            offset: 1,
            limit: Some(3),
            retrieval_depth: Some(2),
            ..SearchOptions::default()
        },
        "empty" => SearchOptions {
            limit: Some(0),
            ..SearchOptions::default()
        },
        _ => panic!("unknown page {name}"),
    }
}

#[test]
fn replay_lexical_membership_and_pagination() {
    let definition = definition();
    let indexes = ["english", "latin", "mixed"]
        .map(|name| (name, index(name, &definition)))
        .into_iter()
        .collect::<BTreeMap<_, _>>();
    let mut cases = CASES.lines();
    assert_eq!(
        cases.next(),
        Some("# QUERY CORPUS PAGE TEXT RESULT PATHS, tab separated")
    );
    let mut count = 0;
    for entry in cases {
        let fields = entry.split('\t').collect::<Vec<_>>();
        let [_, name, page, input, result, ids] = fields.as_slice() else {
            panic!("bad corpus row {entry}");
        };
        let parsed = SearchQuery::parse(input, tokenize_query);
        if *result == "invalid" {
            assert!(
                matches!(parsed, Err(SearchError::InvalidQuery(_))),
                "{entry}"
            );
        } else {
            let query = parsed.unwrap();
            assert_eq!(
                query.is_covered_by(&definition),
                *result != "unknown",
                "{entry}"
            );
            let found = indexes[name].search(&query, &options(page));
            if *result == "unknown" {
                assert_eq!(
                    found,
                    Err(SearchError::UnknownField("unindexed".into())),
                    "{entry}"
                );
            } else {
                assert_eq!(*result, "ok", "{entry}");
                let actual = found
                    .unwrap()
                    .into_iter()
                    .map(|hit| hit.path.relative())
                    .collect::<Vec<_>>();
                let expected = ids.split(',').filter(|id| *id != "-").collect::<Vec<_>>();
                assert_eq!(actual, expected, "{entry}");
            }
        }
        count += 1;
    }
    assert_eq!(count, 168);
}
