//! Replays the Pub/Sub name contract independently modeled in Lean.

use fireemu_core_pubsub::name::{
    validate_project, validate_resource_id, SubscriptionName, TopicName,
};
use fireemu_core_pubsub::{Code, Result};

const CORPUS: &str = include_str!("fixtures/lean-pubsub-names.corpus");

fn code_points(text: &str) -> String {
    if text == "-" {
        return String::new();
    }
    text.split(',')
        .map(|point| char::from_u32(point.parse().unwrap()).unwrap())
        .collect()
}

fn check_validity<T>(result: Result<T>, expected: &str) {
    match (result, expected) {
        (Ok(_), "-") => (),
        (Err(error), expected) => {
            assert_eq!(error.code(), Code::InvalidArgument);
            assert_eq!(error.message(), expected);
        }
        (Ok(_), expected) => panic!("expected name refusal: {expected}"),
    }
}

fn check_full(kind: &str, full: &str, expected: &str) {
    let parsed = match kind {
        "topic" => TopicName::parse(full).map(|name| name.to_full()),
        "subscription" => SubscriptionName::parse(full).map(|name| name.to_full()),
        _ => panic!("unexpected full name kind: {kind}"),
    };
    if expected == "yes" {
        assert_eq!(parsed.unwrap(), full);
    } else {
        let error = parsed.unwrap_err();
        assert_eq!(error.code(), Code::InvalidArgument);
        assert_eq!(error.message(), format!("Invalid resource name given (name={full}). Refer to https://cloud.google.com/pubsub/docs/pubsub-basics#resource_names for more information."));
    }
}

#[test]
fn replay_names() {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(count, 177);
    assert_eq!(lines.clone().count(), count);
    for line in lines {
        let row = line.split('\t').collect::<Vec<_>>();
        match row.as_slice() {
            ["parts", kind, _, _, project, id, project_expected, id_expected, full_expected] => {
                let project = code_points(project);
                let id = code_points(id);
                check_validity(validate_project(&project), project_expected);
                check_validity(validate_resource_id(&id, kind), id_expected);
                if *kind != "snapshot" {
                    check_full(
                        kind,
                        &format!("projects/{project}/{kind}s/{id}"),
                        full_expected,
                    );
                }
            }
            ["wire", kind, wire, expected] => check_full(kind, &code_points(wire), expected),
            _ => panic!("malformed names row: {line}"),
        }
    }
}
