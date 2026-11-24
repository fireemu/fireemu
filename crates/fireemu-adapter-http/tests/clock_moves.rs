//! Control API tests for calendar and legacy moves of the virtual clock.

use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering::SeqCst};
use std::sync::{Arc, Mutex, RwLock};

use fireemu_adapter_http::control::{
    handle, handle_async, CalendarZones, ControlState, FunctionsHook, PublishMessagesError,
    RunScheduleError, SharedCalendarZone,
};
use fireemu_adapter_http::identity_toolkit::{JsonResponse, RequestHeaders};
use fireemu_core_rules::runtime::RulesetSlot;
use fireemu_core_session::calendar::{CalendarZone, FixedZone, LocalOffsets};
use fireemu_core_session::clock::VirtualClock;
use fireemu_core_types::edition::FirestoreEdition;
use fireemu_core_types::time::LogicalInstant;
use serde_json::{json, Value};

/// 2026-01-31T10:00:00Z.
const START: i64 = 1_769_853_600;

fn state_at(clock: VirtualClock, zones: Option<CalendarZones>) -> ControlState {
    ControlState {
        clock: Arc::new(Mutex::new(clock)),
        require_demo_prefix: true,
        edition: FirestoreEdition::Standard,
        capabilities: json!({"schemaVersion": 1}).into(),
        rules: Arc::new(RulesetSlot::default()),
        storage_rules: Arc::new(fireemu_adapter_http::storage::StorageRulesRegistry::default()),
        reset_hooks: Vec::new(),
        functions: None,
        control_token: "test-token".to_owned(),
        app_check: None,
        firestore_listen_expiry: None,
        firestore_missing_indexes: None,
        require_control_token: false,
        remote_config: fireemu_adapter_http::remote_config::RemoteConfigSettings::default(),
        barrier: None,
        snapshot_hooks: Vec::new(),
        snapshots: Mutex::new(std::collections::BTreeMap::new()),
        faults: None,
        text_indexes: Arc::new(Mutex::new(
            fireemu_core_firestore::text_index::TextIndexCatalog::default(),
        )),
        default_project: "demo-app".to_owned(),
        tenancy: Arc::new(RwLock::new(fireemu_core_session::tenancy::Tenancy::new(
            "demo-app",
        ))),
        sessions: Mutex::new(std::collections::BTreeMap::from([(
            "default".to_owned(),
            "demo-app".to_owned(),
        )])),
        project_hooks: None,
        resource_hooks: Vec::new(),
        calendar_zones: zones,
    }
}

fn state(zones: Option<CalendarZones>) -> ControlState {
    state_at(
        VirtualClock::new(LogicalInstant::from_unix_seconds(START)),
        zones,
    )
}

/// New York's 2026 spring-forward gap only (2026-03-08T07:00Z, -05:00 to -04:00).
struct SpringForward;

impl CalendarZone for SpringForward {
    fn offset_at(&self, utc_seconds: i64) -> i64 {
        if utc_seconds < 1_772_953_200 {
            -18_000
        } else {
            -14_400
        }
    }

    fn local_offsets(&self, local_seconds: i64) -> LocalOffsets {
        match (
            local_seconds + 18_000 < 1_772_953_200,
            local_seconds + 14_400 >= 1_772_953_200,
        ) {
            (true, true) => LocalOffsets::Fold(-18_000, -14_400),
            (true, false) => LocalOffsets::Unique(-18_000),
            (false, true) => LocalOffsets::Unique(-14_400),
            (false, false) => LocalOffsets::Gap {
                before: -18_000,
                after: -14_400,
            },
        }
    }
}

/// `Test/Tokyo` (+09:00), `Test/NewYork` (the spring gap above) and `UTC`.
fn zones(default: Option<&str>) -> CalendarZones {
    CalendarZones {
        default_time_zone: default.map(str::to_owned),
        resolve: Arc::new(|name: &str| -> Result<SharedCalendarZone, String> {
            match name {
                "UTC" => Ok(Arc::new(FixedZone(0))),
                "Test/Tokyo" => Ok(Arc::new(FixedZone(32_400))),
                "Test/NewYork" => Ok(Arc::new(SpringForward)),
                other => Err(format!("unknown time zone {other:?}")),
            }
        }),
    }
}

