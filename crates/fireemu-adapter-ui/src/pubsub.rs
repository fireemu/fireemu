//! Guarded, bounded front to this runtime's Cloud Pub/Sub REST surface.
//!
//! Only explicit project-scoped topic, subscription and snapshot operations are admitted,
//! forwarded strictly to the bound loopback Pub/Sub listener.

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use crate::{UiBody, UiRequest, UiResponse, UiState, MAX_JSON_BODY_BYTES};

/// Trusted runtime wiring for the Pub/Sub listener.
#[derive(Clone, Debug)]
pub struct PubSubEndpoint {
    /// Bound Pub/Sub listener address.
    pub address: SocketAddr,
    /// Optional configured local bearer token (`pubsub.authentication.localBearerToken`).
    /// Forwarded only when set; strict mode rejects unexpected Authorization headers when unset.
    pub bearer_token: Option<String>,
}

impl PubSubEndpoint {
    /// Connect only to loopback at the bound port, preserving its address family.
    #[must_use]
    pub fn loopback(&self) -> SocketAddr {
        SocketAddr::new(
            match self.address.ip() {
                IpAddr::V4(_) => IpAddr::V4(Ipv4Addr::LOCALHOST),
                IpAddr::V6(_) => IpAddr::V6(Ipv6Addr::LOCALHOST),
            },
            self.address.port(),
        )
    }
}

/// Validated request ready to forward to loopback Pub/Sub.
#[derive(Debug, PartialEq, Eq)]
pub struct PubSubPlan {
    /// Target path and optional query string (`/v1/projects/...`).
    pub target: String,
}

fn invalid(message: &str) -> UiResponse {
    UiResponse::error(400, &format!("INVALID_ARGUMENT : {message}"))
}

fn valid_id(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= 255
        && !segment.contains("..")
        && !crate::has_control_chars(segment)
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'+' | b'%'))
}

fn validate_query(query: &str) -> Result<(), UiResponse> {
    if query.is_empty() {
        return Ok(());
    }
    if crate::has_control_chars(query)
        || !fireemu_core_types::codec::percent_escapes_are_well_formed(query)
    {
        return Err(invalid("malformed Pub/Sub query string"));
    }
    for pair in query.split('&').filter(|part| !part.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let decoded_key = String::from_utf8(fireemu_core_types::codec::percent_decode_bytes(
            key,
            fireemu_core_types::codec::PlusMode::Literal,
        ))
        .map_err(|_| invalid("invalid UTF-8 in Pub/Sub query"))?;
        let decoded_value = String::from_utf8(fireemu_core_types::codec::percent_decode_bytes(
            value,
            fireemu_core_types::codec::PlusMode::Literal,
        ))
        .map_err(|_| invalid("invalid UTF-8 in Pub/Sub query"))?;
        if crate::has_control_chars(&decoded_key) || crate::has_control_chars(&decoded_value) {
            return Err(invalid("control character in Pub/Sub query"));
        }
        if !matches!(
            decoded_key.as_str(),
            "pageSize" | "pageToken" | "updateMask"
        ) {
            return Err(invalid("unsupported Pub/Sub query parameter"));
        }
    }
    Ok(())
}

/// Validates a `/ui/api/pubsub/{rest}` request against known session projects and allowed routes.
pub fn prepare(
    sessions: &BTreeMap<String, String>,
    rest: &str,
    req: &UiRequest,
) -> Result<PubSubPlan, UiResponse> {
    if req.body.len() > MAX_JSON_BODY_BYTES {
        return Err(UiResponse::error(413, "PAYLOAD_TOO_LARGE"));
    }
    if crate::has_control_chars(rest) {
        return Err(invalid("control character in Pub/Sub path"));
    }
    let Some(after_v1) = rest.strip_prefix("v1/projects/") else {
        return Err(UiResponse::error(
            404,
            "NOT_FOUND : only /v1/projects/{project}/... Pub/Sub routes are exposed",
        ));
    };
    let parts: Vec<&str> = after_v1.split('/').collect();
    if parts.len() < 2 || !valid_id(parts[0]) {
        return Err(invalid("invalid Pub/Sub project path"));
    }
    let project = parts[0];
    if !sessions.values().any(|known| known == project) {
        return Err(UiResponse::error(
            404,
            &format!("NOT_FOUND : no session owns project {project:?}"),
        ));
    }
    let method = req.method.as_str();
    let admitted = match (parts[1], &parts[2..]) {
        ("topics", []) => method == "GET",
        ("topics", [leaf]) => match leaf.split_once(':') {
            Some((id, "publish")) => valid_id(id) && method == "POST",
            Some(_) => false,
            None => valid_id(leaf) && matches!(method, "GET" | "PUT" | "PATCH" | "DELETE"),
        },
        ("topics", [id, sub]) if matches!(*sub, "subscriptions" | "snapshots") => {
            valid_id(id) && method == "GET"
        }
        ("subscriptions", []) => method == "GET",
        ("subscriptions", [leaf]) => match leaf.split_once(':') {
            Some((id, op))
                if matches!(op, "pull" | "acknowledge" | "modifyAckDeadline" | "seek") =>
            {
                valid_id(id) && method == "POST"
            }
            Some(_) => false,
            None => valid_id(leaf) && matches!(method, "GET" | "PUT" | "PATCH" | "DELETE"),
        },
        ("snapshots", []) => method == "GET",
        ("snapshots", [leaf]) => {
            !leaf.contains(':') && valid_id(leaf) && matches!(method, "GET" | "PUT" | "DELETE")
        }
        _ => false,
    };
    if !admitted {
        return Err(UiResponse::error(
            404,
            "NOT_FOUND : unsupported Pub/Sub route or method",
        ));
    }
    validate_query(&req.query)?;
    let target = if req.query.is_empty() {
        format!("/{rest}")
    } else {
        format!("/{rest}?{}", req.query)
    };
    Ok(PubSubPlan { target })
}

