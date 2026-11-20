//! Replays a Lean full-sort model against the bounded administrator page API.

use fireemu_core_auth::mfa::TotpPolicy;
use fireemu_core_auth::store::{AuthStore, NewUser, UserQueryExpression, UserSortField};
use fireemu_core_types::{determinism::SplitMix64, time::LogicalInstant};

const CORPUS: &str = include_str!("fixtures/lean-auth-user-pagination.corpus");
const PHONE: &str = "+12025550111";

struct Example {
    id: &'static str,
    name: Option<&'static str>,
    email: Option<&'static str>,
    nanos: i128,
    login: Option<i128>,
}

fn users() -> AuthStore {
    let mut store = AuthStore::new("demo", SplitMix64::new(42), TotpPolicy::default());
    for example in [
        Example {
            id: "g",
            name: Some("Alpha"),
            email: Some("g@x.test"),
            nanos: 3_000_100,
            login: Some(0),
        },
        Example {
            id: "f",
            name: Some("Zed"),
            email: Some("f@x.test"),
            nanos: 3_000_000,
            login: Some(9_000_000),
        },
        Example {
            id: "e",
            name: Some("other"),
            email: None,
            nanos: 0,
            login: Some(-999_999),
        },
        Example {
            id: "d",
            name: Some("Alpha"),
            email: Some("d@x.test"),
            nanos: 1_000_000,
            login: Some(1_999_999),
        },
        Example {
            id: "c",
            name: Some("same"),
            email: Some("c@x.test"),
            nanos: 1_999_999,
            login: Some(1_000_000),
        },
        Example {
            id: "b",
            name: None,
            email: None,
            nanos: -1_999_999,
            login: Some(1_999_999),
        },
        Example {
            id: "a",
            name: Some("same"),
            email: Some("a@x.test"),
            nanos: -2_500_000,
            login: None,
        },
    ] {
        let record = example
            .email
            .map_or_else(NewUser::anonymous, NewUser::email);
        let id = store
            .create_user_with_id(
                record,
                Some(example.id),
                LogicalInstant::from_nanos(example.nanos),
            )
            .unwrap();
        if example.id == "d" {
            store.set_phone_number(&id, Some(PHONE)).unwrap();
        }
        let record = store.user_mut(&id).unwrap();
        record.display_name = example.name.map(str::to_owned);
        record.last_sign_in_at = example.login.map(LogicalInstant::from_nanos);
    }
    store
}

fn filter(tag: &str) -> Vec<UserQueryExpression> {
    use UserQueryExpression::{Email, PhoneNumber, UserId};
    match tag {
        "all" => Vec::new(),
        "miss" => vec![UserId("A".into())],
        "overlap" => vec![
            UserId("a".into()),
            UserId("b".into()),
            Email("A@X.TEST".into()),
            PhoneNumber(PHONE.into()),
            UserId("b".into()),
        ],
        "case" => vec![Email("G@X.tEsT".into())],
        "phone" => vec![PhoneNumber(PHONE.into())],
        _ => panic!("unknown filter {tag}"),
    }
}

fn bound(input: &str) -> usize {
    if input == "max" {
        usize::MAX
    } else {
        input.parse().unwrap()
    }
}

#[test]
fn bounded_auth_pages_match_the_lean_full_sort() {
    let store = users();
    let mut lines = CORPUS.lines();
    let count = lines
        .next()
        .unwrap()
        .strip_prefix("# cases ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert_eq!(count, lines.clone().count());
    assert_eq!(count, 1250);
    for line in lines {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        let ["page", field, direction, group, offset, limit, matching, expected] =
            fields.as_slice()
        else {
            panic!("malformed page {line}");
        };
        let field = match *field {
            "id" => UserSortField::LocalId,
            "name" => UserSortField::Name,
            "email" => UserSortField::Email,
            "created" => UserSortField::CreatedAt,
            "login" => UserSortField::LastLoginAt,
            _ => panic!("unknown field {field}"),
        };
        let expressions = filter(group);
        let offset = bound(offset);
        let limit = bound(limit);
        let descending = *direction == "desc";
        assert_eq!(
            store.matching_user_count(&expressions),
            matching.parse::<usize>().unwrap(),
            "{line}"
        );
        let expected = if *expected == "-" {
            Vec::new()
        } else {
            expected.split(',').collect()
        };
        let page = store.users_matching_sorted_page(&expressions, field, offset, limit, descending);
        let ids = page
            .iter()
            .map(|user| user.local_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, expected, "{line}");
        if expressions.is_empty() {
            assert_eq!(
                page,
                store.users_sorted_page(field, offset, limit, descending),
                "{line}"
            );
            if field == UserSortField::LocalId {
                assert_eq!(
                    page,
                    store.users_by_local_id_page(offset, limit, descending),
                    "{line}"
                );
            }
        }
    }
}
