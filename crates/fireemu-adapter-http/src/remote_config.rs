//! Immutable templates and version transitions for Remote Config namespaces.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use fireemu_core_types::time::LogicalInstant;
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::{json, Map, Value};

/// Local retention bound, including the current version.
pub const MAX_RETAINED_VERSIONS: usize = 300;

/// Production's template limits, each recorded at the limit and one over it (2026-11-21).
const MAX_PARAMETERS: usize = 3000;
const MAX_CONDITIONS: usize = 2000;
const MAX_NAME_CHARS: usize = 256;
const MAX_DESCRIPTION_CHARS: usize = 1024;

type Parameters = BTreeMap<String, Map<String, Value>>;

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
struct Draft {
    conditions: Vec<Map<String, Value>>,
    parameters: Parameters,
    parameter_groups: BTreeMap<String, Group>,
    version: Option<DraftVersion>,
}

#[derive(Deserialize)]
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

/// The refusals production's JSON transcoder answered before the template reached validation
/// (2026-11-21 `unknown-field`, `parameters-not-object`, `groups-not-object`, `kind-invalid`,
/// `pair-07` to `pair-14` bad type). A parameter's index is its position in Fireemu's sorted
/// parameter map, which is the request order only for sorted requests (member order is a
/// documented difference); group parameters and conditional values keep the earlier refusal.
fn transcoder_checks(input: &Map<String, Value>) -> Result<(), Error> {
    let refusal = |message: String, field: String| Err(Error::Transcoder { message, field });
    for key in input.keys() {
        if !["conditions", "parameters", "parameterGroups", "version"].contains(&key.as_str()) {
            return refusal(
                format!("Invalid JSON payload received. Unknown name {} at 'remote_config': Cannot find field.", Value::String(key.clone())),
                "remote_config".into(),
            );
        }
    }
    for field in ["parameters", "parameterGroups"] {
        if input.get(field).is_some_and(Value::is_array) {
            return refusal(
                format!("Invalid value at 'remote_config' (Map), Cannot bind a list to map for field '{field}'."),
                "remote_config".into(),
            );
        }
    }
    let parameters = input
        .get("parameters")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    for (index, parameter) in parameters.map(|(_, parameter)| parameter).enumerate() {
        if let Some(kind) = parameter.get("valueType").and_then(Value::as_str) {
            if ![
                "PARAMETER_VALUE_TYPE_UNSPECIFIED",
                "STRING",
                "BOOLEAN",
                "NUMBER",
                "JSON",
            ]
            .contains(&kind)
            {
                let field = format!("remote_config.parameters[{index}].value.value_type");
                return refusal(
                    format!("Invalid value at '{field}' (type.googleapis.com/google.firebase.remoteconfig.v1.RemoteConfigParameter.ParameterValueType), {}", Value::String(kind.into())),
                    field,
                );
            }
        }
        if let Some(value) = parameter
            .pointer("/defaultValue/value")
            .filter(|value| value.is_number() || value.is_boolean())
        {
            let field = format!("remote_config.parameters[{index}].value.default_value.value");
            return refusal(
                format!("Invalid value at '{field}' (TYPE_STRING), {value}"),
                field,
            );
        }
    }
    Ok(())
}

