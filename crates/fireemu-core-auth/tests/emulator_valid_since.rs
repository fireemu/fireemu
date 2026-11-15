//! The emulator profile's `validSince` bound history, against a reference model written from
//! firebase-tools 15.28.2 only (`lib/emulator/auth/operations.js`):
//!
//! - `parseIdToken` (`:1727`): `!user.validSince || iat >= Number(user.validSince)`.
//! - A setter assigns the current Unix second, never a maximum: a password at sign-up
//!   (`:169`), a password, email or `validSince` update (`:861-862`), a password reset
//!   (`:634`), a verified identity provider taking over an unverified account (`:2019`) and a
//!   batch import (`:341`, the upload second). A privileged `validSince` is then copied over
//!   the computed one as given (`:885`).
//! - Every other change keeps the persisted value, including removing the password.
//!
//! The production bound (`tokens_valid_after`, what strict and the integer `auth_time` arm
//! read and what an account read reports) is independent and is not modelled here.

#![allow(clippy::cast_precision_loss)]

use fireemu_core_auth::claims::{ClaimValue, CustomClaims};
use fireemu_core_auth::jwt::{encode_payload_with, verify_id_token, FutureClaims, JwtError};
use fireemu_core_auth::mfa::TotpPolicy;
use fireemu_core_auth::store::{AuthSnapshot, AuthStore, ImportedUser, LocalId, NewUser, Provider};
use fireemu_core_types::determinism::SplitMix64;
use fireemu_core_types::json::{parse, JsonValue};
use fireemu_core_types::time::LogicalInstant;
use proptest::prelude::*;
use std::fmt::Write as _;

const NOW: i64 = 1_788_004_860;

fn at(seconds: i64) -> LogicalInstant {
    LogicalInstant::from_unix_seconds(seconds)
}

fn emulator_store() -> AuthStore {
    let mut store = AuthStore::new(
        "demo-valid-since",
        SplitMix64::new(7),
        TotpPolicy::default(),
    );
    store.set_future_id_token_claims(FutureClaims::Accept);
    store
}

/// `operations.js:1727`.
fn official_accepts(valid_since: Option<i64>, iat: Option<i64>) -> bool {
    valid_since.is_none_or(|since| iat.is_some_and(|iat| iat as f64 >= since as f64))
}

/// A token for `uid` with `iat` replaced (or removed) and no `auth_time`, valid for an hour
/// after `now`.
fn token(store: &AuthStore, uid: &LocalId, iat: Option<i64>, now: i64) -> String {
    let claims = store.id_token_claims(uid, None, at(now)).unwrap();
    let JsonValue::Object(mut object) = parse(&claims.canonical_json()).unwrap() else {
        panic!("claims encode an object");
    };
    for key in ["iat", "auth_time", "exp"] {
        object.remove(key);
    }
    let mut payload = String::new();
    ClaimValue::from_json(&JsonValue::Object(object)).write_canonical_json(&mut payload);
    payload.pop();
    write!(payload, ",\"exp\":{}", now + 3_600).unwrap();
    if let Some(iat) = iat {
        write!(payload, ",\"iat\":{iat}").unwrap();
    }
    payload.push('}');
    encode_payload_with(&payload, None)
}

fn accepted(store: &AuthStore, uid: &LocalId, iat: Option<i64>, now: i64) -> bool {
    match verify_id_token(&token(store, uid, iat, now), store, at(now)) {
        Ok(_) => true,
        Err(JwtError::Revoked) => false,
        Err(other) => panic!("only revocation may refuse here, got {other:?}"),
    }
}

/// Every iat that tells the bound apart: missing, one below, equal, and now.
fn assert_bound(store: &AuthStore, uid: &LocalId, bound: Option<i64>, now: i64, what: &str) {
    let probes = [
        None,
        bound.map(|b| b - 1),
        bound,
        Some(now),
        Some(NOW - 10_000),
    ];
    for iat in probes {
        assert_eq!(
            accepted(store, uid, iat, now),
            official_accepts(bound, iat),
            "{what}: iat={iat:?} bound={bound:?}"
        );
    }
}

