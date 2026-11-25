//! The wire details production recorded for Remote Config administration (2026-11-21 and
//! `RC-OBSERVE-V2-3`): JSON escaping, time digits, `ETag`s, history tokens, filters and refusals.

use super::*;
use proptest::prelude::*;

/// A synthetic project number (never a sandbox number).
const NUMBER: u64 = 123_456_789_012;
const T0: i64 = 1_765_000_000;

#[allow(clippy::too_many_arguments)] // one request's parts, as `dispatch` takes them
fn at(
    stores: &RemoteConfigStores,
    settings: &RemoteConfigSettings,
    path: &str,
    method: &str,
    query: &str,
    body: &[u8],
    if_match: Option<&str>,
    now: LogicalInstant,
) -> Reply {
    dispatch(
        stores,
        settings,
        &route(path).unwrap(),
        method,
        query,
        body,
        if_match,
        now,
    )
}

fn body_of(reply: &Reply) -> Value {
    match &reply.body {
        ReplyBody::Json(value) => value.clone(),
        ReplyBody::Rendered(bytes) | ReplyBody::File(bytes, _) => {
            serde_json::from_slice(bytes).unwrap()
        }
    }
}

fn text_of(reply: Reply) -> String {
    String::from_utf8(reply.wire().body.to_vec()).unwrap()
}

fn numbered() -> RemoteConfigStores {
    RemoteConfigStores {
        client: TemplateStore::default().with_project_number(Some(NUMBER)),
        server: TemplateStore::default().with_project_number(Some(NUMBER)),
    }
}

const CLIENT: &str = "/v1/projects/demo-config/remoteConfig";
const HISTORY: &str = "/v1/projects/demo-config/remoteConfig:listVersions";

/// Three client versions published at T0 + 1 s, + 2 s and + 3 s and 123 456 µs (whole
/// microseconds, so a filter can name a version's time exactly).
fn three_versions(stores: &RemoteConfigStores) -> [LogicalInstant; 3] {
    let times = [1, 2, 3].map(|second| {
        LogicalInstant::from_nanos(i128::from(T0 + second) * 1_000_000_000 + 123_456_000)
    });
    for time in times {
        let reply = at(
            stores,
            &RemoteConfigSettings::default(),
            CLIENT,
            "PUT",
            "",
            b"{}",
            Some("*"),
            time,
        );
        assert_eq!(reply.status, 200);
    }
    times
}

fn listed(reply: &Reply) -> Vec<String> {
    body_of(reply)["versions"]
        .as_array()
        .map(|versions| {
            versions
                .iter()
                .map(|v| v["versionNumber"].as_str().unwrap().to_owned())
                .collect()
        })
        .unwrap_or_default()
}

fn error_message(reply: &Reply) -> String {
    body_of(reply)["error"]["message"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn json_answers_escape_angle_brackets_only() {
    let text = String::from_utf8(pretty_json(&json!({"a<b": "x > y && z = 'q' \"r\""}))).unwrap();
    assert_eq!(
        text,
        "{\n  \"a\\u003cb\": \"x \\u003e y && z = 'q' \\\"r\\\"\"\n}\n"
    );
}

proptest! {
    #[test]
    fn escaped_json_decodes_to_the_same_value_and_has_no_raw_angle_bracket(key in ".{0,12}", value in ".{0,40}") {
        let original = json!({ key: value });
        let bytes = pretty_json(&original);
        prop_assert!(!bytes.contains(&b'<') && !bytes.contains(&b'>'));
        prop_assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), original);
        prop_assert_eq!(bytes.last(), Some(&b'\n'));
    }

    /// Production writes Remote Config times as protobuf JSON does, at microsecond precision:
    /// no fraction on a whole second, three digits on a whole millisecond, otherwise six
    /// (RC-CLOSURE-A 2026-11-25: `.949`, `.193490`, `.408063`).
    #[test]
    fn remote_config_times_use_three_or_six_fraction_digits(
        seconds in 0_i64..253_402_300_799,
        nanos in prop_oneof![
            0_i128..1_000_000_000,
            (0_i128..1_000).prop_map(|ms| ms * 1_000_000),
            (0_i128..1_000).prop_map(|ms| ms * 1_000_000 + 999),
            (0_i128..1_000_000).prop_map(|us| us * 1_000),
        ],
    ) {
        let time = LogicalInstant::from_nanos(i128::from(seconds) * 1_000_000_000 + nanos);
        let text = micros_rfc3339(time).unwrap();
        let whole_text = LogicalInstant::from_unix_seconds(seconds).to_rfc3339().unwrap();
        let micros = nanos / 1_000;
        let expected = if micros == 0 {
            whole_text.clone()
        } else if micros % 1_000 == 0 {
            format!("{}.{:03}Z", whole_text.strip_suffix('Z').unwrap(), micros / 1_000)
        } else {
            format!("{}.{micros:06}Z", whole_text.strip_suffix('Z').unwrap())
        };
        prop_assert_eq!(text, expected);
    }
}

#[test]
fn versions_report_update_times_as_protobuf_writes_them() {
    let stores = RemoteConfigStores::default();
    let reply = at(
        &stores,
        &RemoteConfigSettings::default(),
        CLIENT,
        "PUT",
        "",
        b"{}",
        Some("*"),
        LogicalInstant::from_unix_seconds(T0),
    );
    assert_eq!(
        body_of(&reply)["version"]["updateTime"],
        "2025-12-06T05:46:40Z"
    );
}

