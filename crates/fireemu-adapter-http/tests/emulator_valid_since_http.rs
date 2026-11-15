//! Which account events give an account the `validSince` the emulator profile's ID-token
//! check reads, through the real Identity Toolkit handler (in process, no listener, no network).
//!
//! The expectations come from firebase-tools 15.28.2 `lib/emulator/auth/operations.js`:
//! `parseIdToken` refuses with `TOKEN_EXPIRED` unless `!user.validSince || iat >=
//! Number(user.validSince)` (`:1727`); `validSince` is assigned the current second by a
//! password at sign-up (`:169`), a password, email or `validSince` update (`:861-862`) and a
//! batch import (`:341`), and a privileged update copies its `validSince` over that as given
//! (`:885`). Disabling, the out-of-band email actions and a fresh email-link, identity-provider
//! or custom-token sign-in set none. The strict profile is not changed and is not tested here
//! beyond one control.

use std::fmt::Write as _;
use std::sync::{Arc, Mutex, RwLock};

use fireemu_adapter_http::control::{self, ControlState};
use fireemu_adapter_http::identity_toolkit::{handle, handle_with, AuthState, RequestHeaders};
use fireemu_core_auth::jwt::{base64url_encode, decode_token, encode_payload_with};
use fireemu_core_auth::mfa::TotpPolicy;
use fireemu_core_auth::store::AuthStore;
use fireemu_core_session::clock::VirtualClock;
use fireemu_core_types::determinism::SplitMix64;
use fireemu_core_types::time::LogicalInstant;
use serde_json::{json, Value};

const NOW: i64 = 1_788_004_860;
const V1: &str = "/identitytoolkit.googleapis.com/v1";
const ADMIN: &str = "/identitytoolkit.googleapis.com/v1/projects/demo-app";
const EMU: &str = "/emulator/v1/projects/demo-app";

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

/// A hand-made unsigned ID token for `uid`: the claims of a real token, re-pointed, with
/// `iat` replaced (or removed) and no `auth_time`.
fn hand_made(template: &str, uid: &str, iat: Option<Value>) -> String {
    let decoded = decode_token(template, None).unwrap();
    let mut payload: Value = serde_json::from_str(&decoded.payload_json).unwrap();
    let object = payload.as_object_mut().unwrap();
    object.insert("sub".to_owned(), json!(uid));
    object.insert("user_id".to_owned(), json!(uid));
    object.insert("exp".to_owned(), json!(NOW + 100_000));
    object.remove("auth_time");
    match iat {
        Some(iat) => object.insert("iat".to_owned(), iat),
        None => object.remove("iat"),
    };
    encode_payload_with(&payload.to_string(), None)
}

/// The template every hand-made token is cut from.
fn template(state: &AuthState) -> String {
    post(
        state,
        &format!("{V1}/accounts:signUp"),
        &json!({"returnSecureToken": true}),
    )["idToken"]
        .as_str()
        .unwrap()
        .to_owned()
}

/// `(status, error message)` of a lookup with a hand-made token.
fn lookup(state: &AuthState, template: &str, uid: &str, iat: Option<Value>) -> (u16, String) {
    let response = handle(
        state,
        "POST",
        &format!("{V1}/accounts:lookup"),
        &json!({"idToken": hand_made(template, uid, iat)}),
    );
    let message = response.body["error"]["message"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    (response.status, message)
}

const OK: (u16, &str) = (200, "");
const EXPIRED: (u16, &str) = (400, "TOKEN_EXPIRED");

fn expect(state: &AuthState, template: &str, uid: &str, bound: Option<i64>, what: &str) {
    let mut probes = vec![None, Some(json!(NOW - 50_000))];
    if let Some(bound) = bound {
        probes.extend([
            Some(json!(bound - 1)),
            Some(json!(bound)),
            Some(json!(bound.to_string())),
        ]);
    }
    for iat in probes {
        let accepted = bound.is_none_or(|bound| {
            iat.as_ref()
                .and_then(|v| v.as_i64().or_else(|| v.as_str()?.parse().ok()))
                .is_some_and(|iat| iat >= bound)
        });
        let want = if accepted { OK } else { EXPIRED };
        assert_eq!(
            lookup(state, template, uid, iat.clone()),
            (want.0, want.1.to_owned()),
            "{what}: iat={iat:?} bound={bound:?}"
        );
    }
}

fn custom_token(uid: &str) -> String {
    let header = base64url_encode(br#"{"alg":"none","typ":"JWT"}"#);
    let payload = json!({
        "aud": "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
        "uid": uid,
    });
    format!(
        "{header}.{}.",
        base64url_encode(payload.to_string().as_bytes())
    )
}

fn percent(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            out.push(char::from(byte));
        } else {
            write!(out, "%{byte:02X}").unwrap();
        }
    }
    out
}