fn email(n: u32) -> NewUser {
    NewUser::email(&format!("valid-since-{n}@example.invalid"))
}

fn imported(local_id: &str, tokens_valid_after: i64) -> ImportedUser {
    ImportedUser {
        local_id: local_id.to_owned(),
        email: None,
        email_verified: false,
        display_name: None,
        photo_url: None,
        phone_number: None,
        disabled: false,
        provider: Provider::Anonymous,
        custom_claims: CustomClaims::default(),
        created_at: at(NOW - 5_000),
        last_sign_in_at: None,
        last_refresh_at: None,
        tokens_valid_after: at(tokens_valid_after),
        federated: Vec::new(),
        password: None,
        imported_password: None,
        allow_shared_email: false,
        totp_factors: Vec::new(),
        phone_factors: Vec::new(),
    }
}

#[test]
fn creation_without_a_password_holds_no_bound_and_with_one_holds_its_second() {
    let mut store = emulator_store();
    let anonymous = store.create_user(NewUser::anonymous(), at(NOW)).unwrap();
    assert_bound(&store, &anonymous, None, NOW, "anonymous");
    let plain = store.create_user(email(1), at(NOW)).unwrap();
    assert_bound(&store, &plain, None, NOW, "email without a password");
    let password = store
        .create_user_with_password(email(2), "password1", at(NOW - 40))
        .unwrap();
    assert_bound(
        &store,
        &password,
        Some(NOW - 40),
        NOW,
        "password at sign-up",
    );
}

/// `operations.js:341`: the upload second, which the batch route passes as the row's
/// production bound.
#[test]
fn a_batch_import_holds_its_upload_second() {
    let mut store = emulator_store();
    let uid = store.import_user(imported("batch", NOW - 70)).unwrap();
    assert_bound(&store, &uid, Some(NOW - 70), NOW, "batch import");
}

/// A password set on a clock that went backwards assigns the earlier second; the production
/// bound keeps its maximum.
#[test]
fn a_password_set_after_a_rewind_lowers_the_bound() {
    let mut store = emulator_store();
    let uid = store
        .create_user_with_password(email(3), "password1", at(NOW))
        .unwrap();
    store
        .set_password(&uid, "password2", at(NOW - 200))
        .unwrap();
    assert_bound(&store, &uid, Some(NOW - 200), NOW, "rewound password");
    assert_eq!(store.user(&uid).unwrap().tokens_valid_after, at(NOW));
}

/// A setter after an explicit later `validSince` assigns its own second.
#[test]
fn a_password_after_a_later_explicit_bound_assigns_its_own_second() {
    let mut store = emulator_store();
    let uid = store.create_user(email(4), at(NOW - 500)).unwrap();
    store.set_valid_since(&uid, at(NOW + 1_000)).unwrap();
    assert_bound(&store, &uid, Some(NOW + 1_000), NOW, "explicit later");
    store
        .set_password(&uid, "password1", at(NOW - 100))
        .unwrap();
    assert_bound(
        &store,
        &uid,
        Some(NOW - 100),
        NOW,
        "password after explicit",
    );
}

/// An explicit bound earlier than before is honoured, and its second is floored.
#[test]
fn an_explicit_earlier_bound_replaces_a_later_one() {
    let mut store = emulator_store();
    let uid = store
        .create_user_with_password(email(5), "password1", at(NOW))
        .unwrap();
    store
        .set_valid_since(
            &uid,
            LogicalInstant::from_nanos(i128::from(NOW - 300) * 1_000_000_000 + 999),
        )
        .unwrap();
    assert_bound(&store, &uid, Some(NOW - 300), NOW, "explicit earlier");
}

/// `revoke_tokens` is the production revocation (emulator disable, MFA withdrawal, strict OOB
/// email change); firebase-tools sets no `validSince` for those, so the bound is kept.
#[test]
fn a_production_only_revocation_keeps_the_bound() {
    let mut store = emulator_store();
    let anonymous = store
        .create_user(NewUser::anonymous(), at(NOW - 50))
        .unwrap();
    store.revoke_tokens(&anonymous, at(NOW)).unwrap();
    assert_bound(&store, &anonymous, None, NOW, "revoked, never set");
    let password = store
        .create_user_with_password(email(6), "password1", at(NOW - 300))
        .unwrap();
    store.revoke_tokens(&password, at(NOW)).unwrap();
    assert_bound(
        &store,
        &password,
        Some(NOW - 300),
        NOW,
        "revoked after a password",
    );
}

