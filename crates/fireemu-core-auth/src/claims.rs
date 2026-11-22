//! ID token claims and custom claims (spec 12A.3, 12A.4).

use core::fmt;
use core::fmt::Write as _;
use std::collections::BTreeMap;

use fireemu_core_limits::catalogs::FIREBASE_AUTH_2026_08_30;
use fireemu_core_limits::evaluate::{
    evaluate, LimitDisposition, LimitViolation, DEFAULT_THRESHOLDS,
};
use fireemu_core_limits::plan::FirestorePlanProfile;

/// JSON-like claim value with canonical key ordering.
#[derive(Debug, Clone, PartialEq)]
pub enum ClaimValue {
    /// `null`
    Null,
    /// Boolean.
    Bool(bool),
    /// Integer.
    Int(i64),
    /// Float.
    Float(f64),
    /// String.
    String(String),
    /// List.
    List(Vec<ClaimValue>),
    /// Map (canonical key order).
    Map(BTreeMap<String, ClaimValue>),
}

impl ClaimValue {
    /// The same value read from a parsed JSON document.
    #[must_use]
    pub fn from_json(value: &fireemu_core_types::json::JsonValue) -> Self {
        use fireemu_core_types::json::JsonValue;
        match value {
            JsonValue::Null => Self::Null,
            JsonValue::Bool(b) => Self::Bool(*b),
            JsonValue::Int(i) => Self::Int(*i),
            JsonValue::Float(f) => Self::Float(*f),
            JsonValue::String(s) => Self::String(s.clone()),
            JsonValue::Array(items) => Self::List(items.iter().map(Self::from_json).collect()),
            JsonValue::Object(members) => Self::Map(
                members
                    .iter()
                    .map(|(k, v)| (k.clone(), Self::from_json(v)))
                    .collect(),
            ),
        }
    }
}

/// Writes `s` as a JSON string literal.
pub fn write_json_string(out: &mut String, s: &str) {
    fireemu_core_types::codec::write_json_string(
        out,
        s,
        fireemu_core_types::codec::JsonControlEscape::Unicode,
    );
}

impl ClaimValue {
    /// Appends the canonical JSON encoding (sorted keys, no whitespace).
    pub fn write_canonical_json(&self, out: &mut String) {
        match self {
            Self::Null => out.push_str("null"),
            Self::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Self::Int(i) => out.push_str(&i.to_string()),
            Self::Float(f) => {
                if f.is_finite() {
                    let _ = write!(out, "{f:?}");
                } else {
                    out.push_str("null");
                }
            }
            Self::String(s) => write_json_string(out, s),
            Self::List(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    item.write_canonical_json(out);
                }
                out.push(']');
            }
            Self::Map(entries) => write_map(out, entries),
        }
    }
}

/// The canonical JSON of a claim map (sorted keys, no whitespace).
#[must_use]
pub fn canonical_map_json(entries: &BTreeMap<String, ClaimValue>) -> String {
    let mut out = String::new();
    write_map(&mut out, entries);
    out
}

fn write_map(out: &mut String, entries: &BTreeMap<String, ClaimValue>) {
    out.push('{');
    for (i, (k, v)) in entries.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        write_json_string(out, k);
        out.push(':');
        v.write_canonical_json(out);
    }
    out.push('}');
}

/// Claim names reserved by OIDC / Firebase that custom claims may not use. `user_id` is not
/// among them: production stores it (sandbox recording 2026-09-23) and the ID token's own
/// `user_id` still takes precedence when the token is assembled.
pub const RESERVED_CLAIM_NAMES: &[&str] = &[
    "acr",
    "amr",
    "at_hash",
    "aud",
    "auth_time",
    "azp",
    "c_hash",
    "cnf",
    "email",
    "email_verified",
    "exp",
    "firebase",
    "iat",
    "identities",
    "iss",
    "jti",
    "nbf",
    "nonce",
    "phone_number",
    "sign_in_provider",
    "sub",
];