#[test]
fn a_store_with_a_project_number_tags_versions_as_production() {
    let stores = numbered();
    let settings = RemoteConfigSettings::default();
    let now = LogicalInstant::from_unix_seconds(T0);
    // The unpublished client state has no tag; its validation tag and the first version have
    // production's form.
    let validated = at(
        &stores,
        &settings,
        CLIENT,
        "PUT",
        "validateOnly=true",
        b"{}",
        Some("*"),
        now,
    );
    assert_eq!(validated.etag.as_deref(), Some("etag-123456789012-0"));
    let first = at(&stores, &settings, CLIENT, "PUT", "", b"{}", Some("*"), now);
    assert_eq!(first.etag.as_deref(), Some("etag-123456789012-1"));
    let second = at(
        &stores,
        &settings,
        CLIENT,
        "PUT",
        "",
        b"{}",
        Some("etag-123456789012-1"),
        now,
    );
    assert_eq!(second.status, 200);
    assert_eq!(second.etag.as_deref(), Some("etag-123456789012-2"));
    // An unavailable version answers `{}` with the validation tag's form (RC-CLOSURE-A
    // `r-version-missing`, both passes: 200 `{}`, `etag-<number>-0`).
    let missing = at(
        &stores,
        &settings,
        CLIENT,
        "GET",
        "versionNumber=9223372036854775807",
        b"",
        None,
        now,
    );
    assert_eq!(
        (missing.status, missing.etag.as_deref()),
        (200, Some("etag-123456789012-0"))
    );
}

#[test]
fn a_rollback_to_an_unknown_client_version_has_the_recorded_message() {
    let stores = numbered();
    let settings = RemoteConfigSettings {
        project_number: Some(NUMBER),
        ..RemoteConfigSettings::default()
    };
    let now = LogicalInstant::from_unix_seconds(T0);
    let rollback = format!("{CLIENT}:rollback");
    for body in [
        &br#"{"versionNumber":"9223372036854775807"}"#[..],
        br#"{"versionNumber":9223372036854775807}"#,
    ] {
        let reply = at(&stores, &settings, &rollback, "POST", "", body, None, now);
        assert_eq!(reply.status, 404);
        assert_eq!(
            error_message(&reply),
            "[NOT_FOUND]: Template version [9223372036854775807] not found for project [ProjectKey{projectNumber=123456789012, namespace=firebase}]"
        );
    }
    // Other refusals keep their answers; the server namespace and a store without a number keep
    // the earlier 404.
    assert_eq!(
        at(&stores, &settings, &rollback, "POST", "", b"{}", None, now).status,
        400
    );
    let server = "/v1/projects/demo-config/namespaces/firebase-server/remoteConfig:rollback";
    let reply = at(
        &stores,
        &settings,
        server,
        "POST",
        "",
        br#"{"versionNumber":"99"}"#,
        None,
        now,
    );
    assert_eq!(
        (reply.status, error_message(&reply)),
        (404, "Remote Config template version not found".to_owned())
    );
    let plain = RemoteConfigSettings::default();
    let reply = at(
        &stores,
        &plain,
        &rollback,
        "POST",
        "",
        br#"{"versionNumber":"99"}"#,
        None,
        now,
    );
    assert_eq!(
        (reply.status, error_message(&reply)),
        (404, "Remote Config template version not found".to_owned())
    );
    let stale = at(
        &stores,
        &settings,
        CLIENT,
        "PUT",
        "",
        b"{}",
        Some("etag-123456789012-1"),
        now,
    );
    assert_eq!(stale.status, 412);
    // The unpublished server tag was not recorded and keeps the opaque store form.
    let server = stores.server.current().etag();
    assert!(server.starts_with("etag-fireemu-"), "{server}");
    // A store without a number keeps the opaque form throughout.
    let plain = RemoteConfigStores::default();
    let version = at(&plain, &settings, CLIENT, "PUT", "", b"{}", Some("*"), now);
    assert!(version.etag.unwrap().starts_with("etag-fireemu-"));
}

#[test]
fn history_tokens_are_the_next_version_number() {
    let stores = RemoteConfigStores::default();
    three_versions(&stores);
    let now = LogicalInstant::from_unix_seconds(T0 + 10);
    let settings = RemoteConfigSettings::default();
    let first = at(
        &stores,
        &settings,
        HISTORY,
        "GET",
        "pageSize=2",
        b"",
        None,
        now,
    );
    assert_eq!(listed(&first), ["3", "2"]);
    assert_eq!(body_of(&first)["nextPageToken"], "1");
    let next = at(
        &stores,
        &settings,
        HISTORY,
        "GET",
        "pageSize=2&pageToken=1",
        b"",
        None,
        now,
    );
    assert_eq!(listed(&next), ["1"]);
    assert!(body_of(&next).get("nextPageToken").is_none());
    let snake = at(
        &stores,
        &settings,
        HISTORY,
        "GET",
        "page_size=1&page_token=2",
        b"",
        None,
        now,
    );
    assert_eq!(listed(&snake), ["2"]);
    assert_eq!(body_of(&snake)["nextPageToken"], "1");
    for token in ["fireemu-invalid", "-1", "%2B1", "1.0"] {
        let refused = at(
            &stores,
            &settings,
            HISTORY,
            "GET",
            &format!("pageToken={token}"),
            b"",
            None,
            now,
        );
        assert_eq!(refused.status, 400, "{token}");
        assert_eq!(
            error_message(&refused),
            format!(
                "[VALIDATION_ERROR]: PageToken [{}] is not properly formatted.",
                token.replace("%2B", "+")
            )
        );
    }
    for token in ["0", "01", "99999999999999999999"] {
        let refused = at(
            &stores,
            &settings,
            HISTORY,
            "GET",
            &format!("pageToken={token}"),
            b"",
            None,
            now,
        );
        assert_eq!(
            error_message(&refused),
            "Invalid or expired page token",
            "{token}"
        );
    }
    let negative = at(
        &stores,
        &settings,
        HISTORY,
        "GET",
        "pageSize=-1",
        b"",
        None,
        now,
    );
    assert_eq!(
        error_message(&negative),
        "[VALIDATION_ERROR]: Page size must be non-negative, but was -1."
    );
}