/// Routes `/ui/api/pubsub/{rest}` to the runtime's loopback Pub/Sub listener.
pub async fn route(state: &Arc<UiState>, rest: &str, req: &UiRequest) -> UiResponse {
    let Some(endpoint) = &state.pubsub else {
        return UiResponse::error(
            503,
            "UNAVAILABLE : Pub/Sub is not running (include pubsub in --only)",
        );
    };
    let sessions = match state.control.sessions.lock() {
        Ok(sessions) => sessions.clone(),
        Err(_) => return UiResponse::error(503, "UNAVAILABLE : session registry unavailable"),
    };
    let plan = match prepare(&sessions, rest, req) {
        Ok(plan) => plan,
        Err(refusal) => return refusal,
    };
    let mut headers = Vec::new();
    if !req.body.is_empty() {
        headers.push(("content-type".to_owned(), "application/json".to_owned()));
    }
    if let Some(token) = endpoint.bearer_token.as_deref().filter(|t| !t.is_empty()) {
        headers.push(("authorization".to_owned(), format!("Bearer {token}")));
    }
    let result = match tokio::time::timeout(
        Duration::from_secs(15),
        fireemu_adapter_functions::http::forward(
            &endpoint.loopback().to_string(),
            &req.method,
            &plan.target,
            &headers,
            &req.body,
        ),
    )
    .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(message)) => {
            return UiResponse::error(502, &format!("BAD_GATEWAY : Pub/Sub transport failed: {message}"));
        }
        Err(_) => {
            return UiResponse::error(504, "DEADLINE_EXCEEDED : Pub/Sub request timed out");
        }
    };
    if result.body.len() > 4 * 1024 * 1024 {
        return UiResponse::error(502, "BAD_GATEWAY : Pub/Sub response exceeds console limit");
    }
    let mut out_headers: Vec<(String, String)> = result
        .headers
        .into_iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .collect();
    if out_headers.is_empty() {
        out_headers.push((
            "content-type".to_owned(),
            "application/json; charset=utf-8".to_owned(),
        ));
    }
    out_headers.push(("cache-control".to_owned(), "no-store".to_owned()));
    out_headers.push(("x-content-type-options".to_owned(), "nosniff".to_owned()));
    UiResponse {
        status: result.status,
        headers: out_headers,
        body: UiBody::Full(result.body.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sessions() -> BTreeMap<String, String> {
        BTreeMap::from([("default".to_owned(), "demo-app".to_owned())])
    }

    fn req(method: &str, query: &str) -> UiRequest {
        UiRequest {
            method: method.to_owned(),
            path: String::new(),
            query: query.to_owned(),
            headers: BTreeMap::new(),
            body: Vec::new(),
        }
    }

    #[test]
    fn admits_supported_pubsub_routes_and_rejects_unknown_or_cross_project_paths() {
        let s = sessions();
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/topics", &req("GET", "pageSize=20"))
                .unwrap()
                .target,
            "/v1/projects/demo-app/topics?pageSize=20"
        );
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/topics/jobs", &req("PUT", ""))
                .unwrap()
                .target,
            "/v1/projects/demo-app/topics/jobs"
        );
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/topics/jobs:publish", &req("POST", ""))
                .unwrap()
                .target,
            "/v1/projects/demo-app/topics/jobs:publish"
        );
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/subscriptions/worker:pull", &req("POST", ""))
                .unwrap()
                .target,
            "/v1/projects/demo-app/subscriptions/worker:pull"
        );
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/subscriptions/worker:acknowledge", &req("POST", ""))
                .unwrap()
                .target,
            "/v1/projects/demo-app/subscriptions/worker:acknowledge"
        );
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/snapshots", &req("GET", ""))
                .unwrap()
                .target,
            "/v1/projects/demo-app/snapshots"
        );

        // Unknown project refused.
        assert_eq!(
            prepare(&s, "v1/projects/other/topics", &req("GET", ""))
                .unwrap_err()
                .status,
            404
        );
        // IAM / arbitrary verbs refused.
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/topics/jobs:setIamPolicy", &req("POST", ""))
                .unwrap_err()
                .status,
            404
        );
        // Traversal and unsupported query params refused.
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/topics/..", &req("GET", ""))
                .unwrap_err()
                .status,
            404
        );
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/topics", &req("GET", "access_token=bad"))
                .unwrap_err()
                .status,
            400
        );
        // Wrong method refused.
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/topics/jobs:publish", &req("GET", ""))
                .unwrap_err()
                .status,
            404
        );
    }

    #[test]
    fn refuses_oversized_body_and_control_characters() {
        let s = sessions();
        let mut big = req("POST", "");
        big.body = vec![b'a'; MAX_JSON_BODY_BYTES + 1];
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/topics/jobs:publish", &big)
                .unwrap_err()
                .status,
            413
        );
        assert_eq!(
            prepare(&s, "v1/projects/demo-app/topics/bad\x00name", &req("GET", ""))
                .unwrap_err()
                .status,
            400
        );
    }
}
