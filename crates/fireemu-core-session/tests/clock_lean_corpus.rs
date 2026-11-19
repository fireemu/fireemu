//! Differential test of `VirtualClock` against the Lean specification in
//! `verification/lean/virtual-clock`, through the golden traces that the Lean executable writes
//! (`lake exe corpus`), plus proptest checks of the properties that the Lean proofs state
//! (`VC.never_backwards_uncounted`, `VC.reads_never_go_back`, `VC.refused_keeps_observation`,
//! `VC.frozen_stands_still`, `VC.freeze_then_resume_keeps_the_instant`, `VC.freeze_idempotent`,
//! `VC.resume_idempotent`, `VC.published_in_range`, `VC.read_in_range`, `VC.budget_monotone`).
//! The Rust build does not need Lean.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use fireemu_core_session::clock::{ClockError, TimeSource, VirtualClock, WallSource};
use fireemu_core_types::determinism::Clock;
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-virtual-clock.corpus");

/// A time source and a wall clock that return what the current step says.
struct Rig {
    reading: Arc<Mutex<i128>>,
    wall: Arc<Mutex<i128>>,
}

impl Rig {
    fn new(reading: i128) -> Self {
        Self {
            reading: Arc::new(Mutex::new(reading)),
            wall: Arc::new(Mutex::new(0)),
        }
    }

    fn source(&self) -> TimeSource {
        let reading = self.reading.clone();
        Arc::new(move || *reading.lock().unwrap())
    }

    /// The wall clock ignores the reading it is given: the step fixes both.
    fn wall_clock(&self) -> WallSource {
        let wall = self.wall.clone();
        Arc::new(move |_| LogicalInstant::from_nanos(*wall.lock().unwrap()))
    }