fn post(s: &ControlState, action: &str, body: &Value) -> JsonResponse {
    handle(s, "POST", &format!("/v1/sessions/default/{action}"), body)
}

fn clock_of(response: &JsonResponse) -> String {
    assert_eq!(response.status, 200, "{}", response.body);
    response.body["clock"].as_str().unwrap().to_owned()
}

fn refused(response: &JsonResponse, needle: &str) {
    assert_eq!(response.status, 400, "{}", response.body);
    let text = response.body.to_string();
    assert!(text.contains("INVALID_ARGUMENT"), "{text}");
    assert!(text.contains(needle), "{needle:?} not in {text}");
}

fn now(s: &ControlState) -> String {
    let session = handle(s, "GET", "/v1/sessions/default", &json!({}));
    session.body["clock"]["clock"].as_str().unwrap().to_owned()
}

#[test]
fn a_duration_moves_by_calendar_and_clock_units() {
    let s = state(None);
    assert_eq!(
        clock_of(&post(&s, "clock:advance", &json!({"duration": "P1M"}))),
        "2026-02-28T10:00:00Z"
    );
    assert_eq!(
        clock_of(&post(&s, "clock:advance", &json!({"duration": "PT36H"}))),
        "2026-03-01T22:00:00Z"
    );
    assert_eq!(
        clock_of(&post(&s, "clock:advance", &json!({"duration": "P1W2D"}))),
        "2026-03-10T22:00:00Z"
    );
}

#[test]
fn a_negative_duration_needs_allow_backwards() {
    let s = state(None);
    refused(
        &post(&s, "clock:advance", &json!({"duration": "-P3D"})),
        "clock would move backwards from 2026-01-31T10:00:00Z to 2026-01-28T10:00:00Z",
    );
    // Only a JSON boolean opts in.
    refused(
        &post(
            &s,
            "clock:advance",
            &json!({"duration": "-P3D", "allowBackwards": "true"}),
        ),
        "backwards",
    );
    assert_eq!(now(&s), "2026-01-31T10:00:00Z");
    let back = post(
        &s,
        "clock:advance",
        &json!({"duration": "-P3D", "allowBackwards": true}),
    );
    assert_eq!(clock_of(&back), "2026-01-28T10:00:00Z");
    assert_eq!(back.body["backwardsSets"], 1);
    // A zero duration is not backwards.
    assert_eq!(
        clock_of(&post(&s, "clock:advance", &json!({"duration": "-PT0S"}))),
        "2026-01-28T10:00:00Z"
    );
}

#[test]
fn anchors_move_through_set_and_advance_to() {
    let s = state(None);
    assert_eq!(
        clock_of(&post(&s, "clock:advanceTo", &json!({"to": "endOfMonth"}))),
        "2026-01-31T23:59:59.999999000Z"
    );
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:advanceTo",
            &json!({"to": "startOfNextMonth"})
        )),
        "2026-02-01T00:00:00Z"
    );
    // One month later, then the start of that month.
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:set",
            &json!({"duration": "P1M", "to": "startOfMonth"})
        )),
        "2026-03-01T00:00:00Z"
    );
    // Backwards anchors: clock:set only with allowBackwards, clock:advanceTo never.
    refused(
        &post(&s, "clock:set", &json!({"to": "startOfYear"})),
        "backwards",
    );
    refused(
        &post(
            &s,
            "clock:advanceTo",
            &json!({"to": "startOfYear", "allowBackwards": true}),
        ),
        "backwards",
    );
    let rewound = post(
        &s,
        "clock:set",
        &json!({"to": "startOfYear", "allowBackwards": true}),
    );
    assert_eq!(clock_of(&rewound), "2026-01-01T00:00:00Z");
    assert_eq!(rewound.body["backwardsSets"], 1);
    assert_eq!(
        clock_of(&post(&s, "clock:set", &json!({"to": "endOfYear"}))),
        "2026-12-31T23:59:59.999999000Z"
    );
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:set",
            &json!({"to": "startOfDay", "allowBackwards": true})
        )),
        "2026-12-31T00:00:00Z"
    );
    assert_eq!(
        clock_of(&post(&s, "clock:set", &json!({"to": "endOfDay"}))),
        "2026-12-31T23:59:59.999999000Z"
    );
}