#[test]
fn history_filters_follow_the_recorded_bounds() {
    let stores = RemoteConfigStores::default();
    let [t1, t2, _] = three_versions(&stores);
    let settings = RemoteConfigSettings::default();
    let now = LogicalInstant::from_unix_seconds(T0 + 10);
    let micro = |time: LogicalInstant, delta: i128| {
        micros_rfc3339(LogicalInstant::from_nanos(time.as_nanos() + delta * 1_000)).unwrap()
    };
    let list = |query: String| at(&stores, &settings, HISTORY, "GET", &query, b"", None, now);
    let start = micros_rfc3339(LogicalInstant::from_nanos(t2.as_nanos() / 1_000 * 1_000)).unwrap();
    for (query, expected) in [
        ("endVersionNumber=2".to_owned(), vec!["2", "1"]),
        ("end_version_number=2".to_owned(), vec!["2", "1"]),
        ("endVersionNumber=0".to_owned(), vec!["3", "2", "1"]),
        (
            "endVersionNumber=9223372036854775807".to_owned(),
            vec!["3", "2", "1"],
        ),
        // startTime is inclusive and endTime exclusive.
        (format!("startTime={start}"), vec!["3", "2"]),
        (format!("startTime={}", micro(t2, 1)), vec!["3"]),
        (format!("endTime={}", micro(t2, 1)), vec!["2", "1"]),
        (format!("endTime={start}"), vec!["1"]),
        (format!("end_time={}", micro(t2, -1)), vec!["1"]),
        (
            format!("startTime={}&endTime={}", micro(t1, 0), micro(t2, 1)),
            vec!["2", "1"],
        ),
    ] {
        let reply = list(query.clone());
        assert_eq!(reply.status, 200, "{query}");
        assert_eq!(listed(&reply), expected, "{query}");
    }
    // A window that holds no version answers an empty object.
    let empty = list(format!("endTime={}", micro(t1, -1_000_000)));
    assert_eq!(body_of(&empty), json!({}));
}

#[test]
fn history_filters_refuse_with_the_recorded_messages() {
    let stores = RemoteConfigStores::default();
    let [t1, t2, _] = three_versions(&stores);
    let settings = RemoteConfigSettings::default();
    let now = LogicalInstant::from_unix_seconds(T0 + 10);
    let list = |query: &str| at(&stores, &settings, HISTORY, "GET", query, b"", None, now);
    let negative = list("endVersionNumber=-1");
    assert_eq!(negative.status, 400);
    assert_eq!(
        error_message(&negative),
        "[VALIDATION_ERROR]: End version number must be at least 0 [-1 specified]."
    );
    let same = list(&format!(
        "startTime={0}&endTime={0}",
        micros_rfc3339(t2).unwrap()
    ));
    assert_eq!(
        error_message(&same),
        "[VALIDATION_ERROR]: start_time [2025-12-06T05:46:42.123456Z] must be before end_time [2025-12-06T05:46:42.123456Z]."
    );
    let reversed = list(&format!(
        "startTime={}&endTime={}",
        micros_rfc3339(t2).unwrap(),
        micros_rfc3339(t1).unwrap()
    ));
    assert_eq!(
        error_message(&reversed),
        "[VALIDATION_ERROR]: start_time [2025-12-06T05:46:42.123456Z] must be before end_time [2025-12-06T05:46:41.123456Z]."
    );
    // 91 days before the request (2026-11-21 history-time-exclude).
    let old = list("endTime=2000-01-01T00%3A00%3A00Z");
    assert_eq!(
        error_message(&old),
        "[VALIDATION_ERROR]: end_time must be no earlier than 2025-09-06T05:46:50Z [2000-01-01T00:00:00Z specified]."
    );
    let edge = LogicalInstant::from_nanos(now.as_nanos() - HISTORY_WINDOW_SECONDS * 1_000_000_000);
    assert_eq!(
        list(&format!("endTime={}", micros_rfc3339(edge).unwrap())).status,
        200
    );
    let invalid = list("startTime=invalid");
    let message = "Invalid value at 'start_time' (type.googleapis.com/google.protobuf.Timestamp), Field 'start_time', Illegal timestamp format; timestamps must end with 'Z' or have a valid timezone offset.";
    assert_eq!(
        body_of(&invalid),
        json!({"error": {"code": 400, "message": message, "status": "INVALID_ARGUMENT", "details": [
            {"@type": "type.googleapis.com/google.rpc.BadRequest", "fieldViolations": [{"field": "start_time", "description": message}]}
        ]}})
    );
    let end_invalid = list("endTime=2026");
    assert_eq!(
        body_of(&end_invalid)["error"]["details"][0]["fieldViolations"][0]["field"],
        "end_time"
    );
    // A zoned but malformed time was not recorded and keeps a plain refusal.
    let zoned = list("startTime=2026-13-01T00:00:00Z");
    assert_eq!(zoned.status, 400);
    assert!(body_of(&zoned)["error"].get("details").is_none());
}

#[test]
fn a_version_that_is_not_a_number_is_refused_as_the_transcoder_does() {
    let stores = RemoteConfigStores::default();
    let reply = at(
        &stores,
        &RemoteConfigSettings::default(),
        CLIENT,
        "GET",
        "versionNumber=invalid",
        b"",
        None,
        LogicalInstant::from_unix_seconds(T0),
    );
    let message = "Invalid value at 'version_number' (TYPE_INT64), \"invalid\"";
    assert_eq!(
        body_of(&reply),
        json!({"error": {"code": 400, "message": message, "status": "INVALID_ARGUMENT", "details": [
            {"@type": "type.googleapis.com/google.rpc.BadRequest", "fieldViolations": [{"field": "version_number", "description": message}]}
        ]}})
    );
    // An out-of-range number was refused in an unrecorded wording and keeps the earlier one.
    let overflow = at(
        &stores,
        &RemoteConfigSettings::default(),
        CLIENT,
        "GET",
        "versionNumber=9223372036854775808",
        b"",
        None,
        LogicalInstant::from_unix_seconds(T0),
    );
    assert_eq!(error_message(&overflow), "Invalid version number");
    let text = text_of(at(
        &stores,
        &RemoteConfigSettings::default(),
        CLIENT,
        "GET",
        "versionNumber=%3Cx%3E",
        b"",
        None,
        LogicalInstant::from_unix_seconds(T0),
    ));
    assert!(text.contains("\\\"\\u003cx\\u003e\\\""), "{text}");
}