/// Claim names the Firebase Functions SDK rejects in Blocking Auth responses.
///
/// This list is intentionally narrower than [`RESERVED_CLAIM_NAMES`]. Blocking Auth is a
/// distinct protocol boundary: the SDK permits names such as `sub`, while the ID-token encoder
/// below still gives protocol-owned claims precedence when the token is assembled.
pub const BLOCKING_RESPONSE_RESERVED_CLAIM_NAMES: &[&str] = &[
    "acr",
    "amr",
    "at_hash",
    "aud",
    "auth_time",
    "azp",
    "cnf",
    "c_hash",
    "exp",
    "iat",
    "iss",
    "jti",
    "nbf",
    "nonce",
    "firebase",
];

/// Custom claims errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CustomClaimsError {
    /// A reserved claim name was used.
    ReservedName(String),
    /// Empty claim name.
    EmptyName,
    /// The `customAttributes` text is not a JSON object.
    NotAnObject,
}

impl fmt::Display for CustomClaimsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReservedName(n) => write!(f, "claim name {n:?} is reserved"),
            Self::EmptyName => f.write_str("claim name is empty"),
            Self::NotAnObject => f.write_str("customAttributes is not a JSON object"),
        }
    }
}

impl std::error::Error for CustomClaimsError {}

/// Custom claims set through the Admin SDK.
#[derive(Debug, Clone, Default)]
pub struct CustomClaims {
    entries: BTreeMap<String, ClaimValue>,
    /// The `customAttributes` text the claims were set from, which production reads back as
    /// given (key order and an empty `{}` included). Any later change drops it.
    source: Option<String>,
}

/// Claims compare by their entries: the text they were set from is a presentation detail.
impl PartialEq for CustomClaims {
    fn eq(&self, other: &Self) -> bool {
        self.entries == other.entries
    }
}

impl CustomClaims {
    /// The claims as a map, in canonical key order.
    #[must_use]
    pub const fn entries_map(&self) -> &BTreeMap<String, ClaimValue> {
        &self.entries
    }

    /// Inserts a claim, rejecting reserved names.
    pub fn insert(&mut self, name: &str, value: ClaimValue) -> Result<(), CustomClaimsError> {
        if name.is_empty() {
            return Err(CustomClaimsError::EmptyName);
        }
        if RESERVED_CLAIM_NAMES.contains(&name) {
            return Err(CustomClaimsError::ReservedName(name.to_owned()));
        }
        self.source = None;
        self.entries.insert(name.to_owned(), value);
        Ok(())
    }

    /// Inserts a claim returned by a Blocking Auth function.
    ///
    /// The Functions SDK applies its own reserved-name list and permits an empty property name.
    /// Callers must separately enforce its `JSON.stringify(...).length` boundary before using
    /// this method.
    pub fn insert_blocking_response(
        &mut self,
        name: &str,
        value: ClaimValue,
    ) -> Result<(), CustomClaimsError> {
        if BLOCKING_RESPONSE_RESERVED_CLAIM_NAMES.contains(&name) {
            return Err(CustomClaimsError::ReservedName(name.to_owned()));
        }
        self.source = None;
        self.entries.insert(name.to_owned(), value);
        Ok(())
    }