#[test]
fn the_zone_is_the_request_then_the_configured_default_then_utc() {
    // UTC: Jan 31 10:00 is the 31st.
    let utc = state(Some(zones(None)));
    assert_eq!(
        clock_of(&post(
            &utc,
            "clock:advanceTo",
            &json!({"to": "startOfNextMonth"})
        )),
        "2026-02-01T00:00:00Z"
    );
    // The configured default: Tokyo's month starts at 15:00Z the day before.
    let tokyo = state(Some(zones(Some("Test/Tokyo"))));
    assert_eq!(
        clock_of(&post(
            &tokyo,
            "clock:advanceTo",
            &json!({"to": "startOfNextMonth"})
        )),
        "2026-01-31T15:00:00Z"
    );
    // The request wins over the default.
    let tokyo = state(Some(zones(Some("Test/Tokyo"))));
    assert_eq!(
        clock_of(&post(
            &tokyo,
            "clock:advanceTo",
            &json!({"to": "startOfNextMonth", "timeZone": "UTC"})
        )),
        "2026-02-01T00:00:00Z"
    );
    // Without a zone database only UTC is known.
    let bare = state(None);
    assert_eq!(
        clock_of(&post(
            &bare,
            "clock:advance",
            &json!({"duration": "P1D", "timeZone": "UTC"})
        )),
        "2026-02-01T10:00:00Z"
    );
    refused(
        &post(
            &bare,
            "clock:advance",
            &json!({"duration": "P1D", "timeZone": "Test/Tokyo"}),
        ),
        "unknown time zone \\\"Test/Tokyo\\\"",
    );
}

#[test]
fn zone_names_are_validated() {
    let s = state(Some(zones(None)));
    refused(
        &post(
            &s,
            "clock:advance",
            &json!({"duration": "P1D", "timeZone": "Mars/Olympus"}),
        ),
        "unknown time zone",
    );
    refused(
        &post(
            &s,
            "clock:advance",
            &json!({"duration": "P1D", "timeZone": 9}),
        ),
        "timeZone must be",
    );
    refused(
        &post(
            &s,
            "clock:advance",
            &json!({"duration": "P1D", "timeZone": "A".repeat(200)}),
        ),
        "timeZone must be",
    );
    assert_eq!(now(&s), "2026-01-31T10:00:00Z");
}

#[test]
fn a_day_into_a_gap_lands_after_it() {
    let s = state_at(
        // 2026-03-07T07:30:00Z, 02:30 EST.
        VirtualClock::new(LogicalInstant::from_unix_seconds(1_772_868_600)),
        Some(zones(Some("Test/NewYork"))),
    );
    // 2026-03-08 02:30 does not exist: 03:30 EDT, 07:30Z.
    assert_eq!(
        clock_of(&post(&s, "clock:advance", &json!({"duration": "P1D"}))),
        "2026-03-08T07:30:00Z"
    );
}

#[test]
fn malformed_new_fields_are_refused_and_change_nothing() {
    let s = state(None);
    for (action, body, needle) in [
        ("clock:advance", json!({"duration": "P1X"}), "ISO 8601 duration"),
        ("clock:advance", json!({"duration": "p1d"}), "ISO 8601 duration"),
        ("clock:advance", json!({"duration": 1}), "duration must be a string"),
        ("clock:advance", json!({"duration": null}), "seconds or millis required"),
        ("clock:advance", json!({"to": "startOfDay"}), "to is accepted by clock:set and clock:advanceTo"),
        ("clock:advance", json!({"duration": "P1D", "to": "startOfDay"}), "to is accepted by clock:set and clock:advanceTo"),
        ("clock:advance", json!({"timeZone": "UTC"}), "duration required"),
        ("clock:set", json!({"to": "startOfWeek"}), "to must be one of startOfDay, endOfDay, startOfMonth, endOfMonth, startOfNextMonth, startOfYear, endOfYear"),
        ("clock:set", json!({"to": 1}), "to must be one of"),
        ("clock:advanceTo", json!({"to": "StartOfMonth"}), "to must be one of"),
        ("clock:set", json!({"duration": "P1D"}), "duration on clock:set and clock:advanceTo needs to"),
        ("clock:advanceTo", json!({"duration": "P1D"}), "needs to"),
        ("clock:set", json!({"to": "endOfMonth", "duration": "P1"}), "ISO 8601 duration"),
        ("clock:advance", json!({"duration": "P9999Y"}), "outside years 0001 through 9999"),
        ("clock:advance", json!({"duration": "-P9999Y", "allowBackwards": true}), "outside years 0001 through 9999"),
        ("clock:advance", json!({"duration": "PT18446744073709551615H"}), "INVALID_ARGUMENT"),
    ] {
        refused(&post(&s, action, &body), needle);
    }
    assert_eq!(now(&s), "2026-01-31T10:00:00Z");
}