#[test]
fn only_the_recorded_route_is_served_under_the_project_number() {
    let number = Some(NUMBER);
    let cases = [
        (
            "/v1/projects/123456789012/remoteConfig",
            "GET",
            "",
            number,
            true,
        ),
        (
            "/v1/projects/123456789012/remoteConfig",
            "GET",
            "versionNumber=1",
            number,
            false,
        ),
        (
            "/v1/projects/123456789012/remoteConfig",
            "GET",
            "x=1",
            number,
            false,
        ),
        (
            "/v1/projects/123456789012/remoteConfig",
            "PUT",
            "",
            number,
            false,
        ),
        (
            "/v1/projects/123456789012/remoteConfig",
            "GET",
            "",
            None,
            false,
        ),
        (
            "/v1/projects/123456789013/remoteConfig",
            "GET",
            "",
            number,
            false,
        ),
        (
            "/v1/projects/123456789012/namespaces/firebase/remoteConfig",
            "GET",
            "",
            number,
            false,
        ),
        (
            "/v1/projects/123456789012/namespaces/firebase-server/remoteConfig",
            "GET",
            "",
            number,
            false,
        ),
        (
            "/v1/projects/123456789012/remoteConfig:listVersions",
            "GET",
            "",
            number,
            false,
        ),
        (
            "/v1/projects/123456789012/remoteConfig:rollback",
            "POST",
            "",
            number,
            false,
        ),
        (
            "/v1/projects/demo-config/remoteConfig",
            "GET",
            "",
            number,
            false,
        ),
    ];
    for (path, method, query, number, expected) in cases {
        assert_eq!(
            number_addresses_project(&route(path).unwrap(), method, query, number),
            expected,
            "{path}?{query} {method}"
        );
    }
}

#[test]
fn defaults_downloads_follow_the_recorded_answers() {
    let stores = RemoteConfigStores::default();
    let settings = RemoteConfigSettings::default();
    let now = LogicalInstant::from_unix_seconds(T0);
    let download =
        |path: &str, query: &str| at(&stores, &settings, path, "GET", query, b"", None, now).wire();
    let defaults = "/v1/projects/demo-config/remoteConfig:downloadDefaults";
    // An empty template is an empty, uncompressed file of each format's type.
    for (format, content_type) in [
        ("JSON", "application/json"),
        ("XML", "application/xml"),
        ("PLIST", "application/x-plist"),
    ] {
        let wire = download(defaults, &format!("format={format}"));
        assert_eq!(
            (
                wire.status,
                wire.body.len(),
                wire.content_type,
                wire.compressible,
                wire.etag
            ),
            (200, 0, content_type, false, None),
            "{format}"
        );
    }
    for path in [
        "/v1/projects/demo-config/namespaces/firebase/remoteConfig:downloadDefaults",
        "/v1/projects/demo-config/namespaces/firebase-server/remoteConfig:downloadDefaults",
    ] {
        assert_eq!(download(path, "format=JSON").status, 200, "{path}");
    }
    let omitted = at(&stores, &settings, defaults, "GET", "", b"", None, now);
    assert_eq!(omitted.status, 400);
    assert_eq!(
        error_message(&omitted),
        "[VALIDATION_ERROR]: The message's format field is unspecified or unrecognized."
    );
    let invalid = at(
        &stores,
        &settings,
        defaults,
        "GET",
        "format=INVALID",
        b"",
        None,
        now,
    );
    let message = "Invalid value at 'format' (type.googleapis.com/google.firebase.remoteconfig.v1.DownloadDefaultsRequest.Format), \"INVALID\"";
    assert_eq!(body_of(&invalid)["error"]["message"], message);
    assert_eq!(
        body_of(&invalid)["error"]["details"][0]["fieldViolations"][0],
        json!({"field": "format", "description": message})
    );
    // JSON refusals are JSON answers that may be compressed.
    let wire = at(&stores, &settings, defaults, "GET", "", b"", None, now).wire();
    assert_eq!(
        (wire.content_type, wire.compressible),
        ("application/json; charset=UTF-8", true)
    );
    // A published template is served from its current version.
    let draft = br#"{"parameters": {"b": {"defaultValue": {"value": "2"}}, "a": {"defaultValue": {"useInAppDefault": true}}}}"#;
    assert_eq!(
        at(&stores, &settings, CLIENT, "PUT", "", draft, Some("*"), now).status,
        200
    );
    // Entries follow the template's own order (coordinator ruling 6; 2026-11-25 RC-CLOSURE-A:
    // production wrote `fireemu_source`, `fireemu_count`, ... as published, not sorted).
    let wire = download(defaults, "format=JSON");
    assert_eq!(
        std::str::from_utf8(&wire.body).unwrap(),
        "{\n  \"b\": \"2\",\n  \"a\": \"\"\n}"
    );
    assert_eq!(download(defaults, "format=JSON&format=XML").status, 400);
}

fn two_conditions(label: &str) -> Value {
    json!({
        "conditions": [
            {"name": "c_a", "expression": "app.customSignal['s'].exactlyMatches(['a'])"},
            {"name": "c_b", "expression": "percent('seed') <= 100"},
        ],
        "parameters": {"p": {"defaultValue": {"value": label}, "conditionalValues": {"c_a": {"value": "x"}, "c_b": {"value": "y"}}}},
    })
}

