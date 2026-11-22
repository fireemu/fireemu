//! Immutable client templates and version transitions for one Remote Config store.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use fireemu_core_types::time::LogicalInstant;
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::{json, Map, Value};

/// Local retention bound, including the current version.
pub const MAX_RETAINED_VERSIONS: usize = 300;

type Parameters = BTreeMap<String, Map<String, Value>>;

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct Draft {
    conditions: Vec<Map<String, Value>>,
    parameters: Parameters,
    parameter_groups: BTreeMap<String, Group>,
    version: Option<DraftVersion>,
}

#[derive(Deserialize, serde::Serialize)]
struct Group {
    #[serde(default)]
    parameters: Parameters,
    #[serde(flatten)]
    metadata: Map<String, Value>,
}

#[derive(Deserialize)]
struct DraftVersion {
    description: Option<String>,
}

impl Draft {
    fn parse(input: Value) -> Result<Self, Error> {
        if !input.is_object() {
            return Err(invalid("template must be an object"));
        }
        if input
            .get("version")
            .is_some_and(|version| !version.is_object())
        {
            return Err(invalid("version must be an object"));
        }
        let draft: Self = serde_json::from_value(input)
            .map_err(|error| Error::InvalidTemplate(error.to_string()))?;
        for condition in &draft.conditions {
            validate_text_fields("condition", condition, &["name", "expression", "tagColor"])?;
        }
        for group in draft.parameter_groups.values() {
            validate_text_fields("parameter group", &group.metadata, &["description"])?;
        }
        let groups = draft
            .parameter_groups
            .values()
            .map(|group| &group.parameters);
        for (name, parameter) in std::iter::once(&draft.parameters).chain(groups).flatten() {
            validate_text_fields("parameter", parameter, &["description", "valueType"])?;
            ValueType::parse(name, parameter)?;
            let conditional = parameter
                .get("conditionalValues")
                .map(|value| {
                    value.as_object().ok_or_else(|| {
                        invalid(format!(
                            "parameter {name:?} conditionalValues must be an object"
                        ))
                    })
                })
                .transpose()?;
            let values = parameter
                .get("defaultValue")
                .into_iter()
                .chain(conditional.into_iter().flat_map(Map::values));
            for value in values {
                let fields = value.as_object().ok_or_else(|| {
                    invalid(format!("parameter {name:?} value must be an object"))
                })?;
                validate_text_fields("parameter", fields, &["value"])?;
                if fields
                    .get("useInAppDefault")
                    .is_some_and(|value| !value.is_boolean())
                {
                    return Err(invalid(format!(
                        "parameter {name:?} useInAppDefault must be a boolean"
                    )));
                }
            }
        }
        Ok(draft)
    }
}

/// Fields owned by the template author. Version metadata is tracked independently.
#[derive(Debug, PartialEq, Eq)]
pub struct ClientTemplate {
    document: Value,
    description: Option<String>,
}

impl ClientTemplate {
    fn validate(mut draft: Draft) -> Result<Self, Error> {
        let mut conditions = BTreeSet::new();
        for condition in &draft.conditions {
            let name = required_string(condition, "name")?;
            required_string(condition, "expression")?;
            if !conditions.insert(name) {
                return Err(invalid(format!("duplicate condition {name:?}")));
            }
        }

        let groups = draft
            .parameter_groups
            .values_mut()
            .map(|group| &mut group.parameters);
        let parameters = std::iter::once(&mut draft.parameters)
            .chain(groups)
            .flatten();
        let mut names = BTreeSet::new();
        for (name, definition) in parameters {
            if !valid_parameter_name(name) || !names.insert(name) {
                return Err(invalid(format!(
                    "invalid or duplicate parameter name {name:?}"
                )));
            }
            validate_parameter(name, definition, &conditions)?;
        }
        Ok(Self {
            document: json!({
                "conditions": draft.conditions,
                "parameters": draft.parameters,
                "parameterGroups": draft.parameter_groups,
            }),
            description: draft.version.and_then(|version| version.description),
        })
    }

    /// Client template fields, with condition order preserved.
    #[must_use]
    pub const fn document(&self) -> &Value {
        &self.document
    }

    /// Optional author-supplied version description.
    #[must_use]
    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }
}

fn invalid(message: impl Into<String>) -> Error {
    Error::InvalidTemplate(message.into())
}

