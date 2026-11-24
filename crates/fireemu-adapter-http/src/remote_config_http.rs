//! Remote Config templates on the daemon's capability-protected local listener.

use std::collections::BTreeMap;

use bytes::Bytes;
use fireemu_adapter_support::api_error::google_rpc;
use fireemu_core_types::codec::{percent_decode, PlusMode};
use fireemu_core_types::time::LogicalInstant;
use serde_json::{json, Map, Value};

use crate::remote_config::{
    Change, ClientTemplate, Error, Namespace, RemoteConfigSettings, RemoteConfigStores,
    TemplateStore, UpdateUser, Version, WriteMode, WriteResult, MAX_RETAINED_VERSIONS,
};

pub(crate) struct Route<'a> {
    pub project: &'a str,
    namespace: Result<Namespace, &'a str>,
    action: &'a str,
}

pub(crate) fn route(path: &str) -> Option<Route<'_>> {
    let (project, action) = path.strip_prefix("/v1/projects/")?.split_once('/')?;
    let (namespace, action) = if let Some(rest) = action.strip_prefix("namespaces/") {
        let (namespace, action) = rest.split_once('/')?;
        let namespace = match namespace {
            "firebase" => Ok(Namespace::Client),
            "firebase-server" => Ok(Namespace::Server),
            unknown => Err(unknown),
        };
        (namespace, action)
    } else {
        (Ok(Namespace::Client), action)
    };
    match action {
        "serverRemoteConfig" if namespace == Ok(Namespace::Server) => Some(Route {
            project,
            namespace,
            action,
        }),
        "remoteConfig" | "remoteConfig:listVersions" | "remoteConfig:rollback" => Some(Route {
            project,
            namespace,
            action,
        }),
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

/// Where version metadata is shown: `updateUser` carries the email only on a version, and the
/// name and image too in history (RC-OBSERVE-V2-3 seq 1, 33, 64-70).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Surface {
    Version,
    History,
}

pub(crate) fn version_fields(
    version: &Version,
    user: Option<&UpdateUser>,
    surface: Surface,
) -> Value {
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
    if let Some(user) = user {
        output["updateUser"] = match surface {
            Surface::Version => json!({"email": user.email}),
            Surface::History => {
                json!({"email": user.email, "name": user.name, "imageUrl": user.image_url})
            }
        };
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

fn published_body(version: &Version, reading: bool, user: Option<&UpdateUser>) -> Value {
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
    body.insert(
        "version".to_owned(),
        version_fields(version, user, Surface::Version),
    );
    Value::Object(body)
}

fn published(version: &Version, reading: bool, user: Option<&UpdateUser>) -> Reply {
    Reply::ok(published_body(version, reading, user), Some(version.etag()))
}

fn read(
    store: &TemplateStore,
    namespace: Namespace,
    query: &str,
    user: Option<&UpdateUser>,
) -> Result<Reply, Reply> {
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
                |version| published(&version, true, user),
            )
        });
    }

    let (version, body) = store.render_current(|version| {
        if version.change() == Change::Initial {
            Bytes::from_static(b"{}\n")
        } else {
            Bytes::from(pretty_json(&published_body(version, true, user)).into_boxed_slice())
        }
    });
    Ok(Reply {
        status: 200,
        body: ReplyBody::Rendered(body),
        etag: (namespace == Namespace::Server || version.change() != Change::Initial)
            .then(|| version.etag()),
    })
}

fn history(store: &TemplateStore, query: &str, user: Option<&UpdateUser>) -> Result<Reply, Reply> {
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
    let mut body = json!({"versions": page.iter().map(|entry| version_fields(entry, user, Surface::History)).collect::<Vec<_>>()});
    if has_more {
        body["nextPageToken"] = json!(last.etag());
    }
    Ok(Reply::ok(body, None))
}

fn write(
    store: &TemplateStore,
    namespace: Namespace,
    settings: &RemoteConfigSettings,
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
    // The strict profile refuses the server conditions production refused (seq 54-57), after the
    // preconditions; the emulator profile keeps accepting them and serves them as `{}`.
    let check = |template: &ClientTemplate| {
        if namespace != Namespace::Server || !settings.strict_server_conditions {
            return Ok(());
        }
        let conditions = template.document()["conditions"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        conditions.iter().try_for_each(|condition| {
            let name = condition["name"].as_str().unwrap_or_default();
            let expression = condition["expression"].as_str().unwrap_or_default();
            crate::remote_config_conditions::strict_refusal(name, expression)
                .map_or(Ok(()), |message| Err(Error::InvalidTemplate(message)))
        })
    };
    match store
        .write_checked(mode, if_match, body, now, &check)
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
        WriteResult::Published(version) => {
            Ok(published(&version, false, settings.update_user.as_ref()))
        }
    }
}

fn rollback(
    store: &TemplateStore,
    user: Option<&UpdateUser>,
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
    Ok(published(&version, false, user))
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
        Error::EventCapacity => Reply::error(
            429,
            "the functions event queue is at capacity",
            "RESOURCE_EXHAUSTED",
        ),
        Error::EventUnavailable => Reply::error(
            503,
            "the functions runtime cannot admit events",
            "UNAVAILABLE",
        ),
        Error::ClockOutOfRange => Reply::error(
            500,
            "the local clock is outside the RFC 3339 range",
            "INTERNAL",
        ),
    }
}

/// Whether a request can commit a version: a publish (`PUT` that is not validate-only) or a
/// rollback (`POST`). A query that `dispatch` refuses commits nothing either way.
pub(crate) fn commits(method: &str, query: &str) -> bool {
    match method {
        "POST" => true,
        "PUT" => parameters(query, &["validateOnly"])
            .is_ok_and(|params| params.get("validateOnly").map(String::as_str) != Some("true")),
        _ => false,
    }
}