#[test]
fn the_loser_of_a_concurrent_write_is_detected_against_the_version_it_saw() {
    let store = TemplateStore::default().with_project_number(Some(NUMBER));
    let now = LogicalInstant::from_unix_seconds(T0);
    let seen = store.current();
    let tag = seen.etag();
    let ok = |_: &ClientTemplate| Ok(());
    assert!(matches!(
        store.write_seen(
            &seen,
            WriteMode::Publish,
            Some(&tag),
            two_conditions("a"),
            now,
            &ok,
            Vec::new(),
        ),
        Ok(WriteResult::Published(_))
    ));
    let lost = store.write_seen(
        &seen,
        WriteMode::Publish,
        Some(&tag),
        two_conditions("b"),
        now,
        &ok,
        Vec::new(),
    );
    assert_eq!(
        lost.err(),
        Some(Error::ConcurrentPrecondition {
            submitted: 2,
            current: 2
        })
    );
    // A tag that was already stale when the request arrived is the ordinary 412.
    let stale = store.write_seen(
        &store.current(),
        WriteMode::Publish,
        Some(&tag),
        two_conditions("c"),
        now,
        &ok,
        Vec::new(),
    );
    assert_eq!(stale.err(), Some(Error::PreconditionFailed));
    // A draft that fails validation keeps the 412 too.
    let invalid = store.write_seen(
        &seen,
        WriteMode::Publish,
        Some(&tag),
        json!({"parameters": {"bad key!": {}}}),
        now,
        &ok,
        Vec::new(),
    );
    assert_eq!(invalid.err(), Some(Error::PreconditionFailed));
}

#[test]
fn strict_answers_the_recorded_race_refusal_only_for_its_recorded_shape() {
    let strict = RemoteConfigSettings {
        strict_concurrent_publish: true,
        project_number: Some(NUMBER),
        ..RemoteConfigSettings::default()
    };
    let race = |submitted, current| Error::ConcurrentPrecondition { submitted, current };
    let reply = concurrent_refusal(&strict, Namespace::Client, race(2, 2));
    assert_eq!(reply.status, 400);
    assert_eq!(
        body_of(&reply),
        json!({"error": {"code": 400, "status": "INVALID_ARGUMENT", "message": "[VALIDATION_ERROR]: Condition order size [2] does not match condition count [4] for project [ProjectKey{projectNumber=123456789012, namespace=firebase}]"}})
    );
    let emulator = RemoteConfigSettings {
        strict_concurrent_publish: false,
        ..strict.clone()
    };
    let unnumbered = RemoteConfigSettings {
        project_number: None,
        ..strict.clone()
    };
    for (settings, namespace, error) in [
        (&emulator, Namespace::Client, race(2, 2)),
        (&unnumbered, Namespace::Client, race(2, 2)),
        (&strict, Namespace::Server, race(2, 2)),
        (&strict, Namespace::Client, race(0, 0)),
        (&strict, Namespace::Client, race(1, 2)),
        (&strict, Namespace::Client, Error::PreconditionFailed),
    ] {
        assert_eq!(concurrent_refusal(settings, namespace, error).status, 412);
    }
}

fn validate(draft: &Value) -> Reply {
    let stores = RemoteConfigStores::default();
    at(
        &stores,
        &RemoteConfigSettings::default(),
        CLIENT,
        "PUT",
        "validateOnly=true",
        &serde_json::to_vec(draft).unwrap(),
        Some("*"),
        LogicalInstant::from_unix_seconds(T0),
    )
}

fn value() -> Value {
    json!({"defaultValue": {"value": "synthetic"}})
}

#[test]
fn validation_refuses_with_the_recorded_messages() {
    let condition = |name: &str| json!({"name": name, "expression": "percent('s') <= 10"});
    let many =
        |count: usize| Value::Object((0..count).map(|i| (format!("p{i}"), value())).collect());
    let cases: Vec<(&str, Value, String)> = vec![
        ("parameter-key-257", json!({"parameters": {"k".repeat(257): value()}}), format!("KEY_TOO_LONG Parameter key {} is larger than the maximum key size 256", "k".repeat(257))),
        ("condition-name-257", json!({"conditions": [condition(&"c".repeat(257))]}), format!("INVALID_CONDITION_NAME Condition name '{}' exceeds the maximum length of 256 characters", "c".repeat(257))),
        ("group-name-257", json!({"parameterGroups": {"g".repeat(257): {"parameters": {"p": value()}}}}), format!("KEY_TOO_LONG Group name {} is larger than the maximum name size 256", "g".repeat(257))),
        ("parameter-count-3001", json!({"parameters": many(3001)}), "PARAM_COUNT_TOO_LARGE The template has 3001 parameters. The maximum number allowed is 3000.".into()),
        ("condition-count-2001", json!({"conditions": (0..2001).map(|i| condition(&format!("c{i}"))).collect::<Vec<_>>()}), "CONDITION_COUNT_TOO_LARGE The template has 2001 conditions. The maximum number allowed is 2000.".into()),
        ("parameter-key-leading-digit", json!({"parameters": {"1probe": value()}}), "INVALID_KEY Invalid parameter key: [1probe]".into()),
        ("parameter-key-unicode", json!({"parameters": {"試験": value()}}), "INVALID_KEY Invalid parameter key: [試験]".into()),
        ("condition-name-empty", json!({"conditions": [condition("")]}), "INVALID_CONDITION_NAME Invalid condition name: []".into()),
        ("duplicate-conditions", json!({"conditions": [condition("fireemu_match"), condition("fireemu_match")]}), "DUPLICATE_CONDITION_NAME Duplicate condition name: fireemu_match".into()),
        ("duplicate-parameter", json!({"parameters": {"fireemu_probe": value()}, "parameterGroups": {"fireemu group": {"parameters": {"fireemu_probe": value()}}}}), "DUPLICATE_KEY Duplicate parameter key: fireemu_probe".into()),
        ("version-description-1025", json!({"version": {"description": "d".repeat(1025)}}), "DESCRIPTION_EXCEEDS_MAXIMUM_SIZE Template version description is larger than the maximum size 1024.".into()),
        ("description-over-limit-utf8", json!({"version": {"description": "あ".repeat(1025)}}), "DESCRIPTION_EXCEEDS_MAXIMUM_SIZE Template version description is larger than the maximum size 1024.".into()),
        ("boolean-invalid", json!({"parameters": {"fireemu_probe": {"defaultValue": {"value": "maybe"}, "valueType": "BOOLEAN"}}}), "PARAM_VALUE_TYPE_MISMATCH Parameter [fireemu_probe] is of type BOOLEAN, which does not match value [maybe]".into()),
        ("number-invalid", json!({"parameters": {"fireemu_probe": {"defaultValue": {"value": "not-a-number"}, "valueType": "NUMBER"}}}), "PARAM_VALUE_TYPE_MISMATCH Parameter [fireemu_probe] is of type NUMBER, which does not match value [not-a-number]".into()),
        ("json-invalid", json!({"parameters": {"fireemu_probe": {"defaultValue": {"value": "{"}, "valueType": "JSON"}}}), "PARAM_VALUE_TYPE_MISMATCH Parameter [fireemu_probe] is of type JSON, which does not match value [{]".into()),
        ("missing-reference", json!({"parameters": {"fireemu_probe": {"defaultValue": {"value": "x"}, "conditionalValues": {"fireemu_absent": {"value": "x"}}}}}), "[fireemu_absent] are not valid condition names. All keys in all conditional value maps must be valid condition names.".into()),
    ];
    for (name, draft, message) in cases {
        let reply = validate(&draft);
        assert_eq!(reply.status, 400, "{name}");
        assert_eq!(
            body_of(&reply),
            json!({"error": {"code": 400, "message": format!("[VALIDATION_ERROR]: {message}"), "status": "INVALID_ARGUMENT"}}),
            "{name}"
        );
    }
    // At each limit the template is accepted.
    for draft in [
        json!({"parameters": {"k".repeat(256): value()}}),
        json!({"conditions": [condition(&"c".repeat(256))]}),
        json!({"parameterGroups": {"g".repeat(256): {"parameters": {"p": value()}}}}),
        json!({"parameters": many(3000)}),
        json!({"conditions": (0..2000).map(|i| condition(&format!("c{i}"))).collect::<Vec<_>>()}),
        json!({"version": {"description": "あ".repeat(1024)}}),
        json!({"parameters": {"_fireemu": value()}}),
    ] {
        assert_eq!(validate(&draft).status, 200);
    }
}