fn idp_sign_in(state: &AuthState, provider: &str, sub: &str, email: &str) -> String {
    let post_body = if provider.starts_with("saml.") {
        let saml = json!({"assertion": {"subject": {"nameId": email}}});
        format!(
            "providerId={provider}&id_token={}&SAMLResponse={}",
            percent(&json!({"sub": sub}).to_string()),
            percent(&saml.to_string())
        )
    } else {
        let claims = json!({"sub": sub, "email": email, "email_verified": true});
        format!(
            "providerId={provider}&id_token={}",
            percent(&claims.to_string())
        )
    };
    let signed = post(
        state,
        &format!("{V1}/accounts:signInWithIdp"),
        &json!({"postBody": post_body, "requestUri": "http://localhost", "returnSecureToken": true}),
    );
    assert_eq!(signed["isNewUser"], true, "{signed}");
    signed["localId"].as_str().unwrap().to_owned()
}

fn oob_code(state: &AuthState, kind: &str) -> String {
    let response = handle(state, "GET", &format!("{EMU}/oobCodes"), &json!({}));
    response.body["oobCodes"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|row| row["requestType"] == kind)
        .unwrap_or_else(|| panic!("no {kind} code in {}", response.body))["oobCode"]
        .as_str()
        .unwrap()
        .to_owned()
}

/// Fresh creation without a password through every source: no `validSince`.
#[test]
fn fresh_sign_ins_without_a_password_hold_no_bound() {
    let s = state(true);
    let t = template(&s);
    let anonymous = post(&s, &format!("{V1}/accounts:signUp"), &json!({}))["localId"]
        .as_str()
        .unwrap()
        .to_owned();
    expect(&s, &t, &anonymous, None, "anonymous");
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "admin-plain", "email": "plain@example.invalid"}),
    );
    expect(
        &s,
        &t,
        "admin-plain",
        None,
        "Admin create without a password",
    );

    post(
        &s,
        &format!("{V1}/accounts:sendOobCode"),
        &json!({"requestType": "EMAIL_SIGNIN", "email": "link@example.invalid", "continueUrl": "https://app.example/x"}),
    );
    let code = oob_code(&s, "EMAIL_SIGNIN");
    let link = post(
        &s,
        &format!("{V1}/accounts:signInWithEmailLink"),
        &json!({"email": "link@example.invalid", "oobCode": code}),
    );
    assert_eq!(link["isNewUser"], true);
    expect(
        &s,
        &t,
        link["localId"].as_str().unwrap(),
        None,
        "email link",
    );

    let oidc = idp_sign_in(&s, "oidc.local", "oidc-1", "oidc@example.invalid");
    expect(&s, &t, &oidc, None, "OIDC");
    let saml = idp_sign_in(&s, "saml.myidp", "saml-1", "saml@example.invalid");
    expect(&s, &t, &saml, None, "SAML");

    let custom = post(
        &s,
        &format!("{V1}/accounts:signInWithCustomToken"),
        &json!({"token": custom_token("custom-1"), "returnSecureToken": true}),
    );
    assert_eq!(custom["isNewUser"], true);
    expect(&s, &t, "custom-1", None, "custom token");
}

/// A password at creation and a batch import (with or without a password) set the second.
#[test]
fn a_password_at_creation_and_a_batch_import_set_their_second() {
    let s = state(true);
    let t = template(&s);
    set_clock(&s, NOW + 30);
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "admin-pw", "email": "pw@example.invalid", "password": "password1"}),
    );
    expect(
        &s,
        &t,
        "admin-pw",
        Some(NOW + 30),
        "Admin create with a password",
    );
    set_clock(&s, NOW + 60);
    admin(
        &s,
        &format!("{ADMIN}/accounts:batchCreate"),
        &json!({"users": [
            {"localId": "imported-plain", "email": "imported@example.invalid", "validSince": "1"},
            {"localId": "imported-pw", "email": "imported-pw@example.invalid", "passwordHash": "c2VjcmV0", "salt": "c2FsdA=="}
        ], "hashAlgorithm": "HMAC_SHA256", "signerKey": "a2V5"}),
    );
    expect(
        &s,
        &t,
        "imported-plain",
        Some(NOW + 60),
        "batch import without a password",
    );
    expect(
        &s,
        &t,
        "imported-pw",
        Some(NOW + 60),
        "batch import with a password",
    );
}

