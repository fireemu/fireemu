//! Replays portable error classes and accept retry delays without a listener.

use std::io::{Error, ErrorKind};

use fireemu_adapter_support::accept::{backoff, classify, AcceptError};

fn kind(label: &str) -> ErrorKind {
    match label {
        "aborted" => ErrorKind::ConnectionAborted,
        "reset" => ErrorKind::ConnectionReset,
        "refused" => ErrorKind::ConnectionRefused,
        "interrupted" => ErrorKind::Interrupted,
        "down" => ErrorKind::NetworkDown,
        "network" => ErrorKind::NetworkUnreachable,
        "host" => ErrorKind::HostUnreachable,
        "memory" => ErrorKind::OutOfMemory,
        "blocked" => ErrorKind::WouldBlock,
        "permission" => ErrorKind::PermissionDenied,
        "other" => ErrorKind::Other,
        _ => panic!("unknown error kind {label}"),
    }
}

#[test]
fn portable_error_classes_and_bounded_backoff_match_lean() {
    let mut rows = include_str!("fixtures/lean-adapter-accept-backoff.corpus").lines();
    assert_eq!(rows.next(), Some("# tag|input|result"));
    let mut counts = [0, 0];
    for row in rows {
        let fields: Vec<_> = row.split('|').collect();
        let [tag, input, expected]: [&str; 3] = fields.try_into().unwrap();
        match tag {
            "error" => {
                let want = match expected {
                    "connection" => AcceptError::Connection,
                    "resources" => AcceptError::Resources,
                    "fatal" => AcceptError::Fatal,
                    _ => panic!("{row}"),
                };
                assert_eq!(classify(&Error::from(kind(input))), want, "{row}");
                counts[0] += 1;
            }
            "delay" => {
                assert_eq!(
                    backoff(input.parse().unwrap()).as_millis(),
                    expected.parse::<u128>().unwrap(),
                    "{row}"
                );
                counts[1] += 1;
            }
            _ => panic!("{row}"),
        }
    }
    assert_eq!(counts, [11, 67]);
}