#[test]
fn the_transcoder_refusals_are_the_recorded_ones() {
    let detail = |message: &str, field: &str| {
        json!({"error": {"code": 400, "message": message, "status": "INVALID_ARGUMENT", "details": [
            {"@type": "type.googleapis.com/google.rpc.BadRequest", "fieldViolations": [{"field": field, "description": message}]}
        ]}})
    };
    for (draft, message, field) in [
        (json!({"fireemuUnknown": true}), "Invalid JSON payload received. Unknown name \"fireemuUnknown\" at 'remote_config': Cannot find field.", "remote_config"),
        (json!({"parameters": []}), "Invalid value at 'remote_config' (Map), Cannot bind a list to map for field 'parameters'.", "remote_config"),
        (json!({"parameterGroups": []}), "Invalid value at 'remote_config' (Map), Cannot bind a list to map for field 'parameterGroups'.", "remote_config"),
        (json!({"parameters": {"fireemu_probe": {"defaultValue": {"value": "x"}, "valueType": "OTHER"}}}), "Invalid value at 'remote_config.parameters[0].value.value_type' (type.googleapis.com/google.firebase.remoteconfig.v1.RemoteConfigParameter.ParameterValueType), \"OTHER\"", "remote_config.parameters[0].value.value_type"),
        (json!({"parameters": {"fireemu_probe": {"defaultValue": {"value": 1}, "valueType": "BOOLEAN"}}}), "Invalid value at 'remote_config.parameters[0].value.default_value.value' (TYPE_STRING), 1", "remote_config.parameters[0].value.default_value.value"),
        (json!({"parameters": {"a": value(), "b": {"defaultValue": {"value": true}}}}), "Invalid value at 'remote_config.parameters[1].value.default_value.value' (TYPE_STRING), true", "remote_config.parameters[1].value.default_value.value"),
    ] {
        let reply = validate(&draft);
        assert_eq!(reply.status, 400, "{draft}");
        assert_eq!(body_of(&reply), detail(message, field), "{draft}");
    }
    // The transcoder refuses before the precondition (2026-11-21 pair-14).
    let stores = RemoteConfigStores::default();
    let missing = at(
        &stores,
        &RemoteConfigSettings::default(),
        CLIENT,
        "PUT",
        "",
        br#"{"parameters": []}"#,
        None,
        LogicalInstant::from_unix_seconds(T0),
    );
    assert!(body_of(&missing)["error"]["details"].is_array());
}

