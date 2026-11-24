//! In-process front to this runtime's Remote Config template store.
//!
//! Shares the exact `RemoteConfigStores` served on the HTTP listener so changes made via the
//! Admin SDK and the Emulator UI observe the same versions and `ETags`, and a commit made here
//! takes the same admission and publishes the same Functions event as one made over HTTP.

use crate::{UiBody, UiRequest, UiResponse, UiState, MAX_JSON_BODY_BYTES};

/// Routes `/ui/api/remoteconfig/{rest}` to the shared Remote Config stores.
#[must_use]
pub fn route(state: &UiState, rest: &str, req: &UiRequest) -> UiResponse {
    if req.body.len() > MAX_JSON_BODY_BYTES {
        return UiResponse::error(413, "PAYLOAD_TOO_LARGE");
    }
    let Some(store) = &state.remote_config else {
        return UiResponse::error(
            503,
            "UNAVAILABLE : Remote Config template store is not attached",
        );
    };
    let endpoint = format!("/{rest}");
    let Some(matched) = fireemu_adapter_http::remote_config_http::route(&endpoint) else {
        return UiResponse::error(404, "NOT_FOUND : unknown Remote Config route");
    };
    if matched.project != state.control.default_project {
        return UiResponse::error(
            404,
            &format!(
                "NOT_FOUND : Remote Config templates belong to the default project ({})",
                state.control.default_project
            ),
        );
    }
    let now = match state.control.clock.lock() {
        Ok(clock) => clock.snapshot().instant,
        Err(_) => return UiResponse::error(500, "INTERNAL : clock unavailable"),
    };
    // A commit reserves, appends and enqueues its version under admission, exactly as the HTTP
    // listener does, so a reset cannot interleave with it.
    let _admitted = fireemu_adapter_http::remote_config_http::commits(&req.method, &req.query)
        .then(|| {
            state
                .control
                .barrier
                .as_ref()
                .map(|barrier| barrier.admit())
        })
        .flatten();
    let reply = fireemu_adapter_http::remote_config_http::dispatch(
        store,
        &state.control.remote_config,
        &matched,
        &req.method,
        &req.query,
        &req.body,
        req.header("if-match"),
        now,
    );
    let (status, body, etag) = reply.into_wire();
    let mut headers = vec![
        (
            "content-type".to_owned(),
            "application/json; charset=utf-8".to_owned(),
        ),
        ("cache-control".to_owned(), "no-store".to_owned()),
        ("x-content-type-options".to_owned(), "nosniff".to_owned()),
    ];
    if let Some(tag) = etag {
        headers.push(("etag".to_owned(), tag));
    }
    UiResponse {
        status,
        headers,
        body: UiBody::Full(body),
    }
}
