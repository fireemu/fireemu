use fireemu_core_firestore::{path::DocumentPath, query::QueryScope};
use fireemu_core_types::ids::{CollectionId, DatabaseId, ProjectId};

#[test]
fn query_scope_matches_lean_corpus() {
    let mut lines = include_str!("fixtures/lean-firestore-query-scope.corpus").lines();
    let count = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases."))
        .expect("fixture count")
        .parse::<usize>()
        .expect("numeric case count");
    assert!(count >= 300);
    assert_eq!(lines.clone().count(), count);
    let parent_project = ProjectId::try_new("demo-lean-a").expect("parent project");
    let other_project = ProjectId::try_new("demo-lean-b").expect("other project");
    let parent_database = DatabaseId::default_database();
    let other_database = DatabaseId::try_new("secondary").expect("other database");
    let collection = CollectionId::try_new("selected").expect("collection");

    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        let [kind, _, _, namespace, anchor, path, expected] = fields.as_slice() else {
            panic!("invalid query scope fixture row");
        };
        let parent = (*anchor != "-").then(|| {
            DocumentPath::parse(&parent_project, &parent_database, anchor).expect("parent path")
        });
        let scope = match *kind {
            "collection" => QueryScope::collection(parent, collection.clone()),
            "group" => QueryScope::collection_group_under(parent, collection.clone()),
            "descendants" => QueryScope::kindless_all_descendants(parent),
            "children" => QueryScope::kindless_children(parent),
            kind => panic!("unknown scope kind {kind}"),
        };
        let (project, database) = match *namespace {
            "same" => (&parent_project, &parent_database),
            "project" => (&other_project, &parent_database),
            "database" => (&parent_project, &other_database),
            "both" => (&other_project, &other_database),
            namespace => panic!("unknown namespace {namespace}"),
        };
        let document = DocumentPath::parse(project, database, path).expect("document path");
        assert_eq!(
            scope.contains(&document),
            expected.parse::<bool>().expect("membership"),
            "{line}"
        );
    }
}