fn required_string<'a>(object: &'a Map<String, Value>, field: &str) -> Result<&'a str, Error> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| invalid(format!("condition {field} must be a nonempty string")))
}

fn validate_text_fields(
    context: &str,
    object: &Map<String, Value>,
    fields: &[&str],
) -> Result<(), Error> {
    for field in fields {
        if object.get(*field).is_some_and(|value| !value.is_string()) {
            return Err(invalid(format!("{context} {field} must be a string")));
        }
    }
    Ok(())
}

fn valid_parameter_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    name.len() <= 256
        && bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

enum ValueType {
    String,
    Boolean,
    Number,
    Json,
}

impl ValueType {
    fn parse(name: &str, parameter: &Map<String, Value>) -> Result<Self, Error> {
        match parameter.get("valueType").and_then(Value::as_str) {
            None | Some("STRING" | "PARAMETER_VALUE_TYPE_UNSPECIFIED") => Ok(Self::String),
            Some("BOOLEAN") => Ok(Self::Boolean),
            Some("NUMBER") => Ok(Self::Number),
            Some("JSON") => Ok(Self::Json),
            Some(kind) => Err(invalid(format!(
                "parameter {name:?} has an unknown valueType {kind:?}"
            ))),
        }
    }

    fn matches(&self, value: &str) -> bool {
        match self {
            Self::String => true,
            Self::Boolean => {
                value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false")
            }
            Self::Number => value.parse::<f64>().is_ok_and(f64::is_finite),
            Self::Json => serde_json::from_str::<Value>(value).is_ok(),
        }
    }
}

fn validate_parameter(
    name: &str,
    parameter: &mut Map<String, Value>,
    conditions: &BTreeSet<&str>,
) -> Result<(), Error> {
    let value_type = ValueType::parse(name, parameter)?;
    if parameter.get("valueType").and_then(Value::as_str)
        == Some("PARAMETER_VALUE_TYPE_UNSPECIFIED")
    {
        parameter.remove("valueType");
    }
    let default = parameter.entry("defaultValue").or_insert_with(|| json!({}));
    if default.as_object().is_some_and(Map::is_empty) {
        *default = json!({"value": ""});
    }
    if !valid_value(default, &value_type) {
        return Err(invalid(format!(
            "parameter {name:?} has an invalid defaultValue"
        )));
    }
    if let Some(references) = parameter
        .get("conditionalValues")
        .and_then(Value::as_object)
    {
        for (condition, value) in references {
            if !conditions.contains(condition.as_str()) || !valid_value(value, &value_type) {
                return Err(invalid(format!(
                    "parameter {name:?} has an invalid value for condition {condition:?}"
                )));
            }
        }
    }
    Ok(())
}

fn valid_value(value: &Value, value_type: &ValueType) -> bool {
    let Some(value) = value.as_object() else {
        return false;
    };
    match (value.get("value"), value.get("useInAppDefault")) {
        (Some(literal), None) => literal
            .as_str()
            .is_some_and(|value| value_type.matches(value)),
        (None, Some(use_default)) => use_default.is_boolean(),
        (None, None) => true,
        (Some(_), Some(_)) => false,
    }
}

/// Whether to validate a proposed template or commit a new version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteMode {
    /// Check the proposal and precondition without modifying the store.
    Validate,
    /// Commit the proposal as the next version.
    Publish,
}

/// Reason a store operation did not change the current version.
#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    /// No `ETag` or wildcard was supplied.
    MissingPrecondition,
    /// The supplied `ETag` did not identify the current version.
    PreconditionFailed,
    /// The proposed document did not satisfy the supported structural contract.
    InvalidTemplate(String),
    /// The requested published version was absent or has been evicted.
    UnknownVersion,
    /// The version counter cannot advance.
    VersionExhausted,
}

/// Successful result of validating or publishing a client template.
#[derive(Debug)]
pub enum WriteResult {
    /// The checked draft, with no new version allocated.
    Validated {
        /// Normalized author-owned content.
        template: ClientTemplate,
        /// Tag of the current version when the draft was checked.
        base_etag: String,
    },
    /// The committed version.
    Published(Arc<Version>),
}

