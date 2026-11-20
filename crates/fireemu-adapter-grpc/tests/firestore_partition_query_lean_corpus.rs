//! Replays the specification of the Fireemu partition sampler.

use fireemu_adapter_grpc::partition::{is_sample, partition_cursors};
use fireemu_core_firestore::path::DocumentPath;
use fireemu_core_types::ids::{DatabaseId, ProjectId};

fn parse_key(project: &ProjectId, database: &DatabaseId, relative: &str) -> DocumentPath {
    DocumentPath::parse(project, database, relative).expect("fixture document path")
}

fn keys(size: usize, shape: &str) -> Vec<DocumentPath> {
    let project = ProjectId::try_new("demo-a").expect("fixture project");
    let other_project = ProjectId::try_new("demo-b").expect("other project");
    let database = DatabaseId::default_database();
    let other_db = DatabaseId::try_new("second").expect("other database");
    let mut keys = Vec::new();
    for i in 0..size {
        let prefix = match i % 4 {
            0 => "é",
            1 => "item",
            _ => "🐦",
        };
        let key = format!("items/{prefix}{i}");
        let relative = if shape == "nested" {
            format!("roots/anchor{}/{key}", i % 3)
        } else {
            key
        };
        let path = parse_key(&project, &database, &relative);
        if shape == "namespaces" {
            keys.push(parse_key(&other_project, &database, &relative));
            keys.push(path.clone());
            keys.push(parse_key(&project, &other_db, &relative));
        }
        keys.push(path);
    }
    keys
}

fn fixture_keys(text: &str) -> Vec<DocumentPath> {
    if text == "-" {
        return Vec::new();
    }
    text.split(',')
        .map(|encoded| {
            let mut parts = encoded.splitn(3, ':');
            let project = ProjectId::try_new(parts.next().expect("project")).expect("project ID");
            let database =
                DatabaseId::try_new(parts.next().expect("database")).expect("database ID");
            parse_key(&project, &database, parts.next().expect("relative path"))
        })
        .collect()
}

#[test]
fn partition_samples_and_cursors_match_lean_corpus() {
    let mut rows = include_str!("fixtures/lean-firestore-partition-query.corpus").lines();
    let count = rows
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases."))
        .expect("fixture count")
        .parse::<usize>()
        .expect("numeric case count");
    assert_eq!(count, 72);
    assert_eq!(rows.clone().count(), count);

    for row in rows {
        let columns: Vec<_> = row.split('\t').collect();
        let [group, shape, input, limit, size, requested, samples, cursors] = columns.as_slice()
        else {
            panic!("invalid partition fixture row");
        };
        let label = format!("{group}/{shape}/{input}/{limit}");
        let mut paths = keys(size.parse().expect("fixture group size"), shape);
        if *input == "reverse" {
            paths.reverse();
        }
        let mut sampled: Vec<_> = paths
            .iter()
            .filter(|path| is_sample(path))
            .cloned()
            .collect();
        sampled.sort();
        assert_eq!(sampled, fixture_keys(samples), "{label} samples");
        assert_eq!(
            partition_cursors(&paths, requested.parse().expect("fixture cursor count")),
            fixture_keys(cursors),
            "{label} cursors"
        );
    }
}
