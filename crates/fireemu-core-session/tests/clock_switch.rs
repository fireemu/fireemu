//! Switching a virtual clock between frozen and following real time at runtime
//! (`clock:freeze`, `clock:resume`).

use fireemu_core_session::clock::{ClockError, ClockObserver, VirtualClock};
use fireemu_core_types::determinism::Clock;
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};
use proptest::prelude::*;
use std::sync::{Arc, Mutex};

const SECOND: i128 = 1_000_000_000;

fn start() -> LogicalInstant {
    LogicalInstant::from_unix_seconds(1_800_000_000)
}

/// A source moved by hand, and a wall clock that reads `wall_base` plus the same reading.
struct Rig {
    reading: Arc<Mutex<i128>>,
}

impl Rig {
    fn new() -> Self {
        Self {
            reading: Arc::new(Mutex::new(7 * SECOND)),
        }
    }
    fn source(&self) -> fireemu_core_session::clock::TimeSource {
        let reading = self.reading.clone();
        Arc::new(move || *reading.lock().unwrap())
    }
    fn wall(wall_base: LogicalInstant) -> fireemu_core_session::clock::WallSource {
        Arc::new(move |reading| LogicalInstant::from_nanos(wall_base.as_nanos() + reading))
    }
    fn run_for(&self, nanos: i128) {
        *self.reading.lock().unwrap() += nanos;
    }
    fn now(&self) -> i128 {
        *self.reading.lock().unwrap()
    }
}

fn offset(clock: &VirtualClock) -> i128 {
    clock.now().as_nanos() - start().as_nanos()
}

#[test]
fn freezing_stops_at_the_current_instant_and_resuming_runs_on_from_it() {
    let rig = Rig::new();
    let mut clock = VirtualClock::following_with(start(), rig.source(), rig.now());
    rig.run_for(3 * SECOND);
    clock.freeze().unwrap();
    assert!(!clock.is_following());
    assert_eq!(offset(&clock), 3 * SECOND);
    rig.run_for(10 * SECOND);
    assert_eq!(offset(&clock), 3 * SECOND, "a frozen clock stands still");
    clock.resume().unwrap();
    assert!(clock.is_following());
    assert_eq!(
        offset(&clock),
        3 * SECOND,
        "resuming does not count the frozen time"
    );
    rig.run_for(2 * SECOND);
    assert_eq!(offset(&clock), 5 * SECOND);
    let snapshot = clock.snapshot();
    assert_eq!(snapshot.elapsed_nanos, 5_000_000_000);
}

#[test]
fn a_clock_started_frozen_resumes_with_its_time_source() {
    let rig = Rig::new();
    let mut clock = VirtualClock::new(start()).with_time_source(rig.source());
    assert!(!clock.is_following());
    rig.run_for(4 * SECOND);
    assert_eq!(offset(&clock), 0);
    clock.resume().unwrap();
    rig.run_for(SECOND);
    assert_eq!(offset(&clock), SECOND);
}

#[test]
fn a_clock_without_a_time_source_cannot_resume() {
    let mut clock = VirtualClock::new(start());
    let before = clock.snapshot();
    assert_eq!(clock.resume(), Err(ClockError::NoTimeSource));
    assert_eq!(
        clock.resume_at(start(), false),
        Err(ClockError::NoTimeSource)
    );
    assert_eq!(clock.snapshot(), before);
    assert!(clock.wall_now().is_none());
    // Freezing a frozen clock is a no-op, not an error.
    clock.freeze().unwrap();
    assert_eq!(clock.snapshot(), before);
}

#[test]
fn freeze_and_resume_are_idempotent_and_publish_only_a_change() {
    let rig = Rig::new();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let observer: Arc<ClockObserver> = Arc::new(move |s| sink.lock().unwrap().push(s));
    let mut clock = VirtualClock::following_with(start(), rig.source(), rig.now());
    clock.observe(&observer);
    clock.resume().unwrap();
    assert_eq!(clock.snapshot().revision, 0, "already running");
    clock.freeze().unwrap();
    assert_eq!(clock.snapshot().revision, 1);
    clock.freeze().unwrap();
    assert_eq!(clock.snapshot().revision, 1, "already frozen");
    clock.resume().unwrap();
    assert_eq!(clock.snapshot().revision, 2);
    assert_eq!(seen.lock().unwrap().len(), 3);
}

