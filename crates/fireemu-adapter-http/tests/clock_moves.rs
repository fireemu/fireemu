//! Control API: relative and calendar moves of the virtual clock (`duration`, `to`,
//! `timeZone`), and that every request accepted before them keeps its answer.

use std::sync::{Arc, Mutex, RwLock};

use fireemu_adapter_http::control::{handle, CalendarZones, ControlState, SharedCalendarZone};
use fireemu_adapter_http::identity_toolkit::JsonResponse;
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
        ("clock:advance", json!({"duration": null}), "duration must be a string"),
        ("clock:advance", json!({"duration": "P1D", "to": "startOfDay"}), "to is accepted by clock:set and clock:advanceTo"),
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
    assert_eq!(now(&s), "2026-01-31T10:00:00Z");
}

/// Requests that were valid before calendar moves keep their exact answers, whatever extra
/// fields they carry.
#[test]
fn requests_accepted_before_keep_their_answers() {
    let s = state(None);
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:advance",
            &json!({"seconds": 60, "timeZone": "Nowhere/Else"})
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
            &json!({"millis": 500, "to": "endOfMonth"})
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
            &json!({"instant": "2026-02-01T00:00:00Z", "timeZone": 3})
        )),
        "2026-02-01T00:00:00Z"
    );
    assert_eq!(
        clock_of(&post(
            &s,
            "clock:advanceTo",
            &json!({"instant": "2026-02-02T00:00:00Z", "allowBackwards": "x"})
        )),
        "2026-02-02T00:00:00Z"
    );
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

/// A running clock whose time source moves 1 ms at every reading.
fn ticking_clock() -> VirtualClock {
    let ticks = Arc::new(std::sync::atomic::AtomicI64::new(0));
    VirtualClock::following_with(
        LogicalInstant::from_unix_seconds(START),
        Arc::new(move || {
            i128::from(ticks.fetch_add(1, std::sync::atomic::Ordering::SeqCst)) * 1_000_000
        }),
        0,
    )
}

/// A running clock whose source moves 1 ms at each of the next `ticks` readings, then stands.
fn clock_ticking_for(ticks: &Arc<std::sync::atomic::AtomicI64>) -> VirtualClock {
    let reading = Arc::new(std::sync::atomic::AtomicI64::new(0));
    let ticks = ticks.clone();
    VirtualClock::following_with(
        LogicalInstant::from_unix_seconds(START),
        Arc::new(move || {
            use std::sync::atomic::Ordering::SeqCst;
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

/// An absolute target is published as computed even when the clock ran on since the move
/// read it: the time that passed is not added to a boundary.
#[test]
fn an_anchor_on_a_running_clock_lands_exactly_on_the_boundary() {
    use std::sync::atomic::Ordering::SeqCst;
    let ticks = Arc::new(std::sync::atomic::AtomicI64::new(0));
    let s = state_at(clock_ticking_for(&ticks), None);
    ticks.store(2, SeqCst);
    assert_eq!(
        clock_of(&post(&s, "clock:advanceTo", &json!({"to": "endOfYear"}))),
        "2026-12-31T23:59:59.999999000Z"
    );
    // The clock ran 2 ms into 2027-01-01, so a day later starts 2027-01-02.
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
fn a_duration_on_a_running_clock_keeps_its_distance_from_a_fresh_reading() {
    let s = state_at(ticking_clock(), None);
    let moved = LogicalInstant::parse_rfc3339(&clock_of(&post(
        &s,
        "clock:advance",
        &json!({"duration": "P1D"}),
    )))
    .unwrap();
    // The day is measured from the reading the move started from; the clock read on since.
    assert!(moved > LogicalInstant::from_unix_seconds(START + 86_400));
    assert!(moved < LogicalInstant::from_unix_seconds(START + 86_401));
}
