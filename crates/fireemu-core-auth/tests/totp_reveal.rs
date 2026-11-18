//! Revealing current TOTP codes for local development (owner decision ledger 2585): the
//! codes a developer would read from an authenticator app, computed from the store's own
//! policy and the logical clock. Verification is unchanged.

use fireemu_core_auth::mfa::TotpPolicy;
use fireemu_core_auth::store::{AuthStore, CredentialNotice, LocalId, NewUser, TotpCodePurpose};
use fireemu_core_auth::totp::{current_code, totp_at, TotpParams};
use fireemu_core_types::determinism::SplitMix64;
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};
use proptest::prelude::*;

fn store_with(policy: TotpPolicy) -> AuthStore {
    AuthStore::new("demo-app", SplitMix64::new(7), policy)
}

fn store() -> AuthStore {
    store_with(TotpPolicy::default())
}

fn t0() -> LogicalInstant {
    LogicalInstant::from_unix_seconds(1_788_004_860)
}

fn at(seconds: i64) -> LogicalInstant {
    t0().checked_add(LogicalDuration::from_seconds(seconds))
        .unwrap()
}

/// A user with one enrolled TOTP factor named `phone`; returns the uid and the secret.
fn enrolled(s: &mut AuthStore) -> (LocalId, Vec<u8>) {
    let uid = s
        .create_user(NewUser::email("totp@example.com"), t0())
        .unwrap();
    let material = s.start_totp_enrollment(&uid, t0()).unwrap();
    let secret = material.secret_for_test().to_vec();
    let code = totp_at(&secret, &s.policy().params(), t0());
    s.finalize_totp_enrollment_named(
        &uid,
        &material.session_id,
        code,
        Some("phone".to_owned()),
        t0(),
    )
    .unwrap();
    s.take_credential_notices();
    (uid, secret)
}

#[test]
fn current_code_is_zero_padded_and_counts_down_to_the_step_boundary() {
    let params = TotpParams {
        period_seconds: 30,
        digits: 8,
    };
    // RFC 6238 appendix B: T = 59 gives 94287082 with the ASCII secret.
    let (code, left) = current_code(
        b"12345678901234567890",
        &params,
        LogicalInstant::from_unix_seconds(59),
    );
    assert_eq!(code, "94287082");
    assert_eq!(left, 1);
    let (_, left) = current_code(
        b"12345678901234567890",
        &params,
        LogicalInstant::from_unix_seconds(60),
    );
    assert_eq!(left, 30);
    // A value with leading zeros keeps its width.
    let six = TotpParams {
        period_seconds: 30,
        digits: 6,
    };
    let padded = (0..2_000_i64)
        .map(|n| {
            current_code(
                b"12345678901234567890",
                &six,
                LogicalInstant::from_unix_seconds(n * 30),
            )
            .0
        })
        .find(|c| c.starts_with('0'))
        .expect("some step has a leading zero");
    assert_eq!(padded.len(), 6);
}

#[test]
fn enrolled_factor_code_is_listed_and_finishes_a_sign_in() {
    let mut s = store();
    let (uid, secret) = enrolled(&mut s);
    let later = at(95);
    let codes = s.totp_codes(later);
    assert_eq!(codes.len(), 1);
    let entry = &codes[0];
    assert_eq!(entry.uid, uid);
    assert_eq!(entry.display_name.as_deref(), Some("phone"));
    assert!(entry.mfa_enrollment_id.is_some());
    assert_eq!(
        entry.code,
        format!("{:06}", totp_at(&secret, &s.policy().params(), later))
    );
    assert_eq!(entry.seconds_remaining, 30 - (1_788_004_860 + 95) % 30);
    // The revealed code is what verification accepts.
    let pending = s.start_mfa_sign_in(&uid, later).unwrap();
    let id = entry.mfa_enrollment_id.clone().unwrap();
    let code: u32 = entry.code.parse().unwrap();
    assert!(s
        .finalize_mfa_sign_in_for_factor(&uid, &pending, &id, code, later)
        .is_ok());
}

#[test]
fn pending_enrollment_is_listed_until_it_expires_or_completes() {
    let mut s = store();
    let uid = s
        .create_user(NewUser::email("pending@example.com"), t0())
        .unwrap();
    let material = s.start_totp_enrollment(&uid, t0()).unwrap();
    let codes = s.totp_codes(t0());
    assert_eq!(codes.len(), 1);
    assert_eq!(codes[0].mfa_enrollment_id, None);
    let code: u32 = codes[0].code.parse().unwrap();
    assert_eq!(
        code,
        totp_at(material.secret_for_test(), &s.policy().params(), t0())
    );
    // Past the 900-second session lifetime it is gone.
    assert!(s.totp_codes(at(901)).is_empty());
    // A finalized session is not listed (only the enrolled factor is).
    s.finalize_totp_enrollment(&uid, &material.session_id, code, t0())
        .unwrap();
    let codes = s.totp_codes(t0());
    assert_eq!(codes.len(), 1);
    assert!(codes[0].mfa_enrollment_id.is_some());
}

