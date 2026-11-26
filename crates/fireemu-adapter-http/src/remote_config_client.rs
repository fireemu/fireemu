//! The client data plane the Web SDK uses: `POST /v1/projects/{project}/namespaces/firebase:fetch`
//! and `POST .../namespaces/firebase:streamFetchInvalidations`, as RC-CLOSURE-B recorded them
//! (two passes, 2026-11-25, Web SDK firebase 12.18.0; coordinator ruling 21).
//!
//! Recorded and implemented:
//! - a fetch answers 200 with the evaluated `entries` (each a string, sorted by key, a parameter
//!   whose chosen value is the in-app default left out), `state` `UPDATE` and `templateVersion`,
//!   written as indented JSON with a final newline, and an `ETag`
//!   `etag-<project>-firebase-fetch-<signed 32-bit number>`;
//! - a fetch whose `If-None-Match` is the current tag answers 200 `{"state": "NO_CHANGE",
//!   "templateVersion": ...}` with the same tag (the SDK sends `*` when it has none);
//! - a conditional value is chosen by the first condition, in the template's condition order,
//!   that matches the request's `custom_signals` and installation id (custom-signal exact match
//!   and numeric comparison, seeded percent);
//! - the realtime stream holds its answer until the client template's version is newer than the
//!   request's `lastKnownVersionNumber`, then writes `[{\n  "latestTemplateVersionNumber": "N"\n}\n`
//!   and, for each later version, `,\r\n{\n  "latestTemplateVersionNumber": "N"\n}\n`, on every
//!   publication and rollback (a metadata-only and a same-content publication included).
//!
//! Not recorded, and documented as known differences (known-differences.json of
//! remote-config-web): the number in the tag (production's is a hash of an input that was not
//! recovered; this one is the same kind of hash of the evaluated entries and the version), the
//! percent hash for a client (this one is the server template's, with the installation id), the
//! answer before any publication (`NO_TEMPLATE`), the stream when the template is already newer
//! on arrival (its first frame at once), and the transport encoding (production answered gzip).

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::remote_config::{Change, Version};

/// The two client routes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClientAction {
    /// `namespaces/firebase:fetch`.
    Fetch,
    /// `namespaces/firebase:streamFetchInvalidations`.
    Stream,
}

/// Parses `/v1/projects/{project}/namespaces/firebase:{fetch|streamFetchInvalidations}` (the
/// query is not part of `path`), returning the project and the action.
#[must_use]
pub fn client_route(path: &str) -> Option<(&str, ClientAction)> {
    let (project, rest) = path.strip_prefix("/v1/projects/")?.split_once('/')?;
    if project.is_empty() {
        return None;
    }
    match rest {
        "namespaces/firebase:fetch" => Some((project, ClientAction::Fetch)),
        "namespaces/firebase:streamFetchInvalidations" => Some((project, ClientAction::Stream)),
        _ => None,
    }
}

/// One answer of the fetch route.
#[derive(Debug, PartialEq, Eq)]
pub struct FetchReply {
    /// HTTP status.
    pub status: u16,
    /// The JSON body as written.
    pub body: Vec<u8>,
    /// The `ETag` header, when the answer has one.
    pub etag: Option<String>,
}

fn written(value: &Value) -> Vec<u8> {
    let mut body = serde_json::to_vec_pretty(value).unwrap_or_default();
    body.push(b'\n');
    body
}

fn refusal(status: u16, message: &str, code: &str) -> FetchReply {
    FetchReply {
        status,
        body: written(&json!({"error": {"code": status, "message": message, "status": code}})),
        etag: None,
    }
}

/// A deterministic signed 32-bit tag for the evaluated entries and published version.
fn etag(project: &str, version: u64, entries: &BTreeMap<String, String>) -> String {
    let mut hash = Sha256::new();
    hash.update(version.to_be_bytes());
    hash.update(serde_json::to_vec(entries).unwrap_or_default());
    let hash = hash.finalize();
    let number = i32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]);
    format!("etag-{project}-firebase-fetch-{number}")
}

/// The installation's position in a percent condition's range, in micro-percent: the Admin SDK's
/// server-template hash (SHA-256 of `<seed>.<id>`, or of the id without a seed, modulo 10^8).
fn micro_percentile(seed: Option<&str>, instance: &str) -> u64 {
    let input = seed
        .filter(|seed| !seed.is_empty())
        .map_or_else(|| instance.to_owned(), |seed| format!("{seed}.{instance}"));
    Sha256::digest(input.as_bytes())
        .iter()
        .fold(0_u64, |rest, byte| {
            (rest * 256 + u64::from(*byte)) % 100_000_000
        })
}

