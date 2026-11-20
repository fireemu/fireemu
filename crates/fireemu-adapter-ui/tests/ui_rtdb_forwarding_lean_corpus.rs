//! Differential replay of socket-free RTDB forwarding plans.

use fireemu_adapter_ui::{
    database::{prepare, DatabaseEndpoint},
    UiRequest, MAX_JSON_BODY_BYTES,
};
use std::collections::BTreeMap;

const CORPUS: &str = include_str!("fixtures/lean-ui-rtdb-forwarding.corpus");

fn endpoint(address: &str) -> DatabaseEndpoint {
    DatabaseEndpoint {
        address: address.parse().expect("local test address"),
        project: "demo-app".into(),
        configured_instances: BTreeMap::from([
            ("named".into(), "demo-app".into()),
            ("named-other".into(), "other".into()),
            ("overridden-default-rtdb".into(), "demo-app".into()),
        ]),
    }
}

#[test]
fn request_preparation_matches_lean() {
    let mut lines = CORPUS.lines();
    let declared: usize = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases"))
        .expect("case count")
        .parse()
        .expect("numeric count");
    assert_eq!(declared, lines.clone().count());
    assert!(declared > 675);
    let endpoint = endpoint("0.0.0.0:19000");
    let sessions = BTreeMap::from([("default".into(), "demo-app".into())]);
    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        match fields.as_slice() {
            ["route", action, method, body, _, query, result @ ..] => {
                let body = match *body {
                    "empty" => Vec::new(),
                    "present" => b" -0 ".to_vec(),
                    "tooLarge" => vec![b'0'; MAX_JSON_BODY_BYTES + 1],
                    _ => panic!("invalid body kind: {line}"),
                };
                let request = UiRequest {
                    method: (*method).into(),
                    query: (*query).into(),
                    body,
                    ..UiRequest::default()
                };
                match result {
                    ["ok", session, project, namespace, target, administrator] => {
                        let plan = prepare(&endpoint, &sessions, action, &request)
                            .unwrap_or_else(|e| panic!("{line}: {}", e.status));
                        assert_eq!(plan.session, *session, "{line}");
                        assert_eq!(plan.project, *project, "{line}");
                        assert_eq!(
                            plan.namespace.as_deref().unwrap_or("-"),
                            *namespace,
                            "{line}"
                        );
                        assert_eq!(plan.target, *target, "{line}");
                        assert_eq!(plan.administrator, *administrator == "true", "{line}");
                        assert_eq!(plan.body, request.body, "{line}");
                    }
                    ["err", status, message] => {
                        let refusal =
                            prepare(&endpoint, &sessions, action, &request).expect_err(line);
                        assert_eq!(
                            refusal.status,
                            status.parse::<u16>().expect("status"),
                            "{line}"
                        );
                        let body = refusal.body_json().expect("error body");
                        assert_eq!(body["error"]["message"].as_str(), Some(*message), "{line}");
                    }
                    _ => panic!("invalid outcome: {line}"),
                }
            }
            ["loopback", address, expected] => {
                assert_eq!(
                    crate::endpoint(address).loopback().to_string(),
                    *expected,
                    "{line}"
                );
            }
            ["owner", instance, expected] => {
                assert_eq!(endpoint.project_of(instance), *expected, "{line}");
            }
            _ => panic!("invalid case: {line}"),
        }
    }
}