#[test]
fn observers_see_the_new_mode_when_they_are_told() {
    let rig = Rig::new();
    let shared = Arc::new(Mutex::new(None::<bool>));
    let mut clock = VirtualClock::following_with(start(), rig.source(), rig.now());
    // The observer cannot read the clock (it runs under the clock's lock), so the test checks
    // the mode right after each publication instead.
    let sink = shared.clone();
    let observer: Arc<ClockObserver> = Arc::new(move |_| *sink.lock().unwrap() = Some(true));
    clock.observe(&observer);
    *shared.lock().unwrap() = None;
    clock.freeze().unwrap();
    assert_eq!(*shared.lock().unwrap(), Some(true));
    assert!(!clock.is_following());
}

#[test]
fn resuming_in_sync_jumps_to_the_wall_time_and_follows_it() {
    let rig = Rig::new();
    let wall_base = LogicalInstant::from_unix_seconds(1_900_000_000);
    let mut clock = VirtualClock::new(start())
        .with_time_source(rig.source())
        .with_wall_clock(Rig::wall(wall_base));
    let wall = clock.wall_now().unwrap();
    clock.resume_at(wall, false).unwrap();
    assert!(clock.is_following());
    assert_eq!(clock.now(), wall);
    rig.run_for(2 * SECOND);
    assert_eq!(
        clock.now(),
        clock.wall_now().unwrap(),
        "it keeps up with the wall clock"
    );
    assert_eq!(clock.backwards_sets(), 0);
}

#[test]
fn resuming_in_sync_refuses_a_backwards_jump_unless_allowed() {
    let rig = Rig::new();
    // A pinned start in the future: the wall clock is behind the emulator clock.
    let wall_base = LogicalInstant::from_unix_seconds(1_700_000_000);
    let mut clock = VirtualClock::new(start())
        .with_time_source(rig.source())
        .with_wall_clock(Rig::wall(wall_base));
    let before = clock.snapshot();
    let wall = clock.wall_now().unwrap();
    assert_eq!(
        clock.resume_at(wall, false),
        Err(ClockError::WouldMoveBackwards {
            current: start(),
            requested: wall
        })
    );
    assert!(
        !clock.is_following(),
        "a refused resume leaves the clock frozen"
    );
    assert_eq!(clock.snapshot(), before);
    clock.resume_at(wall, true).unwrap();
    assert_eq!(clock.now(), wall);
    assert_eq!(clock.backwards_sets(), 1);
    assert!(clock.is_following());
}

#[test]
fn a_resume_outside_the_runtime_range_is_refused_and_changes_nothing() {
    let rig = Rig::new();
    let mut clock = VirtualClock::new(start()).with_time_source(rig.source());
    let high = LogicalInstant::from_nanos(start().as_nanos() + 10 * SECOND);
    clock.restrict_range(start(), high).unwrap();
    let before = clock.snapshot();
    assert_eq!(
        clock.resume_at(LogicalInstant::from_nanos(high.as_nanos() + 1), false),
        Err(ClockError::OutOfRange)
    );
    assert!(!clock.is_following());
    assert_eq!(clock.snapshot(), before);
    clock.resume_at(high, false).unwrap();
    assert!(clock.is_following());
}

#[test]
fn a_clone_keeps_the_mode_and_the_time_source() {
    let rig = Rig::new();
    let clock = VirtualClock::new(start()).with_time_source(rig.source());
    let mut copy = clock.clone();
    copy.resume().unwrap();
    rig.run_for(SECOND);
    assert_eq!(offset(&copy), SECOND);
    assert_eq!(offset(&clock), 0);
}

#[derive(Debug, Clone)]
enum Step {
    Run(i64),
    Freeze,
    Resume,
    Advance(i64),
    ResumeAt(i64, bool),
}

