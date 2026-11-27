//! Replays projected registry histories with synthetic app and token metadata.

use fireemu_core_app_check::{
    AppCheckClaims, AppCheckRegistry, AppRegistration, DebugTokenDigest, DebugTokenRecord,
    ProjectEpoch, RegistryError,
};
use fireemu_core_types::time::LogicalInstant;

const CORPUS: &str = include_str!("../fixtures/lean-app-check-registry.corpus");

fn settings(n: usize) -> AppCheckRegistry {
    let mut registry = AppCheckRegistry::new(3600).unwrap();
    for (project_id, project_number, app_id, enabled, count) in [
        ("demo-first", "42", "app-first", true, n),
        ("demo-second", "43", "app-second", false, 0),
    ] {
        registry
            .register_app(AppRegistration {
                project_id: project_id.into(),
                project_number: project_number.into(),
                app_id: app_id.into(),
                enabled,
                debug_token_digests: vec![DebugTokenDigest::from_bytes([0; 32]); count],
            })
            .unwrap();
        assert_eq!(registry.resolve_project(project_number), Some(project_id));
    }
    registry
}

fn selected(scope: &str, project: &str) -> bool {
    match scope {
        "none" => false,
        "first" => project == "demo-first",
        "second" => project == "demo-second",
        "both" => true,
        _ => panic!("unknown scope {scope}"),
    }
}

fn add(registry: &mut AppCheckRegistry, app: &str, label: &str, time: i128) -> String {
    let result = registry.add_debug_token(
        &format!("demo-{app}"),
        &format!("app-{app}"),
        label,
        DebugTokenDigest::from_bytes([0; 32]),
        LogicalInstant::from_nanos(time),
    );
    match result {
        Ok(created) => created.id,
        Err(RegistryError::TooManyDebugTokens) => "cap".into(),
        Err(other) => panic!("unexpected addition error {other:?}"),
    }
}

fn dynamic(records: &[DebugTokenRecord]) -> String {
    if records.is_empty() {
        return "-".into();
    }
    records
        .iter()
        .map(|record| {
            format!(
                "{}:{}:{}",
                record.id,
                record.display_name,
                record.created_at.as_nanos()
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn history(fields: [&str; 12], line: &str) {
    let [capture, restore, mutation, initial_count, before1, before2, changed, after1, after2, final1, final2, size] =
        fields;
    let initial_count = initial_count.parse().unwrap();
    let mut registry = settings(initial_count);
    let first = add(&mut registry, "first", "first-base", 1);
    assert_eq!(first, before1, "{line}");
    assert_eq!(
        add(&mut registry, "second", "second-base", 2),
        before2,
        "{line}"
    );
    let saved = registry.capture_dynamic_debug_tokens(|project| selected(capture, project));
    match mutation {
        "delete" => {
            let actual = registry.delete_debug_token("demo-first", "app-first", &first);
            let actual = match actual {
                Ok(()) => "deleted",
                Err(RegistryError::UnknownDebugToken) => "missing",
                Err(other) => panic!("unexpected deletion error {other:?}"),
            };
            assert_eq!(actual, changed, "{line}");
        }
        "clear" => {
            registry.clear_dynamic_debug_tokens("demo-first");
            assert_eq!(changed, "cleared", "{line}");
        }
        "retain" => assert_eq!(changed, "retained", "{line}"),
        _ => panic!("unknown mutation {mutation}"),
    }
    assert_eq!(
        add(&mut registry, "first", "first-post", 3),
        after1,
        "{line}"
    );
    assert_eq!(
        add(&mut registry, "second", "second-post", 4),
        after2,
        "{line}"
    );
    registry.restore_dynamic_debug_tokens(|project| selected(restore, project), &saved);
    for (app, expected) in [("first", final1), ("second", final2)] {
        let project = format!("demo-{app}");
        let app_id = format!("app-{app}");
        let tokens = registry.list_debug_tokens(&project, &app_id).unwrap();
        assert_eq!(dynamic(tokens), expected, "{line}");
    }
    assert_eq!(
        registry
            .app("demo-first", "app-first")
            .unwrap()
            .digest_count(),
        size.parse::<usize>().unwrap(),
        "{line}"
    );
}

fn issue_tag(result: Result<AppCheckClaims, RegistryError>) -> String {
    match result {
        Ok(claims) => claims.jti,
        Err(RegistryError::UnknownApp) => "unknown".into(),
        Err(RegistryError::NoEpoch) => "missing-epoch".into(),
        Err(RegistryError::AppDisabled) => "disabled".into(),
        Err(other) => panic!("unexpected issuance refusal {other:?}"),
    }
}

fn generation(fields: [&str; 9], line: &str) {
    let [app, initial_gen, before, first_gen, first, subsequent, next_gen, next, current] = fields;
    let project = format!("demo-{app}");
    let id = format!("app-{app}");
    let mut registry = settings(0);
    let time = LogicalInstant::from_nanos(0);
    assert_eq!(
        registry.policy_generation(&project),
        initial_gen.parse::<u64>().unwrap(),
        "{line}"
    );
    assert_eq!(
        issue_tag(registry.issue_claims(&project, &id, time)),
        before,
        "{line}"
    );
    registry.set_project_epoch(&project, ProjectEpoch::new(1));
    assert_eq!(
        registry.policy_generation(&project),
        first_gen.parse::<u64>().unwrap(),
        "{line}"
    );
    assert_eq!(
        issue_tag(registry.issue_claims(&project, &id, time)),
        first,
        "{line}"
    );
    assert_eq!(
        issue_tag(registry.issue_claims(&project, &id, time)),
        subsequent,
        "{line}"
    );
    registry.set_project_epoch(&project, ProjectEpoch::new(2));
    assert_eq!(
        registry.policy_generation(&project),
        next_gen.parse::<u64>().unwrap(),
        "{line}"
    );
    assert_eq!(
        issue_tag(registry.issue_claims(&project, &id, time)),
        next,
        "{line}"
    );
    assert_eq!(
        registry.project_epoch(&project).unwrap().claim_text(),
        current,
        "{line}"
    );
}

#[test]
fn app_check_registry_matches_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let count = lines
        .next()
        .unwrap()
        .strip_prefix("# cases ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert_eq!(count, lines.clone().count());
    assert_eq!(count, 147);
    for line in lines {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        match fields.as_slice() {
            ["history", fields @ ..] => history(fields.try_into().unwrap(), line),
            ["epoch", fields @ ..] => generation(fields.try_into().unwrap(), line),
            _ => panic!("malformed registry case {line}"),
        }
    }
}
