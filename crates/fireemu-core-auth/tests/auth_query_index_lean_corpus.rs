//! Replay exact Auth predicates across tracked and unrestricted account mutations.

use fireemu_core_auth::claims::CustomClaims;
use fireemu_core_auth::mfa::TotpPolicy;
use fireemu_core_auth::store::{
    AuthStore, ImportedUser, NewUser, Provider, UserQueryExpression as Expr, UserSortField,
};
use fireemu_core_types::{determinism::SplitMix64, time::LogicalInstant};

const CORPUS: &str = include_str!("fixtures/lean-auth-query-index.corpus");
const NOW: LogicalInstant = LogicalInstant::UNIX_EPOCH;
const PHONE1: &str = "+12025550001";
const PHONE2: &str = "+12025550002";
const PHONE3: &str = "+12025550003";

fn import(store: &mut AuthStore, id: &str, email: Option<&str>, phone: Option<&str>, name: &str) {
    store
        .import_user_trusted(ImportedUser {
            local_id: id.to_owned(),
            email: email.map(str::to_owned),
            email_verified: false,
            display_name: Some(name.to_owned()),
            photo_url: None,
            phone_number: phone.map(str::to_owned),
            disabled: false,
            provider: Provider::Anonymous,
            custom_claims: CustomClaims::default(),
            created_at: NOW,
            last_refresh_at: None,
            last_sign_in_at: None,
            tokens_valid_after: NOW,
            federated: Vec::new(),
            password: None,
            imported_password: None,
            allow_shared_email: true,
            totp_factors: Vec::new(),
            phone_factors: Vec::new(),
        })
        .expect("valid trusted artifact row");
}

fn populate(store: &mut AuthStore, tenant: bool) {
    if tenant {
        import(store, "a", Some("USER@example.com"), Some(PHONE2), "Zed");
    } else {
        import(store, "a", Some("ΟΣ@example.com"), Some(PHONE1), "Zed");
        import(store, "b", Some("ος@example.com"), Some(PHONE1), "Amy");
        import(
            store,
            "c",
            Some("\u{212a}İ@example.com"),
            Some(PHONE2),
            "Amy",
        );
    }
    for n in 0..32 {
        import(store, &format!("x{n:02}"), None, None, "zz");
    }
}

fn store(stage: &str, scope: &str) -> AuthStore {
    let tenant = scope == "tenant";
    let rng = SplitMix64::new(58);
    let policy = TotpPolicy::default();
    let mut store = if tenant {
        AuthStore::new_tenant("demo-query", "query-tenant", rng, policy)
    } else {
        AuthStore::new("demo-query", rng, policy)
    };
    populate(&mut store, tenant);
    if !tenant {
        let key = store.user_by_id("a").unwrap().local_id.clone();
        match stage {
            "tracked" => {
                store.delete_user_by_id("b").unwrap();
                store.set_email(&key, "USER@example.com").unwrap();
                store.set_phone_number(&key, Some(PHONE3)).unwrap();
            }
            "raw" | "cloned" | "reset" => {
                let replacement = store
                    .create_user_with_id(NewUser::anonymous(), Some("other"), NOW)
                    .unwrap();
                store.delete_user_by_id("other").unwrap();
                let record = store.user_mut(&key).unwrap();
                record.local_id = replacement;
                record.email = Some("\u{212a}İ@example.com".to_owned());
                record.phone_number = Some(PHONE2.to_owned());
                if stage == "cloned" {
                    let snapshot = store.clone();
                    store.clear();
                    populate(&mut store, false);
                    return snapshot;
                }
                if stage == "reset" {
                    store.clear();
                    populate(&mut store, false);
                }
            }
            "clean" => {}
            _ => panic!("unexpected stage {stage}"),
        }
    }
    store
}

fn filter(label: &str) -> Vec<Expr> {
    use Expr::{Email, PhoneNumber, UserId};

    match label {
        "all" => Vec::new(),
        "sigma" => vec![Email("ΟΣ@example.com".into())],
        "medial" => vec![Email("οσ@example.com".into())],
        "kelvin" => vec![Email("KI\u{307}@EXAMPLE.COM".into())],
        "ascii" => vec![Email("USER@example.com".into())],
        "phone" => vec![PhoneNumber(PHONE1.into())],
        "changedPhone" => vec![PhoneNumber(PHONE2.into())],
        "rawId" => vec![UserId("other".into())],
        "mixed" => vec![
            Email("ΟΣ@example.com".into()),
            PhoneNumber(PHONE2.into()),
            UserId("a".into()),
            UserId("a".into()),
        ],
        "miss" => vec![UserId("A".into())],
        _ => panic!("unexpected predicate {label}"),
    }
}