fn step() -> impl Strategy<Value = Step> {
    prop_oneof![
        (0_i64..5_000).prop_map(Step::Run),
        Just(Step::Freeze),
        Just(Step::Resume),
        (0_i64..5_000).prop_map(Step::Advance),
        (-5_000_i64..5_000, any::<bool>()).prop_map(|(d, b)| Step::ResumeAt(d, b)),
    ]
}

proptest! {
    /// Against a reference model of (instant, running, elapsed, backwards sets): a frozen
    /// clock counts no real time, a running one counts all of it, hand moves add on top, and a
    /// refused step changes nothing.
    #[test]
    fn mode_switching_matches_its_reference_model(steps in proptest::collection::vec(step(), 1..40)) {
        let rig = Rig::new();
        let mut clock = VirtualClock::new(start()).with_time_source(rig.source());
        let mut instant = start().as_nanos();
        let mut running = false;
        let mut elapsed: i128 = 0;
        let mut backwards = 0_u32;
        let mut revision = 0_u64;
        for step in steps {
            match step {
                Step::Run(ms) => {
                    rig.run_for(i128::from(ms) * 1_000_000);
                    if running {
                        instant += i128::from(ms) * 1_000_000;
                        elapsed += i128::from(ms) * 1_000_000;
                    }
                }
                Step::Freeze => {
                    clock.freeze().unwrap();
                    if running { revision += 1; }
                    running = false;
                }
                Step::Resume => {
                    clock.resume().unwrap();
                    if !running { revision += 1; }
                    running = true;
                }
                Step::Advance(ms) => {
                    clock.advance(LogicalDuration::from_millis(ms)).unwrap();
                    instant += i128::from(ms) * 1_000_000;
                    elapsed += i128::from(ms) * 1_000_000;
                    revision += 1;
                }
                Step::ResumeAt(ms, allow) => {
                    let target = instant + i128::from(ms) * 1_000_000;
                    let result = clock.resume_at(LogicalInstant::from_nanos(target), allow);
                    if target < instant && !allow {
                        prop_assert!(matches!(result, Err(ClockError::WouldMoveBackwards { .. })), "{result:?}");
                    } else {
                        prop_assert_eq!(result, Ok(()));
                        if target < instant { backwards += 1; } else { elapsed += target - instant; }
                        instant = target;
                        running = true;
                        revision += 1;
                    }
                }
            }
            prop_assert_eq!(clock.now().as_nanos(), instant);
            prop_assert_eq!(clock.is_following(), running);
            prop_assert_eq!(clock.backwards_sets(), backwards);
            let snapshot = clock.snapshot();
            prop_assert_eq!(snapshot.elapsed_nanos, u128::try_from(elapsed).unwrap());
            prop_assert_eq!(snapshot.revision, revision);
        }
    }
}

#[test]
fn a_resume_lands_where_it_was_judged_even_when_every_read_moves_the_source() {
    let calls = Arc::new(Mutex::new(0_i128));
    let counted = calls.clone();
    // Every read of the source finds it ten nanoseconds further on, as a real clock does.
    let mut clock = VirtualClock::new(start()).with_time_source(Arc::new(move || {
        let mut calls = counted.lock().unwrap();
        *calls += 1;
        *calls * 10
    }));
    clock.resume().unwrap();
    assert!(clock.is_following());
    clock.freeze().unwrap();
    let frozen_at = clock.now();
    clock.resume_at(frozen_at, false).unwrap();
    assert_eq!(clock.backwards_sets(), 0);
}