#[test]
fn stale_client_tags_are_refused_with_the_recorded_bodies() {
    let stores = numbered();
    let settings = RemoteConfigSettings {
        project_number: Some(NUMBER),
        ..RemoteConfigSettings::default()
    };
    let now = LogicalInstant::from_unix_seconds(T0);
    for _ in 0..4 {
        assert_eq!(
            at(&stores, &settings, CLIENT, "PUT", "", b"{}", Some("*"), now).status,
            200
        );
    }
    let refused =
        |tag: &str, path: &str| at(&stores, &settings, path, "PUT", "", b"{}", Some(tag), now);
    let stale = refused("etag-123456789012-3", CLIENT);
    assert_eq!(stale.status, 412);
    assert_eq!(
        body_of(&stale),
        json!({"error": {"code": 400, "status": "FAILED_PRECONDITION", "message": "[VERSION_MISMATCH]: Expected version 3, found 4 for project: ProjectKey{projectNumber=123456789012, namespace=firebase}"}})
    );
    let malformed = refused("etag-fireemu-expired-validation", CLIENT);
    assert_eq!(malformed.status, 412);
    let text = text_of(malformed);
    assert!(text.contains(r#""message": "[VERSION_MISMATCH]: The provided ETag [etag-fireemu-expired-validation] is not of the format \"etag-\u003cproject number\u003e-\u003cversion number\u003e\".""#), "{text}");
    assert!(text.contains(r#""code": 400"#));
    // The server namespace, another project's tag and a store without a number keep the 412.
    let server = "/v1/projects/demo-config/namespaces/firebase-server/remoteConfig";
    assert_eq!(
        body_of(&refused("etag-123456789012-3", server))["error"]["code"],
        412
    );
    assert_eq!(body_of(&refused("etag-1-3", CLIENT))["error"]["code"], 412);
    let plain = RemoteConfigStores::default();
    let reply = at(
        &plain,
        &RemoteConfigSettings::default(),
        CLIENT,
        "PUT",
        "",
        b"{}",
        Some("stale"),
        now,
    );
    assert_eq!(
        (reply.status, body_of(&reply)["error"]["code"].clone()),
        (412, json!(412))
    );
}

#[test]
fn near_misses_of_the_recorded_history_and_refusal_rules() {
    let stores = RemoteConfigStores::default();
    let [_, t2, _] = three_versions(&stores);
    let settings = RemoteConfigSettings::default();
    let now = LogicalInstant::from_unix_seconds(T0 + 10);
    let list = |query: String| at(&stores, &settings, HISTORY, "GET", &query, b"", None, now);
    // An exact time: start inclusive, end exclusive.
    let exact = micros_rfc3339(t2).unwrap();
    assert_eq!(listed(&list(format!("startTime={exact}"))), ["3", "2"]);
    assert_eq!(listed(&list(format!("endTime={exact}"))), ["1"]);
    assert_eq!(listed(&list("endVersionNumber=1".into())), ["1"]);
    assert_eq!(listed(&list(format!("start_time={exact}"))), ["3", "2"]);
    // Only a value without any zone is the transcoder's zone refusal.
    for (raw, transcoder) in [
        ("2026-13-01T00:00:00%2B09:00", false),
        ("%2B09:00", false),
        ("-09:00", false),
        ("9:00", true),
        ("19:00", true),
        ("2026-01-01T12:34", true),
        ("2026-01-01T00:00:00%2B0900", true),
        ("2026-01-01T00:00:00%2B09-00", true),
    ] {
        let reply = list(format!("startTime={raw}"));
        assert_eq!(reply.status, 400, "{raw}");
        assert_eq!(
            body_of(&reply)["error"].get("details").is_some(),
            transcoder,
            "{raw}"
        );
    }
    // A version of digits and dashes that is no number keeps the earlier message.
    let dashed = at(
        &stores,
        &settings,
        CLIENT,
        "GET",
        "versionNumber=1-2",
        b"",
        None,
        now,
    );
    assert_eq!(error_message(&dashed), "Invalid version number");
}

#[test]
fn stale_tags_of_another_shape_and_one_condition_races() {
    let settings = RemoteConfigSettings {
        project_number: Some(NUMBER),
        strict_concurrent_publish: true,
        ..RemoteConfigSettings::default()
    };
    for tag in [
        "etag-12a-3",
        "etag-123456789012-",
        "etag--3",
        "etag-123456789012-3x",
    ] {
        let reply = stale_refusal(&settings, Namespace::Client, tag, 4).unwrap();
        assert!(
            body_of(&reply)["error"]["message"]
                .as_str()
                .unwrap()
                .contains("is not of the format"),
            "{tag}"
        );
    }
    let one = concurrent_refusal(
        &settings,
        Namespace::Client,
        Error::ConcurrentPrecondition {
            submitted: 1,
            current: 1,
        },
    );
    assert_eq!(
        error_message(&one),
        "[VALIDATION_ERROR]: Condition order size [1] does not match condition count [2] for project [ProjectKey{projectNumber=123456789012, namespace=firebase}]"
    );
}

#[test]
fn strict_refuses_the_recorded_client_conditions_after_the_precondition_and_emulator_accepts() {
    let strict = RemoteConfigSettings {
        strict_client_conditions: true,
        time_zone_known: Some(|zone| zone == "Asia/Tokyo"),
        ..RemoteConfigSettings::default()
    };
    let draft = |expression: &str| {
        serde_json::to_vec(
            &json!({"conditions": [{"name": "fireemu_match", "expression": expression}]}),
        )
        .unwrap()
    };
    let now = LogicalInstant::from_unix_seconds(T0);
    for (settings, refused) in [(&strict, true), (&RemoteConfigSettings::default(), false)] {
        let stores = RemoteConfigStores::default();
        for query in ["validateOnly=true", ""] {
            let reply = at(
                &stores,
                settings,
                CLIENT,
                "PUT",
                query,
                &draft("percent <= -1"),
                Some("*"),
                now,
            );
            if refused {
                assert_eq!(reply.status, 400);
                assert_eq!(
                    error_message(&reply),
                    "[VALIDATION_ERROR]: at line 1, column 12. Percent value cannot be negative"
                );
            } else {
                assert_eq!(reply.status, 200);
            }
        }
        // The precondition is checked first.
        let stale = at(
            &stores,
            settings,
            CLIENT,
            "PUT",
            "",
            &draft("percent <= -1"),
            Some("stale"),
            now,
        );
        assert_eq!(stale.status, 412);
        assert_eq!(stores.client.current().number(), u64::from(!refused));
    }
    // The server namespace keeps its own recorded rules.
    let stores = RemoteConfigStores::default();
    let server = "/v1/projects/demo-config/namespaces/firebase-server/remoteConfig";
    assert_eq!(
        at(
            &stores,
            &strict,
            server,
            "PUT",
            "",
            &draft("percent <= -1"),
            Some("*"),
            now
        )
        .status,
        200
    );
}

#[test]
fn unrecorded_client_expressions_keep_their_acceptance_in_both_profiles() {
    let strict = RemoteConfigSettings {
        strict_client_conditions: true,
        ..RemoteConfigSettings::default()
    };
    let now = LogicalInstant::from_unix_seconds(T0);
    // Coordinator ruling 5 item 2: the review's three inputs.
    for expression in ["percent != -1", "percent <= -1e-6", "(percent <= -1)"] {
        for settings in [&strict, &RemoteConfigSettings::default()] {
            let stores = RemoteConfigStores::default();
            let draft = serde_json::to_vec(
                &json!({"conditions": [{"name": "c", "expression": expression}]}),
            )
            .unwrap();
            let reply = at(
                &stores,
                settings,
                CLIENT,
                "PUT",
                "validateOnly=true",
                &draft,
                Some("*"),
                now,
            );
            assert_eq!(reply.status, 200, "{expression}");
        }
    }
}

#[test]
fn defaults_follow_the_written_order_through_groups_and_rollbacks() {
    let stores = RemoteConfigStores::default();
    let settings = RemoteConfigSettings::default();
    let now = LogicalInstant::from_unix_seconds(T0);
    let defaults = "/v1/projects/demo-config/remoteConfig:downloadDefaults";
    let download =
        |query: &str| at(&stores, &settings, defaults, "GET", query, b"", None, now).wire();
    // Top-level parameters in their order, then each group in its order with its parameters in
    // theirs; a rollback keeps the order of the version it restores.
    let draft = br#"{"parameters": {"z": {"defaultValue": {"value": "1"}}, "m": {"defaultValue": {"value": "2"}}},
        "parameterGroups": {"y": {"parameters": {"q": {"defaultValue": {"value": "3"}}, "c": {"defaultValue": {"value": "4"}}}},
                            "b": {"parameters": {"k": {"defaultValue": {"value": "5"}}}}}}"#;
    let published = at(&stores, &settings, CLIENT, "PUT", "", draft, Some("*"), now);
    assert_eq!(published.status, 200);
    let keys = |wire: &Wire| {
        let text = std::str::from_utf8(&wire.body).unwrap().to_owned();
        text.lines()
            .filter_map(|line| {
                line.trim()
                    .strip_prefix("<key>")
                    .map(|k| k.trim_end_matches("</key>").to_owned())
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(keys(&download("format=XML")), ["z", "m", "q", "c", "k"]);
    assert_eq!(keys(&download("format=PLIST")), ["z", "m", "q", "c", "k"]);
    // A file with entries is compressed when the request accepts gzip (2026-11-25 RC-CLOSURE-A
    // passes: `content-encoding: gzip` on every non-empty defaults file); an empty one is not.
    for format in ["format=JSON", "format=XML", "format=PLIST"] {
        assert!(download(format).compressible, "{format}");
    }
    let version = body_of(&published)["version"]["versionNumber"]
        .as_str()
        .unwrap()
        .to_owned();
    let other = br#"{"parameters": {"a": {"defaultValue": {"value": "1"}}}}"#;
    assert_eq!(
        at(&stores, &settings, CLIENT, "PUT", "", other, Some("*"), now).status,
        200
    );
    let back = serde_json::to_vec(&json!({"versionNumber": version})).unwrap();
    let rollback = format!("{CLIENT}:rollback");
    assert_eq!(
        at(&stores, &settings, &rollback, "POST", "", &back, None, now).status,
        200
    );
    assert_eq!(keys(&download("format=XML")), ["z", "m", "q", "c", "k"]);
}

#[test]
fn a_client_expression_in_one_pair_of_parentheses_is_answered_without_it() {
    let now = LogicalInstant::from_unix_seconds(T0);
    for settings in [
        RemoteConfigSettings::default(),
        RemoteConfigSettings {
            strict_client_conditions: true,
            ..RemoteConfigSettings::default()
        },
    ] {
        let stores = RemoteConfigStores::default();
        let draft = |expression: &str| {
            serde_json::to_vec(&json!({"conditions": [{"name": "c", "expression": expression}]}))
                .unwrap()
        };
        for (written, answered) in [
            (
                "(percent > 0 && percent <= 100)",
                "percent > 0 && percent <= 100",
            ),
            ("((percent > 0))", "(percent > 0)"),
            (
                "(percent > 0) && (percent <= 100)",
                "(percent > 0) && (percent <= 100)",
            ),
            (
                "device.os == ')' && (percent > 0)",
                "device.os == ')' && (percent > 0)",
            ),
            ("(device.os == ')')", "device.os == ')'"),
            ("(device.os == '(')", "device.os == '('"),
            ("percent > 0", "percent > 0"),
            // An open quote or an unclosed parenthesis inside: the outer pair is not one pair.
            ("(device.os == ')", "(device.os == ')"),
            ("((percent > 0)", "((percent > 0)"),
            ("(percent > 0))", "(percent > 0))"),
        ] {
            let reply = at(
                &stores,
                &settings,
                CLIENT,
                "PUT",
                "validateOnly=true",
                &draft(written),
                Some("*"),
                now,
            );
            assert_eq!(reply.status, 200, "{written}");
            assert_eq!(
                body_of(&reply)["conditions"][0]["expression"],
                answered,
                "{written}"
            );
        }
        // The strict check sees the expression as written: outer parentheses keep acceptance
        // (coordinator ruling 5), and the published template keeps the answered form.
        let reply = at(
            &stores,
            &settings,
            CLIENT,
            "PUT",
            "",
            &draft("(percent <= -1)"),
            Some("*"),
            now,
        );
        assert_eq!(reply.status, 200);
        assert_eq!(
            body_of(&reply)["conditions"][0]["expression"],
            "percent <= -1"
        );
        // The server namespace keeps its expressions.
        let server = "/v1/projects/demo-config/namespaces/firebase-server/remoteConfig";
        let reply = at(
            &stores,
            &settings,
            server,
            "PUT",
            "validateOnly=true",
            &draft("(percent > 0)"),
            Some("*"),
            now,
        );
        assert_eq!(
            body_of(&reply)["conditions"][0]["expression"],
            "(percent > 0)"
        );
    }
}