#[test]
fn exact_auth_queries_follow_record_values_and_return_every_owner() {
    let stores: std::collections::BTreeMap<_, _> = ["clean", "raw", "cloned", "tracked", "reset"]
        .into_iter()
        .flat_map(|stage| {
            ["root", "tenant"]
                .into_iter()
                .map(move |scope| ((stage, scope), store(stage, scope)))
        })
        .collect();
    let mut lines = CORPUS.lines();
    assert_eq!(
        lines.next(),
        Some("# stage|scope|predicate|sort|direction|page|count|ids")
    );
    assert_eq!(lines.clone().count(), 1_600);
    for line in lines {
        let row: Vec<_> = line.split('|').collect();
        let [stage, scope, label, field, direction, page, count, ids] = row.as_slice() else {
            panic!("malformed fixture {line}");
        };
        let store = &stores[&(*stage, *scope)];
        let field = if *field == "id" {
            UserSortField::LocalId
        } else {
            UserSortField::Name
        };
        let (offset, limit) = match *page {
            "first" => (0, 2),
            "second" => (1, 2),
            "none" => (0, 0),
            "all" => (0, 1_000),
            _ => panic!("unexpected page {page}"),
        };
        let expressions = filter(label);
        assert_eq!(
            store.matching_user_count(&expressions),
            count.parse().unwrap(),
            "{line}"
        );
        let result = store.users_matching_sorted_page(
            &expressions,
            field,
            offset,
            limit,
            *direction == "desc",
        );
        let actual: Vec<_> = result.iter().map(|user| user.local_id.as_str()).collect();
        let expected: Vec<_> = if *ids == "-" {
            Vec::new()
        } else {
            ids.split(',').collect()
        };
        assert_eq!(actual, expected, "{line}");
    }
}

fn scan_matches(user: &fireemu_core_auth::store::UserRecord, expressions: &[Expr]) -> bool {
    expressions.is_empty()
        || expressions.iter().any(|expr| match expr {
            Expr::Email(raw) => user
                .email
                .as_ref()
                .is_some_and(|email| email.to_lowercase() == raw.to_lowercase()),
            Expr::PhoneNumber(raw) => user.phone_number.as_ref() == Some(raw),
            Expr::UserId(raw) => user.local_id.as_str() == raw,
        })
}

proptest::proptest! {
    #[test]
    fn query_plan_matches_a_full_scan_for_arbitrary_unions(
        stage in proptest::sample::select(vec!["clean", "raw", "tracked", "reset"]),
        scope in proptest::sample::select(vec!["root", "tenant"]),
        user_ids in proptest::collection::vec(0usize..8, 0..8),
        direction in proptest::bool::ANY,
        by_name in proptest::bool::ANY,
        offset in 0usize..38,
        limit in 0usize..38,
    ) {
        let store = store(stage, scope);
        let selectors = [
            Expr::Email("ΟΣ@example.com".into()),
            Expr::Email("οσ@example.com".into()),
            Expr::Email("KI\u{307}@example.com".into()),
            Expr::Email("user@example.com".into()),
            Expr::PhoneNumber(PHONE1.into()),
            Expr::PhoneNumber(PHONE2.into()),
            Expr::UserId("a".into()),
            Expr::UserId("other".into()),
        ];
        let expressions: Vec<_> = user_ids.into_iter().map(|id| selectors[id].clone()).collect();
        let mut expected: Vec<_> = store.users_by_local_id_page(0, usize::MAX, false)
            .into_iter()
            .filter(|user| scan_matches(user, &expressions))
            .collect();
        let field = if by_name {
            expected.sort_by(|a, b| {
                let name_order = a.display_name.cmp(&b.display_name);
                let ordered = if direction { name_order.reverse() } else { name_order };
                ordered.then_with(|| a.local_id.cmp(&b.local_id))
            });
            UserSortField::Name
        } else {
            if direction {
                expected.reverse();
            }
            UserSortField::LocalId
        };
        proptest::prop_assert_eq!(store.matching_user_count(&expressions), expected.len());
        let expected: Vec<_> = expected.into_iter().skip(offset).take(limit).collect();
        let actual = store.users_matching_sorted_page(&expressions, field, offset, limit, direction);
        proptest::prop_assert_eq!(actual, expected);
    }
}