/// Removing the password leaves the bound it set (`operations.js:903-913` deletes fields only).
#[test]
fn removing_the_password_keeps_its_bound() {
    let mut store = emulator_store();
    let uid = store
        .create_user_with_password(email(7), "password1", at(NOW - 20))
        .unwrap();
    assert!(store.clear_password(&uid).unwrap());
    assert_bound(&store, &uid, Some(NOW - 20), NOW, "password removed");
}

/// An in-memory snapshot restores the bound together with the account.
#[test]
fn a_snapshot_restore_brings_the_bound_back() {
    let mut store = emulator_store();
    let absent = store.create_user(email(8), at(NOW - 400)).unwrap();
    let present = store
        .create_user_with_password(email(9), "password1", at(NOW - 300))
        .unwrap();
    let snapshot = AuthSnapshot::capture(&store);
    store.set_password(&absent, "password1", at(NOW)).unwrap();
    store
        .set_password(&present, "password2", at(NOW - 600))
        .unwrap();
    snapshot.restore_into(&mut store);
    assert_bound(&store, &absent, None, NOW, "restored absent");
    assert_bound(&store, &present, Some(NOW - 300), NOW, "restored present");
}

/// The strict profile and the integer `auth_time` arm still read the production bound.
#[test]
fn strict_keeps_reading_the_production_bound() {
    let mut store = AuthStore::new(
        "demo-valid-since",
        SplitMix64::new(7),
        TotpPolicy::default(),
    );
    let uid = store
        .create_user(NewUser::anonymous(), at(NOW - 50))
        .unwrap();
    store.revoke_tokens(&uid, at(NOW)).unwrap();
    let claims = store.id_token_claims(&uid, None, at(NOW - 10)).unwrap();
    let old = encode_payload_with(&claims.canonical_json(), None);
    assert_eq!(
        verify_id_token(&old, &store, at(NOW)).map(|_| ()),
        Err(JwtError::Revoked)
    );
}

// ---------------------------------------------------------------------------------------
// Stateful model
// ---------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
enum Event {
    /// Move the clock by this many seconds (negative: backwards).
    Tick(i64),
    SetPassword,
    ClearPassword,
    Revoke,
    /// An explicit privileged `validSince` this many seconds from now.
    Explicit(i64),
    Capture,
    Restore,
}

fn event() -> impl Strategy<Value = Event> {
    prop_oneof![
        (-400i64..=400).prop_map(Event::Tick),
        Just(Event::SetPassword),
        Just(Event::ClearPassword),
        Just(Event::Revoke),
        (-400i64..=400).prop_map(Event::Explicit),
        Just(Event::Capture),
        Just(Event::Restore),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, ..ProptestConfig::default() })]

    /// Any trace of setters, preserving events, clock moves in both directions and snapshot
    /// round trips answers every distinguishing `iat` as the assignment model does.
    #[test]
    fn every_trace_answers_as_the_last_setter_model(
        with_password in any::<bool>(),
        events in proptest::collection::vec(event(), 0..24),
    ) {
        let mut store = emulator_store();
        let mut clock = NOW;
        let uid = if with_password {
            store.create_user_with_password(email(10), "password1", at(clock)).unwrap()
        } else {
            store.create_user(email(10), at(clock)).unwrap()
        };
        let mut model: Option<i64> = with_password.then_some(clock);
        let mut saved: Option<(AuthSnapshot, Option<i64>)> = None;
        for event in events {
            match event {
                Event::Tick(delta) => clock += delta,
                Event::SetPassword => {
                    store.set_password(&uid, "password9", at(clock)).unwrap();
                    model = Some(clock);
                }
                Event::ClearPassword => {
                    store.clear_password(&uid).unwrap();
                }
                Event::Revoke => store.revoke_tokens(&uid, at(clock)).unwrap(),
                Event::Explicit(offset) => {
                    store.set_valid_since(&uid, at(clock + offset)).unwrap();
                    model = Some(clock + offset);
                }
                Event::Capture => saved = Some((AuthSnapshot::capture(&store), model)),
                Event::Restore => {
                    if let Some((snapshot, bound)) = &saved {
                        snapshot.restore_into(&mut store);
                        model = *bound;
                    }
                }
            }
            for iat in [None, model.map(|b| b - 1), model, Some(clock)] {
                prop_assert_eq!(
                    accepted(&store, &uid, iat, clock),
                    official_accepts(model, iat),
                    "iat={:?} model={:?} clock={}", iat, model, clock
                );
            }
        }
    }
}

