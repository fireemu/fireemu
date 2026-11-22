//! The embedded single-page app: static files with content types and cache policy, the
//! runtime configuration injected into `index.html`, and the SPA fallback.

use include_dir::{include_dir, Dir};
use serde_json::Value;

/// The built app (or the placeholder page, see `build.rs`).
static UI_DIR: Dir<'_> = include_dir!("$OUT_DIR/ui");

/// Whether the binary carries the real app rather than the placeholder page.
#[must_use]
pub fn bundled() -> bool {
    UI_DIR
        .get_file("fireemu-ui.json")
        .and_then(|f| f.contents_utf8())
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|v| v.get("bundled").and_then(Value::as_bool))
        .unwrap_or(false)
}

/// One static file ready to serve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asset {
    /// `Content-Type`.
    pub content_type: &'static str,
    /// `Cache-Control`.
    pub cache_control: &'static str,
    /// Bytes.
    pub body: Vec<u8>,
}

pub(crate) struct ResolvedAsset<B> {
    pub(crate) content_type: &'static str,
    pub(crate) cache_control: &'static str,
    pub(crate) body: B,
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" | "webmanifest" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Serialises `config` for a `<script>` block: `<` is escaped so no value can close the
/// script element, whatever it contains.
fn script_json(config: &Value) -> String {
    config.to_string().replace('<', "\\u003c")
}

/// `index.html` with `window.__FIREEMU__` (the runtime configuration the app needs before its
/// first request) injected at the end of `<head>` as a script carrying `nonce` (the page's
/// Content Security Policy allows only it and the bundle).
#[must_use]
pub fn index_html(config: &Value, nonce: &str) -> Vec<u8> {
    let template = UI_DIR
        .get_file("index.html")
        .and_then(|f| f.contents_utf8())
        .unwrap_or("<!doctype html><html><head></head><body></body></html>");
    let script = format!(
        "<script nonce=\"{nonce}\">window.__FIREEMU__ = {};</script>",
        script_json(config)
    );
    let injected = match template.find("</head>") {
        Some(at) => format!("{}{script}{}", &template[..at], &template[at..]),
        None => format!("{script}{template}"),
    };
    injected.into_bytes()
}

/// Resolves a request path under `/ui` (already stripped of the prefix; `""` or `"/"` is the
/// app root). Unknown paths that look like app routes (no file extension) fall back to
/// `index.html` so a deep link loads the app; unknown files are `None`.
#[must_use]
pub fn resolve(path: &str, config: &Value, nonce: &str) -> Option<Asset> {
    resolve_with(path, <[u8]>::to_vec, || index_html(config, nonce)).map(|asset| Asset {
        content_type: asset.content_type,
        cache_control: asset.cache_control,
        body: asset.body,
    })
}

pub(crate) fn resolve_bytes(
    path: &str,
    render_index: impl FnOnce() -> Vec<u8>,
) -> Option<ResolvedAsset<bytes::Bytes>> {
    resolve_with(path, bytes::Bytes::from_static, || {
        bytes::Bytes::from(render_index())
    })
}

fn resolve_with<B>(
    path: &str,
    static_body: impl FnOnce(&'static [u8]) -> B,
    render_index: impl FnOnce() -> B,
) -> Option<ResolvedAsset<B>> {
    let rel = path.trim_start_matches('/');
    if rel.is_empty() || rel == "index.html" {
        return Some(ResolvedAsset {
            content_type: content_type("index.html"),
            cache_control: "no-cache",
            body: render_index(),
        });
    }
    if rel == "fireemu-ui.json" || rel.contains("..") {
        return None;
    }
    if let Some(file) = UI_DIR.get_file(rel) {
        let immutable = rel.starts_with("assets/");
        return Some(ResolvedAsset {
            content_type: content_type(rel),
            cache_control: if immutable {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            },
            body: static_body(file.contents()),
        });
    }
    let last = rel.rsplit('/').next().unwrap_or(rel);
    if last.contains('.') {
        return None;
    }
    Some(ResolvedAsset {
        content_type: content_type("index.html"),
        cache_control: "no-cache",
        body: render_index(),
    })
}

#[cfg(test)]
mod tests {
    use super::Asset;

    #[test]
    #[allow(
        clippy::default_trait_access,
        reason = "An explicitly typed body would bypass the inference regression."
    )]
    fn asset_struct_literal_infers_default_body() {
        let asset = Asset {
            content_type: "application/octet-stream",
            cache_control: "no-cache",
            body: Default::default(),
        };
        assert_eq!(asset.cache_control, "no-cache");
    }
}
