//! Replays cache observations and exact answer-window boundaries through the public core.

use fireemu_core_pubsub::rest_negative_cache::{
    ConnectionId, RestNegativeCache, RestOutcome, RestRequest, RestResource, RuleChoice,
    MAX_ENTRIES,
};
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};

const CORPUS: &str = include_str!("fixtures/lean-pubsub-rest-negative-cache.corpus");

fn scope(key: u64) -> (ConnectionId, RestResource) {
    let (connection, id) = (key / 10_000, key % 10_000);
    let (project, id) = if id == 4999 { ("q", 0) } else { ("p", id) };
    let path = format!("/v1/projects/{project}/subscriptions/sub-{id:04}");
    (
        ConnectionId::new(connection),
        RestResource::parse_path(&path).unwrap(),
    )
}

fn method(label: &str) -> RestRequest {
    match label {
        "get" => RestRequest::Get,
        "patch" => RestRequest::Patch,
        "delete" => RestRequest::Delete,
        "other" => RestRequest::Other,
        _ => panic!("unknown REST method {label}"),
    }
}

fn outcome(label: &str) -> RestOutcome {
    match label {
        "ok" => RestOutcome::Success,
        "missing" => RestOutcome::NotFound,
        "other" => RestOutcome::Other,
        _ => panic!("unknown REST outcome {label}"),
    }
}

fn filled() -> RestNegativeCache {
    assert_eq!(MAX_ENTRIES, 4096);
    let mut cache = RestNegativeCache::default();
    for key in 0..u64::try_from(MAX_ENTRIES).unwrap() {
        let (connection, resource) = scope(key);
        cache.observe(
            connection,
            &resource,
            RestRequest::Get,
            LogicalInstant::UNIX_EPOCH,
            RestOutcome::NotFound,
        );
    }
    cache
}

#[test]
fn replay_rest_cache() {
    let mut rows = CORPUS.lines();
    let count: usize = rows
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(rows.clone().count(), count);
    assert_eq!(count, 368);
    let mut cache = RestNegativeCache::default();
    let mut full = None;
    let mut traces = 0;
    for line in rows {
        let row: Vec<_> = line.split('\t').collect();
        match row.as_slice() {
            ["trace", exemption, _, _, ttl] => {
                traces += 1;
                cache = RestNegativeCache::new(RuleChoice {
                    ttl: LogicalDuration::from_nanos(ttl.parse().unwrap()),
                    recent_success_exempts: *exemption == "on",
                });
            }
            ["fill", len] => {
                cache = full.get_or_insert_with(filled).clone();
                assert_eq!(cache.len(), len.parse::<usize>().unwrap(), "{line}");
            }
            ["forget", connection, len] => {
                cache.forget_connection(ConnectionId::new(connection.parse().unwrap()));
                assert_eq!(cache.len(), len.parse::<usize>().unwrap(), "{line}");
            }
            ["observe", key, request, at, result, len] => {
                let (connection, resource) = scope(key.parse().unwrap());
                cache.observe(
                    connection,
                    &resource,
                    method(request),
                    LogicalInstant::from_nanos(at.parse().unwrap()),
                    outcome(result),
                );
                assert_eq!(cache.len(), len.parse::<usize>().unwrap(), "{line}");
            }
            ["probe", key, request, at, result, len] => {
                let (connection, resource) = scope(key.parse().unwrap());
                let actual = cache.serves(
                    connection,
                    &resource,
                    method(request),
                    LogicalInstant::from_nanos(at.parse().unwrap()),
                );
                assert_eq!(actual, *result == "hit", "{line}");
                assert_eq!(cache.len(), len.parse::<usize>().unwrap(), "{line}");
            }
            _ => panic!("malformed cache row: {line}"),
        }
    }
    assert_eq!(traces, 51);
}