impl Draft {
    fn parse(input: Value) -> Result<Self, Error> {
        let Some(object) = input.as_object() else {
            return Err(invalid("template must be an object"));
        };
        transcoder_checks(object)?;
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
        // The refusals and messages recorded on 2026-11-21 (`validate-*`, `validation-edges-*`,
        // `validation-resume-*`); their order among several faults was not recorded.
        let refuse = |message: String| Err(invalid(format!("[VALIDATION_ERROR]: {message}")));
        if let Some(description) = draft.version.as_ref().and_then(|v| v.description.as_ref()) {
            if description.chars().count() > MAX_DESCRIPTION_CHARS {
                return refuse(format!("DESCRIPTION_EXCEEDS_MAXIMUM_SIZE Template version description is larger than the maximum size {MAX_DESCRIPTION_CHARS}."));
            }
        }
        let parameter_count = draft.parameters.len()
            + draft
                .parameter_groups
                .values()
                .map(|group| group.parameters.len())
                .sum::<usize>();
        if parameter_count > MAX_PARAMETERS {
            return refuse(format!("PARAM_COUNT_TOO_LARGE The template has {parameter_count} parameters. The maximum number allowed is {MAX_PARAMETERS}."));
        }
        if draft.conditions.len() > MAX_CONDITIONS {
            return refuse(format!("CONDITION_COUNT_TOO_LARGE The template has {} conditions. The maximum number allowed is {MAX_CONDITIONS}.", draft.conditions.len()));
        }
        let mut conditions = BTreeSet::new();
        for condition in &draft.conditions {
            let name = condition
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if name.is_empty() {
                return refuse("INVALID_CONDITION_NAME Invalid condition name: []".into());
            }
            if name.chars().count() > MAX_NAME_CHARS {
                return refuse(format!("INVALID_CONDITION_NAME Condition name '{name}' exceeds the maximum length of {MAX_NAME_CHARS} characters"));
            }
            let name = required_string(condition, "name")?;
            required_string(condition, "expression")?;
            if !conditions.insert(name) {
                return refuse(format!(
                    "DUPLICATE_CONDITION_NAME Duplicate condition name: {name}"
                ));
            }
        }
        for name in draft.parameter_groups.keys() {
            if name.chars().count() > MAX_NAME_CHARS {
                return refuse(format!("KEY_TOO_LONG Group name {name} is larger than the maximum name size {MAX_NAME_CHARS}"));
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
            if name.chars().count() > MAX_NAME_CHARS {
                return refuse(format!("KEY_TOO_LONG Parameter key {name} is larger than the maximum key size {MAX_NAME_CHARS}"));
            }
            if !valid_parameter_name(name) {
                return refuse(format!("INVALID_KEY Invalid parameter key: [{name}]"));
            }
            if !names.insert(name) {
                return refuse(format!("DUPLICATE_KEY Duplicate parameter key: {name}"));
            }
            validate_parameter(name, definition, &conditions)?;
        }
        let groups = draft
            .parameter_groups
            .into_iter()
            .map(|(name, group)| {
                let mut metadata = group.metadata;
                metadata.insert("parameters".into(), parameters_value(group.parameters));
                (name, Value::Object(metadata))
            })
            .collect();
        Ok(Self {
            document: Value::Object(Map::from_iter([
                (
                    "conditions".into(),
                    Value::Array(draft.conditions.into_iter().map(Value::Object).collect()),
                ),
                ("parameters".into(), parameters_value(draft.parameters)),
                ("parameterGroups".into(), Value::Object(groups)),
            ])),
            description: draft.version.and_then(|version| version.description),
        })
    }

    /// Client template fields, with condition order preserved.
    #[must_use]
    pub const fn document(&self) -> &Value {
        &self.document
    }

    pub(crate) fn into_document(self) -> Value {
        self.document
    }

    /// Optional author-supplied version description.
    #[must_use]
    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }
}

