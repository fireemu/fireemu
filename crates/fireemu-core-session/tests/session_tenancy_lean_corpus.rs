//! Replays complete Tenancy registration and removal snapshots.

use fireemu_core_session::tenancy::Tenancy;

const PROJECTS: [&str; 5] = ["demo-default", "demo-a", "demo-b", "demo-c", "other"];
const BUCKETS: [&str; 11] = [
    "demo-default.appspot.com",
    "demo-default.firebasestorage.app",
    "demo-a.appspot.com",
    "demo-b.appspot.com",
    "demo-c.firebasestorage.app",
    "alias-a",
    "alias-b",
    "alias-c",
    "unowned",
    ".appspot.com",
    "alias-new",
];
const KEYS: [&str; 8] = [
    "key-default",
    "key-shared",
    "key-a",
    "key-b",
    "key-c",
    "new-key",
    "unknown",
    "",
];

fn register(
    tenancy: &mut Tenancy,
    project: &str,
    buckets: &[&str],
    keys: &[&str],
) -> Result<(), String> {
    let owned = |strings: &[&str]| strings.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    tenancy.register(project, &owned(buckets), &owned(keys))
}

fn initial(baseline: &str, policy: &str) -> Tenancy {
    let mut tenancy = Tenancy::new("demo-default");
    match policy {
        "open" => {}
        "declared" => {
            tenancy.declare_default_api_keys(&["key-shared".to_owned(), "key-default".to_owned()]);
        }
        other => panic!("unknown key policy {other}"),
    }
    match baseline {
        "empty" => {}
        "occupied" | "full" => {
            register(
                &mut tenancy,
                "demo-b",
                &["alias-b"],
                &["key-shared", "key-b"],
            )
            .unwrap();
            if baseline == "full" {
                register(&mut tenancy, "demo-a", &["alias-a"], &["key-a"]).unwrap();
            }
        }
        other => panic!("unknown baseline {other}"),
    }
    tenancy
}

fn proposal(label: &str) -> (&str, &[&str], &[&str]) {
    match label {
        "freshA" => ("demo-a", &["alias-new", "alias-a"], &["key-a"]),
        "freshC" => ("demo-c", &["alias-c"], &["key-c"]),
        "default" => ("demo-default", &[], &[]),
        "duplicate" => ("demo-b", &["alias-new"], &["new-key"]),
        "foreignRegistered" => ("demo-c", &["demo-b.appspot.com"], &[]),
        "foreignUnregistered" => ("demo-a", &["demo-c.firebasestorage.app"], &[]),
        "ownConventional" => ("demo-c", &["demo-c.firebasestorage.app"], &[]),
        "bucketBeforeKey" => ("demo-c", &["alias-new", "alias-b"], &["key-b"]),
        "keyAfterFreeKey" => ("demo-c", &["alias-c"], &["new-key", "key-b", "key-a"]),
        "baseKeyOverlap" => ("demo-c", &[], &["key-default"]),
        "emptyPrefix" => ("demo-c", &[".appspot.com"], &[]),
        other => panic!("unknown proposal {other}"),
    }
}

fn snapshot(tenancy: &Tenancy) -> String {
    assert_eq!(tenancy.default_project(), "demo-default");
    let owners = BUCKETS.map(|b| tenancy.project_of_bucket(b)).join(",");
    let keys = KEYS
        .map(|key| {
            format!(
                "{}:{}:{}",
                tenancy.project_of_api_key(key).unwrap_or("-"),
                tenancy.is_default_api_key(key),
                tenancy.refuses_api_key(key)
            )
        })
        .join(",");
    let projects = PROJECTS
        .map(|project| {
            format!(
                "{}:{}:{}",
                tenancy.api_key_for(project).unwrap_or("-"),
                tenancy.is_registered(project),
                tenancy.declared_buckets(project).join("+"),
            )
        })
        .join(",");
    let scopes = PROJECTS
        .map(|p| {
            let scope = tenancy.scope_of(p);
            assert_eq!(scope.is_default(), !tenancy.is_registered(p));
            assert_eq!(scope.project(), tenancy.is_registered(p).then_some(p));
            if scope.is_default() {
                assert_eq!(scope, tenancy.default_scope());
            }
            PROJECTS
                .map(|q| if scope.owns_project(q) { '1' } else { '0' })
                .iter()
                .collect::<String>()
        })
        .join(",");
    let registered = tenancy
        .registered()
        .into_iter()
        .collect::<Vec<_>>()
        .join(",");
    format!("{registered};{owners};{keys};{projects};{scopes}")
}

#[test]
fn session_tenancy_matches_lean() {
    let mut lines = include_str!("fixtures/lean-session-tenancy.corpus").lines();
    assert_eq!(
        lines.next(),
        Some("# baseline|keyPolicy|proposal|result|after|removed|afterRemoval")
    );
    let mut count = 0;
    for row in lines {
        let fields: Vec<_> = row.split('|').collect();
        let [baseline, policy, label, result, after, removed, after_removal]: [&str; 7] =
            fields.try_into().unwrap();
        let mut tenancy = initial(baseline, policy);
        let before = tenancy.clone();
        let (project, buckets, keys) = proposal(label);
        let accepted = register(&mut tenancy, project, buckets, keys);
        if result == "accepted" {
            assert_eq!(accepted, Ok(()), "{row}");
        } else {
            assert_eq!(accepted, Err(result.to_owned()), "{row}");
            assert_eq!(tenancy, before, "a refusal must be atomic: {row}");
        }
        assert_eq!(snapshot(&tenancy), after, "{row}");
        assert_eq!(
            tenancy.unregister(project),
            removed.parse::<bool>().unwrap(),
            "{row}"
        );
        assert_eq!(snapshot(&tenancy), after_removal, "{row}");
        count += 1;
    }
    assert_eq!(count, 66);
}