#[test]
fn old_and_new_fields_cannot_be_mixed() {
    let s = state(None);
    refused(
        &post(
            &s,
            "clock:advance",
            &json!({"seconds": 1, "duration": "P1D"}),
        ),
        "seconds cannot be combined with duration",
    );
    refused(
        &post(
            &s,
            "clock:advance",
            &json!({"millis": 1, "duration": "P1D"}),
        ),
        "millis cannot be combined with duration",
    );
    refused(
        &post(
            &s,
            "clock:advance",
            &json!({"seconds": 1, "millis": 1, "duration": "P1D"}),
        ),
        "seconds and millis cannot be combined with duration",
    );
    refused(
        &post(
            &s,
            "clock:set",
            &json!({"instant": "2027-01-01T00:00:00Z", "to": "startOfMonth"}),
        ),
        "instant cannot be combined with to",
    );
    refused(
        &post(
            &s,
            "clock:advanceTo",
            &json!({"instant": "2027-01-01T00:00:00Z", "duration": "P1D"}),
        ),
        "instant cannot be combined with duration",
    );
    refused(
        &post(
            &s,
            "clock:set",
            &json!({"instant": "2027-01-01T00:00:00Z", "to": "startOfMonth", "duration": "P1D"}),
        ),
        "instant cannot be combined with to and duration",
    );
    for (action, body, message) in [
        (
            "clock:advance",
            json!({"seconds": 1, "timeZone": "UTC"}),
            "seconds cannot be combined with timeZone",
        ),
        (
            "clock:advance",
            json!({"duration": "P1D", "instant": "2027-01-01T00:00:00Z"}),
            "instant cannot be combined with duration",
        ),
        (
            "clock:set",
            json!({"millis": 0, "instant": null, "to": "endOfMonth", "timeZone": "UTC"}),
            "millis and instant cannot be combined with to and timeZone",
        ),
        (
            "clock:advanceTo",
            json!({"seconds": 0, "duration": null, "timeZone": "UTC"}),
            "seconds cannot be combined with timeZone",
        ),
    ] {
        let response = post(&s, action, &body);
        assert_eq!(response.status, 400, "{}", response.body);
        assert_eq!(
            response.body["error"]["message"],
            format!("INVALID_ARGUMENT : {message}")
        );
    }
    assert_eq!(now(&s), "2026-01-31T10:00:00Z");
}

/// Requests without a non-null calendar field keep their exact legacy answers.
#[test]
fn requests_accepted_before_keep_their_answers() {
    let s = state(None);
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:advance",
            &json!({"seconds": 60, "duration": null})
        )),
        "2026-01-31T10:01:00Z"
    );
    // seconds wins over millis, as before.
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:advance",
            &json!({"seconds": 60, "millis": 1})
        )),
        "2026-01-31T10:02:00Z"
    );
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:advance",
            &json!({"millis": 500, "to": null})
        )),
        "2026-01-31T10:02:00.500000000Z"
    );
    refused(
        &post(&s, "clock:advance", &json!({"seconds": -1})),
        "clock cannot advance by a negative duration",
    );
    refused(
        &post(&s, "clock:advance", &json!({})),
        "seconds or millis required",
    );
    refused(&post(&s, "clock:set", &json!({})), "instant required");
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:set",
            &json!({"instant": "2026-02-01T00:00:00Z", "timeZone": null, "duration": null, "to": null})
        )),
        "2026-02-01T00:00:00Z"
    );
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:advanceTo",
            &json!({"instant": "2026-02-02T00:00:00Z", "allowBackwards": "x", "duration": null, "to": null, "timeZone": null})
        )),
        "2026-02-02T00:00:00Z"
    );
}

