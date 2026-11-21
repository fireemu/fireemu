//! Boundary tests for retention reporting and quiescence allowances.

use fireemu_core_types::resources::{
    assert_quiescent, AllowedRoot, RetentionRoot, RootBudget, ServiceResources,
};

fn root(kind: &str, id: &str) -> RetentionRoot {
    RetentionRoot {
        kind: kind.to_owned(),
        id: id.to_owned(),
        count: 1,
        bytes: 0,
        outstanding: true,
    }
}

#[test]
fn omitting_one_retention_root_marks_the_report_as_truncated() {
    let retained = root("transaction", "tx-7");
    let omitted = root("transaction", "tx-8");
    let report = RootBudget { max_roots: 1 }.bound(vec![retained.clone(), omitted]);
    assert_eq!(report.roots, vec![retained]);
    assert_eq!(report.total, 2);
    assert!(report.truncated);
}

#[test]
fn quiescence_allowances_require_the_same_service_kind_and_identifier() {
    let transaction = root("transaction", "tx-7");
    let service = ServiceResources {
        service: "firestore".to_owned(),
        gauges: Vec::new(),
        refusals: Vec::new(),
        roots: RootBudget::DEFAULT.bound(vec![transaction.clone()]),
    };
    let services = [service];
    for name in ["firestore", "functions"] {
        for kind in ["transaction", "listener"] {
            for id in ["tx-7", "tx-8"] {
                let allowance = AllowedRoot {
                    service: name.to_owned(),
                    kind: kind.to_owned(),
                    id: id.to_owned(),
                    reason: "work allowed by the caller".to_owned(),
                };
                let verdict = assert_quiescent(&services, std::slice::from_ref(&allowance));
                if (name, kind, id) == ("firestore", "transaction", "tx-7") {
                    assert_eq!(verdict, Ok(()));
                    continue;
                }
                let failure = verdict.unwrap_err();
                assert_eq!(
                    failure.leaks,
                    vec![("firestore".to_owned(), transaction.clone())]
                );
                assert_eq!(failure.stale_allowances, vec![allowance]);
                assert!(failure.truncated_services.is_empty());
            }
        }
    }
}