/// The operation that created a retained version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    /// The empty state before any version was published.
    Initial,
    /// A publication from a submitted template.
    Publish {
        /// Whether the caller explicitly supplied the wildcard.
        forced: bool,
    },
    /// A publication of content from a retained version.
    Rollback {
        /// The version from which the content was restored.
        source: u64,
    },
}

/// Immutable template and server-generated version metadata.
#[derive(Debug)]
pub struct Version {
    number: u64,
    store_id: u128,
    template: Arc<ClientTemplate>,
    update_time: Option<LogicalInstant>,
    change: Change,
}

impl Version {
    /// Monotonically increasing version number within a store.
    #[must_use]
    pub const fn number(&self) -> u64 {
        self.number
    }

    /// Opaque precondition token scoped to the owning store.
    #[must_use]
    pub fn etag(&self) -> String {
        self.etag_for(self.number)
    }

    pub(crate) fn empty_etag(&self) -> String {
        self.etag_for(0)
    }

    fn etag_for(&self, number: u64) -> String {
        format!("etag-fireemu-{:032x}-{number}", self.store_id)
    }

    /// Immutable contents associated with this version.
    #[must_use]
    pub fn template(&self) -> &ClientTemplate {
        &self.template
    }

    /// Time at which this version was committed, absent for the initial state.
    #[must_use]
    pub const fn update_time(&self) -> Option<LogicalInstant> {
        self.update_time
    }

    /// The operation that produced this version.
    #[must_use]
    pub const fn change(&self) -> Change {
        self.change
    }
}

/// In-memory history for one project's client template.
pub struct TemplateStore {
    history: Mutex<History>,
}

struct History {
    versions: VecDeque<Arc<Version>>,
    current_body: Option<Bytes>,
}

const MAX_CACHED_TEMPLATE_BYTES: usize = 1024 * 1024;

impl Default for TemplateStore {
    fn default() -> Self {
        let mut id = [0; 16];
        OsRng.fill_bytes(&mut id);
        let initial = Version {
            number: 0,
            store_id: u128::from_be_bytes(id),
            template: Arc::new(ClientTemplate {
                document: json!({"conditions": [], "parameters": {}, "parameterGroups": {}}),
                description: None,
            }),
            update_time: None,
            change: Change::Initial,
        };
        Self {
            history: Mutex::new(History {
                versions: VecDeque::from([Arc::new(initial)]),
                current_body: None,
            }),
        }
    }
}

fn head(versions: &VecDeque<Arc<Version>>) -> &Arc<Version> {
    versions.back().expect("store always has a current version")
}

fn published(versions: &VecDeque<Arc<Version>>, number: u64) -> Option<&Arc<Version>> {
    let index = published_index(versions, number)?;
    versions.get(index)
}

fn published_index(versions: &VecDeque<Arc<Version>>, number: u64) -> Option<usize> {
    // Each commit appends exactly the next version; retention only removes the oldest.
    if number == 0 {
        return None;
    }
    let oldest = versions.front()?.number;
    let index = usize::try_from(number.checked_sub(oldest)?).ok()?;
    (index < versions.len()).then_some(index)
}

impl TemplateStore {
    /// The current version, or the store's empty initial state.
    #[must_use]
    pub fn current(&self) -> Arc<Version> {
        head(&self.history.lock().expect("template store lock").versions).clone()
    }

    /// A retained published version, excluding the empty initial state.
    #[must_use]
    pub fn version(&self, number: u64) -> Option<Arc<Version>> {
        published(
            &self.history.lock().expect("template store lock").versions,
            number,
        )
        .cloned()
    }

    /// Retained published versions in descending order.
    #[must_use]
    pub fn history(&self) -> Vec<Arc<Version>> {
        self.history
            .lock()
            .expect("template store lock")
            .versions
            .iter()
            .rev()
            .filter(|version| version.number > 0)
            .cloned()
            .collect()
    }

    pub(crate) fn history_page(
        &self,
        limit: usize,
        after: Option<&str>,
    ) -> Option<(Vec<Arc<Version>>, bool)> {
        let history = self.history.lock().expect("template store lock");
        let versions = &history.versions;
        let end = if let Some(token) = after {
            let (_, number) = token.rsplit_once('-')?;
            let index = published_index(versions, number.parse().ok()?)?;
            if versions[index].etag() != token {
                return None;
            }
            index
        } else {
            versions.len()
        };
        let first_published =
            usize::from(versions.front().is_some_and(|version| version.number == 0));
        let first = end.saturating_sub(limit).max(first_published);
        let page = versions.range(first..end).rev().cloned().collect();
        Some((page, first > first_published))
    }