#[test]
fn only_calendar_null_fields_are_absent_with_a_calendar_move() {
    let s = state(Some(zones(Some("Test/Tokyo"))));
    for (route, body, message) in [
        (
            "clock:advance",
            json!({"seconds": null, "duration": "PT1H", "to": null}),
            "seconds cannot be combined with duration",
        ),
        (
            "clock:set",
            json!({"instant": null, "to": "startOfNextMonth", "duration": null}),
            "instant cannot be combined with to",
        ),
        (
            "clock:advanceTo",
            json!({"millis": null, "to": "endOfDay", "timeZone": null}),
            "millis cannot be combined with to",
        ),
    ] {
        refused(&post(&s, route, &body), message);
    }
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:advance",
            &json!({"duration": "PT1H", "to": null})
        )),
        "2026-01-31T11:00:00Z"
    );
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:set",
            &json!({"to": "startOfNextMonth", "duration": null})
        )),
        "2026-01-31T15:00:00Z"
    );
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:advanceTo",
            &json!({"to": "endOfDay", "timeZone": null})
        )),
        "2026-02-01T14:59:59.999999000Z"
    );
}

struct ClockCounting {
    limit: LogicalInstant,
    moves: AtomicUsize,
    syncs: AtomicUsize,
}

impl FunctionsHook for ClockCounting {
    fn validate_clock_target(&self, instant: LogicalInstant) -> Result<(), String> {
        if instant > self.limit {
            return Err("INVALID_ARGUMENT : Functions clock limit exceeded".to_owned());
        }
        Ok(())
    }

    fn sync_clock(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + '_>> {
        self.syncs.fetch_add(1, SeqCst);
        Box::pin(async { Ok(()) })
    }

    fn on_clock_changed(&self) {
        self.moves.fetch_add(1, SeqCst);
    }

    fn run_schedule(&self, _function: &str) -> Result<(), RunScheduleError> {
        Ok(())
    }

    fn is_idle(&self) -> bool {
        true
    }

    fn idle_notify(&self) -> Arc<tokio::sync::Notify> {
        Arc::new(tokio::sync::Notify::new())
    }

    fn status(&self) -> Value {
        json!({})
    }

    fn publish(
        &self,
        _topic: &str,
        _messages: &[Value],
    ) -> Result<Vec<String>, PublishMessagesError> {
        Err(PublishMessagesError::Invalid("not used".to_owned()))
    }

    fn project(&self) -> String {
        "demo-app".to_owned()
    }
}

#[test]
fn calendar_moves_validate_the_functions_limit_and_notify_only_on_success() {
    let functions = Arc::new(ClockCounting {
        limit: LogicalInstant::from_unix_seconds(START + 86_400),
        moves: AtomicUsize::new(0),
        syncs: AtomicUsize::new(0),
    });
    let mut s = state(None);
    s.functions = Some(functions.clone());
    let before = s.clock.lock().unwrap().snapshot();
    let response = post(&s, "clock:advance", &json!({"duration": "P2D"}));
    assert_eq!(response.status, 400, "{}", response.body);
    assert_eq!(
        response.body["error"]["message"],
        "INVALID_ARGUMENT : Functions clock limit exceeded"
    );
    assert_eq!(s.clock.lock().unwrap().snapshot(), before);
    assert_eq!(functions.moves.load(SeqCst), 0);

    let response = post(&s, "clock:advance", &json!({"duration": "P1D"}));
    assert_eq!(clock_of(&response), "2026-02-01T10:00:00Z");
    assert_eq!(functions.moves.load(SeqCst), 1);
}

#[test]
fn a_zero_duration_on_a_running_clock_is_not_backwards() {
    let s = state_at(
        VirtualClock::following(LogicalInstant::from_unix_seconds(START)),
        None,
    );
    for duration in ["P0D", "PT0S", "-P0D"] {
        let response = post(&s, "clock:advance", &json!({"duration": duration}));
        assert_eq!(response.status, 200, "{duration}: {}", response.body);
        assert_eq!(response.body["backwardsSets"], 0);
    }
    let response = post(&s, "clock:advance", &json!({"duration": "P1D"}));
    let moved = LogicalInstant::parse_rfc3339(&clock_of(&response)).unwrap();
    assert!(moved >= LogicalInstant::from_unix_seconds(START + 86_400));
}

