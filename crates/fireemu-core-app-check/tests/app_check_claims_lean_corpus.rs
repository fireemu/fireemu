//! Replays Lean claim arithmetic and admission over already-classified synthetic input.

use fireemu_core_app_check::claims::unix_seconds;
use fireemu_core_app_check::{
    AdmissionDecision, AppCheckClaims, AppCheckCredentialState, AppCheckFailure, AppCheckRegistry,
    AppIdentity, AppRegistration, BaselineMode, ProjectEpoch, RegistryError, TokenClass,
};
use fireemu_core_types::time::LogicalInstant;

const CORPUS: &str = include_str!("fixtures/lean-app-check-claims.corpus");

fn setup() -> AppCheckRegistry {
    let mut registry = AppCheckRegistry::new(3600).unwrap();
    for (project_id, project_number, app_id) in [
        ("demo-first", "42", "app-alpha"),
        ("demo-second", "123456789", "app-beta"),
    ] {
        registry
            .register_app(AppRegistration {
                project_id: project_id.into(),
                project_number: project_number.into(),
                app_id: app_id.into(),
                enabled: true,
                debug_token_digests: Vec::new(),
            })
            .unwrap();
    }
    registry
}

fn check_issued(registry: &AppCheckRegistry, fields: [&str; 13], line: &str) {
    let [_, _, app, time, requested, start_seconds, expiry_seconds, reported, issuer, number_aud, id_aud, subject, epoch] =
        fields;
    let now = LogicalInstant::from_nanos(time.parse().unwrap());
    assert_eq!(
        unix_seconds(now),
        start_seconds.parse::<i64>().unwrap(),
        "{line}"
    );
    let (project, id, epoch_value, jti) = match app {
        "first" => ("demo-first", "app-alpha", 0x10_u128, "fixed-one"),
        "second" => ("demo-second", "app-beta", u128::MAX, "fixed-two"),
        _ => panic!("unknown app {app}"),
    };
    let app = registry.app(project, id).unwrap();
    let claims = AppCheckClaims::issue(
        app,
        ProjectEpoch::new(epoch_value),
        jti.into(),
        now,
        requested.parse().unwrap(),
    );
    assert_eq!(claims.iat, start_seconds.parse::<i64>().unwrap(), "{line}");
    assert_eq!(claims.exp, expiry_seconds.parse::<i64>().unwrap(), "{line}");
    assert_eq!(
        claims.ttl_seconds(),
        reported.parse::<i64>().unwrap(),
        "{line}"
    );
    assert_eq!(claims.iss, issuer, "{line}");
    assert_eq!(claims.sub, subject, "{line}");
    assert_eq!(claims.aud, [number_aud, id_aud], "{line}");
    assert_eq!(claims.fireemu_epoch, epoch, "{line}");
    assert_eq!(claims.jti, jti, "{line}");
}

fn failure(code: &str) -> AppCheckFailure {
    match code {
        "malformed" => AppCheckFailure::Malformed,
        "algorithm" => AppCheckFailure::UnsupportedAlgorithm,
        "key" => AppCheckFailure::UnknownKeyId,
        "signature" => AppCheckFailure::BadSignature,
        "future" => AppCheckFailure::NotYetValid,
        "expired" => AppCheckFailure::Expired,
        "issuer" => AppCheckFailure::WrongIssuer,
        "audience" => AppCheckFailure::WrongAudience,
        "unknown_app" => AppCheckFailure::UnknownApp,
        "disabled" => AppCheckFailure::AppDisabled,
        "project" => AppCheckFailure::WrongProject,
        "epoch" => AppCheckFailure::WrongEpoch,
        _ => panic!("unexpected failure {code}"),
    }
}

fn check_admission(fields: [&str; 6], line: &str) {
    let [mode, state, reason, allowed, public_reason, visible] = fields;
    let mode = BaselineMode::parse_config(mode).unwrap();
    let example = AppIdentity {
        app_id: "app-alpha".into(),
        project_id: "demo-first".into(),
        project_number: "42".into(),
        issued_at: LogicalInstant::from_unix_seconds(0),
        expires_at: LogicalInstant::from_unix_seconds(3600),
        token_id: "fixed-one".into(),
        token_class: TokenClass::Session,
    };
    let state = match state {
        "missing" => AppCheckCredentialState::Missing,
        "bypass" => AppCheckCredentialState::Bypass,
        "valid" => AppCheckCredentialState::Valid(example.clone()),
        "invalid" => AppCheckCredentialState::Invalid(failure(reason)),
        _ => panic!("unexpected state {state}"),
    };
    let decision = AdmissionDecision::decide(mode, state.clone());
    assert_eq!(decision.mode, mode, "{line}");
    assert_eq!(decision.state, state, "{line}");
    assert_eq!(decision.allowed, allowed == "yes", "{line}");
    assert_eq!(
        decision.reason,
        (public_reason != "-").then_some(public_reason),
        "{line}"
    );
    assert_eq!(
        decision.identity(),
        (visible == "yes").then_some(&example),
        "{line}"
    );
}

#[test]
fn app_check_claims_and_admission_match_the_lean_corpus() {
    let registry = setup();
    let mut lines = CORPUS.lines();
    let declared = lines
        .next()
        .unwrap()
        .strip_prefix("# cases ")
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert_eq!(declared, lines.clone().count());
    assert_eq!(declared, 246);
    for line in lines {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        match fields.as_slice() {
            ["issue", rest @ ..] => check_issued(&registry, rest.try_into().unwrap(), line),
            ["admission", rest @ ..] => check_admission(rest.try_into().unwrap(), line),
            ["config", ttl, result] => {
                let ttl = ttl.parse().unwrap();
                match AppCheckRegistry::new(ttl) {
                    Ok(registry) => {
                        assert_eq!(*result, "accepted", "{line}");
                        assert_eq!(registry.token_ttl_seconds(), ttl, "{line}");
                        assert_eq!(
                            registry.token_ttl().as_nanos(),
                            i128::from(ttl) * 1_000_000_000,
                            "{line}"
                        );
                    }
                    Err(error) => {
                        assert_eq!(error, RegistryError::InvalidTokenTtl, "{line}");
                        assert_eq!(*result, "invalid", "{line}");
                    }
                }
            }
            _ => panic!("malformed App Check case {line}"),
        }
    }
}