#[test]
fn production_rules_keep_the_completed_session_but_it_is_not_listed() {
    let mut s = store();
    s.set_production_mfa(true);
    let (_, _) = enrolled(&mut s);
    let codes = s.totp_codes(t0());
    assert_eq!(codes.len(), 1);
    assert!(codes[0].mfa_enrollment_id.is_some());
}

#[test]
fn detached_secrets_are_not_listed() {
    let mut s = store();
    let (uid, _) = enrolled(&mut s);
    s.user_mut(&uid).unwrap().mfa.detach_totp_secrets();
    assert!(s.totp_codes(t0()).is_empty());
}

#[test]
fn custom_period_and_digits_are_used() {
    let policy = TotpPolicy {
        period_seconds: 60,
        digits: 8,
        ..TotpPolicy::default()
    };
    let mut s = store_with(policy);
    let (_, secret) = enrolled(&mut s);
    let codes = s.totp_codes(at(7));
    assert_eq!(codes[0].code.len(), 8);
    assert_eq!(
        codes[0].code,
        format!("{:08}", totp_at(&secret, &policy.params(), at(7)))
    );
    assert_eq!(codes[0].seconds_remaining, 60 - (1_788_004_860 + 7) % 60);
}

#[test]
fn enrollment_start_and_sign_in_challenge_announce_codes_without_the_secret() {
    let mut s = store();
    let uid = s
        .create_user(NewUser::email("log@example.com"), t0())
        .unwrap();
    let material = s.start_totp_enrollment(&uid, t0()).unwrap();
    let notices = s.take_credential_notices();
    assert_eq!(notices.len(), 1);
    let expected = format!(
        "{:06}",
        totp_at(material.secret_for_test(), &s.policy().params(), t0())
    );
    match &notices[0] {
        CredentialNotice::TotpCode {
            uid: who,
            code,
            purpose,
            mfa_enrollment_id,
            ..
        } => {
            assert_eq!(who, &uid);
            assert_eq!(code, &expected);
            assert_eq!(*purpose, TotpCodePurpose::Enrollment);
            assert_eq!(mfa_enrollment_id, &None);
        }
        other => panic!("unexpected notice {other:?}"),
    }
    let message = notices[0].message();
    assert!(message.contains(&expected), "{message}");
    assert!(message.contains("demo-app"), "{message}");
    assert!(message.contains(uid.as_str()), "{message}");
    assert!(!message.contains("otpauth"), "{message}");
    assert!(
        !message.contains(&fireemu_core_auth::base32::encode(
            material.secret_for_test()
        )),
        "{message}"
    );

    let code: u32 = expected.parse().unwrap();
    s.finalize_totp_enrollment_named(
        &uid,
        &material.session_id,
        code,
        Some("laptop".into()),
        t0(),
    )
    .unwrap();
    assert!(s.take_credential_notices().is_empty());
    s.start_mfa_sign_in(&uid, at(40)).unwrap();
    let notices = s.take_credential_notices();
    assert_eq!(notices.len(), 1);
    let message = notices[0].message();
    assert!(matches!(
        &notices[0],
        CredentialNotice::TotpCode {
            purpose: TotpCodePurpose::SignIn,
            mfa_enrollment_id: Some(_),
            ..
        }
    ));
    assert!(message.contains("laptop"), "{message}");
    assert!(message.contains("left"), "{message}");
}