fn signal_text(signals: &Map<String, Value>, key: &str) -> Option<String> {
    match signals.get(key)? {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn atom_holds(atom: &Value, signals: &Map<String, Value>, instance: &str) -> bool {
    if let Some(percent) = atom.get("percent") {
        let at = micro_percentile(percent.get("seed").and_then(Value::as_str), instance);
        let micro = percent.get("microPercent").and_then(Value::as_u64);
        return match percent.get("percentOperator").and_then(Value::as_str) {
            Some("LESS_OR_EQUAL") => micro.is_some_and(|m| at <= m),
            Some("GREATER_THAN") => micro.is_some_and(|m| at > m),
            Some("BETWEEN") => {
                let range = &percent["microPercentRange"];
                match (
                    range["microPercentLowerBound"].as_u64(),
                    range["microPercentUpperBound"].as_u64(),
                ) {
                    (Some(lower), Some(upper)) => at > lower && at <= upper,
                    _ => false,
                }
            }
            _ => false,
        };
    }
    let Some(signal) = atom.get("customSignal") else {
        return false;
    };
    let key = signal["customSignalKey"].as_str().unwrap_or_default();
    let Some(actual) = signal_text(signals, key) else {
        return false;
    };
    let targets: Vec<&str> = signal["targetCustomSignalValues"]
        .as_array()
        .map(|values| values.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let numeric = |holds: fn(f64, f64) -> bool| match (
        actual.trim().parse::<f64>(),
        targets.first().map(|t| t.parse::<f64>()),
    ) {
        (Ok(actual), Some(Ok(target))) => holds(actual, target),
        _ => false,
    };
    match signal["customSignalOperator"].as_str().unwrap_or_default() {
        "STRING_EXACTLY_MATCHES" => targets.contains(&actual.as_str()),
        "STRING_CONTAINS" => targets.iter().any(|t| actual.contains(t)),
        "STRING_DOES_NOT_CONTAIN" => !targets.iter().any(|t| actual.contains(t)),
        "NUMERIC_LESS_THAN" => numeric(|a, t| a < t),
        "NUMERIC_LESS_EQUAL" => numeric(|a, t| a <= t),
        "NUMERIC_EQUAL" => numeric(|a, t| a.partial_cmp(&t).is_some_and(std::cmp::Ordering::is_eq)),
        "NUMERIC_NOT_EQUAL" => {
            numeric(|a, t| a.partial_cmp(&t).is_some_and(std::cmp::Ordering::is_ne))
        }
        "NUMERIC_GREATER_THAN" => numeric(|a, t| a > t),
        "NUMERIC_GREATER_EQUAL" => numeric(|a, t| a >= t),
        // Semantic-version and regular-expression atoms were not recorded for a client.
        _ => false,
    }
}

/// Whether a client condition expression holds. The recorded forms are the server template's
/// (`&&` chains of custom-signal and percent atoms); any other expression does not hold.
fn condition_holds(expression: &str, signals: &Map<String, Value>, instance: &str) -> bool {
    let structured = crate::remote_config_conditions::structured(expression);
    let Some(atoms) = structured
        .pointer("/orCondition/conditions/0/andCondition/conditions")
        .and_then(Value::as_array)
    else {
        return false;
    };
    !atoms.is_empty() && atoms.iter().all(|atom| atom_holds(atom, signals, instance))
}

/// The evaluated entries of a client template for one request.
fn entries(
    document: &Value,
    signals: &Map<String, Value>,
    instance: &str,
) -> BTreeMap<String, String> {
    let matched: Vec<&str> = document["conditions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|condition| {
            condition["expression"]
                .as_str()
                .is_some_and(|expression| condition_holds(expression, signals, instance))
        })
        .filter_map(|condition| condition["name"].as_str())
        .collect();
    let grouped = document["parameterGroups"]
        .as_object()
        .into_iter()
        .flat_map(|groups| groups.values())
        .filter_map(|group| group["parameters"].as_object());
    let mut out = BTreeMap::new();
    for parameters in document["parameters"]
        .as_object()
        .into_iter()
        .chain(grouped)
    {
        for (name, parameter) in parameters {
            let chosen = matched
                .iter()
                .find_map(|condition| parameter.get("conditionalValues")?.get(*condition))
                .or_else(|| parameter.get("defaultValue"));
            if let Some(value) = chosen
                .and_then(|chosen| chosen.get("value"))
                .and_then(Value::as_str)
            {
                out.insert(name.clone(), value.to_owned());
            }
        }
    }
    out
}

/// Answers one fetch of the client template `current` for `project`.
#[must_use]
pub fn fetch(
    current: &Version,
    project: &str,
    if_none_match: Option<&str>,
    body: &[u8],
) -> FetchReply {
    let Ok(Value::Object(request)) = serde_json::from_slice::<Value>(body) else {
        return refusal(400, "Invalid JSON payload received.", "INVALID_ARGUMENT");
    };
    let signals = request
        .get("custom_signals")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let instance = request
        .get("app_instance_id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let version = current.number();
    if current.change() == Change::Initial {
        // Not recorded: the answer before the client template is published.
        let empty = BTreeMap::new();
        return FetchReply {
            status: 200,
            body: written(&json!({"state": "NO_TEMPLATE"})),
            etag: Some(etag(project, version, &empty)),
        };
    }
    let entries = entries(current.template().document(), &signals, instance);
    let tag = etag(project, version, &entries);
    let version_text = version.to_string();
    let body = if if_none_match == Some(tag.as_str()) {
        json!({"state": "NO_CHANGE", "templateVersion": version_text})
    } else {
        json!({"entries": entries, "state": "UPDATE", "templateVersion": version_text})
    };
    FetchReply {
        status: 200,
        body: written(&body),
        etag: Some(tag),
    }
}

/// The `lastKnownVersionNumber` of a stream request (a decimal string; absent or unreadable is 0).
#[must_use]
pub fn last_known(body: &[u8]) -> u64 {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|request| match request.get("lastKnownVersionNumber")? {
            Value::String(text) => text.parse().ok(),
            Value::Number(number) => number.as_u64(),
            _ => None,
        })
        .unwrap_or(0)
}

/// One frame of the realtime stream, as production wrote it: the first opens the array.
#[must_use]
pub fn frame(first: bool, version: u64) -> Vec<u8> {
    let object = format!("{{\n  \"latestTemplateVersionNumber\": \"{version}\"\n}}\n");
    let mut out = Vec::with_capacity(object.len() + 3);
    out.extend_from_slice(if first { b"[" } else { b",\r\n" });
    out.extend_from_slice(object.as_bytes());
    out
}

#[cfg(test)]
#[path = "remote_config_client_tests.rs"]
mod tests;