/// A running clock whose first reading is at `start`, then advances by `step_nanos` per read.
fn ticking_clock(start: LogicalInstant, step_nanos: i128) -> VirtualClock {
    let ticks = AtomicI64::new(0);
    VirtualClock::following_with(
        start,
        Arc::new(move || i128::from(ticks.fetch_add(1, SeqCst)) * step_nanos),
        0,
    )
}

/// A running clock whose source moves 1 ms at each of the next `ticks` readings, then stands.
fn clock_ticking_for(ticks: &Arc<AtomicI64>) -> VirtualClock {
    let reading = AtomicI64::new(0);
    let ticks = ticks.clone();
    VirtualClock::following_with(
        LogicalInstant::from_unix_seconds(START),
        Arc::new(move || {
            let tick = ticks.fetch_sub(1, SeqCst) > 0;
            let now = if tick {
                reading.fetch_add(1, SeqCst) + 1
            } else {
                ticks.store(0, SeqCst);
                reading.load(SeqCst)
            };
            i128::from(now) * 1_000_000
        }),
        0,
    )
}

/// The response reports the published boundary even when the clock has already run past it.
#[test]
fn an_anchor_on_a_running_clock_lands_exactly_on_the_boundary() {
    let ticks = Arc::new(AtomicI64::new(0));
    let s = state_at(clock_ticking_for(&ticks), None);
    ticks.store(2, SeqCst);
    assert_eq!(
        clock_of(&post(&s, "clock:advanceTo", &json!({"to": "endOfYear"}))),
        "2026-12-31T23:59:59.999999000Z"
    );
    // The clock ran into 2027-01-01, so a day later starts 2027-01-02.
    ticks.store(2, SeqCst);
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:set",
            &json!({"duration": "P1D", "to": "startOfDay"})
        )),
        "2027-01-02T00:00:00Z"
    );
}

#[test]
fn a_duration_on_a_running_clock_is_measured_from_the_commit_sample() {
    let start = LogicalInstant::from_unix_seconds(START);
    let s = state_at(ticking_clock(start, 1_000_000), None);
    assert_eq!(s.clock.lock().unwrap().snapshot().instant, start);
    let response = post(&s, "clock:advance", &json!({"duration": "P1D"}));
    assert_eq!(clock_of(&response), "2026-02-01T10:00:00.001000000Z");
}

#[test]
fn a_running_duration_checks_the_year_at_the_commit_sample() {
    let start = LogicalInstant::parse_rfc3339("9999-12-31T23:59:58.9995Z").unwrap();
    let body = json!({"duration": "PT1S"});
    // At the first reading the move fits. A second reading would push it into year 10000.
    let s = state_at(ticking_clock(start, 1_000_000), None);
    assert_eq!(
        clock_of(&post(&s, "clock:advance", &body)),
        "9999-12-31T23:59:59.999500000Z"
    );

    // When the commit sample itself is 1 ms later, the move is refused.
    let s = state_at(ticking_clock(start, 1_000_000), None);
    let before = s.clock.lock().unwrap().snapshot();
    refused(
        &post(&s, "clock:advance", &body),
        "outside years 0001 through 9999",
    );
    let after = s.clock.lock().unwrap().snapshot();
    assert_eq!(after.revision, before.revision);
    assert_eq!(after.instant.as_nanos(), start.as_nanos() + 2_000_000);
    assert_eq!(after.elapsed_nanos, 2_000_000);
    assert_eq!(s.clock.lock().unwrap().backwards_sets(), 0);
}