    /// Looks up a claim.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<&ClaimValue> {
        self.entries.get(name)
    }

    /// Removes a claim, returning whether it was present.
    pub fn remove(&mut self, name: &str) -> bool {
        let removed = self.entries.remove(name).is_some();
        if removed {
            self.source = None;
        }
        removed
    }

    /// Entries in canonical order.
    #[must_use]
    pub const fn entries(&self) -> &BTreeMap<String, ClaimValue> {
        &self.entries
    }

    /// Parses the `customAttributes` text an export or the Identity Toolkit carries.
    ///
    /// The API transports custom claims as a JSON *string* holding an object, so an import
    /// has to parse it back. A reserved claim name is refused rather than dropped: an
    /// artifact that smuggled `sub` or `iss` into the claims would otherwise silently change
    /// what every ID token of that account says.
    pub fn parse_attributes(text: &str) -> Result<Self, CustomClaimsError> {
        let parsed =
            fireemu_core_types::json::parse(text).map_err(|_| CustomClaimsError::NotAnObject)?;
        let fireemu_core_types::json::JsonValue::Object(members) = parsed else {
            return Err(CustomClaimsError::NotAnObject);
        };
        let mut claims = Self::default();
        for (name, value) in &members {
            claims.insert(name, ClaimValue::from_json(value))?;
        }
        claims.source = Some(text.to_owned());
        Ok(claims)
    }

    /// The same claims, remembered as set from `text` (the `customAttributes` value the
    /// caller parsed them from).
    #[must_use]
    pub fn with_source(mut self, text: &str) -> Self {
        self.source = Some(text.to_owned());
        self
    }

    /// The `customAttributes` value an account reports: the text the claims were set from,
    /// else their canonical JSON; `None` for claims never set.
    #[must_use]
    pub fn attributes_text(&self) -> Option<String> {
        match &self.source {
            Some(text) => Some(text.clone()),
            None if self.entries.is_empty() => None,
            None => Some(self.canonical_json()),
        }
    }

    /// Canonical JSON encoding.
    #[must_use]
    pub fn canonical_json(&self) -> String {
        let mut out = String::new();
        write_map(&mut out, &self.entries);
        out
    }

    /// Checks `AUTH-LIMIT-CUSTOM-CLAIMS-BYTES` on the stored text: the text the claims were set
    /// from when there is one, so padding cannot carry more than the limit (closure security
    /// review 2026-09-24), else the canonical JSON.
    pub fn check_size(&self) -> Result<(), LimitViolation> {
        let def = FIREBASE_AUTH_2026_08_30
            .find("AUTH-LIMIT-CUSTOM-CLAIMS-BYTES")
            .unwrap_or_else(|| unreachable!("catalog entry is checked by catalog tests"));
        let bytes = self
            .source
            .as_ref()
            .map_or_else(|| self.canonical_json().len(), String::len) as u64;
        match evaluate(
            def,
            bytes,
            &FirestorePlanProfile::default(),
            DEFAULT_THRESHOLDS,
        ) {
            LimitDisposition::Reject(v) | LimitDisposition::ObservedOverLimit(v) => Err(v),
            LimitDisposition::Allow | LimitDisposition::AllowWithWarnings(_) => Ok(()),
        }
    }
}

/// The `firebase` claim block.
#[derive(Debug, Clone, PartialEq)]
pub struct FirebaseClaims {
    /// Provider identities, e.g. `{"email": ["a@example.com"]}`.
    pub identities: BTreeMap<String, Vec<String>>,
    /// Sign-in provider (`password`, `anonymous`, `custom`, ...).
    pub sign_in_provider: String,
    /// Second factor used (`totp`), if any.
    pub sign_in_second_factor: Option<String>,
    /// Enrollment ID of the second factor, if any.
    pub second_factor_identifier: Option<String>,
    /// Identity Platform tenant ID, absent for the parent project namespace.
    pub tenant: Option<String>,
    /// Additional attributes from the identity provider used for this sign-in.
    pub sign_in_attributes: Option<ClaimValue>,
    /// Private fireemu control-session incarnation. Ordinary production-shaped stores omit it.
    pub fireemu_session_epoch: Option<String>,
}

/// ID token claims (unsigned; signing is an adapter concern).
#[derive(Debug, Clone, PartialEq)]
pub struct IdTokenClaims {
    /// Issuer `https://securetoken.google.com/{project}`.
    pub iss: String,
    /// Audience (project ID).
    pub aud: String,
    /// Authentication time (Unix seconds).
    pub auth_time: i64,
    /// User ID (duplicate of `sub`, as Firebase emits it).
    pub user_id: String,
    /// Subject.
    pub sub: String,
    /// Issued at.
    pub iat: i64,
    /// Expiry.
    pub exp: i64,
    /// Email, if any.
    pub email: Option<String>,
    /// Email verified flag.
    pub email_verified: bool,
    /// Phone number, if any.
    pub phone_number: Option<String>,
    /// Display name (`name` in the JWT).
    pub display_name: Option<String>,
    /// Profile photo URL (`picture` in the JWT).
    pub photo_url: Option<String>,
    /// `provider_id` at the top level: production sets it to `anonymous` for an anonymous
    /// account and leaves it out otherwise.
    pub provider_id: Option<String>,
    /// Firebase block.
    pub firebase: FirebaseClaims,
    /// Custom claims (merged at the top level when serialized).
    pub custom: CustomClaims,
}