/// Disabling and re-enabling an account sets no `validSince` (`operations.js:878-880` copies
/// `disabled` only), so a token held from before is usable again.
#[test]
fn disabling_and_re_enabling_sets_no_bound() {
    let s = state(true);
    let t = template(&s);
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "toggled", "email": "toggled@example.invalid"}),
    );
    set_clock(&s, NOW + 100);
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "toggled", "disableUser": true}),
    );
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "toggled", "disableUser": false}),
    );
    expect(&s, &t, "toggled", None, "after disable and enable");
    // With a password the bound stays the password's second.
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "toggled", "password": "password1"}),
    );
    set_clock(&s, NOW + 200);
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "toggled", "disableUser": true}),
    );
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "toggled", "disableUser": false}),
    );
    expect(
        &s,
        &t,
        "toggled",
        Some(NOW + 100),
        "password, then disable and enable",
    );
}

/// A privileged `validSince` is copied as given after the current-second setter: the number 0
/// is false to JavaScript and leaves none, the text "0" is a `validSince` of 0, and an earlier
/// value replaces a later one.
#[test]
fn a_privileged_valid_since_is_copied_as_given() {
    let s = state(true);
    let t = template(&s);
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "explicit", "email": "explicit@example.invalid", "password": "password1"}),
    );
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "explicit", "validSince": 0}),
    );
    expect(&s, &t, "explicit", None, "validSince 0");
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "explicit", "validSince": "0"}),
    );
    expect(&s, &t, "explicit", Some(0), "validSince \"0\"");
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "explicit", "validSince": NOW + 400}),
    );
    expect(
        &s,
        &t,
        "explicit",
        Some(NOW + 400),
        "validSince as a number",
    );
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "explicit", "validSince": (NOW + 500).to_string()}),
    );
    expect(&s, &t, "explicit", Some(NOW + 500), "later validSince");
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "explicit", "validSince": (NOW - 500).to_string()}),
    );
    expect(&s, &t, "explicit", Some(NOW - 500), "earlier validSince");
    // The explicit value wins over a password in the same update.
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "explicit", "password": "password2", "validSince": (NOW - 900).to_string()}),
    );
    expect(
        &s,
        &t,
        "explicit",
        Some(NOW - 900),
        "password and validSince together",
    );
}

/// A setter on a clock that went backwards assigns that earlier second, for a password and for
/// a direct email change: the last setter wins, not the latest time.
#[test]
fn a_setter_after_a_rewind_assigns_the_earlier_second() {
    let s = state(true);
    let t = template(&s);
    set_clock(&s, NOW + 600);
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "rewound", "email": "rewound@example.invalid", "password": "password1"}),
    );
    expect(&s, &t, "rewound", Some(NOW + 600), "password at +600");
    set_clock(&s, NOW + 10);
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "rewound", "password": "password2"}),
    );
    expect(&s, &t, "rewound", Some(NOW + 10), "password again at +10");
    set_clock(&s, NOW + 700);
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "rewound", "email": "rewound-2@example.invalid"}),
    );
    set_clock(&s, NOW + 20);
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "rewound", "email": "rewound-3@example.invalid"}),
    );
    expect(
        &s,
        &t,
        "rewound",
        Some(NOW + 20),
        "email change at +20 after one at +700",
    );
    // An update that changes neither keeps it.
    set_clock(&s, NOW + 900);
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": "rewound", "displayName": "kept", "email": "rewound-3@example.invalid"}),
    );
    expect(&s, &t, "rewound", Some(NOW + 20), "unrelated update");
}

/// `VERIFY_AND_CHANGE_EMAIL` keeps the account's `validSince` (`operations.js:781-823` is
/// outside the setter at `:861`), absent or present. (`RECOVER_EMAIL` is the same branch in
/// firebase-tools; this emulator issues no such code yet.)
#[test]
fn the_out_of_band_email_actions_keep_the_bound() {
    let s = state(true);
    let t = template(&s);
    for (uid, password) in [("oob-plain", None), ("oob-pw", Some("password1"))] {
        let email = format!("{uid}@example.invalid");
        let mut body = json!({"localId": uid, "email": email});
        if let Some(password) = password {
            body["password"] = json!(password);
        }
        admin(&s, &format!("{ADMIN}/accounts"), &body);
        let bound = password.map(|_| NOW);
        set_clock(&s, NOW + 300);
        let link = admin(
            &s,
            &format!("{ADMIN}/accounts:sendOobCode"),
            &json!({"requestType": "VERIFY_AND_CHANGE_EMAIL", "email": email, "newEmail": format!("new-{email}"), "returnOobLink": true}),
        );
        post(
            &s,
            &format!("{V1}/accounts:update"),
            &json!({"oobCode": link["oobCode"]}),
        );
        expect(&s, &t, uid, bound, "after VERIFY_AND_CHANGE_EMAIL");
        set_clock(&s, NOW);
    }
}