#[test]
fn a_sync_judges_lands_and_runs_from_one_reading() {
    let calls = Arc::new(Mutex::new(0_i128));
    let counted = calls.clone();
    // Every read finds the source ten nanoseconds on; the wall instant is the reading itself.
    let source: fireemu_core_session::clock::TimeSource = Arc::new(move || {
        let mut calls = counted.lock().unwrap();
        *calls += 10;
        *calls
    });
    let wall: fireemu_core_session::clock::WallSource = Arc::new(LogicalInstant::from_nanos);
    // Running, already at the wall time: a sync is not refused as backwards.
    let mut running = VirtualClock::following_with(LogicalInstant::UNIX_EPOCH, source.clone(), 0)
        .with_wall_clock(wall.clone());
    let reading = running.read_wall().unwrap();
    running.resume_at_wall(reading, false).unwrap();
    assert_eq!(
        running.now(),
        LogicalInstant::from_nanos(*calls.lock().unwrap())
    );
    // Frozen behind: the synced clock runs from the reading it landed on, so it shows the wall
    // time at every later read, without lag.
    let mut frozen = VirtualClock::new(LogicalInstant::UNIX_EPOCH)
        .with_time_source(source)
        .with_wall_clock(wall);
    let reading = frozen.read_wall().unwrap();
    frozen.resume_at_wall(reading, false).unwrap();
    assert_eq!(
        frozen.now(),
        LogicalInstant::from_nanos(*calls.lock().unwrap())
    );
    assert_eq!(frozen.backwards_sets(), 0);
    assert!(VirtualClock::new(LogicalInstant::UNIX_EPOCH)
        .read_wall()
        .is_none());
}

#[test]
fn a_sync_after_the_host_clock_steps_back_runs_from_the_raw_wall_reading() {
    let rig = Rig::new();
    let wall_base = LogicalInstant::from_unix_seconds(1_800_000_000);
    // Running from the wall clock, with the wall instant equal to the clock.
    let mut clock = VirtualClock::following_with(
        LogicalInstant::from_nanos(wall_base.as_nanos() + rig.now()),
        rig.source(),
        rig.now(),
    )
    .with_wall_clock(Rig::wall(wall_base));
    rig.run_for(2 * SECOND);
    let high = clock.now();
    // The host clock steps back two seconds: the clock holds at its high-water mark.
    rig.run_for(-2 * SECOND);
    assert_eq!(clock.now(), high);
    let wall = clock.read_wall().unwrap();
    assert!(wall.instant < high);
    clock.resume_at_wall(wall, true).unwrap();
    assert_eq!(clock.now(), wall.instant);
    assert_eq!(clock.backwards_sets(), 1);
    // From here on the clock shows the wall time.
    rig.run_for(3 * SECOND);
    assert_eq!(clock.now(), clock.wall_now().unwrap());
}

/// A source that returns the readings in order, repeating the last one.
fn scripted(readings: &[i128]) -> fireemu_core_session::clock::TimeSource {
    let queue = Arc::new(Mutex::new(std::collections::VecDeque::from(
        readings.to_vec(),
    )));
    Arc::new(move || {
        let mut queue = queue.lock().unwrap();
        if queue.len() > 1 {
            queue.pop_front().unwrap()
        } else {
            *queue.front().unwrap()
        }
    })
}

#[test]
fn a_sync_never_takes_back_what_its_publication_showed() {
    let start = LogicalInstant::from_nanos(100);
    // The anchor read, the sync's wall read, the publication's snapshot, then a read that is
    // behind it.
    let source = scripted(&[100, 100, 101, 99]);
    let mut clock = VirtualClock::following_with(start, source, 100)
        .with_wall_clock(Arc::new(LogicalInstant::from_nanos));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let observer: Arc<ClockObserver> = Arc::new(move |s| sink.lock().unwrap().push(s));
    // Observing reads the source once (the first scripted 100).
    clock.observe(&observer);
    let wall = clock.read_wall().unwrap();
    assert_eq!(wall.instant, LogicalInstant::from_nanos(100));
    clock.resume_at_wall(wall, false).unwrap();
    let published = *seen.lock().unwrap().last().unwrap();
    let after = clock.snapshot();
    assert_eq!(after.revision, published.revision);
    assert!(
        after.instant >= published.instant,
        "{after:?} < {published:?}"
    );
    assert!(
        after.elapsed_nanos >= published.elapsed_nanos,
        "{after:?} < {published:?}"
    );
    assert_eq!(clock.backwards_sets(), 0);
}