enum ClaimRef<'a> {
    Str(&'a str),
    Bool(bool),
    Int(i64),
    Existing(&'a ClaimValue),
    Firebase(&'a FirebaseClaims),
}

impl ClaimRef<'_> {
    fn write(&self, out: &mut String) {
        match self {
            Self::Str(value) => write_json_string(out, value),
            Self::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Self::Int(value) => {
                let _ = write!(out, "{value}");
            }
            Self::Existing(value) => value.write_canonical_json(out),
            Self::Firebase(value) => write_firebase(out, value),
        }
    }
}

fn write_firebase(out: &mut String, firebase: &FirebaseClaims) {
    out.push('{');
    if let Some(epoch) = &firebase.fireemu_session_epoch {
        out.push_str("\"fireemu_session_epoch\":");
        write_json_string(out, epoch);
        out.push(',');
    }
    out.push_str("\"identities\":{");
    for (index, (provider, ids)) in firebase.identities.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_json_string(out, provider);
        out.push_str(":[");
        for (index, id) in ids.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write_json_string(out, id);
        }
        out.push(']');
    }
    out.push('}');
    if let Some(id) = &firebase.second_factor_identifier {
        out.push_str(",\"second_factor_identifier\":");
        write_json_string(out, id);
    }
    if let Some(attributes) = &firebase.sign_in_attributes {
        out.push_str(",\"sign_in_attributes\":");
        attributes.write_canonical_json(out);
    }
    out.push_str(",\"sign_in_provider\":");
    write_json_string(out, &firebase.sign_in_provider);
    if let Some(factor) = &firebase.sign_in_second_factor {
        out.push_str(",\"sign_in_second_factor\":");
        write_json_string(out, factor);
    }
    if let Some(tenant) = &firebase.tenant {
        out.push_str(",\"tenant\":");
        write_json_string(out, tenant);
    }
    out.push('}');
}

impl IdTokenClaims {
    /// Canonical JSON (sorted keys, no whitespace).
    #[must_use]
    pub fn canonical_json(&self) -> String {
        let mut entries: BTreeMap<&str, ClaimRef<'_>> = self
            .custom
            .entries()
            .iter()
            .map(|(key, value)| (key.as_str(), ClaimRef::Existing(value)))
            .collect();
        entries.extend([
            ("iss", ClaimRef::Str(&self.iss)),
            ("aud", ClaimRef::Str(&self.aud)),
            ("auth_time", ClaimRef::Int(self.auth_time)),
            ("user_id", ClaimRef::Str(&self.user_id)),
            ("sub", ClaimRef::Str(&self.sub)),
            ("iat", ClaimRef::Int(self.iat)),
            ("exp", ClaimRef::Int(self.exp)),
            ("firebase", ClaimRef::Firebase(&self.firebase)),
        ]);
        for (key, value) in [
            ("provider_id", self.provider_id.as_deref()),
            ("email", self.email.as_deref()),
            ("phone_number", self.phone_number.as_deref()),
            ("name", self.display_name.as_deref()),
            ("picture", self.photo_url.as_deref()),
        ] {
            if let Some(value) = value {
                entries.insert(key, ClaimRef::Str(value));
            }
        }
        if self.email.is_some() {
            entries.insert("email_verified", ClaimRef::Bool(self.email_verified));
        }
        let mut out = String::new();
        out.push('{');
        for (index, (key, value)) in entries.into_iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write_json_string(&mut out, key);
            out.push(':');
            value.write(&mut out);
        }
        out.push('}');
        out
    }
}