// One request's parts and the daemon's settings; grouping them would only move the list.
#[allow(clippy::too_many_arguments)]
pub(crate) fn dispatch(
    stores: &RemoteConfigStores,
    settings: &RemoteConfigSettings,
    route: &Route<'_>,
    method: &str,
    query: &str,
    bytes: &[u8],
    if_match: Option<&str>,
    now: LogicalInstant,
) -> Reply {
    let namespace = match route.namespace {
        Ok(namespace) => namespace,
        Err(unknown) => {
            return invalid(&format!(
                "[VALIDATION_ERROR]: template_id field value {unknown} unrecognized."
            ))
        }
    };
    let store = stores.get(namespace);
    let user = settings.update_user.as_ref();
    let result = match (route.action, method) {
        ("serverRemoteConfig", "GET") => {
            if let Err(reply) = parameters(query, &[]) {
                return reply;
            }
            let version = store.current();
            if version.change() == Change::Initial {
                return Reply::error(
                    404,
                    &format!(
                        "[NOT_FOUND]: Template not found for project {} and namespace firebase-server",
                        route.project
                    ),
                    "NOT_FOUND",
                );
            }
            let mut body = visible_fields(version.template());
            let etag = Some(version.etag());
            let number = version.number();
            if body.is_empty() {
                // Preserve the recorded key order for the byte-exact empty response.
                return Reply {
                    status: 200,
                    body: ReplyBody::Rendered(Bytes::from(format!(
                        "{{\n  \"version\": {{\n    \"versionNumber\": \"{number}\",\n    \"isLegacy\": true\n  }}\n}}\n"
                    ))),
                    etag,
                };
            }
            if let Some(conditions) = body.get_mut("conditions").and_then(Value::as_array_mut) {
                for condition in conditions {
                    let expression = condition["expression"]
                        .as_str()
                        .expect("validated expression");
                    *condition = json!({
                        "name": condition["name"],
                        "condition": crate::remote_config_conditions::structured(expression)
                    });
                }
            }
            // The data plane serves group parameters next to the top-level ones and no
            // `parameterGroups` key (seq 59). A name used both in a group and at the top level is
            // refused at validation, as before (unrecorded in production; ruling 4 item 4), so no
            // merge rule is needed here.
            if let Some(Value::Object(groups)) = body.remove("parameterGroups") {
                let parameters = body
                    .entry("parameters")
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .expect("validated parameters object");
                for group in groups.into_values() {
                    if let Some(Value::Object(grouped)) = group.get("parameters").cloned() {
                        parameters.extend(grouped);
                    }
                }
            }
            if let Some(parameters) = body.get_mut("parameters").and_then(Value::as_object_mut) {
                for parameter in parameters.values_mut().filter_map(Value::as_object_mut) {
                    parameter.remove("valueType");
                }
            }
            body.insert(
                "version".to_owned(),
                json!({"versionNumber": number.to_string(), "isLegacy": true}),
            );
            Ok(Reply::ok(Value::Object(body), etag))
        }
        ("remoteConfig", "GET") => read(store, namespace, query, user),
        ("remoteConfig", "PUT") => write(store, namespace, settings, query, bytes, if_match, now),
        ("remoteConfig:listVersions", "GET") => history(store, query, user),
        ("remoteConfig:rollback", "POST") => rollback(store, user, query, bytes, now),
        _ => return Reply::error(405, "Method not allowed", "METHOD_NOT_ALLOWED"),
    };
    result.unwrap_or_else(|reply| reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote_config_conditions::structured as server_condition;

    fn json_body(reply: &Reply) -> Value {
        match &reply.body {
            ReplyBody::Json(value) => value.clone(),
            ReplyBody::Rendered(bytes) => serde_json::from_slice(bytes).unwrap(),
        }
    }

    #[test]
    fn dispatch_refuses_commits_when_the_clock_is_out_of_range() {
        let stores = RemoteConfigStores::default();
        let now = LogicalInstant::from_unix_seconds(253_402_300_801);
        let expected = Reply::error(
            500,
            "the local clock is outside the RFC 3339 range",
            "INTERNAL",
        )
        .into_wire();
        for endpoint in ["remoteConfig", "namespaces/firebase-server/remoteConfig"] {
            let first = request(&stores, endpoint, "PUT", "", b"{}", Some("*"));
            assert_eq!(first.status, 200);
            for (method, suffix, body, tag) in [
                ("PUT", "", b"{}".as_slice(), first.etag.as_deref()),
                (
                    "POST",
                    ":rollback",
                    br#"{"versionNumber":"1"}"#.as_slice(),
                    None,
                ),
            ] {
                let path = format!("/v1/projects/demo-config/{endpoint}{suffix}");
                let reply = dispatch(
                    &stores,
                    &RemoteConfigSettings::default(),
                    &route(&path).unwrap(),
                    method,
                    "",
                    body,
                    tag,
                    now,
                );
                assert_eq!(reply.into_wire(), expected);
            }
        }
    }

    fn request(
        stores: &RemoteConfigStores,
        endpoint: &str,
        method: &str,
        query: &str,
        body: &[u8],
        if_match: Option<&str>,
    ) -> Reply {
        let path = format!("/v1/projects/demo-config/{endpoint}");
        dispatch(
            stores,
            &RemoteConfigSettings::default(),
            &route(&path).unwrap(),
            method,
            query,
            body,
            if_match,
            LogicalInstant::from_unix_seconds(1_765_000_000),
        )
    }

    #[test]
    fn latest_get_reuses_rendered_bytes_only_within_its_version() {
        let stores = RemoteConfigStores::default();
        let latest = || request(&stores, "remoteConfig", "GET", "", b"", None).into_wire();
        let publish = |value: &[u8]| request(&stores, "remoteConfig", "PUT", "", value, Some("*"));
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
            request(&stores, "remoteConfig", "GET", "versionNumber=1", b"", None).into_wire();
        assert_eq!(first, historical);
        assert_eq!(first_tag, historical_tag);
    }

    #[test]
    fn historical_reads_distinguish_missing_versions_from_unpublished_templates() {
        let stores = RemoteConfigStores::default();
        for (query, status, version, tagged) in [
            ("", 200, None, false),
            ("versionNumber=0", 200, None, false),
            ("versionNumber=-1", 200, None, false),
            ("versionNumber=1", 200, None, false),
            ("versionNumber=9223372036854775807", 200, None, false),
            ("versionNumber=broken", 400, None, false),
            ("versionNumber=9223372036854775808", 400, None, false),
        ] {
            let reply = request(&stores, "remoteConfig", "GET", query, b"", None);
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

        let first = request(&stores, "remoteConfig", "PUT", "", b"{}", Some("*"));
        let second = request(
            &stores,
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
            let reply = request(&stores, "remoteConfig", "GET", query, b"", None);
            assert_eq!(reply.status, status, "{query}");
            assert_eq!(
                json_body(&reply)["version"]["versionNumber"].as_str(),
                version,
                "{query}"
            );
            assert_eq!(reply.etag.as_deref(), tag, "{query}");
        }
        let missing = request(
            &stores,
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
            request(&stores, "remoteConfig", "PUT", "", b"{}", Some(tag)).status,
            412
        );
        let rollback = request(
            &stores,
            "remoteConfig:rollback",
            "POST",
            "",
            br#"{"versionNumber":"9223372036854775807"}"#,
            None,
        );
        assert_eq!(rollback.status, 404);
        assert_eq!(stores.client.current().number(), 2);
    }

    #[test]
    fn history_defaults_and_caps_page_sizes_without_changing_order() {
        let stores = RemoteConfigStores::default();
        for _ in 0..3 {
            assert_eq!(
                request(&stores, "remoteConfig", "PUT", "", b"{}", Some("*")).status,
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
            let reply = request(
                &stores,
                "remoteConfig:listVersions",
                "GET",
                query,
                b"",
                None,
            );
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
        let stores = RemoteConfigStores::default();
        let first = request(&stores, "remoteConfig", "PUT", "", b"{}", Some("*"));
        for (body, expected) in [
            (b"{}".as_slice(), json!({"version":{}})),
            (
                br#"{"version":{"description":"Draft","versionNumber":"9"}}"#.as_slice(),
                json!({"version":{"description":"Draft"}}),
            ),
        ] {
            let reply = request(
                &stores,
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
            let reply = request(&stores, "remoteConfig", "PUT", query, body, tag);
            assert_eq!(reply.status, status);
            assert_eq!(json_body(&reply)["error"]["status"], error);
        }
        assert_eq!(stores.client.current().number(), 1);
        assert_eq!(stores.client.history().len(), 1);
    }

    #[test]
    fn writes_check_wire_types_before_preconditions_and_semantics_after_them() {
        let stores = RemoteConfigStores::default();
        let first = request(&stores, "remoteConfig", "PUT", "", b"{}", Some("*"));
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
                    let reply = request(&stores, "remoteConfig", "PUT", query, body, tag);
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
                    assert_eq!(Some(stores.client.current().etag()), first.etag);
                }
            }
        }
        assert_eq!(stores.client.history().len(), 1);
    }

    #[test]
    fn explicit_client_routes_share_the_legacy_template_and_history() {
        let stores = RemoteConfigStores::default();
        let legacy = "remoteConfig";
        let explicit = "namespaces/firebase/remoteConfig";
        for endpoint in [legacy, explicit] {
            assert_eq!(
                request(&stores, endpoint, "GET", "", b"", None).into_wire(),
                (200, Bytes::from_static(b"{}\n"), None)
            );
        }
        let first = request(&stores, legacy, "PUT", "", b"{}", Some("*"));
        let second = request(&stores, explicit, "PUT", "", b"{}", first.etag.as_deref());
        assert_eq!(second.status, 200);
        assert_eq!(json_body(&second)["version"]["versionNumber"], "2");
        assert_eq!(
            request(&stores, legacy, "GET", "", b"", None).into_wire(),
            request(&stores, explicit, "GET", "", b"", None).into_wire()
        );

        let rollback = request(
            &stores,
            "namespaces/firebase/remoteConfig:rollback",
            "POST",
            "",
            br#"{"versionNumber":"1"}"#,
            None,
        );
        assert_eq!(rollback.status, 200);
        assert_eq!(json_body(&rollback)["version"]["versionNumber"], "3");
        let legacy_history = request(&stores, "remoteConfig:listVersions", "GET", "", b"", None);
        let explicit_history = request(
            &stores,
            "namespaces/firebase/remoteConfig:listVersions",
            "GET",
            "",
            b"",
            None,
        );
        assert_eq!(legacy_history.status, 200);
        assert_eq!(
            json_body(&legacy_history)["versions"][0]["versionNumber"],
            "3"
        );
        assert_eq!(legacy_history.into_wire(), explicit_history.into_wire());
        assert!(stores.server.history().is_empty());
    }

    #[test]
    fn unknown_namespace_has_the_recorded_error_on_every_admin_route() {
        let stores = RemoteConfigStores::default();
        let expected = Bytes::from(pretty_json(&json!({
            "error": {
                "code": 400,
                "message": "[VALIDATION_ERROR]: template_id field value unknown-ns unrecognized.",
                "status": "INVALID_ARGUMENT"
            }
        })));
        for (action, method) in [
            ("remoteConfig", "GET"),
            ("remoteConfig", "PUT"),
            ("remoteConfig:listVersions", "GET"),
            ("remoteConfig:rollback", "POST"),
        ] {
            let endpoint = format!("namespaces/unknown-ns/{action}");
            let reply = request(&stores, &endpoint, method, "", b"{}", None);
            assert_eq!(
                reply.into_wire(),
                (400, expected.clone(), None),
                "{method} {endpoint}"
            );
        }
        for prefix in [
            "",
            "namespaces/firebase/",
            "namespaces/firebase-server/",
            "namespaces/unknown-ns/",
        ] {
            for suffix in ["", ":listVersions", ":rollback"] {
                let path = format!("/v1/projects/demo-config/{prefix}serverRemoteConfig{suffix}");
                assert_eq!(
                    route(&path).is_some(),
                    prefix == "namespaces/firebase-server/" && suffix.is_empty(),
                    "{path}"
                );
            }
        }
    }

    #[test]
    fn server_initial_tag_allows_version_one_without_changing_the_client_template() {
        let stores = RemoteConfigStores::default();
        let client = "remoteConfig";
        let server = "namespaces/firebase-server/remoteConfig";
        let list = "namespaces/firebase-server/remoteConfig:listVersions";
        let client_doc = br#"{"parameters":{"p":{"defaultValue":{"value":"client"}}}}"#;
        let server_doc = br#"{"parameters":{"p":{"defaultValue":{"value":"server"}}}}"#;
        let client_publish = request(&stores, client, "PUT", "", client_doc, Some("*"));
        assert_eq!(client_publish.status, 200);
        let client_before = request(&stores, client, "GET", "", b"", None).into_wire();
        assert_eq!(client_before.2.as_deref(), client_publish.etag.as_deref());

        let initial_tag = stores.server.current().etag();
        assert_eq!(
            request(&stores, server, "GET", "", b"", None).into_wire(),
            (200, Bytes::from_static(b"{}\n"), Some(initial_tag.clone()))
        );
        assert_eq!(
            request(&stores, server, "GET", "versionNumber=1", b"", None).into_wire(),
            (200, Bytes::from_static(b"{}\n"), None)
        );
        assert_eq!(
            request(&stores, list, "GET", "", b"", None).into_wire(),
            (200, Bytes::from_static(b"{}\n"), None)
        );

        let server_publish = request(&stores, server, "PUT", "", server_doc, Some(&initial_tag));
        assert_eq!(server_publish.status, 200);
        let body = json_body(&server_publish);
        assert_eq!(body["version"]["versionNumber"], "1");
        assert_eq!(body["version"]["updateType"], "INCREMENTAL_UPDATE");
        assert_eq!(body["parameters"]["p"]["defaultValue"]["value"], "server");
        assert_ne!(server_publish.etag, client_publish.etag);
        assert_eq!(
            request(&stores, client, "GET", "", b"", None).into_wire(),
            client_before
        );

        let server_before = request(&stores, server, "GET", "", b"", None).into_wire();
        for (endpoint, foreign_tag) in [
            (client, &server_publish.etag),
            (server, &client_publish.etag),
        ] {
            let refused = request(&stores, endpoint, "PUT", "", b"{}", foreign_tag.as_deref());
            assert_eq!(refused.status, 412);
            assert_eq!(
                json_body(&refused)["error"]["status"],
                "FAILED_PRECONDITION"
            );
        }
        assert_eq!(
            request(&stores, client, "GET", "", b"", None).into_wire(),
            client_before
        );
        assert_eq!(
            request(&stores, server, "GET", "", b"", None).into_wire(),
            server_before
        );
        assert_eq!(stores.client.history().len(), 1);
        assert_eq!(stores.server.history().len(), 1);
    }

    #[test]
    fn server_validates_and_checks_preconditions_without_publishing() {
        let stores = RemoteConfigStores::default();
        let server = "namespaces/firebase-server/remoteConfig";
        let first = request(&stores, server, "PUT", "", b"{}", Some("*"));
        assert_eq!(first.status, 200);
        let before = request(&stores, server, "GET", "", b"", None).into_wire();
        for tag in [Some("*"), first.etag.as_deref()] {
            let validated = request(
                &stores,
                server,
                "PUT",
                "validateOnly=true",
                br#"{"version":{"description":"Server draft"}}"#,
                tag,
            );
            assert_eq!(validated.status, 200);
            assert_eq!(
                json_body(&validated),
                json!({"version":{"description":"Server draft"}})
            );
            assert!(validated.etag.unwrap().ends_with("-0"));
        }
        for query in ["", "validateOnly=true"] {
            for (tag, status) in [(None, 400), (Some("stale"), 412)] {
                let refused = request(&stores, server, "PUT", query, b"{}", tag);
                assert_eq!(refused.status, status);
                assert_eq!(
                    json_body(&refused)["error"]["status"],
                    "FAILED_PRECONDITION"
                );
            }
            let invalid = br#"{"parameters":{"flag":{"valueType":"BOOLEAN","defaultValue":{"value":"maybe"}}}}"#;
            let server_error = request(&stores, server, "PUT", query, invalid, Some("*"));
            let client_error = request(&stores, "remoteConfig", "PUT", query, invalid, Some("*"));
            assert_eq!(server_error.status, 400);
            assert_eq!(
                json_body(&server_error)["error"]["status"],
                "INVALID_ARGUMENT"
            );
            assert_eq!(server_error.into_wire(), client_error.into_wire());
        }
        assert_eq!(
            request(&stores, server, "GET", "", b"", None).into_wire(),
            before
        );
        assert_eq!(stores.server.history().len(), 1);
        assert!(stores.client.history().is_empty());
    }

    #[test]
    fn server_reads_pages_and_rolls_back_its_published_versions() {
        let stores = RemoteConfigStores::default();
        let server = "namespaces/firebase-server/remoteConfig";
        let list = "namespaces/firebase-server/remoteConfig:listVersions";
        let rollback = "namespaces/firebase-server/remoteConfig:rollback";
        let original = br#"{"parameters":{"p":{"defaultValue":{"value":"original"}}}}"#;
        let first = request(&stores, server, "PUT", "", original, Some("*"));
        let second = request(&stores, server, "PUT", "", b"{}", Some("*"));
        assert_eq!(first.status, 200);
        assert_eq!(second.status, 200);
        assert_eq!(json_body(&second)["version"]["updateType"], "FORCED_UPDATE");
        let read_first = request(&stores, server, "GET", "versionNumber=1", b"", None);
        assert_eq!(read_first.status, 200);
        assert_eq!(read_first.etag, first.etag);
        assert_eq!(
            json_body(&read_first)["parameters"]["p"]["defaultValue"]["value"],
            "original"
        );
        let missing = request(&stores, server, "GET", "versionNumber=99", b"", None);
        assert_eq!(
            missing.into_wire(),
            (
                200,
                Bytes::from_static(b"{}\n"),
                Some(stores.server.current().empty_etag())
            )
        );

        let newest = request(&stores, list, "GET", "pageSize=1", b"", None);
        assert_eq!(newest.status, 200);
        let page = json_body(&newest);
        assert_eq!(page["versions"].as_array().unwrap().len(), 1);
        assert_eq!(page["versions"][0]["versionNumber"], "2");
        let next = format!(
            "pageSize=1&pageToken={}",
            page["nextPageToken"].as_str().unwrap()
        );
        let oldest = request(&stores, list, "GET", &next, b"", None);
        assert_eq!(oldest.status, 200);
        let page = json_body(&oldest);
        assert_eq!(page["versions"].as_array().unwrap().len(), 1);
        assert_eq!(page["versions"][0]["versionNumber"], "1");
        assert!(page.get("nextPageToken").is_none());

        let restored = request(
            &stores,
            rollback,
            "POST",
            "",
            br#"{"versionNumber":"1"}"#,
            None,
        );
        assert_eq!(restored.status, 200);
        assert_ne!(restored.etag, first.etag);
        assert_ne!(restored.etag, second.etag);
        let body = json_body(&restored);
        assert_eq!(body["parameters"], json_body(&first)["parameters"]);
        assert_eq!(body["version"]["versionNumber"], "3");
        assert_eq!(body["version"]["updateType"], "ROLLBACK");
        assert_eq!(body["version"]["rollbackSource"], "1");
        assert_eq!(body["version"]["description"], "Rollback to version 1");
        let before = request(&stores, server, "GET", "", b"", None).into_wire();
        let history_before = request(&stores, list, "GET", "", b"", None).into_wire();
        let refused = request(
            &stores,
            rollback,
            "POST",
            "",
            br#"{"versionNumber":"99"}"#,
            None,
        );
        assert_eq!(refused.status, 404);
        assert_eq!(json_body(&refused)["error"]["status"], "NOT_FOUND");
        assert_eq!(
            request(&stores, server, "GET", "", b"", None).into_wire(),
            before
        );
        assert_eq!(
            request(&stores, list, "GET", "", b"", None).into_wire(),
            history_before
        );
        assert!(stores.client.history().is_empty());
    }

    #[test]
    fn server_data_plane_reads_the_current_published_template() {
        let stores = RemoteConfigStores::default();
        let server = "namespaces/firebase-server/remoteConfig";
        let data_plane = "namespaces/firebase-server/serverRemoteConfig";
        let publish = |body: &[u8], tag: &str| request(&stores, server, "PUT", "", body, Some(tag));
        let read = || request(&stores, data_plane, "GET", "", b"", None);
        let seed = br#"{"version":{"description":"Fireemu RC server coverage seed"},"conditions":[{"name":"audited","expression":"app.customSignal['fireemu_tier'].exactlyMatches(['premium'])"},{"name":"always","expression":"percent('fireemu_server') <= 100"}],"parameters":{"fireemu_text":{"defaultValue":{"value":"seed"},"valueType":"STRING","conditionalValues":{"audited":{"value":"matched"},"always":{"value":"fallback"}}},"fireemu_bool":{"defaultValue":{"value":"true"},"valueType":"BOOLEAN","conditionalValues":{"audited":{"value":"false"}}},"fireemu_number":{"defaultValue":{"value":"9.5"},"valueType":"NUMBER","conditionalValues":{"audited":{"value":"2.25"}}},"fireemu_json":{"defaultValue":{"value":"{\"outside\":1}"},"valueType":"JSON","conditionalValues":{"audited":{"value":"{\"inside\":2}"}}}}}"#;
        let mut tag = "*".to_owned();
        for (body, version) in [(b"{}".as_slice(), "1"), (b"{}", "2"), (seed, "3")] {
            let reply = publish(body, &tag);
            assert_eq!(reply.status, 200);
            assert_eq!(json_body(&reply)["version"]["versionNumber"], version);
            tag = reply.etag.unwrap();
        }

        // A Windows checkout may turn the fixture's LF line ends into CRLF; the recorded
        // body (2040 bytes) used LF.
        let fixture =
            include_str!("remote_config_testdata/server_dataplane.json").replace("\r\n", "\n");
        let (status, body, etag) = read().into_wire();
        assert_eq!(status, 200);
        assert_eq!(etag.as_deref(), Some(tag.as_str()));
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap(),
            serde_json::from_str::<Value>(&fixture).unwrap()
        );
        assert_eq!(fixture.len(), 2040);
        assert_eq!(body.len(), fixture.len());

        let empty = publish(b"{}", &tag);
        assert_eq!(empty.status, 200);
        let (status, body, etag) = read().into_wire();
        assert_eq!(status, 200);
        assert_eq!(etag, empty.etag);
        assert_eq!(body.len(), 70);
        assert_eq!(
            body.as_ref(),
            b"{\n  \"version\": {\n    \"versionNumber\": \"4\",\n    \"isLegacy\": true\n  }\n}\n"
        );
    }

    #[test]
    fn server_data_plane_stays_unpublished_after_a_client_publish() {
        let stores = RemoteConfigStores::default();
        let data_plane = "namespaces/firebase-server/serverRemoteConfig";
        let expected = json!({
            "error": {
                "code": 404,
                "message": "[NOT_FOUND]: Template not found for project demo-config and namespace firebase-server",
                "status": "NOT_FOUND"
            }
        });
        let read = || request(&stores, data_plane, "GET", "", b"", None);
        for client_published in [false, true] {
            if client_published {
                assert_eq!(
                    request(&stores, "remoteConfig", "PUT", "", b"{}", Some("*")).status,
                    200
                );
            }
            let reply = read();
            assert_eq!(reply.status, 404);
            assert_eq!(reply.etag, None);
            assert_eq!(json_body(&reply), expected);
        }

        let post = request(&stores, data_plane, "POST", "", b"", None);
        assert_eq!(post.status, 405);
        assert_eq!(json_body(&post)["error"]["status"], "METHOD_NOT_ALLOWED");
        let query = request(&stores, data_plane, "GET", "x=1", b"", None);
        assert_eq!(query.status, 400);
        assert_eq!(json_body(&query)["error"]["status"], "INVALID_ARGUMENT");
    }

    #[test]
    fn server_data_plane_flattens_groups_and_only_removes_parameter_value_types() {
        let stores = RemoteConfigStores::default();
        let reply = request(
            &stores,
            "namespaces/firebase-server/remoteConfig",
            "PUT",
            "",
            br#"{
                "conditions": [{"name":"unknown","expression":"device.os == 'ios'","tagColor":"BLUE"}],
                "parameterGroups": {
                    "sample": {
                        "description": "Group metadata",
                        "parameters": {"p": {"defaultValue":{"value":"true"},"valueType":"BOOLEAN","description":"Parameter metadata"}}
                    }
                }
            }"#,
            Some("*"),
        );
        assert_eq!(reply.status, 200);
        let data = request(
            &stores,
            "namespaces/firebase-server/serverRemoteConfig",
            "GET",
            "",
            b"",
            None,
        );
        assert_eq!(data.status, 200);
        assert_eq!(
            json_body(&data),
            json!({
                "conditions": [{"name":"unknown","condition":{}}],
                // RC-OBSERVE-V2-3 seq 59: group parameters are served at the top level and the
                // group itself is not.
                "parameters": {"p": {"defaultValue":{"value":"true"},"description":"Parameter metadata"}},
                "version": {"versionNumber":"1","isLegacy":true}
            })
        );
    }

    #[test]
    fn server_condition_translates_only_the_recorded_forms() {
        for expression in [
            "percent('s') < 100",
            "percent('s') <= 100.0000001",
            "percent('s') <= 12.5000001",
            "percent('s') <= +5",
            "percent('s') <= 100.000001",
            "percent('s') <= -1",
            // A whole part above 100 is refused before it is scaled to micro-percent, where
            // 5000 * 1_000_000 would overflow u32.
            "percent('s') <= 5000",
            r#"percent("s") <= 100"#,
            r#"percent('s"eed') <= 100"#,
            r"percent('s\eed') <= 100",
            "percent('s'eed') <= 100",
            // A `&&` chain is recorded since RC-OBSERVE-V2-3 (seq 59): see
            // recorded_condition_families_convert_to_the_recorded_structure.
            "app.customSignal['k'].exactlyMatches(['a',])",
            // The tail is the recorded one; the signal accessor before the key is not.
            "app.userProperty['k'].exactlyMatches(['a'])",
            "device.os == 'ios'",
        ] {
            assert_eq!(server_condition(expression), json!({}), "{expression}");
        }
        let leaf = "/orCondition/conditions/0/andCondition/conditions/0";
        assert_eq!(
            server_condition("percent('s') <= 12.5").pointer(&format!("{leaf}/percent")),
            Some(&json!({"percentOperator":"LESS_OR_EQUAL","microPercent":12_500_000,"seed":"s"}))
        );
        assert_eq!(
            server_condition(
                " app . customSignal [ 'k' ] . exactlyMatches (\t[ 'a,b' , 'c' ] )\r\n"
            )
            .pointer(&format!("{leaf}/customSignal")),
            Some(&json!({
                "customSignalOperator": "STRING_EXACTLY_MATCHES",
                "customSignalKey": "k",
                "targetCustomSignalValues": ["a,b", "c"]
            }))
        );
    }

    proptest::proptest! {
        #[test]
        fn server_condition_preserves_every_decimal_micro_percent(micro in 0..=100_000_000_u32) {
            let whole = micro / 1_000_000;
            let fraction = format!("{:06}", micro % 1_000_000);
            let fraction = fraction.trim_end_matches('0');
            let decimal = if fraction.is_empty() {
                whole.to_string()
            } else {
                format!("{whole}.{fraction}")
            };
            let condition = server_condition(&format!("percent('s') <= {decimal}"));
            proptest::prop_assert_eq!(
                condition.pointer("/orCondition/conditions/0/andCondition/conditions/0/percent/microPercent")
                    .and_then(Value::as_u64),
                Some(u64::from(micro))
            );
        }

        #[test]
        fn server_condition_rejects_non_grammar_tokens(
            unexpected in proptest::strategy::Strategy::prop_filter(
                proptest::arbitrary::any::<char>(),
                "outside the grammar for unquoted tokens",
                |&c| !matches!(c, 'a'..='z' | 'A'..='Z' | '0'..='9' | '\t'..='\r' | ' ' | '\'' | '.' | ',' | '(' | ')' | '[' | ']' | '<' | '='),
            )
        ) {
            proptest::prop_assert_eq!(server_condition(&format!("percent('s') {unexpected}<= 100")), json!({}));
            proptest::prop_assert_eq!(server_condition(&format!("app.customSignal['k']{unexpected}.exactlyMatches(['a'])")), json!({}));
        }
    }

    #[test]
    fn pict_rows_follow_the_recorded_namespace_rules() {
        let table = include_str!("remote_config_testdata/pict.tsv");
        for row in table.lines().skip(1) {
            let columns: Vec<_> = row.split('\t').collect();
            let [name, operation, precondition, state, _]: [&str; 5] = columns.try_into().unwrap();
            let stores = RemoteConfigStores::default();
            let (client, server) = (&stores.client, &stores.server);
            let (prefix, store, other) = match name {
                "legacy-client" => ("", client, server),
                "explicit-client" => ("namespaces/firebase/", client, server),
                "server" => ("namespaces/firebase-server/", server, client),
                "unknown" => ("namespaces/unknown/", client, server),
                _ => panic!("Invalid namespace in {row}"),
            };
            let seed_prefix = if name == "unknown" { "" } else { prefix };
            let seed_endpoint = format!("{seed_prefix}remoteConfig");
            let version_count = match state {
                "unpublished" => 0,
                "one-version" => 1,
                "many-versions" => 3,
                _ => panic!("Invalid version state in {row}"),
            };
            for _ in 0..version_count {
                assert_eq!(
                    request(&stores, &seed_endpoint, "PUT", "", b"{}", Some("*")).status,
                    200,
                    "{row}"
                );
            }

            let before = store.current();
            let history = store.history();
            let other_tag = other.current().etag();
            assert_eq!(before.number(), version_count, "{row}");
            let current_tag = before.etag();
            let tag = match precondition {
                "absent" | "not-applicable" => None,
                "stale" => Some("stale"),
                "current" => Some(current_tag.as_str()),
                "wildcard" => Some("*"),
                _ => panic!("Invalid precondition in {row}"),
            };
            let rollback_path = "remoteConfig:rollback";
            let (action, method, query, body): (_, _, _, &[u8]) = match operation {
                "publish" => ("remoteConfig", "PUT", "", b"{}"),
                "validate" => ("remoteConfig", "PUT", "validateOnly=true", b"{}"),
                "rollback-known" => (rollback_path, "POST", "", br#"{"versionNumber":"1"}"#),
                "rollback-unknown" => (rollback_path, "POST", "", br#"{"versionNumber":"99"}"#),
                "read" => ("remoteConfig", "GET", "", b""),
                "read-version" => ("remoteConfig", "GET", "versionNumber=1", b""),
                "list-versions" => ("remoteConfig:listVersions", "GET", "", b""),
                "dataplane" => ("serverRemoteConfig", "GET", "", b""),
                _ => panic!("Invalid operation in {row}"),
            };
            let endpoint = format!("{prefix}{action}");
            if operation == "dataplane" && name != "server" {
                let path = format!("/v1/projects/demo-config/{endpoint}");
                assert!(route(&path).is_none(), "{row}");
                continue;
            }
            let reply = request(&stores, &endpoint, method, query, body, tag);
            let (status, error) = match (name, operation, precondition) {
                ("unknown", _, _) => (400, Some("INVALID_ARGUMENT")),
                (_, "publish" | "validate", "absent") => (400, Some("FAILED_PRECONDITION")),
                (_, "publish" | "validate", "stale") => (412, Some("FAILED_PRECONDITION")),
                (_, "rollback-unknown", _) => (404, Some("NOT_FOUND")),
                (_, "dataplane", _) if state == "unpublished" => (404, Some("NOT_FOUND")),
                _ => (200, None),
            };
            let added = status == 200 && matches!(operation, "publish" | "rollback-known");
            assert_eq!(reply.status, status, "{row}");
            let body = json_body(&reply);
            assert_eq!(body["error"]["status"].as_str(), error, "{row}");
            if operation == "dataplane" {
                let expected = (status == 200).then_some(current_tag.as_str());
                assert_eq!(reply.etag.as_deref(), expected, "{row}");
            }
            let current = store.current();
            let retained = store.history();
            assert_eq!(current.number(), version_count + u64::from(added), "{row}");
            assert_eq!(retained.len(), history.len() + usize::from(added), "{row}");
            for (old, retained) in history.iter().zip(&retained[usize::from(added)..]) {
                assert!(std::sync::Arc::ptr_eq(old, retained), "{row}");
            }
            if added {
                assert_ne!(current.etag(), current_tag, "{row}");
                assert_eq!(
                    body["version"]["versionNumber"],
                    current.number().to_string(),
                    "{row}"
                );
                if operation == "rollback-known" {
                    assert_eq!(body["version"]["rollbackSource"], "1", "{row}");
                }
            } else {
                assert!(std::sync::Arc::ptr_eq(&before, &current), "{row}");
            }
            assert_eq!(other.current().etag(), other_tag, "{row}");
            assert!(other.history().is_empty(), "{row}");
        }
    }

    fn request_with(
        stores: &RemoteConfigStores,
        settings: &RemoteConfigSettings,
        endpoint: &str,
        method: &str,
        query: &str,
        body: &[u8],
        if_match: Option<&str>,
    ) -> Reply {
        let path = format!("/v1/projects/demo-config/{endpoint}");
        dispatch(
            stores,
            settings,
            &route(&path).unwrap(),
            method,
            query,
            body,
            if_match,
            LogicalInstant::from_unix_seconds(1_765_000_000),
        )
    }

    const SERVER: &str = "namespaces/firebase-server/remoteConfig";
    const DATA_PLANE: &str = "namespaces/firebase-server/serverRemoteConfig";

    fn strict() -> RemoteConfigSettings {
        RemoteConfigSettings {
            strict_server_conditions: true,
            update_user: None,
        }
    }

    /// The recorded server template of RC-OBSERVE-V2-3 (seq 60, its version metadata removed),
    /// published as version 7 as it was there, served as the recorded data plane (seq 59).
    #[test]
    fn server_data_plane_matches_the_recorded_conditions_and_flattened_groups() {
        let template = include_str!("remote_config_testdata/server_conditions_template.json");
        let fixture = include_str!("remote_config_testdata/server_conditions_dataplane.json")
            .replace("\r\n", "\n");
        for settings in [RemoteConfigSettings::default(), strict()] {
            let stores = RemoteConfigStores::default();
            let mut tag = "*".to_owned();
            for _ in 0..6 {
                let reply = request_with(&stores, &settings, SERVER, "PUT", "", b"{}", Some(&tag));
                tag = reply.etag.unwrap();
            }
            let reply = request_with(
                &stores,
                &settings,
                SERVER,
                "PUT",
                "",
                template.as_bytes(),
                Some(&tag),
            );
            assert_eq!(reply.status, 200);
            assert_eq!(json_body(&reply)["version"]["versionNumber"], "7");
            let (status, body, _) =
                request_with(&stores, &settings, DATA_PLANE, "GET", "", b"", None).into_wire();
            assert_eq!(status, 200);
            assert_eq!(
                serde_json::from_slice::<Value>(&body).unwrap(),
                serde_json::from_str::<Value>(&fixture).unwrap()
            );
            // The recorded body is 14958 bytes; member order differs (serde_json sorts keys),
            // the layout does not.
            assert_eq!(fixture.len(), 14958);
            assert_eq!(body.len(), fixture.len());
        }
    }

    #[test]
    fn strict_refuses_the_recorded_server_conditions_after_the_precondition() {
        // RC-OBSERVE-V2-3 seq 54-57: validate-only answers of 201, 228, 253 and 256 bytes.
        let cases = [
            ("fireemu_obs_or", "app.customSignal['fireemu_s'].exactlyMatches(['a']) || percent('fireemu_obs') <= 50", "[VALIDATION_ERROR]: Expected exactly one term in OR condition for condition with name [fireemu_obs_or], found 2", 201),
            ("fireemu_obs_not", "!(percent('fireemu_obs') <= 50)", "[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: NOT condition is not allowed here @ fireemu_obs_not.OR[0].AND[0].NOT", 228),
            ("fireemu_obs_literal_true", "true", "[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: ALWAYS_TRUE condition is not allowed here @ fireemu_obs_literal_true.OR[0].AND[0].ALWAYS_TRUE", 253),
            ("fireemu_obs_literal_false", "false", "[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: ALWAYS_FALSE condition is not allowed here @ fireemu_obs_literal_false.OR[0].AND[0].ALWAYS_FALSE", 256),
        ];
        for (name, expression, message, bytes) in cases {
            let body = json!({
                "conditions": [{"name": name, "expression": expression}],
                "parameters": {"fireemu_obs_probe": {"defaultValue": {"value": "default"}, "conditionalValues": {name: {"value": "matched"}}, "valueType": "STRING"}}
            })
            .to_string();
            let stores = RemoteConfigStores::default();
            let first = request_with(&stores, &strict(), SERVER, "PUT", "", b"{}", Some("*"));
            let tag = first.etag.unwrap();
            for query in ["validateOnly=true", ""] {
                let stale = request_with(
                    &stores,
                    &strict(),
                    SERVER,
                    "PUT",
                    query,
                    body.as_bytes(),
                    Some("stale"),
                );
                assert_eq!(stale.status, 412, "{name}");
                let (status, wire, etag) = request_with(
                    &stores,
                    &strict(),
                    SERVER,
                    "PUT",
                    query,
                    body.as_bytes(),
                    Some(&tag),
                )
                .into_wire();
                assert_eq!(status, 400, "{name}");
                assert_eq!(etag, None);
                let wire: Value = serde_json::from_slice(&wire).unwrap();
                assert_eq!(wire["error"]["message"], message, "{name}");
                assert_eq!(wire["error"]["status"], "INVALID_ARGUMENT");
                assert_eq!(pretty_json(&wire).len(), bytes, "{name}");
                assert_eq!(stores.server.current().number(), 1, "{name}");
            }
            // The emulator profile keeps accepting it and serves the condition as `{}`.
            let lenient = RemoteConfigStores::default();
            let defaults = RemoteConfigSettings::default();
            let first = request_with(&lenient, &defaults, SERVER, "PUT", "", b"{}", Some("*"));
            let published = request_with(
                &lenient,
                &defaults,
                SERVER,
                "PUT",
                "",
                body.as_bytes(),
                first.etag.as_deref(),
            );
            assert_eq!(published.status, 200, "{name}");
            let data = json_body(&request_with(
                &lenient, &defaults, DATA_PLANE, "GET", "", b"", None,
            ));
            assert_eq!(
                data["conditions"],
                json!([{"name": name, "condition": {}}]),
                "{name}"
            );
            // The client namespace is not refused in either profile.
            let client = request_with(
                &stores,
                &strict(),
                "remoteConfig",
                "PUT",
                "",
                body.as_bytes(),
                Some("*"),
            );
            assert_eq!(client.status, 200, "{name}");
        }
    }

    #[test]
    fn strict_refuses_only_the_recorded_positions() {
        for expression in [
            "percent('s') <= 5 || percent('s') <= 6 || percent('s') <= 7",
            "percent('s') <= 5 && true",
            "!(percent('s') <= 5) && percent('s') <= 6",
            "(true)",
            "app.customSignal['k'].exactlyMatches(['a||b'])",
            "(percent('s') <= 5 || percent('s') <= 6)",
            "percent('s') <= 5",
            "percent",
            "maybe",
        ] {
            assert_eq!(
                crate::remote_config_conditions::strict_refusal("c", expression),
                None,
                "{expression}"
            );
        }
    }

    #[test]
    fn pict_rows_follow_the_recorded_server_condition_rules() {
        let expression = |class: &str| match class {
            "percent-le" => "percent('s') <= 12.5",
            "percent-gt" => "percent('s') > 50",
            "percent-between" => "percent('s') between 10 and 60",
            "percent-unseeded" => "percent <= 50",
            "numeric" => "app.customSignal['n'] >= 5",
            "string" => "app.customSignal['k'].contains(['ab'])",
            "semver" => "version(app.customSignal['v']) < '1.2.3'",
            "and-chain" => "app.customSignal['k'].exactlyMatches(['a']) && percent('s') <= 50",
            "or-two" => "percent('s') <= 5 || percent('s') <= 6",
            "not" => "!(percent('s') <= 50)",
            "literal-true" => "true",
            "literal-false" => "false",
            "unrecorded" => "device.os == 'ios'",
            _ => panic!("class {class}"),
        };
        let table = include_str!("remote_config_testdata/conditions_pict.tsv");
        for row in table.lines().skip(1) {
            let [namespace, profile, class, mode, groups]: [&str; 5] =
                row.split('\t').collect::<Vec<_>>().try_into().unwrap();
            let settings = RemoteConfigSettings {
                strict_server_conditions: profile == "strict",
                update_user: None,
            };
            let stores = RemoteConfigStores::default();
            let endpoint = if namespace == "server" {
                SERVER
            } else {
                "remoteConfig"
            };
            let mut body = json!({
                "conditions": [{"name": "c", "expression": expression(class)}],
                "parameters": {"top": {"defaultValue": {"value": "d"}, "conditionalValues": {"c": {"value": "v"}}}}
            });
            if groups == "grouped" {
                body["parameterGroups"] = json!({"g": {"description": "G", "parameters": {"inner": {"defaultValue": {"value": "1"}, "valueType": "NUMBER"}}}});
            }
            let query = if mode == "validate" {
                "validateOnly=true"
            } else {
                ""
            };
            let reply = request_with(
                &stores,
                &settings,
                endpoint,
                "PUT",
                query,
                body.to_string().as_bytes(),
                Some("*"),
            );
            let refused = namespace == "server"
                && profile == "strict"
                && matches!(class, "or-two" | "not" | "literal-true" | "literal-false");
            assert_eq!(reply.status, if refused { 400 } else { 200 }, "{row}");
            let store = if namespace == "server" {
                &stores.server
            } else {
                &stores.client
            };
            let published = !refused && mode == "publish";
            assert_eq!(store.current().number(), u64::from(published), "{row}");
            if !(published && namespace == "server") {
                continue;
            }
            let data = json_body(&request_with(
                &stores, &settings, DATA_PLANE, "GET", "", b"", None,
            ));
            let recorded = !matches!(
                class,
                "or-two" | "not" | "literal-true" | "literal-false" | "unrecorded"
            );
            assert_eq!(
                data["conditions"][0]["condition"] != json!({}),
                recorded,
                "{row}"
            );
            assert!(data.get("parameterGroups").is_none(), "{row}");
            assert_eq!(
                data["parameters"]["top"],
                json!({"defaultValue": {"value": "d"}, "conditionalValues": {"c": {"value": "v"}}}),
                "{row}"
            );
            assert_eq!(
                data["parameters"].get("inner").cloned(),
                (groups == "grouped").then(|| json!({"defaultValue": {"value": "1"}})),
                "{row}"
            );
        }
    }

    #[test]
    fn configured_update_user_has_the_recorded_shape_on_each_surface() {
        let settings = RemoteConfigSettings {
            strict_server_conditions: false,
            update_user: Some(UpdateUser {
                email: "tester@example.com".into(),
                name: "Tester".into(),
                image_url: "https://example.com/a.png".into(),
            }),
        };
        for endpoint in ["remoteConfig", SERVER] {
            let stores = RemoteConfigStores::default();
            let published = request_with(&stores, &settings, endpoint, "PUT", "", b"{}", Some("*"));
            assert_eq!(
                json_body(&published)["version"]["updateUser"],
                json!({"email": "tester@example.com"})
            );
            let rollback = request_with(
                &stores,
                &settings,
                &format!("{endpoint}:rollback"),
                "POST",
                "",
                br#"{"versionNumber":"1"}"#,
                None,
            );
            assert_eq!(
                json_body(&rollback)["version"]["updateUser"],
                json!({"email": "tester@example.com"})
            );
            for query in ["", "versionNumber=1"] {
                let read = request_with(&stores, &settings, endpoint, "GET", query, b"", None);
                assert_eq!(
                    json_body(&read)["version"]["updateUser"],
                    json!({"email": "tester@example.com"}),
                    "{query}"
                );
            }
            let history = json_body(&request_with(
                &stores,
                &settings,
                &format!("{endpoint}:listVersions"),
                "GET",
                "",
                b"",
                None,
            ));
            for version in history["versions"].as_array().unwrap() {
                assert_eq!(
                    version["updateUser"],
                    json!({"email": "tester@example.com", "name": "Tester", "imageUrl": "https://example.com/a.png"})
                );
            }
            // Validation creates no version and names no user, as before.
            let validated = request_with(
                &stores,
                &settings,
                endpoint,
                "PUT",
                "validateOnly=true",
                b"{}",
                Some("*"),
            );
            assert!(json_body(&validated)["version"].get("updateUser").is_none());
            // Without the setting no surface carries the field.
            let plain = RemoteConfigStores::default();
            let defaults = RemoteConfigSettings::default();
            let published = request_with(&plain, &defaults, endpoint, "PUT", "", b"{}", Some("*"));
            assert!(json_body(&published)["version"].get("updateUser").is_none());
            let history = json_body(&request_with(
                &plain,
                &defaults,
                &format!("{endpoint}:listVersions"),
                "GET",
                "",
                b"",
                None,
            ));
            assert!(history["versions"][0].get("updateUser").is_none());
        }
    }

    #[derive(Clone, Debug)]
    enum Atom {
        Percent {
            op: u8,
            seed: bool,
            a: u32,
            b: u32,
        },
        Numeric {
            op: u8,
            key: String,
            n: u32,
        },
        Text {
            op: u8,
            key: String,
            values: Vec<String>,
        },
        Semver {
            op: u8,
            key: String,
            target: String,
        },
    }

    fn decimal(micro: u32) -> String {
        let fraction = format!("{:06}", micro % 1_000_000);
        let fraction = fraction.trim_end_matches('0');
        if fraction.is_empty() {
            (micro / 1_000_000).to_string()
        } else {
            format!("{}.{fraction}", micro / 1_000_000)
        }
    }

    const COMPARISONS: [(&str, &str); 6] = [
        ("<", "LESS_THAN"),
        ("<=", "LESS_EQUAL"),
        ("==", "EQUAL"),
        ("!=", "NOT_EQUAL"),
        (">", "GREATER_THAN"),
        (">=", "GREATER_EQUAL"),
    ];

    /// The expression text and the structured atom production served for it (seq 59).
    fn render(atom: &Atom) -> (String, Value) {
        match atom {
            Atom::Percent { op, seed, a, b } => {
                let (lower, upper) = ((*a).min(*b), (*a).max(*b));
                let head = if *seed {
                    "percent('s')".to_owned()
                } else {
                    "percent".to_owned()
                };
                let (text, mut value) = match (op % 3, seed) {
                    (1, true) => (
                        format!("{head} > {}", decimal(*a)),
                        json!({"percentOperator": "GREATER_THAN", "microPercent": a}),
                    ),
                    (2, true) => (
                        format!("{head} between {} and {}", decimal(lower), decimal(upper)),
                        json!({"percentOperator": "BETWEEN", "microPercentRange": {"microPercentLowerBound": lower, "microPercentUpperBound": upper}}),
                    ),
                    _ => (
                        format!("{head} <= {}", decimal(*a)),
                        json!({"percentOperator": "LESS_OR_EQUAL", "microPercent": a}),
                    ),
                };
                if *seed {
                    value["seed"] = json!("s");
                }
                (text, json!({"percent": value}))
            }
            Atom::Numeric { op, key, n } => {
                let (symbol, name) = COMPARISONS[usize::from(*op % 6)];
                (
                    format!("app.customSignal['{key}'] {symbol} {n}"),
                    json!({"customSignal": {"customSignalOperator": format!("NUMERIC_{name}"), "customSignalKey": key, "targetCustomSignalValues": [n.to_string()]}}),
                )
            }
            Atom::Text { op, key, values } => {
                let (method, name) = [
                    ("exactlyMatches", "STRING_EXACTLY_MATCHES"),
                    ("contains", "STRING_CONTAINS"),
                    ("notContains", "STRING_DOES_NOT_CONTAIN"),
                    ("matches", "STRING_CONTAINS_REGEX"),
                ][usize::from(*op % 4)];
                let list = values
                    .iter()
                    .map(|v| format!("'{v}'"))
                    .collect::<Vec<_>>()
                    .join(", ");
                (
                    format!("app.customSignal['{key}'].{method}([{list}])"),
                    json!({"customSignal": {"customSignalOperator": name, "customSignalKey": key, "targetCustomSignalValues": values}}),
                )
            }
            Atom::Semver { op, key, target } => {
                let (symbol, name) = COMPARISONS[usize::from(*op % 6)];
                (
                    format!("version(app.customSignal['{key}']) {symbol} '{target}'"),
                    json!({"customSignal": {"customSignalOperator": format!("SEMANTIC_VERSION_{name}"), "customSignalKey": key, "targetCustomSignalValues": [target]}}),
                )
            }
        }
    }

    fn atoms() -> impl proptest::strategy::Strategy<Value = Atom> {
        use proptest::prelude::*;
        let text = "[A-Za-z0-9_ ,.^$|&!()-]{0,8}";
        prop_oneof![
            (
                any::<u8>(),
                any::<bool>(),
                0..=100_000_000_u32,
                0..=100_000_000_u32
            )
                .prop_map(|(op, seed, a, b)| Atom::Percent { op, seed, a, b }),
            (any::<u8>(), "[a-z_]{1,8}", any::<u32>()).prop_map(|(op, key, n)| Atom::Numeric {
                op,
                key,
                n
            }),
            (
                any::<u8>(),
                "[a-z_]{1,8}",
                proptest::collection::vec(text, 1..4)
            )
                .prop_map(|(op, key, values)| Atom::Text { op, key, values }),
            (any::<u8>(), "[a-z_]{1,8}", "[0-9]{1,3}(\\.[0-9]{1,3}){0,2}")
                .prop_map(|(op, key, target)| Atom::Semver { op, key, target }),
        ]
    }

    proptest::proptest! {
        #[test]
        fn recorded_condition_families_convert_to_the_recorded_structure(
            chain in proptest::collection::vec(atoms(), 1..5)
        ) {
            let rendered: Vec<_> = chain.iter().map(render).collect();
            let text = rendered.iter().map(|(t, _)| t.as_str()).collect::<Vec<_>>().join(" && ");
            let expected: Vec<_> = rendered.into_iter().map(|(_, v)| v).collect();
            proptest::prop_assert_eq!(
                crate::remote_config_conditions::structured(&text),
                json!({"orCondition": {"conditions": [{"andCondition": {"conditions": expected}}]}})
            );
            proptest::prop_assert_eq!(crate::remote_config_conditions::strict_refusal("c", &text), None);
        }
    }

    #[test]
    fn unrecorded_condition_forms_stay_empty() {
        for expression in [
            "percent > 50",
            "percent between 10 and 60",
            "percent('s') between 60 and 10",
            "percent('s') between 10.000001 and 10",
            "percent('s') within 10 and 60",
            "percent('s') <= 5.",
            "percent('s') <= 5.1.2",
            "percent('s') <= 101",
            "percent('s') <= 4294",
            "percent('s') <= 4295",
            "percent('s') <= 99999999999",
            "_app.customSignal['k'].contains(['a'])",
            "application.customSignal['k'].contains(['a'])",
            "percent('s') >= 50",
            "app.customSignal['n'] >= 5.5",
            "app.customSignal['n'] >= '5'",
            "version(app.customSignal['v']) < 1",
            "app.customSignal['k'].contains([])",
            "app.customSignal['k'].startsWith(['a'])",
            "percent('s') <= 5 &&",
            "&& percent('s') <= 5",
            "percent('s') <= 5 & percent('s') <= 6",
            "(percent('s') <= 5)",
            "percent('s') <= 5 || percent('s') <= 6",
            "!(percent('s') <= 5)",
            "true",
            "false",
        ] {
            assert_eq!(
                crate::remote_config_conditions::structured(expression),
                json!({}),
                "{expression}"
            );
        }
        // Equal bounds are a range of one micro-percent value.
        assert_eq!(
            crate::remote_config_conditions::structured("percent('s') between 10 and 10").pointer(
                "/orCondition/conditions/0/andCondition/conditions/0/percent/microPercentRange"
            ),
            Some(
                &json!({"microPercentLowerBound": 10_000_000, "microPercentUpperBound": 10_000_000})
            )
        );
    }

    /// Ruling 4 item 4: a group parameter named like a top-level one was not recorded in
    /// production; Fireemu keeps its earlier answer (refused at validation, nothing published) in
    /// both namespaces and profiles, so the flattened data plane never meets a collision.
    #[test]
    fn a_group_parameter_named_like_a_top_level_one_keeps_the_earlier_refusal() {
        let body = json!({
            "parameters": {"p": {"defaultValue": {"value": "top"}}},
            "parameterGroups": {"g": {"parameters": {"p": {"defaultValue": {"value": "grouped"}}}}}
        })
        .to_string();
        for settings in [RemoteConfigSettings::default(), strict()] {
            for endpoint in ["remoteConfig", SERVER] {
                let stores = RemoteConfigStores::default();
                for query in ["validateOnly=true", ""] {
                    let reply = request_with(
                        &stores,
                        &settings,
                        endpoint,
                        "PUT",
                        query,
                        body.as_bytes(),
                        Some("*"),
                    );
                    assert_eq!(reply.status, 400, "{endpoint} {query}");
                    let wire = json_body(&reply);
                    assert_eq!(wire["error"]["status"], "INVALID_ARGUMENT");
                    assert_eq!(
                        wire["error"]["message"],
                        "invalid or duplicate parameter name \"p\""
                    );
                }
                assert_eq!(stores.client.current().number(), 0);
                assert_eq!(stores.server.current().number(), 0);
            }
        }
    }
}
