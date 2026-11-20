//! Refresh-token redemption after an account's `validSince` moved, in both profiles, through
//! the real Identity Toolkit and Secure Token handlers (in process, no listener, no network).
//!
//! firebase-tools 15.28.2 `lib/emulator/auth/operations.js` `grantToken` (`:1399-1418`) checks
//! only the grant type, the token's presence, `state.validateRefreshToken` (`state.js:305-319`:
//! project, tenant and that the user exists) and `USER_DISABLED`; it never reads
//! `validSince`. So the emulator profile redeems a refresh token minted before a password
//! change or a revocation, while strict keeps production's `TOKEN_EXPIRED`.

use std::sync::{Arc, Mutex, RwLock};

use fireemu_adapter_http::control::{self, ControlState};
use fireemu_adapter_http::identity_toolkit::{handle, handle_with, AuthState, RequestHeaders};
use fireemu_core_auth::mfa::TotpPolicy;
use fireemu_core_auth::store::AuthStore;
use fireemu_core_session::clock::VirtualClock;
use fireemu_core_types::determinism::SplitMix64;
use fireemu_core_types::time::LogicalInstant;
use serde_json::{json, Value};

const NOW: i64 = 1_788_004_860;
const V1: &str = "/identitytoolkit.googleapis.com/v1";
const ADMIN: &str = "/identitytoolkit.googleapis.com/v1/projects/demo-app";
const TOKEN: &str = "/securetoken.googleapis.com/v1/token";
fn state(emulator: bool) -> AuthState {
    AuthState {
        store: Arc::new(Mutex::new(AuthStore::new(
            "demo-app",
            SplitMix64::new(9),
            TotpPolicy::default(),
        ))),
        clock: Arc::new(Mutex::new(VirtualClock::new(
            LogicalInstant::from_unix_seconds(NOW),
        ))),
        wall_clock: None,
        totp_extension_enabled: false,
        reveal_totp_codes: true,
        barrier: None,
        events: None,
        notices: None,
        blocking: None,
        operation_gate: Arc::new(Mutex::new(())),
        control_token: None,
        registry: None,
        allow_routed_projects: false,
        stateless_refresh_tokens: emulator,
        idp_continuations: fireemu_adapter_http::identity_toolkit::IdpContinuationPolicy::Disabled,
        query_limits: fireemu_adapter_http::identity_toolkit::AuthQueryLimits::EmulatorUnbounded,
        client_api_key: fireemu_adapter_http::identity_toolkit::ClientApiKeyPolicy::Optional,
        fake_custom_token_expiry:
            fireemu_adapter_http::identity_toolkit::FakeCustomTokenExpiry::Ignore,
        custom_token_trust: None,
        allow_unsigned_custom_tokens: true,
        caller_times: fireemu_adapter_http::CallerTimes::default(),
        idp_assertions: fireemu_adapter_http::identity_toolkit::IdpAssertionPolicy::Fixture,
        app_check: None,
        app_check_policy: None,
        tenancy: None,
    }
}

fn owner() -> RequestHeaders {
    RequestHeaders {
        authorization: Some("Bearer owner".to_owned()),
        ..RequestHeaders::default()
    }
}

fn post(state: &AuthState, path: &str, body: &Value) -> Value {
    let response = handle(state, "POST", path, body);
    assert_eq!(response.status, 200, "{path}: {}", response.body);
    response.body
}

fn admin(state: &AuthState, path: &str, body: &Value) -> Value {
    let response = handle_with(state, "POST", path, &owner(), body);
    assert_eq!(response.status, 200, "{path}: {}", response.body);
    response.body
}

fn set_clock(state: &AuthState, seconds: i64) {
    let control = ControlState {
        clock: state.clock.clone(),
        require_demo_prefix: true,
        edition: fireemu_core_types::edition::FirestoreEdition::Standard,
        capabilities: json!({"schemaVersion": 1}).into(),
        rules: Arc::new(fireemu_core_rules::runtime::RulesetSlot::default()),
        storage_rules: Arc::new(fireemu_adapter_http::storage::StorageRulesRegistry::default()),
        reset_hooks: Vec::new(),
        functions: None,
        control_token: "test-token".to_owned(),
        app_check: None,
        firestore_listen_expiry: None,
        firestore_missing_indexes: None,
        require_control_token: false,
        calendar_zones: None,
        barrier: None,
        snapshot_hooks: Vec::new(),
        snapshots: Mutex::new(std::collections::BTreeMap::new()),
        faults: None,
        text_indexes: Arc::new(Mutex::new(
            fireemu_core_firestore::text_index::TextIndexCatalog::default(),
        )),
        default_project: "demo-app".to_owned(),
        tenancy: Arc::new(RwLock::new(fireemu_core_session::tenancy::Tenancy::new(
            "demo-app",
        ))),
        sessions: Mutex::new(std::collections::BTreeMap::from([(
            "default".to_owned(),
            "demo-app".to_owned(),
        )])),
        project_hooks: None,
        resource_hooks: Vec::new(),
    };
    let instant = LogicalInstant::from_unix_seconds(seconds)
        .to_rfc3339()
        .unwrap();
    let response = control::handle(
        &control,
        "POST",
        "/v1/sessions/default/clock:set",
        &json!({"instant": instant, "allowBackwards": true}),
    );
    assert_eq!(response.status, 200, "{}", response.body);
}