/// The two direct writers change only the emulator bound: assign takes the second of the
/// instant given, clear leaves none; the production bound is untouched.
#[test]
fn the_direct_writers_assign_and_clear_only_the_emulator_bound() {
    let mut store = emulator_store();
    let uid = store.create_user(email(11), at(NOW - 900)).unwrap();
    store
        .assign_emulator_valid_since(
            &uid,
            LogicalInstant::from_nanos(i128::from(NOW - 30) * 1_000_000_000 + 5),
        )
        .unwrap();
    assert_bound(&store, &uid, Some(NOW - 30), NOW, "assigned");
    store.clear_emulator_valid_since(&uid).unwrap();
    assert_bound(&store, &uid, None, NOW, "cleared");
    assert_eq!(store.user(&uid).unwrap().tokens_valid_after, at(NOW - 900));
    let missing = store.create_user(email(12), at(NOW)).unwrap();
    store.delete_user_by_id(missing.as_str()).unwrap();
    assert!(store
        .assign_emulator_valid_since(&missing, at(NOW))
        .is_err());
    assert!(store.clear_emulator_valid_since(&missing).is_err());
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]

    /// A tenant snapshot carries the emulator bound: whatever setters run after the capture,
    /// a tenant restore brings back the bound held at the capture (security review of the
    /// validSince lane, 2026-11-15, suggested test 4).
    #[test]
    fn a_tenant_restore_brings_back_the_captured_bound(
        before in proptest::collection::vec(event(), 0..12),
        after in proptest::collection::vec(event(), 1..12),
    ) {
        use std::sync::{Arc, Mutex};
        let registry = fireemu_core_auth::store::AuthRegistry::new(
            "demo-valid-since",
            Arc::new(Mutex::new(emulator_store())),
        );
        let tenant = registry.ensure_tenant("demo-valid-since", "t").unwrap();
        let mut clock = NOW;
        let uid = tenant
            .lock()
            .unwrap()
            .create_user_with_password(email(20), "password1", at(clock))
            .unwrap();
        let run = |events: &[Event], clock: &mut i64| {
            let mut store = tenant.lock().unwrap();
            for event in events {
                match event {
                    Event::Tick(delta) => *clock += delta,
                    Event::SetPassword => store.set_password(&uid, "password9", at(*clock)).unwrap(),
                    Event::ClearPassword => {
                        store.clear_password(&uid).unwrap();
                    }
                    Event::Revoke => store.revoke_tokens(&uid, at(*clock)).unwrap(),
                    Event::Explicit(offset) => {
                        store.set_valid_since(&uid, at(*clock + offset)).unwrap();
                    }
                    Event::Capture | Event::Restore => {}
                }
            }
        };
        let bound = |tenant: &Arc<Mutex<AuthStore>>| {
            tenant.lock().unwrap().user(&uid).unwrap().emulator_valid_since
        };
        run(&before, &mut clock);
        let captured = bound(&tenant);
        let snapshot = registry.capture_tenants_snapshot("demo-valid-since").unwrap();
        run(&after, &mut clock);
        registry.restore_tenants_snapshot("demo-valid-since", &snapshot).unwrap();
        let restored = registry.tenant_store("demo-valid-since", "t").unwrap();
        prop_assert_eq!(bound(&restored), captured);
    }
}
