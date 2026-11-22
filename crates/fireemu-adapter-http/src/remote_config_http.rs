//! Client-template administration on the daemon's capability-protected local listener.

use std::collections::BTreeMap;

use bytes::Bytes;
use fireemu_adapter_support::api_error::google_rpc;
use fireemu_core_types::codec::{percent_decode, PlusMode};
use fireemu_core_types::time::LogicalInstant;
use serde_json::{json, Map, Value};

use crate::remote_config::{
    Change, ClientTemplate, Error, TemplateStore, Version, WriteMode, WriteResult,
    MAX_RETAINED_VERSIONS,
};

pub(crate) struct Route<'a> {
    pub project: &'a str,
    action: &'a str,
}

pub(crate) fn route(path: &str) -> Option<Route<'_>> {
    let (project, action) = path.strip_prefix("/v1/projects/")?.split_once('/')?;
    match action {
        "remoteConfig" | "remoteConfig:listVersions" | "remoteConfig:rollback" => {
            Some(Route { project, action })
        }
        _ => None,
    }
}

pub(crate) struct Reply {
    pub status: u16,
    body: ReplyBody,
    pub etag: Option<String>,
}

enum ReplyBody {
    Json(Value),
    Rendered(Bytes),
}

fn pretty_json(value: &Value) -> Vec<u8> {
    let mut body = serde_json::to_vec_pretty(value).unwrap_or_default();
    body.push(b'\n');
    body
}

impl Reply {
    pub(crate) fn error(status: u16, message: &str, code: &str) -> Self {
        Self {
            status,
            body: ReplyBody::Json(google_rpc(status, message, code)),
            etag: None,
        }
    }

    pub(crate) fn into_wire(self) -> (u16, Bytes, Option<String>) {
        let body = match self.body {
            ReplyBody::Json(value) => Bytes::from(pretty_json(&value)),
            ReplyBody::Rendered(body) => body,
        };
        (self.status, body, self.etag)
    }

    fn ok(body: Value, etag: Option<String>) -> Self {
        Self {
            status: 200,
            body: ReplyBody::Json(body),
            etag,
        }
    }
}

fn invalid(message: &str) -> Reply {
    Reply::error(400, message, "INVALID_ARGUMENT")
}

fn missing() -> Reply {
    Reply::error(404, "Remote Config template version not found", "NOT_FOUND")
}

fn parameters(query: &str, allowed: &[&str]) -> Result<BTreeMap<String, String>, Reply> {
    let mut result = BTreeMap::new();
    for component in query.split('&').filter(|part| !part.is_empty()) {
        let (raw, value) = component.split_once('=').unwrap_or((component, ""));
        let raw = percent_decode(raw, PlusMode::Space);
        let name = match raw.as_str() {
            "version_number" => "versionNumber",
            "validate_only" => "validateOnly",
            "page_size" => "pageSize",
            "page_token" => "pageToken",
            name => name,
        };
        if !allowed.contains(&name) || result.contains_key(name) {
            return Err(invalid(
                "Unsupported or duplicate Remote Config query parameter",
            ));
        }
        result.insert(name.to_owned(), percent_decode(value, PlusMode::Space));
    }
    Ok(result)
}