    fn set(&self, reading: i128, wall: i128) {
        *self.reading.lock().unwrap() = reading;
        *self.wall.lock().unwrap() = wall;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Init {
    New,
    Paused,
    Following,
}

fn build(init: Init, start: i128, reading: i128, wall: bool, rig: &Rig) -> VirtualClock {
    let start = LogicalInstant::from_nanos(start);
    let clock = match init {
        Init::New => VirtualClock::new(start),
        Init::Paused => VirtualClock::new(start).with_time_source(rig.source()),
        Init::Following => VirtualClock::following_with(start, rig.source(), reading),
    };
    if wall {
        clock.with_wall_clock(rig.wall_clock())
    } else {
        clock
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Freeze,
    Resume,
    ResumeAt(i128, bool),
    ResumeWall(bool),
    Advance(i128),
    AdvanceTo(i128),
    Set(i128),
    SetAllowBackwards(i128),
    TrySetAllowBackwards(i128),
    RestrictRange(i128, i128),
    Sync,
    Tick,
    ValidateTarget(i128),
    Read,
}

impl Op {
    /// `VC.Op.allowsBackwards`.
    const fn allows_backwards(self) -> bool {
        match self {
            Self::SetAllowBackwards(_) | Self::TrySetAllowBackwards(_) => true,
            Self::ResumeAt(_, allow) | Self::ResumeWall(allow) => allow,
            _ => false,
        }
    }

    /// `VC.Op.setsInstant`.
    const fn sets_instant(self) -> bool {
        !matches!(
            self,
            Self::Freeze
                | Self::Resume
                | Self::RestrictRange(..)
                | Self::Sync
                | Self::ValidateTarget(_)
                | Self::Read
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Res {
    Unit,
    Instant(i128),
    Synced(bool),
    NoWall,
    Err(ClockError),
}

impl Res {
    /// `VC.Res.refused`.
    const fn refused(&self) -> bool {
        matches!(self, Self::Err(_) | Self::Synced(false) | Self::NoWall)
    }
}

fn unit(result: Result<(), ClockError>) -> Res {
    result.map_or_else(Res::Err, |()| Res::Unit)
}

fn instant(result: Result<LogicalInstant, ClockError>) -> Res {
    result.map_or_else(Res::Err, |i| Res::Instant(i.as_nanos()))
}

fn at(nanos: i128) -> LogicalInstant {
    LogicalInstant::from_nanos(nanos)
}

fn apply(clock: &mut VirtualClock, op: Op) -> Res {
    match op {
        Op::Freeze => unit(clock.freeze()),
        Op::Resume => unit(clock.resume()),
        Op::ResumeAt(i, allow) => unit(clock.resume_at(at(i), allow)),
        Op::ResumeWall(allow) => match clock.read_wall() {
            None => Res::NoWall,
            Some(wall) => unit(clock.resume_at_wall(wall, allow)),
        },
        Op::Advance(d) => instant(clock.advance(LogicalDuration::from_nanos(d))),
        Op::AdvanceTo(i) => instant(clock.advance_to(at(i))),
        Op::Set(i) => instant(clock.set(at(i))),
        Op::SetAllowBackwards(i) => {
            clock.set_allow_backwards(at(i));
            Res::Unit
        }
        Op::TrySetAllowBackwards(i) => unit(clock.try_set_allow_backwards(at(i))),
        Op::RestrictRange(lo, hi) => unit(clock.restrict_range(at(lo), at(hi))),
        Op::Sync => Res::Synced(clock.sync()),
        Op::Tick => instant(clock.tick()),
        Op::ValidateTarget(i) => unit(clock.validate_target(at(i))),
        Op::Read => Res::Instant(clock.now().as_nanos()),
    }
}

/// What the replay reads after each step (`VC.observe`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Obs {
    instant: i128,
    elapsed: u128,
    revision: u64,
    backwards: u32,
    following: bool,
}

fn observe(clock: &VirtualClock) -> Result<Obs, String> {
    let now = clock.now().as_nanos();
    let snapshot = clock.snapshot();
    if snapshot.instant.as_nanos() != now {
        return Err(format!(
            "now() {now} differs from snapshot().instant {}",
            snapshot.instant.as_nanos()
        ));
    }
    Ok(Obs {
        instant: now,
        elapsed: snapshot.elapsed_nanos,
        revision: snapshot.revision,
        backwards: clock.backwards_sets(),
        following: clock.is_following(),
    })
}

// ---------------------------------------------------------------------------------------------
// The corpus

fn encode_err(e: &ClockError) -> String {
    match e {
        ClockError::NegativeDuration => "negativeDuration".into(),
        ClockError::Overflow => "overflow".into(),
        ClockError::OutOfRange => "outOfRange".into(),
        ClockError::NoTimeSource => "noTimeSource".into(),
        ClockError::WouldMoveBackwards { current, requested } => format!(
            "wouldMoveBackwards {} {}",
            current.as_nanos(),
            requested.as_nanos()
        ),
    }
}

fn encode_res(res: &Res) -> String {
    match res {
        Res::Unit => "unit".into(),
        Res::Instant(i) => format!("instant {i}"),
        Res::Synced(b) => format!("synced {}", u8::from(*b)),
        Res::NoWall => "noWall".into(),
        Res::Err(e) => format!("err {}", encode_err(e)),
    }
}

fn encode_obs(o: &Obs) -> String {
    format!(
        "{} {} {} {} {}",
        o.instant,
        o.elapsed,
        o.revision,
        o.backwards,
        u8::from(o.following)
    )
}

fn num(token: Option<&str>) -> i128 {
    token.expect("number").parse().expect("i128")
}

fn flag(token: Option<&str>) -> bool {
    match token.expect("flag") {
        "0" => false,
        "1" => true,
        other => panic!("flag {other}"),
    }
}

fn parse_op(text: &str) -> Op {
    let mut t = text.split(' ');
    let name = t.next().expect("op");
    match name {
        "freeze" => Op::Freeze,
        "resume" => Op::Resume,
        "resumeAt" => Op::ResumeAt(num(t.next()), flag(t.next())),
        "resumeWall" => Op::ResumeWall(flag(t.next())),
        "advance" => Op::Advance(num(t.next())),
        "advanceTo" => Op::AdvanceTo(num(t.next())),
        "set" => Op::Set(num(t.next())),
        "setAllowBackwards" => Op::SetAllowBackwards(num(t.next())),
        "trySetAllowBackwards" => Op::TrySetAllowBackwards(num(t.next())),
        "restrictRange" => Op::RestrictRange(num(t.next()), num(t.next())),
        "sync" => Op::Sync,
        "tick" => Op::Tick,
        "validateTarget" => Op::ValidateTarget(num(t.next())),
        "read" => Op::Read,
        other => panic!("unknown operation {other}"),
    }
}

struct Step {
    line: usize,
    reading: i128,
    wall: i128,
    op: Op,
    op_text: String,
    /// `panic`, or `<result> | <observation>`, or `<result> | panic`.
    expected: String,
}

struct Trace {
    name: String,
    init: Init,
    start: i128,
    reading: i128,
    wall: bool,
    steps: Vec<Step>,
}

fn corpus() -> Vec<Trace> {
    let mut traces: Vec<Trace> = Vec::new();
    for (index, line) in CORPUS.lines().enumerate() {
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if let Some(header) = line.strip_prefix("trace ") {
            let mut t = header.split(' ');
            let name = t.next().expect("name").to_owned();
            let init = match t.next().expect("init") {
                "new" => Init::New,
                "paused" => Init::Paused,
                "following" => Init::Following,
                other => panic!("unknown init {other}"),
            };
            traces.push(Trace {
                name,
                init,
                start: num(t.next()),
                reading: num(t.next()),
                wall: flag(t.next()),
                steps: Vec::new(),
            });
            continue;
        }
        let (input, expected) = line.split_once(" => ").expect("step separator");
        let mut t = input.splitn(3, ' ');
        let reading = num(t.next());
        let wall = num(t.next());
        let op_text = t.next().expect("operation").to_owned();
        traces
            .last_mut()
            .expect("a trace header first")
            .steps
            .push(Step {
                line: index + 1,
                reading,
                wall,
                op: parse_op(&op_text),
                op_text,
                expected: expected.to_owned(),
            });
    }
    traces
}

/// Replays one trace; returns the first disagreement.
fn replay(trace: &Trace) -> Result<(), String> {
    let rig = Rig::new(trace.reading);
    let mut clock = build(trace.init, trace.start, trace.reading, trace.wall, &rig);
    for step in &trace.steps {
        rig.set(step.reading, step.wall);
        let expects_panic = step.expected == "panic" || step.expected.ends_with(" | panic");
        if expects_panic && !cfg!(debug_assertions) {
            // Without overflow checks the unchecked i128 arithmetic wraps instead of panicking.
            return Ok(());
        }
        let outcome = catch_unwind(AssertUnwindSafe(|| apply(&mut clock, step.op)));
        let actual = match outcome {
            Err(_) => "panic".to_owned(),
            Ok(res) => {
                let observed = catch_unwind(AssertUnwindSafe(|| observe(&clock)));
                let obs = match observed {
                    Err(_) => "panic".to_owned(),
                    Ok(Ok(o)) => encode_obs(&o),
                    Ok(Err(message)) => message,
                };
                format!("{} | {obs}", encode_res(&res))
            }
        };
        if actual != step.expected {
            return Err(format!(
                "trace {} line {} ({} {} {}): expected `{}`, got `{actual}`",
                trace.name, step.line, step.reading, step.wall, step.op_text, step.expected
            ));
        }
        if expects_panic {
            return Ok(());
        }
    }
    Ok(())
}

#[test]
fn virtual_clock_matches_the_lean_specification_on_the_golden_traces() {
    let traces = corpus();
    assert!(traces.len() >= 1900, "corpus has {} traces", traces.len());
    let failures: Vec<String> = traces.iter().filter_map(|t| replay(t).err()).collect();
    assert!(
        failures.is_empty(),
        "{} of {} traces disagree with the specification; first ones:\n{}",
        failures.len(),
        traces.len(),
        failures
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn golden_traces_cover_every_operation_result_and_finding() {
    let traces = corpus();
    let steps: Vec<&Step> = traces.iter().flat_map(|t| &t.steps).collect();
    let ops = [
        "freeze",
        "resume",
        "resumeAt",
        "resumeWall",
        "advance",
        "advanceTo",
        "set",
        "setAllowBackwards",
        "trySetAllowBackwards",
        "restrictRange",
        "sync",
        "tick",
        "validateTarget",
        "read",
    ];
    for op in ops {
        assert!(
            steps
                .iter()
                .any(|s| s.op_text.split(' ').next() == Some(op)),
            "no step runs {op}"
        );
    }
    let results = [
        "unit |",
        "instant ",
        "synced 0",
        "synced 1",
        "noWall",
        "err negativeDuration",
        "err overflow",
        "err outOfRange",
        "err noTimeSource",
        "err wouldMoveBackwards",
        "panic",
    ];
    for result in results {
        assert!(
            steps.iter().any(|s| s.expected.starts_with(result)),
            "no step results in {result}"
        );
    }
    for name in [
        "budget/exhaust",
        "finding/i128-top-steps-back",
        "finding/read-below-range-min",
        "panic/reading-minus-anchor",
        "panic/wall-anchor",
        "panic/publish-snapshot",
        "wall/stepped-back",
    ] {
        assert!(traces.iter().any(|t| t.name == name), "no trace {name}");
    }
    // Every mode, position and reading relation of the combinatorial part.
    for mode in ["new", "paused", "following"] {
        for pos in ["free", "inside", "atMax", "atMin", "top", "bottom"] {
            let prefix = format!("{mode}/{pos}/");
            assert!(
                traces.iter().any(|t| t.name.starts_with(&prefix)),
                "no trace {prefix}"
            );
        }
    }
    for rel in ["same", "forward", "back"] {
        let prefix = format!("following/inside/{rel}/");
        assert!(
            traces.iter().any(|t| t.name.starts_with(&prefix)),
            "no trace {prefix}"
        );
    }
}

/// The findings the Lean counterexamples state hold for the Rust clock too.
#[test]
fn a_read_steps_back_uncounted_once_the_drift_overflows_i128() {
    // VC.read_steps_back_at_the_i128_top
    let rig = Rig::new(0);
    let clock = build(Init::Following, i128::MAX - 10, 0, false, &rig);
    rig.set(5, 0);
    assert_eq!(clock.now().as_nanos(), i128::MAX - 5);
    rig.set(20, 0);
    assert_eq!(clock.now().as_nanos(), i128::MAX - 10);
    assert_eq!(clock.backwards_sets(), 0);
}

#[test]
fn a_read_can_fall_below_the_range_minimum_once_the_drift_overflows_i128() {
    // VC.read_below_the_range_minimum
    let rig = Rig::new(0);
    let mut clock = build(Init::Following, 10, 0, false, &rig);
    rig.set(10, 0);
    clock.restrict_range(at(15), at(100)).unwrap();
    rig.set(i128::MAX, 0);
    assert_eq!(clock.now().as_nanos(), 10);
}

// ---------------------------------------------------------------------------------------------
// Properties over random operation sequences (values far from the i128 edges, where the
// hypotheses of `reads_never_go_back` and `read_in_range` hold)

/// One generated step: how the reading moves, the operation kind, an offset from the instant
/// now for its target, the backwards flag and how the wall clock sits against the instant now.
#[derive(Debug, Clone, Copy)]
struct Gen {
    reading_delta: i128,
    kind: u8,
    offset: i128,
    allow: bool,
    wall_offset: i128,
}

fn gen_step() -> impl Strategy<Value = Gen> {
    (
        -20i128..40,
        0u8..14,
        -40i128..40,
        any::<bool>(),
        -30i128..30,
    )
        .prop_map(|(reading_delta, kind, offset, allow, wall_offset)| Gen {
            reading_delta,
            kind,
            offset,
            allow,
            wall_offset,
        })
}

fn make_op(g: Gen, now: i128) -> Op {
    let t = now + g.offset;
    match g.kind {
        0 => Op::Freeze,
        1 => Op::Resume,
        2 => Op::ResumeAt(t, g.allow),
        3 => Op::ResumeWall(g.allow),
        4 => Op::Advance(g.offset),
        5 => Op::AdvanceTo(t),
        6 => Op::Set(t),
        7 => Op::SetAllowBackwards(t),
        8 => Op::TrySetAllowBackwards(t),
        9 => Op::RestrictRange(t - 30, t + 60),
        10 => Op::Sync,
        11 => Op::Tick,
        12 => Op::ValidateTarget(t),
        _ => Op::Read,
    }
}

fn gen_init() -> impl Strategy<Value = Init> {
    prop_oneof![Just(Init::New), Just(Init::Paused), Just(Init::Following)]
}

const START: i128 = 1_800_000_000_000_000_000;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2048))]

    /// `never_backwards_uncounted`, `reads_never_go_back`, `refused_keeps_observation`,
    /// `frozen_stands_still`, `published_in_range`, `read_in_range` and `budget_monotone` on
    /// every step of a random run.
    #[test]
    fn every_step_keeps_the_proved_properties(
        init in gen_init(),
        steps in prop::collection::vec(gen_step(), 1..40),
    ) {
        let rig = Rig::new(0);
        let mut clock = build(init, START, 0, true, &rig);
        let mut reading = 0i128;
        let mut range: Option<(i128, i128)> = None;
        let mut last = observe(&clock).unwrap();
        for g in steps {
            reading += g.reading_delta;
            let before_read = clock.now().as_nanos();
            rig.set(reading, before_read + g.wall_offset);
            let before = observe(&clock).unwrap();
            // Between operations a later read never shows an earlier instant, even when the
            // reading steps back.
            prop_assert!(before.instant >= last.instant, "read went back: {last:?} -> {before:?}");
            prop_assert!(before.elapsed >= last.elapsed);
            if !before.following {
                prop_assert_eq!(before.instant, last.instant, "a frozen clock moved");
            }
            let op = make_op(g, before.instant);
            let res = apply(&mut clock, op);
            let after = observe(&clock).unwrap();
            if let (Op::RestrictRange(lo, hi), false) = (op, res.refused()) {
                range = Some(range.map_or((lo, hi), |(l, h)| (l.max(lo), h.min(hi))));
            }
            if res.refused() {
                prop_assert_eq!(after, before, "refused {:?} -> {:?} changed the clock", op, res);
            }
            if after.instant < before.instant {
                prop_assert!(op.allows_backwards(), "{:?} moved back uncounted", op);
                prop_assert_eq!(after.backwards, before.backwards + 1);
            } else {
                prop_assert_eq!(after.backwards, before.backwards);
            }
            if !before.following && !op.sets_instant() {
                prop_assert_eq!(after.instant, before.instant, "{:?} moved a frozen clock", op);
            }
            if let Some((lo, hi)) = range {
                prop_assert!(lo <= after.instant && after.instant <= hi,
                    "{} outside [{lo}, {hi}] after {:?}", after.instant, op);
            }
            prop_assert!(after.elapsed >= before.elapsed);
            prop_assert!(after.revision >= before.revision);
            prop_assert!(after.revision <= before.revision + 1);
            last = after;
        }
    }

    /// `freeze_then_resume_keeps_the_instant`, `freeze_idempotent` and `resume_idempotent`
    /// after a random run.
    #[test]
    fn freeze_and_resume_keep_the_instant_and_are_idempotent(
        init in gen_init(),
        steps in prop::collection::vec(gen_step(), 0..20),
        twice in any::<bool>(),
    ) {
        let rig = Rig::new(0);
        let mut clock = build(init, START, 0, true, &rig);
        let mut reading = 0i128;
        for g in steps {
            reading += g.reading_delta;
            let now = clock.now().as_nanos();
            rig.set(reading, now + g.wall_offset);
            let op = make_op(g, now);
            apply(&mut clock, op);
        }
        let before = observe(&clock).unwrap();
        let first = apply(&mut clock, Op::Freeze);
        let frozen = observe(&clock).unwrap();
        prop_assert_eq!(frozen.instant, before.instant);
        if twice {
            let second = apply(&mut clock, Op::Freeze);
            prop_assert_eq!(&second, &first);
            prop_assert_eq!(observe(&clock).unwrap(), frozen);
        }
        let resumed_first = apply(&mut clock, Op::Resume);
        let resumed = observe(&clock).unwrap();
        prop_assert_eq!(resumed.instant, before.instant);
        let resumed_second = apply(&mut clock, Op::Resume);
        prop_assert_eq!(&resumed_second, &resumed_first);
        prop_assert_eq!(observe(&clock).unwrap(), resumed);
    }
}