    pub(crate) fn render_current(
        &self,
        render: impl FnOnce(&Version) -> Bytes,
    ) -> (Arc<Version>, Bytes) {
        let version = {
            let history = self.history.lock().expect("template store lock");
            let current = head(&history.versions).clone();
            if let Some(body) = &history.current_body {
                return (current, body.clone());
            }
            current
        };
        let body = render(&version);
        if body.len() <= MAX_CACHED_TEMPLATE_BYTES {
            let mut history = self.history.lock().expect("template store lock");
            if Arc::ptr_eq(head(&history.versions), &version) && history.current_body.is_none() {
                history.current_body = Some(body.clone());
            }
        }
        (version, body)
    }

    /// Applies a matching `ETag` or an explicit wildcard to a proposal. Validation leaves history
    /// untouched. The `ETag` check and any publication share one critical section.
    pub fn write(
        &self,
        mode: WriteMode,
        if_match: Option<&str>,
        input: Value,
        now: LogicalInstant,
    ) -> Result<WriteResult, Error> {
        let draft = Draft::parse(input)?;
        let if_match = if_match.ok_or(Error::MissingPrecondition)?;
        let template = ClientTemplate::validate(draft);
        let mut history = self.history.lock().expect("template store lock");
        let forced = if_match == "*";
        let base_etag = head(&history.versions).etag();
        if !forced && if_match != base_etag {
            return Err(Error::PreconditionFailed);
        }
        let template = template?;
        if mode == WriteMode::Validate {
            return Ok(WriteResult::Validated {
                template,
                base_etag,
            });
        }
        Self::commit(
            &mut history,
            Arc::new(template),
            now,
            Change::Publish { forced },
        )
        .map(WriteResult::Published)
    }

    /// Reuses a retained version's template with a fresh version number and timestamp.
    pub fn rollback(&self, source: u64, now: LogicalInstant) -> Result<Arc<Version>, Error> {
        let mut history = self.history.lock().expect("template store lock");
        let template = published(&history.versions, source)
            .ok_or(Error::UnknownVersion)?
            .template
            .clone();
        Self::commit(&mut history, template, now, Change::Rollback { source })
    }

    fn commit(
        history: &mut History,
        template: Arc<ClientTemplate>,
        now: LogicalInstant,
        change: Change,
    ) -> Result<Arc<Version>, Error> {
        let versions = &mut history.versions;
        let current = head(versions);
        let number = current
            .number
            .checked_add(1)
            .ok_or(Error::VersionExhausted)?;
        let version = Arc::new(Version {
            number,
            store_id: current.store_id,
            template,
            update_time: Some(now),
            change,
        });
        versions.push_back(version.clone());
        if number == 1 || versions.len() > MAX_RETAINED_VERSIONS {
            versions.pop_front();
        }
        history.current_body = None;
        Ok(version)
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    #[test]
    fn late_render_cannot_replace_the_current_version() {
        let store = TemplateStore::default();
        let now = LogicalInstant::UNIX_EPOCH;
        store
            .write(WriteMode::Publish, Some("*"), json!({}), now)
            .unwrap();

        let (old, body) = store.render_current(|version| {
            assert_eq!(version.number(), 1);
            store.rollback(1, now).unwrap();
            let (new, body) = store.render_current(|_| Bytes::from_static(b"new"));
            assert_eq!(new.number(), 2);
            assert_eq!(body, "new");
            Bytes::from_static(b"old")
        });
        assert_eq!(old.number(), 1);
        assert_eq!(body, "old");
        let (new, body) = store.render_current(|_| panic!("version 2 was already rendered"));
        assert_eq!(new.number(), 2);
        assert_eq!(body, "new");
    }

    #[test]
    fn large_current_body_is_rendered_each_time() {
        let store = TemplateStore::default();
        let oversized =
            store.render_current(|_| Bytes::from(vec![0; MAX_CACHED_TEMPLATE_BYTES + 1]));
        assert_eq!(oversized.1.len(), MAX_CACHED_TEMPLATE_BYTES + 1);
        let (_, body) = store.render_current(|_| Bytes::from_static(b"next render"));
        assert_eq!(body, "next render");
    }
}