#[test]
fn a_running_anchored_set_honours_allow_backwards_at_the_commit_sample() {
    let start = LogicalInstant::parse_rfc3339("2026-01-31T23:59:59.9999985Z").unwrap();
    let body = json!({"to": "endOfDay", "allowBackwards": true});
    let s = state_at(ticking_clock(start, 1_000), None);
    let response = post(&s, "clock:set", &body);
    assert_eq!(clock_of(&response), "2026-01-31T23:59:59.999999000Z");
    assert_eq!(response.body["backwardsSets"], 0);

    let s = state_at(ticking_clock(start, 1_000), None);
    assert_eq!(s.clock.lock().unwrap().snapshot().instant, start);
    let response = post(&s, "clock:set", &body);
    assert_eq!(clock_of(&response), "2026-01-31T23:59:59.999999000Z");
    assert_eq!(response.body["backwardsSets"], 1);

    let s = state_at(ticking_clock(start, 1_000), None);
    let before = s.clock.lock().unwrap().snapshot();
    refused(
        &post(&s, "clock:set", &json!({"to": "endOfDay"})),
        "clock would move backwards",
    );
    let clock = s.clock.lock().unwrap();
    assert_eq!(clock.snapshot().revision, before.revision);
    assert_eq!(clock.backwards_sets(), 0);
}

#[test]
fn previews_match_frozen_moves_without_publishing() {
    for (action, body, expected) in [
        (
            "advance",
            json!({"duration": "P1M"}),
            "2026-02-28T10:00:00Z",
        ),
        ("advance", json!({"seconds": 59}), "2026-01-31T10:00:59Z"),
        (
            "set",
            json!({"to": "startOfNextMonth"}),
            "2026-01-31T15:00:00Z",
        ),
        (
            "advanceTo",
            json!({"to": "endOfMonth"}),
            "2026-01-31T14:59:59.999999000Z",
        ),
        (
            "set",
            json!({"instant": "2026-01-30T10:00:00Z", "allowBackwards": true}),
            "2026-01-30T10:00:00Z",
        ),
    ] {
        let s = state(Some(zones(Some("Test/Tokyo"))));
        let before = s.clock.lock().unwrap().snapshot();
        let response = post(
            &s,
            "clock:preview",
            &json!({"action": action, "move": body}),
        );
        assert_eq!(clock_of(&response), expected);
        assert_eq!(response.body["running"], false);
        assert_eq!(s.clock.lock().unwrap().snapshot(), before);
        assert_eq!(s.clock.lock().unwrap().backwards_sets(), 0);
        let confirmed = post(&s, &format!("clock:{action}"), &body);
        assert_eq!(clock_of(&confirmed), expected);
    }
}

#[tokio::test]
async fn preview_checks_functions_limits_without_notifying_or_settling_runners() {
    let functions = Arc::new(ClockCounting {
        limit: LogicalInstant::from_unix_seconds(START + 86_400),
        moves: AtomicUsize::new(0),
        syncs: AtomicUsize::new(0),
    });
    let mut s = state(None);
    s.functions = Some(functions.clone());
    let before = s.clock.lock().unwrap().snapshot();
    let preview = "/v1/sessions/default/clock:preview";
    let headers = RequestHeaders::default();
    let response = handle_async(
        &s,
        "POST",
        preview,
        &headers,
        &json!({
            "action": "advance", "move": {"duration": "P1D"}
        }),
    )
    .await;
    assert_eq!(clock_of(&response), "2026-02-01T10:00:00Z");
    let response = handle_async(
        &s,
        "POST",
        preview,
        &headers,
        &json!({
            "action": "advance", "move": {"duration": "P2D"}
        }),
    )
    .await;
    refused(&response, "Functions clock limit exceeded");
    assert_eq!(s.clock.lock().unwrap().snapshot(), before);
    assert_eq!(functions.moves.load(SeqCst), 0);
    assert_eq!(functions.syncs.load(SeqCst), 0);
}

#[test]
fn preview_observes_running_clock_without_exposing_unvalidated_targets() {
    let s = state_at(
        ticking_clock(LogicalInstant::from_unix_seconds(START), 1_000_000),
        None,
    );
    let before = s.clock.lock().unwrap().snapshot();
    let body = json!({"action": "advance", "move": {"duration": "PT1H"}});
    let reply = post(&s, "clock:preview", &body);
    assert_eq!(clock_of(&reply), "2026-01-31T11:00:00.001000000Z");
    assert_eq!(reply.body["running"], true);
    assert_eq!(s.clock.lock().unwrap().snapshot().revision, before.revision);

    let s = state(None);
    for (body, diagnostic) in [
        (json!({"action": "resume", "move": {}}), "action"),
        (json!({"action": "set", "move": null}), "move"),
        (
            json!({"action": "advance", "move": {"seconds": -1}}),
            "negative duration",
        ),
        (
            json!({"action": "advance", "move": {"duration": "P"}}),
            "duration",
        ),
        (
            json!({"action": "set", "move": {"instant": "2026-01-01T00:00:00Z"}}),
            "would move backwards",
        ),
        (
            json!({"action": "advanceTo", "move": {"to": "startOfDay", "allowBackwards": true}}),
            "would move backwards",
        ),
    ] {
        refused(&post(&s, "clock:preview", &body), diagnostic);
    }
    assert_eq!(now(&s), "2026-01-31T10:00:00Z");
}