fn visible_fields(template: &ClientTemplate) -> Map<String, Value> {
    let object = template
        .document()
        .as_object()
        .expect("validated template object");
    object
        .iter()
        .filter(|(_, value)| visible(value))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn visible(value: &Value) -> bool {
    !value.as_object().is_some_and(Map::is_empty) && !value.as_array().is_some_and(Vec::is_empty)
}

fn version_fields(version: &Version) -> Value {
    let change = version.change();
    let mut output = json!({
        "versionNumber": version.number().to_string(),
        "updateOrigin": "REST_API",
        "updateType": match change {
            Change::Initial => unreachable!("initial state has no published metadata"),
            Change::Publish { forced: true } => "FORCED_UPDATE",
            Change::Publish { forced: false } => "INCREMENTAL_UPDATE",
            Change::Rollback { .. } => "ROLLBACK",
        },
    });
    let description = match change {
        Change::Rollback { source } => Some(format!("Rollback to version {source}")),
        _ => version.template().description().map(str::to_owned),
    };
    if let Some(description) = description {
        output["description"] = json!(description);
    }
    if let Some(time) = version
        .update_time()
        .and_then(|time| time.to_rfc3339().ok())
    {
        output["updateTime"] = json!(time);
    }
    if let Change::Rollback { source } = change {
        output["rollbackSource"] = json!(source.to_string());
    }
    output
}

fn insert_default_types(parameters: &mut Value) {
    if let Some(parameters) = parameters.as_object_mut() {
        for value in parameters.values_mut().filter_map(Value::as_object_mut) {
            value.entry("valueType").or_insert_with(|| json!("STRING"));
        }
    }
}

fn published_body(version: &Version, reading: bool) -> Value {
    let mut body = visible_fields(version.template());
    if reading {
        if let Some(parameters) = body.get_mut("parameters") {
            insert_default_types(parameters);
        }
        if let Some(groups) = body
            .get_mut("parameterGroups")
            .and_then(Value::as_object_mut)
        {
            for parameters in groups
                .values_mut()
                .filter_map(|group| group.get_mut("parameters"))
            {
                insert_default_types(parameters);
            }
        }
    }
    body.insert("version".to_owned(), version_fields(version));
    Value::Object(body)
}

fn published(version: &Version, reading: bool) -> Reply {
    Reply::ok(published_body(version, reading), Some(version.etag()))
}

fn read(store: &TemplateStore, query: &str) -> Result<Reply, Reply> {
    let params = parameters(query, &["versionNumber"])?;
    let requested = params
        .get("versionNumber")
        .map(|value| {
            value
                .parse::<i64>()
                .map_err(|_| invalid("Invalid version number"))
        })
        .transpose()?;
    let requested = requested
        .and_then(|number| u64::try_from(number).ok())
        .filter(|number| *number > 0);
    if let Some(number) = requested {
        let current = store.current();
        return Ok(if current.change() == Change::Initial {
            Reply::ok(json!({}), None)
        } else {
            store.version(number).map_or_else(
                || Reply::ok(json!({}), Some(current.empty_etag())),
                |version| published(&version, true),
            )
        });
    }

    let (version, body) = store.render_current(|version| {
        if version.change() == Change::Initial {
            Bytes::from_static(b"{}\n")
        } else {
            Bytes::from(pretty_json(&published_body(version, true)).into_boxed_slice())
        }
    });
    Ok(Reply {
        status: 200,
        body: ReplyBody::Rendered(body),
        etag: (version.change() != Change::Initial).then(|| version.etag()),
    })
}

fn history(store: &TemplateStore, query: &str) -> Result<Reply, Reply> {
    let params = parameters(query, &["pageSize", "pageToken"])?;
    let limit = params
        .get("pageSize")
        .map(|raw| {
            raw.parse::<i32>()
                .ok()
                .and_then(|size| usize::try_from(size).ok())
                .ok_or_else(|| invalid("Invalid page size"))
        })
        .transpose()?
        .filter(|size| *size > 0)
        .unwrap_or(MAX_RETAINED_VERSIONS)
        .min(MAX_RETAINED_VERSIONS);
    let (page, has_more) = store
        .history_page(limit, params.get("pageToken").map(String::as_str))
        .ok_or_else(|| invalid("Invalid or expired page token"))?;
    let Some(last) = page.last() else {
        return Ok(Reply::ok(json!({}), None));
    };
    let mut body =
        json!({"versions": page.iter().map(|entry| version_fields(entry)).collect::<Vec<_>>()});
    if has_more {
        body["nextPageToken"] = json!(last.etag());
    }
    Ok(Reply::ok(body, None))
}

fn write(
    store: &TemplateStore,
    query: &str,
    bytes: &[u8],
    if_match: Option<&str>,
    now: LogicalInstant,
) -> Result<Reply, Reply> {
    let params = parameters(query, &["validateOnly"])?;
    let mode = match params.get("validateOnly").map(String::as_str) {
        Some("true") => WriteMode::Validate,
        None | Some("false") => WriteMode::Publish,
        Some(_) => return Err(invalid("validateOnly must be a boolean")),
    };
    let body = serde_json::from_slice(bytes).map_err(|_| invalid("Invalid JSON payload"))?;
    match store
        .write(mode, if_match, body, now)
        .map_err(store_error)?
    {
        WriteResult::Validated {
            template,
            base_etag,
        } => {
            let version = template.description().map_or_else(
                || json!({}),
                |description| json!({"description": description}),
            );
            let Value::Object(mut body) = template.into_document() else {
                unreachable!("validated template object")
            };
            body.retain(|_, value| visible(value));
            body.insert("version".to_owned(), version);
            Ok(Reply::ok(
                Value::Object(body),
                Some(format!("{base_etag}-0")),
            ))
        }
        WriteResult::Published(version) => Ok(published(&version, false)),
    }
}

fn rollback(
    store: &TemplateStore,
    query: &str,
    bytes: &[u8],
    now: LogicalInstant,
) -> Result<Reply, Reply> {
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Revision {
        Number(u64),
        Text(String),
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Input {
        #[serde(alias = "version_number")]
        version_number: Revision,
    }

    parameters(query, &[])?;
    let input =
        serde_json::from_slice::<Input>(bytes).map_err(|_| invalid("Invalid rollback request"))?;
    let number = match input.version_number {
        Revision::Number(number) => number,
        Revision::Text(text) => text
            .parse::<u64>()
            .map_err(|_| invalid("Invalid rollback version"))?,
    };
    let version = store.rollback(number, now).map_err(store_error)?;
    Ok(published(&version, false))
}

fn store_error(error: Error) -> Reply {
    match error {
        Error::MissingPrecondition => Reply::error(
            400,
            "[VERSION_MISMATCH]: No If-Match header found in ConditionRequestContext or HTTP headers on UpdateRemoteConfig call",
            "FAILED_PRECONDITION",
        ),
        Error::PreconditionFailed => Reply::error(
            412,
            "The Remote Config ETag does not match",
            "FAILED_PRECONDITION",
        ),
        Error::InvalidTemplate(message) => invalid(&message),
        Error::UnknownVersion => missing(),
        Error::VersionExhausted => {
            Reply::error(500, "Remote Config version number exhausted", "INTERNAL")
        }
    }
}

pub(crate) fn dispatch(
    store: &TemplateStore,
    route: &Route<'_>,
    method: &str,
    query: &str,
    bytes: &[u8],
    if_match: Option<&str>,
    now: LogicalInstant,
) -> Reply {
    let result = match (route.action, method) {
        ("remoteConfig", "GET") => read(store, query),
        ("remoteConfig", "PUT") => write(store, query, bytes, if_match, now),
        ("remoteConfig:listVersions", "GET") => history(store, query),
        ("remoteConfig:rollback", "POST") => rollback(store, query, bytes, now),
        _ => return Reply::error(405, "Method not allowed", "METHOD_NOT_ALLOWED"),
    };
    result.unwrap_or_else(|reply| reply)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_body(reply: &Reply) -> Value {
        match &reply.body {
            ReplyBody::Json(value) => value.clone(),
            ReplyBody::Rendered(bytes) => serde_json::from_slice(bytes).unwrap(),
        }
    }

    fn request(
        store: &TemplateStore,
        action: &str,
        method: &str,
        query: &str,
        body: &[u8],
        if_match: Option<&str>,
    ) -> Reply {
        dispatch(
            store,
            &Route {
                project: "demo-config",
                action,
            },
            method,
            query,
            body,
            if_match,
            LogicalInstant::from_unix_seconds(1_765_000_000),
        )
    }

    #[test]
    fn latest_get_reuses_rendered_bytes_only_within_its_version() {
        let store = TemplateStore::default();
        let latest = || request(&store, "remoteConfig", "GET", "", b"", None).into_wire();
        let publish = |value: &[u8]| request(&store, "remoteConfig", "PUT", "", value, Some("*"));
        assert_eq!(
            publish(br#"{"parameters":{"p":{"defaultValue":{"value":"one"}}}}"#).status,
            200
        );
        let (status, first, first_tag) = latest();
        let (_, repeated, repeated_tag) = latest();
        assert_eq!(status, 200);
        assert_eq!(first_tag, repeated_tag);
        assert_eq!(first, repeated);
        assert_eq!(
            first.as_ptr(),
            repeated.as_ptr(),
            "latest GET rebuilt bytes"
        );
        assert_eq!(
            publish(br#"{"parameters":{"p":{"defaultValue":{"value":"two"}}}}"#).status,
            200
        );
        let (_, after, after_tag) = latest();
        assert_ne!(first_tag, after_tag);
        assert_ne!(first, after);
        let (_, historical, historical_tag) =
            request(&store, "remoteConfig", "GET", "versionNumber=1", b"", None).into_wire();
        assert_eq!(first, historical);
        assert_eq!(first_tag, historical_tag);
    }

    #[test]
    fn historical_reads_distinguish_missing_versions_from_unpublished_templates() {
        let store = TemplateStore::default();
        for (query, status, version, tagged) in [
            ("", 200, None, false),
            ("versionNumber=0", 200, None, false),
            ("versionNumber=-1", 200, None, false),
            ("versionNumber=1", 200, None, false),
            ("versionNumber=9223372036854775807", 200, None, false),
            ("versionNumber=broken", 400, None, false),
            ("versionNumber=9223372036854775808", 400, None, false),
        ] {
            let reply = request(&store, "remoteConfig", "GET", query, b"", None);
            assert_eq!(reply.status, status, "{query}");
            assert_eq!(
                json_body(&reply)["version"]["versionNumber"].as_str(),
                version,
                "{query}"
            );
            assert_eq!(reply.etag.is_some(), tagged, "{query}");
            if status == 200 {
                assert_eq!(json_body(&reply), json!({}), "{query}");
            }
        }

        let first = request(&store, "remoteConfig", "PUT", "", b"{}", Some("*"));
        let second = request(
            &store,
            "remoteConfig",
            "PUT",
            "",
            b"{}",
            first.etag.as_deref(),
        );
        for (query, status, version, tag) in [
            ("", 200, Some("2"), second.etag.as_deref()),
            ("versionNumber=0", 200, Some("2"), second.etag.as_deref()),
            ("versionNumber=-1", 200, Some("2"), second.etag.as_deref()),
            ("versionNumber=1", 200, Some("1"), first.etag.as_deref()),
            ("versionNumber=broken", 400, None, None),
            ("versionNumber=9223372036854775808", 400, None, None),
        ] {
            let reply = request(&store, "remoteConfig", "GET", query, b"", None);
            assert_eq!(reply.status, status, "{query}");
            assert_eq!(
                json_body(&reply)["version"]["versionNumber"].as_str(),
                version,
                "{query}"
            );
            assert_eq!(reply.etag.as_deref(), tag, "{query}");
        }
        let missing = request(
            &store,
            "remoteConfig",
            "GET",
            "versionNumber=9223372036854775807",
            b"",
            None,
        );
        assert_eq!(missing.status, 200);
        assert_eq!(json_body(&missing), json!({}));
        let tag = missing.etag.as_deref().unwrap();
        assert!(tag.starts_with("etag-"));
        assert_ne!(missing.etag, second.etag);
        assert_eq!(
            request(&store, "remoteConfig", "PUT", "", b"{}", Some(tag)).status,
            412
        );
        let rollback = request(
            &store,
            "remoteConfig:rollback",
            "POST",
            "",
            br#"{"versionNumber":"9223372036854775807"}"#,
            None,
        );
        assert_eq!(rollback.status, 404);
        assert_eq!(store.current().number(), 2);
    }

    #[test]
    fn history_defaults_and_caps_page_sizes_without_changing_order() {
        let store = TemplateStore::default();
        for _ in 0..3 {
            assert_eq!(
                request(&store, "remoteConfig", "PUT", "", b"{}", Some("*")).status,
                200
            );
        }
        for (query, expected) in [
            ("", Some(vec!["3", "2", "1"])),
            ("pageSize=0", Some(vec!["3", "2", "1"])),
            ("pageSize=3001", Some(vec!["3", "2", "1"])),
            ("pageSize=1", Some(vec!["3"])),
            ("pageSize=2", Some(vec!["3", "2"])),
            ("pageSize=-1", None),
            ("pageSize=2147483648", None),
            ("pageSize=invalid", None),
        ] {
            let reply = request(&store, "remoteConfig:listVersions", "GET", query, b"", None);
            if let Some(expected) = expected {
                let body = json_body(&reply);
                let versions: Vec<_> = body["versions"]
                    .as_array()
                    .expect("successful history has three retained versions")
                    .iter()
                    .map(|version| version["versionNumber"].as_str().unwrap())
                    .collect();
                assert_eq!(reply.status, 200, "{query}");
                assert_eq!(versions, expected, "{query}");
                assert_eq!(body.get("nextPageToken").is_some(), expected.len() < 3);
            } else {
                assert_eq!(reply.status, 400, "{query}");
            }
        }
    }

    #[test]
    fn validation_returns_version_metadata_and_distinguishes_precondition_failures() {
        let store = TemplateStore::default();
        let first = request(&store, "remoteConfig", "PUT", "", b"{}", Some("*"));
        for (body, expected) in [
            (b"{}".as_slice(), json!({"version":{}})),
            (
                br#"{"version":{"description":"Draft","versionNumber":"9"}}"#.as_slice(),
                json!({"version":{"description":"Draft"}}),
            ),
        ] {
            let reply = request(
                &store,
                "remoteConfig",
                "PUT",
                "validateOnly=true",
                body,
                first.etag.as_deref(),
            );
            assert_eq!(reply.status, 200);
            assert_eq!(json_body(&reply), expected);
            assert!(reply.etag.unwrap().ends_with("-0"));
        }
        for (query, body, tag, status, error) in [
            (
                "validateOnly=true",
                b"{}".as_slice(),
                None,
                400,
                "FAILED_PRECONDITION",
            ),
            ("", b"{}".as_slice(), None, 400, "FAILED_PRECONDITION"),
            (
                "validateOnly=true",
                b"{".as_slice(),
                None,
                400,
                "INVALID_ARGUMENT",
            ),
            (
                "validateOnly=true",
                b"{}".as_slice(),
                Some("old"),
                412,
                "FAILED_PRECONDITION",
            ),
        ] {
            let reply = request(&store, "remoteConfig", "PUT", query, body, tag);
            assert_eq!(reply.status, status);
            assert_eq!(json_body(&reply)["error"]["status"], error);
        }
        assert_eq!(store.current().number(), 1);
        assert_eq!(store.history().len(), 1);
    }

    #[test]
    fn writes_check_wire_types_before_preconditions_and_semantics_after_them() {
        let store = TemplateStore::default();
        let first = request(&store, "remoteConfig", "PUT", "", b"{}", Some("*"));
        let wire_error =
            br#"{"parameters":{"flag":{"valueType":"BOOLEAN","defaultValue":{"value":1}}}}"#;
        let semantic_error =
            br#"{"parameters":{"flag":{"valueType":"BOOLEAN","defaultValue":{"value":"maybe"}}}}"#;
        let missing_reference =
            br#"{"parameters":{"flag":{"conditionalValues":{"unknown":{"value":"a"}}}}}"#;
        for (tag, status) in [
            (None, 400),
            (Some("old"), 412),
            (first.etag.as_deref(), 400),
        ] {
            for (body, wire) in [
                (wire_error.as_slice(), true),
                (semantic_error.as_slice(), false),
                (missing_reference.as_slice(), false),
            ] {
                for query in ["validateOnly=true", ""] {
                    let reply = request(&store, "remoteConfig", "PUT", query, body, tag);
                    let invalid = wire || tag == first.etag.as_deref();
                    assert_eq!(
                        reply.status,
                        if invalid { 400 } else { status },
                        "{query}/{tag:?}"
                    );
                    assert_eq!(
                        json_body(&reply)["error"]["status"],
                        if invalid {
                            "INVALID_ARGUMENT"
                        } else {
                            "FAILED_PRECONDITION"
                        },
                        "{query}/{tag:?}"
                    );
                    assert_eq!(Some(store.current().etag()), first.etag);
                }
            }
        }
        assert_eq!(store.history().len(), 1);
    }
}
