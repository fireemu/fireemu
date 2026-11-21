//! Immutable client templates and version transitions for one Remote Config store.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

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

/// Fields owned by the template author. Version metadata is tracked independently.
#[derive(Debug, PartialEq, Eq)]
pub struct ClientTemplate {
    document: Value,
    description: Option<String>,
}

impl ClientTemplate {
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
        let draft: Draft = serde_json::from_value(input)
            .map_err(|error| Error::InvalidTemplate(error.to_string()))?;
        let mut conditions = BTreeSet::new();
        for condition in &draft.conditions {
            let name = required_string(condition, "name")?;
            required_string(condition, "expression")?;
            validate_text_fields("condition", condition, &["tagColor"])?;
            if !conditions.insert(name) {
                return Err(invalid(format!("duplicate condition {name:?}")));
            }
        }

        for group in draft.parameter_groups.values() {
            validate_text_fields("parameter group", &group.metadata, &["description"])?;
        }
        let groups = draft
            .parameter_groups
            .values()
            .map(|group| &group.parameters);
        let parameters = std::iter::once(&draft.parameters).chain(groups).flatten();
        let mut names = BTreeSet::new();
        for (name, definition) in parameters {
            if name.trim().is_empty() || !names.insert(name) {
                return Err(invalid(format!(
                    "empty or duplicate parameter name {name:?}"
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

fn validate_parameter(
    name: &str,
    parameter: &Map<String, Value>,
    conditions: &BTreeSet<&str>,
) -> Result<(), Error> {
    validate_text_fields("parameter", parameter, &["description", "valueType"])?;
    if parameter
        .get("defaultValue")
        .is_some_and(|value| !valid_value(value))
    {
        return Err(invalid(format!(
            "parameter {name:?} has an invalid defaultValue"
        )));
    }
    if let Some(references) = parameter.get("conditionalValues") {
        let references = references.as_object().ok_or_else(|| {
            invalid(format!(
                "parameter {name:?} conditionalValues must be an object"
            ))
        })?;
        for (condition, value) in references {
            if !conditions.contains(condition.as_str()) || !valid_value(value) {
                return Err(invalid(format!(
                    "parameter {name:?} has an invalid value for condition {condition:?}"
                )));
            }
        }
    }
    Ok(())
}

fn valid_value(value: &Value) -> bool {
    let Some(value) = value.as_object() else {
        return false;
    };
    match (value.get("value"), value.get("useInAppDefault")) {
        (Some(literal), None) => literal.is_string(),
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
        format!("etag-fireemu-{:032x}-{}", self.store_id, self.number)
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
    versions: Mutex<VecDeque<Arc<Version>>>,
}

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
            versions: Mutex::new(VecDeque::from([Arc::new(initial)])),
        }
    }
}

fn head(versions: &VecDeque<Arc<Version>>) -> &Arc<Version> {
    versions.back().expect("store always has a current version")
}

fn published(versions: &VecDeque<Arc<Version>>, number: u64) -> Option<&Arc<Version>> {
    versions
        .iter()
        .find(|version| version.number == number && number > 0)
}

impl TemplateStore {
    /// The current version, or the store's empty initial state.
    #[must_use]
    pub fn current(&self) -> Arc<Version> {
        head(&self.versions.lock().expect("template store lock")).clone()
    }

    /// A retained published version, excluding the empty initial state.
    #[must_use]
    pub fn version(&self, number: u64) -> Option<Arc<Version>> {
        published(&self.versions.lock().expect("template store lock"), number).cloned()
    }

    /// Retained published versions in descending order.
    #[must_use]
    pub fn history(&self) -> Vec<Arc<Version>> {
        self.versions
            .lock()
            .expect("template store lock")
            .iter()
            .rev()
            .filter(|version| version.number > 0)
            .cloned()
            .collect()
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
        let if_match = if_match.ok_or(Error::MissingPrecondition)?;
        let template = ClientTemplate::parse(input);
        let mut versions = self.versions.lock().expect("template store lock");
        let forced = if_match == "*";
        let base_etag = head(&versions).etag();
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
            &mut versions,
            Arc::new(template),
            now,
            Change::Publish { forced },
        )
        .map(WriteResult::Published)
    }

    /// Reuses a retained version's template with a fresh version number and timestamp.
    pub fn rollback(&self, source: u64, now: LogicalInstant) -> Result<Arc<Version>, Error> {
        let mut versions = self.versions.lock().expect("template store lock");
        let template = published(&versions, source)
            .ok_or(Error::UnknownVersion)?
            .template
            .clone();
        Self::commit(&mut versions, template, now, Change::Rollback { source })
    }

    fn commit(
        versions: &mut VecDeque<Arc<Version>>,
        template: Arc<ClientTemplate>,
        now: LogicalInstant,
        change: Change,
    ) -> Result<Arc<Version>, Error> {
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
        Ok(version)
    }
}