#[test]
fn preview_matches_the_pict_move_mode_and_validation_rows() {
    let rows = include_str!("fixtures/clock-preview-pict.tsv");
    for row in rows.lines().skip(1) {
        let fields: Vec<_> = row.split('\t').collect();
        let [kind, mode, input] = fields.as_slice() else {
            panic!("bad row: {row}")
        };
        let moving_backwards = matches!(*input, "rewind" | "allowRewind");
        let allow = *input == "allowRewind";
        let start = LogicalInstant::from_unix_seconds(START);
        let clock = if *mode == "running" {
            ticking_clock(start, 0)
        } else {
            VirtualClock::new(start)
        };
        let s = state_at(clock, None);
        let (action, request, expected) = match *kind {
            "seconds" => ("advance", json!({"seconds": 59}), "2026-01-31T10:00:59Z"),
            "hour" => (
                "advance",
                json!({"duration": "PT1H"}),
                "2026-01-31T11:00:00Z",
            ),
            "day" if moving_backwards => (
                "advance",
                json!({"duration": "-P1D", "allowBackwards": allow}),
                "2026-01-30T10:00:00Z",
            ),
            "day" => (
                "advance",
                json!({"duration": "P1D"}),
                "2026-02-01T10:00:00Z",
            ),
            "week" => (
                "advance",
                json!({"duration": "P1W"}),
                "2026-02-07T10:00:00Z",
            ),
            "month" => (
                "advance",
                json!({"duration": "P1M"}),
                "2026-02-28T10:00:00Z",
            ),
            "startOfNextMonth" => ("set", json!({"to": *kind}), "2026-02-01T00:00:00Z"),
            "endOfMonth" => (
                "set",
                json!({"to": *kind}),
                "2026-01-31T23:59:59.999999000Z",
            ),
            "instant" if moving_backwards => (
                "set",
                json!({"instant": "2026-01-29T00:00:00Z", "allowBackwards": allow}),
                "2026-01-29T00:00:00Z",
            ),
            "instant" => (
                "set",
                json!({"instant": "2026-02-02T00:00:00Z"}),
                "2026-02-02T00:00:00Z",
            ),
            _ => panic!("bad move: {row}"),
        };
        let before = s.clock.lock().unwrap().snapshot();
        let request = if *input == "invalid" {
            let mut request = request;
            let value = ["seconds", "instant", "duration", "to"]
                .into_iter()
                .find_map(|name| request.get(name).map(|_| name))
                .unwrap();
            request[value] = json!("not a clock move");
            request
        } else {
            request
        };
        let preview = post(
            &s,
            "clock:preview",
            &json!({"action": action, "move": request}),
        );
        assert_eq!(s.clock.lock().unwrap().snapshot(), before, "{row}");
        if matches!(*input, "invalid" | "rewind") {
            assert_eq!(preview.status, 400, "{row}: {}", preview.body);
        } else {
            assert_eq!(clock_of(&preview), expected, "{row}");
            assert_eq!(preview.body["running"], *mode == "running", "{row}");
            assert_eq!(
                clock_of(&post(&s, &format!("clock:{action}"), &request)),
                expected,
                "{row}"
            );
        }
    }
}

#[test]
fn previewing_zero_legacy_duration_leaves_the_clock_at_its_current_instant() {
    let s = state(None);
    let before = s.clock.lock().unwrap().snapshot();
    for body in [json!({"seconds": 0}), json!({"millis": 0})] {
        let preview = post(
            &s,
            "clock:preview",
            &json!({"action": "advance", "move": body}),
        );
        assert_eq!(clock_of(&preview), "2026-01-31T10:00:00Z");
        assert_eq!(s.clock.lock().unwrap().snapshot(), before);
    }
}