/// Strict still reads the production bound: a disable-and-enable does not open old tokens there
/// (control; strict refuses a token without `iat` as malformed anyway).
#[test]
fn strict_refuses_a_hand_made_token_whatever_the_account() {
    let s = state(false);
    let t = template(&s);
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "strict", "email": "strict@example.invalid"}),
    );
    assert_eq!(
        lookup(&s, &t, "strict", None),
        (400, "INVALID_ID_TOKEN".to_owned())
    );
}

/// A verified identity-provider email over an unverified account takes it over and assigns the
/// current second (`operations.js:2014-2020`), with or without an earlier `validSince`.
#[test]
fn a_verified_identity_provider_taking_over_an_account_assigns_the_second() {
    let s = state(true);
    let t = template(&s);
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "taken-plain", "email": "taken-plain@example.invalid"}),
    );
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "taken-pw", "email": "taken-pw@example.invalid", "password": "password1"}),
    );
    expect(&s, &t, "taken-plain", None, "before the takeover");
    set_clock(&s, NOW + 100);
    for (uid, sub) in [("taken-plain", "g-plain"), ("taken-pw", "g-pw")] {
        let claims =
            json!({"sub": sub, "email": format!("{uid}@example.invalid"), "email_verified": true});
        let signed = post(
            &s,
            &format!("{V1}/accounts:signInWithIdp"),
            &json!({"postBody": format!("providerId=google.com&id_token={}", percent(&claims.to_string())), "requestUri": "http://localhost", "returnSecureToken": true}),
        );
        assert_eq!(signed["localId"], uid, "{signed}");
        expect(&s, &t, uid, Some(NOW + 100), "after the takeover");
    }
}

/// The remaining setters, each after a rewind below an earlier setter so a maximum would show:
/// an anonymous account upgraded by `signUp` with a password (`operations.js:169`), a password
/// reset through its out-of-band code (`:634`), and a batch import over an existing account
/// (`:341`, the overwrite starts from the row).
#[test]
fn upgrade_reset_and_overwrite_assign_the_rewound_second() {
    let s = state(true);
    let t = template(&s);
    set_clock(&s, NOW + 800);
    let anonymous = post(
        &s,
        &format!("{V1}/accounts:signUp"),
        &json!({"returnSecureToken": true}),
    );
    let uid = anonymous["localId"].as_str().unwrap().to_owned();
    admin(
        &s,
        &format!("{ADMIN}/accounts:update"),
        &json!({"localId": uid, "validSince": (NOW + 800).to_string()}),
    );
    set_clock(&s, NOW + 40);
    post(
        &s,
        &format!("{V1}/accounts:signUp"),
        &json!({"idToken": anonymous["idToken"], "email": "upgraded@example.invalid", "password": "password1", "returnSecureToken": true}),
    );
    expect(
        &s,
        &t,
        &uid,
        Some(NOW + 40),
        "anonymous upgraded with a password",
    );

    set_clock(&s, NOW + 800);
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "reset", "email": "reset@example.invalid", "password": "password1"}),
    );
    set_clock(&s, NOW + 50);
    post(
        &s,
        &format!("{V1}/accounts:sendOobCode"),
        &json!({"requestType": "PASSWORD_RESET", "email": "reset@example.invalid"}),
    );
    let code = oob_code(&s, "PASSWORD_RESET");
    post(
        &s,
        &format!("{V1}/accounts:resetPassword"),
        &json!({"oobCode": code, "newPassword": "password2"}),
    );
    expect(&s, &t, "reset", Some(NOW + 50), "password reset");

    set_clock(&s, NOW + 800);
    admin(
        &s,
        &format!("{ADMIN}/accounts"),
        &json!({"localId": "overwritten", "email": "overwritten@example.invalid", "password": "password1"}),
    );
    set_clock(&s, NOW + 60);
    admin(
        &s,
        &format!("{ADMIN}/accounts:batchCreate"),
        &json!({"users": [{"localId": "overwritten", "email": "overwritten@example.invalid"}], "allowOverwrite": true}),
    );
    expect(
        &s,
        &t,
        "overwritten",
        Some(NOW + 60),
        "batch import over an existing account",
    );
}