/// The owner's repro (2026-11-18): with the clock standing still, the code used to enroll is the
/// code the sign-in challenge reveals, and verification refuses it as already used. The reveal
/// says so and how to get a fresh code instead of a countdown that never runs out.
#[test]
fn a_still_clock_reveals_the_used_enrollment_code_as_used_with_how_to_move_on() {
    let mut s = store();
    s.set_totp_clock_running(false);
    let (uid, secret) = enrolled(&mut s);
    let codes = s.totp_codes(t0());
    assert_eq!(codes.len(), 1);
    assert!(codes[0].already_used);
    s.start_mfa_sign_in(&uid, t0()).unwrap();
    let notices = s.take_credential_notices();
    assert_eq!(notices.len(), 1);
    let message = notices[0].message();
    let used = format!("{:06}", totp_at(&secret, &s.policy().params(), t0()));
    assert!(message.contains(&used), "{message}");
    assert!(message.contains("already used"), "{message}");
    assert!(!message.contains("s left"), "{message}");
    assert!(
        message.contains("advance the clock by 30 seconds"),
        "{message}"
    );
    assert!(
        message.contains(r#"POST /v1/sessions/default/clock:advance with {"seconds": 30}"#),
        "{message}"
    );
    assert!(!message.contains("or wait"), "{message}");
    // Verification is unchanged: the revealed code is refused as replayed.
    let pending = s.start_mfa_sign_in(&uid, t0()).unwrap();
    let id = codes[0].mfa_enrollment_id.clone().unwrap();
    assert!(s
        .finalize_mfa_sign_in_for_factor(&uid, &pending, &id, used.parse().unwrap(), t0())
        .is_err());
    // One step later the code is fresh again and the countdown is gone only while still.
    let next = at(30);
    let fresh = &s.totp_codes(next)[0];
    assert!(!fresh.already_used);
    s.take_credential_notices();
    s.start_mfa_sign_in(&uid, next).unwrap();
    let message = s.take_credential_notices()[0].message();
    assert!(message.contains(&fresh.code), "{message}");
    assert!(!message.contains("already used"), "{message}");
    assert!(!message.contains("s left"), "{message}");
    assert!(
        message.contains("stays the same until the clock moves"),
        "{message}"
    );
}

#[test]
fn a_running_clock_reveals_a_used_code_with_the_wait_and_keeps_the_countdown_otherwise() {
    let mut s = store();
    assert!(s.totp_clock_running());
    let (uid, _) = enrolled(&mut s);
    s.start_mfa_sign_in(&uid, t0()).unwrap();
    let message = s.take_credential_notices()[0].message();
    // t0 is a step boundary, so the whole period is left.
    let left = 30;
    assert!(message.contains("already used"), "{message}");
    assert!(
        message.contains(&format!("wait {left} seconds")),
        "{message}"
    );
    s.start_mfa_sign_in(&uid, at(30)).unwrap();
    let message = s.take_credential_notices()[0].message();
    assert!(message.ends_with("s left)."), "{message}");
    assert!(!message.contains("already used"), "{message}");
}

#[test]
fn phone_only_sign_in_announces_no_totp_code() {
    let mut s = store();
    let uid = s
        .create_user(NewUser::email("sms@example.com"), t0())
        .unwrap();
    s.enroll_phone_factor(&uid, "+15559876543", None, t0())
        .unwrap();
    s.start_mfa_sign_in(&uid, t0()).unwrap();
    assert!(s
        .take_credential_notices()
        .iter()
        .all(|n| !matches!(n, CredentialNotice::TotpCode { .. })));
}

#[test]
fn reveal_off_announces_nothing_and_lists_nothing() {
    let mut s = store();
    s.set_reveal_totp_codes(false);
    assert!(!s.reveal_totp_codes());
    let uid = s
        .create_user(NewUser::email("off@example.com"), t0())
        .unwrap();
    s.start_totp_enrollment(&uid, t0()).unwrap();
    assert!(s.take_credential_notices().is_empty());
    assert!(s.totp_codes(t0()).is_empty());
}

#[test]
fn reveal_is_on_by_default() {
    assert!(store().reveal_totp_codes());
}

proptest! {
    #[test]
    fn current_code_matches_totp_at_and_its_window(
        secret in proptest::collection::vec(any::<u8>(), 1..40),
        period in 1_u32..120,
        digits in 6_u8..=8,
        seconds in 0_i64..4_000_000_000,
    ) {
        let params = TotpParams { period_seconds: period, digits };
        let now = LogicalInstant::from_unix_seconds(seconds);
        let (code, left) = current_code(&secret, &params, now);
        prop_assert_eq!(code.len(), usize::from(digits));
        prop_assert_eq!(code.parse::<u32>().unwrap(), totp_at(&secret, &params, now));
        prop_assert!(left >= 1 && left <= period);
        // The code holds for `left` seconds and changes step right after.
        let last = LogicalInstant::from_unix_seconds(seconds + i64::from(left) - 1);
        prop_assert_eq!(totp_at(&secret, &params, last), totp_at(&secret, &params, now));
        let next = LogicalInstant::from_unix_seconds(seconds + i64::from(left));
        let (_, next_left) = current_code(&secret, &params, next);
        prop_assert_eq!(next_left, period);
    }
}

#[test]
fn an_enrollment_is_listed_through_its_last_accepted_instant() {
    let mut s = store();
    let uid = s
        .create_user(NewUser::email("edge@example.com"), t0())
        .unwrap();
    let material = s.start_totp_enrollment(&uid, t0()).unwrap();
    let last = material.expires_at;
    let codes = s.totp_codes(last);
    assert_eq!(
        codes.len(),
        1,
        "finalize still accepts at the expiry instant"
    );
    let code: u32 = codes[0].code.parse().unwrap();
    assert!(s
        .finalize_totp_enrollment(&uid, &material.session_id, code, last)
        .is_ok());
}

#[test]
fn a_sign_in_announces_only_its_own_factor_and_names_an_unnamed_factor_by_id() {
    let mut s = store();
    let (first, _) = enrolled(&mut s);
    let second = s
        .create_user(NewUser::email("other@example.com"), t0())
        .unwrap();
    let material = s.start_totp_enrollment(&second, t0()).unwrap();
    let code = totp_at(material.secret_for_test(), &s.policy().params(), t0());
    s.finalize_totp_enrollment(&second, &material.session_id, code, t0())
        .unwrap();
    s.take_credential_notices();
    let id = s.user(&second).unwrap().mfa.totp_factors()[0]
        .mfa_enrollment_id
        .clone();
    s.start_mfa_sign_in(&second, at(60)).unwrap();
    let notices = s.take_credential_notices();
    assert_eq!(notices.len(), 1, "{notices:?}");
    let message = notices[0].message();
    assert!(message.contains(second.as_str()), "{message}");
    assert!(!message.contains(first.as_str()), "{message}");
    assert!(message.contains(&format!(" factor {id},")), "{message}");
}