/// Signs up `email` with a password and returns `(uid, idToken, refreshToken)`.
fn sign_up(state: &AuthState, email: &str) -> (String, String, String) {
    let body = post(
        state,
        &format!("{V1}/accounts:signUp"),
        &json!({"email": email, "password": "secret-1", "returnSecureToken": true}),
    );
    let field = |name: &str| body[name].as_str().unwrap().to_owned();
    (field("localId"), field("idToken"), field("refreshToken"))
}

fn refresh(state: &AuthState, token: &str) -> (u16, Value) {
    let response = handle(
        state,
        "POST",
        TOKEN,
        &json!({"grant_type": "refresh_token", "refresh_token": token}),
    );
    (response.status, response.body)
}

/// The events that move the production bound (`tokens_valid_after`) past a token minted at
/// `NOW`. Each runs 100 s later.
#[derive(Clone, Copy, Debug)]
enum Event {
    ClientPasswordChange,
    AdminPasswordChange,
    AdminRevocation,
    ClientEmailChange,
}

const EVENTS: [Event; 4] = [
    Event::ClientPasswordChange,
    Event::AdminPasswordChange,
    Event::AdminRevocation,
    Event::ClientEmailChange,
];

fn apply(state: &AuthState, event: Event, uid: &str, id_token: &str, email: &str) {
    set_clock(state, NOW + 100);
    match event {
        Event::ClientPasswordChange => {
            post(
                state,
                &format!("{V1}/accounts:update"),
                &json!({"idToken": id_token, "password": "secret-2"}),
            );
        }
        Event::AdminPasswordChange => {
            admin(
                state,
                &format!("{ADMIN}/accounts:update"),
                &json!({"localId": uid, "password": "secret-2"}),
            );
        }
        Event::AdminRevocation => {
            admin(
                state,
                &format!("{ADMIN}/accounts:update"),
                &json!({"localId": uid, "validSince": (NOW + 100).to_string()}),
            );
        }
        Event::ClientEmailChange => {
            post(
                state,
                &format!("{V1}/accounts:update"),
                &json!({"idToken": id_token, "email": format!("moved-{email}")}),
            );
        }
    }
}

#[test]
fn the_emulator_profile_redeems_a_refresh_token_minted_before_the_bound_moved() {
    for event in EVENTS {
        let s = state(true);
        let email = format!("{event:?}@example.invalid").to_lowercase();
        let (uid, id_token, refresh_token) = sign_up(&s, &email);
        apply(&s, event, &uid, &id_token, &email);
        let (status, body) = refresh(&s, &refresh_token);
        assert_eq!(status, 200, "{event:?}: {body}");
        assert_eq!(body["user_id"], uid.as_str(), "{event:?}: {body}");
        // The refreshed ID token postdates the emulator bound, so it is usable (`:1727`).
        let looked_up = post(
            &s,
            &format!("{V1}/accounts:lookup"),
            &json!({"idToken": body["id_token"]}),
        );
        assert_eq!(looked_up["users"][0]["localId"], uid.as_str(), "{event:?}");
    }
}

#[test]
fn strict_refuses_a_refresh_token_minted_before_the_bound_moved() {
    for event in EVENTS {
        let s = state(false);
        let email = format!("{event:?}@example.invalid").to_lowercase();
        let (uid, id_token, refresh_token) = sign_up(&s, &email);
        apply(&s, event, &uid, &id_token, &email);
        let (status, body) = refresh(&s, &refresh_token);
        assert_eq!(status, 400, "{event:?}: {body}");
        assert_eq!(
            body["error"]["message"], "TOKEN_EXPIRED",
            "{event:?}: {body}"
        );
    }
}

/// Near misses: the emulator profile still refuses what `grantToken` refuses, a disabled
/// user (`:1404`) and a deleted one (`state.js:311-312`), after the bound moved.
#[test]
fn the_emulator_profile_still_refuses_disabled_and_deleted_users_after_the_bound_moved() {
    let s = state(true);
    let (uid, id_token, refresh_token) = sign_up(&s, "near@example.invalid");
    apply(
        &s,
        Event::AdminRevocation,
        &uid,
        &id_token,
        "near@example.invalid",
    );
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": uid, "disableUser": true}),
    );
    let (status, body) = refresh(&s, &refresh_token);
    assert_eq!(
        (status, body["error"]["message"].clone()),
        (400, json!("USER_DISABLED")),
        "{body}"
    );
    admin(
        &s,
        &format!("{ADMIN}/accounts:delete"),
        &json!({"localId": uid}),
    );
    let (status, body) = refresh(&s, &refresh_token);
    assert_eq!(status, 400, "{body}");
    assert_ne!(body["error"]["message"], "TOKEN_EXPIRED", "{body}");
}
