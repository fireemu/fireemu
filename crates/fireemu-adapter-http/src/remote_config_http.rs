//! Client-template administration on the daemon's capability-protected local listener.

use std::collections::BTreeMap;

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
    pub body: Value,
    pub etag: Option<String>,
}

impl Reply {
    pub(crate) fn error(status: u16, message: &str, code: &str) -> Self {
        Self {
            status,
            body: google_rpc(status, message, code),
            etag: None,
        }
    }

    fn ok(body: Value, etag: Option<String>) -> Self {
        Self {
            status: 200,
            body,
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
        .filter(|(_, value)| {
            !value.as_object().is_some_and(Map::is_empty)
                && !value.as_array().is_some_and(Vec::is_empty)
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
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

fn published(version: &Version, reading: bool) -> Reply {
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
    Reply::ok(Value::Object(body), Some(version.etag()))
}

fn read(store: &TemplateStore, query: &str) -> Result<Reply, Reply> {
    let params = parameters(query, &["versionNumber"])?;
    let requested = params
        .get("versionNumber")
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|_| invalid("Invalid version number"))
        })
        .transpose()?;
    let current = store.current();
    if current.change() == Change::Initial {
        return Ok(Reply::ok(json!({}), None));
    }
    match requested {
        Some(number) => store
            .version(number)
            .map_or_else(|| Err(missing()), |version| Ok(published(&version, true))),
        None => Ok(published(&current, true)),
    }
}

fn history(store: &TemplateStore, query: &str) -> Result<Reply, Reply> {
    let params = parameters(query, &["pageSize", "pageToken"])?;
    let limit = match params.get("pageSize") {
        Some(raw) => raw
            .parse::<usize>()
            .ok()
            .filter(|n| (1..=MAX_RETAINED_VERSIONS).contains(n))
            .ok_or_else(|| invalid("Invalid page size"))?,
        None => MAX_RETAINED_VERSIONS,
    };
    let versions = store.history();
    let start = if let Some(token) = params.get("pageToken") {
        versions
            .iter()
            .position(|version| version.etag() == *token)
            .ok_or_else(|| invalid("Invalid or expired page token"))?
            + 1
    } else {
        0
    };
    let page = versions.get(start..).unwrap_or_default();
    if page.is_empty() {
        return Ok(Reply::ok(json!({}), None));
    }
    let mut body = json!({"versions": page.iter().take(limit).map(|entry| version_fields(entry)).collect::<Vec<_>>()});
    if page.len() > limit {
        body["nextPageToken"] = json!(page[limit - 1].etag());
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
            let mut body = visible_fields(&template);
            if let Some(description) = template.description() {
                body.insert("version".to_owned(), json!({"description": description}));
            }
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
        Error::MissingPrecondition => invalid("An If-Match header is required"),
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