fn parameters_value(parameters: Parameters) -> Value {
    Value::Object(
        parameters
            .into_iter()
            .map(|(key, fields)| (key, Value::Object(fields)))
            .collect(),
    )
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

    const fn name(&self) -> &'static str {
        match self {
            Self::String => "STRING",
            Self::Boolean => "BOOLEAN",
            Self::Number => "NUMBER",
            Self::Json => "JSON",
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
    let mismatch = |value: &Value| {
        let literal = value.get("value").and_then(Value::as_str)?;
        (!value_type.matches(literal)).then(|| {
            invalid(format!(
                "[VALIDATION_ERROR]: PARAM_VALUE_TYPE_MISMATCH Parameter [{name}] is of type {}, which does not match value [{literal}]",
                value_type.name()
            ))
        })
    };
    if let Some(error) = mismatch(default) {
        return Err(error);
    }
    if !valid_value(default, &ValueType::String) {
        return Err(invalid(format!(
            "parameter {name:?} has an invalid defaultValue"
        )));
    }
    if let Some(references) = parameter
        .get("conditionalValues")
        .and_then(Value::as_object)
    {
        let unknown: Vec<&str> = references
            .keys()
            .map(String::as_str)
            .filter(|condition| !conditions.contains(condition))
            .collect();
        if !unknown.is_empty() {
            return Err(invalid(format!(
                "[VALIDATION_ERROR]: [{}] are not valid condition names. All keys in all conditional value maps must be valid condition names.",
                unknown.join(", ")
            )));
        }
        for (condition, value) in references {
            if let Some(error) = mismatch(value) {
                return Err(error);
            }
            if !valid_value(value, &ValueType::String) {
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
    /// The supplied `ETag` identified the current version when the request arrived, but another
    /// publication committed first: the loser of two concurrent writes with one `ETag`. It
    /// carries the condition counts production's refusal names (2026-11-21 race: `Condition order
    /// size [2] does not match condition count [4]`).
    ConcurrentPrecondition {
        /// Conditions of the refused draft.
        submitted: usize,
        /// Conditions of the version that committed first.
        current: usize,
    },
    /// The proposed document did not satisfy the supported structural contract.
    InvalidTemplate(String),
    /// Production's JSON transcoder refused the request body before validation: its message and
    /// the field it names.
    Transcoder {
        /// The refusal's message (also the field violation's description).
        message: String,
        /// The field violation's field.
        field: String,
    },
    /// The requested published version was absent or has been evicted.
    UnknownVersion,
    /// The version counter cannot advance.
    VersionExhausted,
    /// The Functions queue cannot hold all deliveries for this version.
    EventCapacity,
    /// The Functions runtime cannot admit this version's events.
    EventUnavailable,
    /// The current logical time cannot be represented in RFC 3339.
    ClockOutOfRange,
}

/// Successful result of validating or publishing a client template.
#[derive(Debug)]
pub enum WriteResult {
    /// The checked draft, with no new version allocated.
    Validated {
        /// Normalized author-owned content.
        template: ClientTemplate,
        /// The tag of the validate-only answer: production's `etag-<project number>-0`, or the
        /// current version's tag with `-0` appended for a store without a project number.
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
    project_number: Option<u64>,
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

    /// Precondition token of this version. A published version of a store that knows its
    /// project number has production's form, `etag-<project number>-<version>`
    /// (RC-OBSERVE-V2-3 seq 1, 2, 33, 58); the unpublished state, whose production value was not
    /// recorded, and a store without a project number keep an opaque store-scoped form.
    #[must_use]
    pub fn etag(&self) -> String {
        match self.project_number {
            Some(number) if self.change != Change::Initial => {
                format!("etag-{number}-{}", self.number)
            }
            _ => self.store_etag(self.number),
        }
    }

    /// The tag of a validate-only answer: production's `etag-<project number>-0`
    /// (RC-OBSERVE-V2-3 seq 34-53), or this version's tag with `-0` appended without a number.
    pub(crate) fn validation_etag(&self) -> String {
        self.project_number.map_or_else(
            || format!("{}-0", self.etag()),
            |number| format!("etag-{number}-0"),
        )
    }

    /// The tag of an unavailable version's empty answer, whose production value was not recorded.
    pub(crate) fn empty_etag(&self) -> String {
        self.store_etag(0)
    }

    fn store_etag(&self, number: u64) -> String {
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

/// Local Remote Config behaviour that depends on the daemon's configuration.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RemoteConfigSettings {
    /// Refuse the server conditions production refused (strict profile only).
    pub strict_server_conditions: bool,
    /// Answer the loser of two concurrent client publications with production's 400 (strict
    /// profile only).
    pub strict_concurrent_publish: bool,
    /// The identity reported as `updateUser`; `None` omits the field everywhere.
    pub update_user: Option<UpdateUser>,
    /// The project number: production's `ETag`s carry it, and production serves the client
    /// template's current read under it (2026-11-21 `client-project-number`). `None` keeps the
    /// opaque tags and answers the number as an unknown project.
    pub project_number: Option<u64>,
}

/// A configured `updateUser` identity (`remoteConfig.updateUser`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateUser {
    /// Reported on every surface.
    pub email: String,
    /// Reported in version history only (empty when not configured).
    pub name: String,
    /// Reported in version history only (empty when not configured).
    pub image_url: String,
}

/// Remote Config template namespaces supported by local administration.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Namespace {
    /// The default `firebase` namespace.
    Client,
    /// The `firebase-server` namespace.
    Server,
}

/// Independent template histories for the project's two namespaces.
#[derive(Default)]
pub struct RemoteConfigStores {
    /// History for `firebase`.
    pub client: TemplateStore,
    /// History for `firebase-server`.
    pub server: TemplateStore,
}

impl RemoteConfigStores {
    /// Selects the history for the requested namespace.
    #[must_use]
    pub const fn get(&self, namespace: Namespace) -> &TemplateStore {
        match namespace {
            Namespace::Client => &self.client,
            Namespace::Server => &self.server,
        }
    }
}

/// In-memory history for one project's template namespace.
pub struct TemplateStore {
    history: Mutex<History>,
    reserver: Option<Box<VersionReserver>>,
}

type VersionReserver = dyn Fn(&Version) -> Result<Box<dyn FnOnce() + Send>, Error> + Send + Sync;

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
            project_number: None,
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
            reserver: None,
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
    /// Creates an empty store that reserves before appending and publishes after appending,
    /// with both operations under the history lock.
    pub fn with_reserver(reserver: Box<VersionReserver>) -> Self {
        Self {
            reserver: Some(reserver),
            ..Self::default()
        }
    }

    /// Tags this store's published versions with production's `etag-<project number>-<version>`.
    #[must_use]
    pub fn with_project_number(self, project_number: Option<u64>) -> Self {
        {
            let mut history = self.history.lock().expect("template store lock");
            let initial = head(&history.versions);
            let tagged = Version {
                number: initial.number,
                store_id: initial.store_id,
                project_number,
                template: initial.template.clone(),
                update_time: initial.update_time,
                change: initial.change,
            };
            history.versions = VecDeque::from([Arc::new(tagged)]);
        }
        self
    }

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

    /// One page of the retained published versions that `keep` admits, newest first, starting at
    /// version `from` (inclusive) when given, and the number of the next admitted version when
    /// one is left: production's `nextPageToken` (RC-OBSERVE-V2-3 seq 69, 2026-11-21 history).
    pub(crate) fn history_page(
        &self,
        limit: usize,
        from: Option<u64>,
        keep: &dyn Fn(&Version) -> bool,
    ) -> (Vec<Arc<Version>>, Option<u64>) {
        let history = self.history.lock().expect("template store lock");
        let mut admitted = history
            .versions
            .iter()
            .rev()
            .filter(|version| version.number > 0)
            .filter(|version| from.is_none_or(|from| version.number <= from))
            .filter(|version| keep(version));
        let page: Vec<_> = admitted.by_ref().take(limit).cloned().collect();
        let next = admitted.next().map(|version| version.number);
        (page, next)
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
        self.write_checked(mode, if_match, input, now, &|_| Ok(()))
    }

    /// [`Self::write`] with `check` run on the validated template after the preconditions, for
    /// refusals that depend on the caller's configuration (the strict profile's server conditions).
    pub fn write_checked(
        &self,
        mode: WriteMode,
        if_match: Option<&str>,
        input: Value,
        now: LogicalInstant,
        check: &dyn Fn(&ClientTemplate) -> Result<(), Error>,
    ) -> Result<WriteResult, Error> {
        let seen = self.current();
        self.write_seen(&seen, mode, if_match, input, now, check)
    }

    /// [`Self::write_checked`] against the version `seen` when the request arrived: a tag that
    /// matched `seen` but no longer matches the head lost a concurrent write.
    pub(crate) fn write_seen(
        &self,
        seen: &Version,
        mode: WriteMode,
        if_match: Option<&str>,
        input: Value,
        now: LogicalInstant,
        check: &dyn Fn(&ClientTemplate) -> Result<(), Error>,
    ) -> Result<WriteResult, Error> {
        let draft = Draft::parse(input)?;
        let if_match = if_match.ok_or(Error::MissingPrecondition)?;
        let forced = if_match == "*";
        if !forced && if_match != seen.etag() {
            return Err(Error::PreconditionFailed);
        }
        let template = ClientTemplate::validate(draft);
        let mut history = self.history.lock().expect("template store lock");
        let base = head(&history.versions);
        if !forced && if_match != base.etag() {
            let count = |template: &ClientTemplate| {
                template.document()["conditions"]
                    .as_array()
                    .map_or(0, Vec::len)
            };
            return Err(match &template {
                Ok(submitted) => Error::ConcurrentPrecondition {
                    submitted: count(submitted),
                    current: count(base.template()),
                },
                Err(_) => Error::PreconditionFailed,
            });
        }
        let base_etag = base.validation_etag();
        let template = template?;
        check(&template)?;
        if mode == WriteMode::Validate {
            return Ok(WriteResult::Validated {
                template,
                base_etag,
            });
        }
        self.commit(
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
        self.commit(&mut history, template, now, Change::Rollback { source })
    }

    fn commit(
        &self,
        history: &mut History,
        template: Arc<ClientTemplate>,
        now: LogicalInstant,
        change: Change,
    ) -> Result<Arc<Version>, Error> {
        now.to_rfc3339().map_err(|_| Error::ClockOutOfRange)?;
        let versions = &mut history.versions;
        let current = head(versions);
        let number = current
            .number
            .checked_add(1)
            .ok_or(Error::VersionExhausted)?;
        let version = Arc::new(Version {
            number,
            store_id: current.store_id,
            project_number: current.project_number,
            template,
            update_time: Some(now),
            change,
        });
        let publish = self
            .reserver
            .as_ref()
            .map(|reserve| reserve(&version))
            .transpose()?;
        versions.push_back(version.clone());
        if number == 1 || versions.len() > MAX_RETAINED_VERSIONS {
            versions.pop_front();
        }
        history.current_body = None;
        if let Some(publish) = publish {
            publish();
        }
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
