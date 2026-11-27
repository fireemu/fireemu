//! Virtual clock (spec 11.1, 11.2, ADR-004).
//!
//! The runtime never calls `SystemTime::now()`. Every session owns a `VirtualClock`; wall-clock
//! adapters for the `compat` profile live outside the core. A clock made with
//! [`VirtualClock::following_with`] counts the time a source reports since its last move, so it
//! runs at the pace of real time without the core ever reading the wall clock: the daemon passes
//! a wall-clock source, and [`VirtualClock::following`] a monotonic one.

use fireemu_core_types::determinism::Clock;
use fireemu_core_types::time::{LogicalDuration, LogicalInstant};
use std::sync::{Arc, Weak};
use std::time::Instant;

/// One reading of a following clock: the instant now, the drift it stands for and the forward
/// movement it counts.
#[derive(Clone, Copy)]
struct Sample {
    instant: LogicalInstant,
    /// Nanoseconds the source ran since the last move.
    drift: i128,
    /// Nanoseconds counted as elapsed: the drift, cut at the runtime range.
    counted: i128,
}

/// A reading of real time in nanoseconds, from any origin. Only differences are used.
pub type TimeSource = Arc<dyn Fn() -> i128 + Send + Sync>;

/// The wall clock's instant at a reading of the clock's [`TimeSource`], for a resume that jumps
/// to the current time. It maps the same reading the clock runs on, so the instant a sync judges
/// and the anchor it runs from come from one read.
pub type WallSource = Arc<dyn Fn(i128) -> LogicalInstant + Send + Sync>;

/// One reading of the wall clock ([`VirtualClock::read_wall`]): the instant, and the reading of
/// the time source it came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WallReading {
    /// The wall clock's instant at the reading.
    pub instant: LogicalInstant,
    reading: i128,
}

/// Thread-safe monotonic high-water drift tracker (`i128` precision, lock-free fast path).
///
/// Replaces `Cell<i128>` so `VirtualClock` is `Send + Sync` without sacrificing full `i128`
/// nanosecond range.
struct PeakDrift {
    fast: std::sync::atomic::AtomicI64,
    overflow: std::sync::Mutex<Option<i128>>,
}

impl PeakDrift {
    const OVERFLOW_SENTINEL: i64 = i64::MAX;

    const fn new(initial: i128) -> Self {
        if initial >= 0 && initial < Self::OVERFLOW_SENTINEL as i128 {
            #[allow(clippy::cast_possible_truncation)]
            let v = initial as i64;
            Self {
                fast: std::sync::atomic::AtomicI64::new(v),
                overflow: std::sync::Mutex::new(None),
            }
        } else {
            Self {
                fast: std::sync::atomic::AtomicI64::new(Self::OVERFLOW_SENTINEL),
                overflow: std::sync::Mutex::new(Some(initial)),
            }
        }
    }

    fn get(&self) -> i128 {
        let v = self.fast.load(std::sync::atomic::Ordering::Acquire);
        if v != Self::OVERFLOW_SENTINEL {
            return i128::from(v);
        }
        self.overflow
            .lock()
            .expect("peak drift lock")
            .unwrap_or(i128::from(Self::OVERFLOW_SENTINEL))
    }

    fn set(&self, value: i128) {
        if value >= 0 && value < i128::from(Self::OVERFLOW_SENTINEL) {
            #[allow(clippy::cast_possible_truncation)]
            let v = value as i64;
            let mut overflow = self.overflow.lock().expect("peak drift lock");
            *overflow = None;
            self.fast.store(v, std::sync::atomic::Ordering::Release);
        } else {
            let mut overflow = self.overflow.lock().expect("peak drift lock");
            *overflow = Some(value);
            self.fast.store(
                Self::OVERFLOW_SENTINEL,
                std::sync::atomic::Ordering::Release,
            );
        }
    }

    fn observe_max(&self, candidate: i128) -> i128 {
        if candidate <= 0 {
            return self.get();
        }
        if candidate < i128::from(Self::OVERFLOW_SENTINEL) {
            #[allow(clippy::cast_possible_truncation)]
            let c = candidate as i64;
            let current = self.fast.load(std::sync::atomic::Ordering::Acquire);
            if current != Self::OVERFLOW_SENTINEL {
                if c <= current {
                    return i128::from(current);
                }
                let prev = self.fast.fetch_max(c, std::sync::atomic::Ordering::AcqRel);
                if prev != Self::OVERFLOW_SENTINEL {
                    return i128::from(prev.max(c));
                }
            }
        }
        // Transition atomically to overflow mode under the mutex: `swap` claims the latest
        // lock-free value so no concurrent `fetch_max` update can be lost during handoff.
        let mut overflow = self.overflow.lock().expect("peak drift lock");
        let prev = self
            .fast
            .swap(Self::OVERFLOW_SENTINEL, std::sync::atomic::Ordering::AcqRel);
        let current = match (*overflow, prev) {
            (Some(v), _) => v,
            (None, Self::OVERFLOW_SENTINEL) => i128::from(Self::OVERFLOW_SENTINEL),
            (None, v) => i128::from(v),
        };
        let next = current.max(candidate);
        *overflow = Some(next);
        next
    }
}

impl Clone for PeakDrift {
    fn clone(&self) -> Self {
        Self::new(self.get())
    }
}

/// What a clock that follows real time counts: a source and its reading at the last move.
#[derive(Clone)]
struct Follow {
    source: TimeSource,
    at: i128,
    /// The most drift any read has reported since the last move, so that a source that steps
    /// back holds the clock where it was instead of taking it back.
    peak: PeakDrift,
}

/// One published clock state; elapsed time counts forward movement only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClockSnapshot {
    /// Current wall instant.
    pub instant: LogicalInstant,
    /// Positive nanoseconds consumed since creation within the checked u128 lifetime budget.
    pub elapsed_nanos: u128,
    /// Monotonic publication revision.
    pub revision: u64,
}

/// A nonblocking observer. Callbacks run under the owner's clock lock and must only publish
/// to a mailbox; they must never acquire service locks or invoke application work.
pub type ClockObserver = dyn Fn(ClockSnapshot) + Send + Sync;

/// Errors from clock manipulation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClockError {
    /// `advance` was called with a negative duration.
    NegativeDuration,
    /// The resulting instant or publication counters are not representable.
    Overflow,
    /// A configured runtime cannot represent the requested instant.
    OutOfRange,
    /// The clock has no real-time source to follow, so it cannot resume.
    NoTimeSource,
    /// The operation would move the clock backwards (INV-TIME-001).
    WouldMoveBackwards {
        /// Current instant.
        current: LogicalInstant,
        /// Requested instant.
        requested: LogicalInstant,
    },
}

impl core::fmt::Display for ClockError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::NegativeDuration => f.write_str("clock cannot advance by a negative duration"),
            Self::Overflow => f.write_str("clock instant overflow"),
            Self::OutOfRange => {
                f.write_str("clock instant is outside the configured runtime range")
            }
            Self::NoTimeSource => f.write_str("the clock has no real-time source to follow"),
            Self::WouldMoveBackwards { current, requested } => {
                write!(
                    f,
                    "clock would move backwards from {current} to {requested}"
                )
            }
        }
    }
}

impl std::error::Error for ClockError {}

/// A move refused by its plan or by the clock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MoveFromSampleError<E> {
    /// The plan could not produce a target.
    Plan(E),
    /// The clock could not publish the target.
    Clock(ClockError),
}

/// A deterministic clock that only moves when told to, or that runs on from its last move at
/// the pace of real time ([`VirtualClock::following`]).
pub struct VirtualClock {
    now: LogicalInstant,
    /// The real-time source and its reading when `now` was published, for a clock that follows
    /// real time.
    follow: Option<Follow>,
    /// The real-time source of a frozen clock, kept so that it can resume.
    paused: Option<TimeSource>,
    /// The wall clock, for a resume in sync with real time.
    wall: Option<WallSource>,
    backwards_sets: u32,
    elapsed_nanos: u128,
    revision: u64,
    observers: Vec<Weak<ClockObserver>>,
    range: Option<(LogicalInstant, LogicalInstant)>,
}

impl Clone for VirtualClock {
    fn clone(&self) -> Self {
        Self {
            now: self.now,
            follow: self.follow.clone(),
            paused: self.paused.clone(),
            wall: self.wall.clone(),
            backwards_sets: self.backwards_sets,
            elapsed_nanos: self.elapsed_nanos,
            revision: self.revision,
            observers: Vec::new(),
            range: self.range,
        }
    }
}

impl PartialEq for VirtualClock {
    fn eq(&self, other: &Self) -> bool {
        self.now == other.now && self.backwards_sets == other.backwards_sets
    }
}
impl Eq for VirtualClock {}

impl core::fmt::Debug for VirtualClock {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("VirtualClock")
            .field("now", &self.now)
            .field("backwards_sets", &self.backwards_sets)
            .field("elapsed_nanos", &self.elapsed_nanos)
            .field("revision", &self.revision)
            .field("range", &self.range)
            .finish_non_exhaustive()
    }
}

impl VirtualClock {
    /// Creates a clock at `start`.
    #[must_use]
    pub const fn new(start: LogicalInstant) -> Self {
        Self {
            now: start,
            follow: None,
            paused: None,
            wall: None,
            backwards_sets: 0,
            elapsed_nanos: 0,
            revision: 0,
            observers: Vec::new(),
            range: None,
        }
    }

    /// Creates a clock at `start` that keeps running at the pace of real time, measured by the
    /// monotonic clock. A move by hand (`advance`, `advance_to`, a set) is an offset on top:
    /// the clock runs on from where it lands.
    #[must_use]
    pub fn following(start: LogicalInstant) -> Self {
        Self::following_since(start, Instant::now())
    }

    /// [`Self::following`] for a clock that was at `start` when the monotonic clock read
    /// `since` (a clock that has already run for a while).
    #[must_use]
    pub fn following_since(start: LogicalInstant, since: Instant) -> Self {
        let source: TimeSource =
            Arc::new(move || i128::try_from(since.elapsed().as_nanos()).unwrap_or(i128::MAX));
        Self::following_with(start, source, 0)
    }

    /// A clock at `start` that runs with `source`, which read `reading` when the clock was at
    /// `start`. A source that steps back holds the clock until it catches up.
    #[must_use]
    pub fn following_with(start: LogicalInstant, source: TimeSource, reading: i128) -> Self {
        let mut clock = Self::new(start);
        clock.follow = Some(Follow {
            source,
            at: reading,
            peak: PeakDrift::new(0),
        });
        clock
    }

    /// Gives a frozen clock a real-time source to follow once it resumes. A clock that already
    /// follows one keeps it.
    #[must_use]
    pub fn with_time_source(mut self, source: TimeSource) -> Self {
        if self.follow.is_none() {
            self.paused = Some(source);
        }
        self
    }

    /// Gives the clock a wall clock: the instant at a reading of its time source.
    #[must_use]
    pub fn with_wall_clock(mut self, wall: WallSource) -> Self {
        self.wall = Some(wall);
        self
    }

    /// The time source, running or paused.
    fn time_source(&self) -> Option<&TimeSource> {
        self.follow
            .as_ref()
            .map(|follow| &follow.source)
            .or(self.paused.as_ref())
    }

    /// One reading of the wall clock, when the clock has a time source and a wall clock. Pass it
    /// to [`Self::resume_at_wall`] to sync to exactly this reading.
    #[must_use]
    pub fn read_wall(&self) -> Option<WallReading> {
        let wall = self.wall.as_ref()?;
        let reading = (self.time_source()?)();
        Some(WallReading {
            instant: wall(reading),
            reading,
        })
    }

    /// The wall clock's instant now, when the clock has one.
    #[must_use]
    pub fn wall_now(&self) -> Option<LogicalInstant> {
        self.read_wall().map(|wall| wall.instant)
    }

    /// Stops the clock at the instant now. The real time that passed since the last move is
    /// kept; none passes from here on until [`Self::resume`]. A frozen clock stays as it is.
    pub fn freeze(&mut self) -> Result<(), ClockError> {
        if self.follow.is_none() {
            return Ok(());
        }
        let sample = self.sample();
        self.check(sample.instant, &sample)?;
        // The mode changes before the observers are told, so that they see the new one.
        self.paused = self.follow.take().map(|follow| follow.source);
        self.publish(sample.instant, &sample, true);
        Ok(())
    }

    /// Lets a frozen clock run on from the instant now at the pace of real time. A running
    /// clock stays as it is.
    pub fn resume(&mut self) -> Result<(), ClockError> {
        if self.follow.is_some() {
            return Ok(());
        }
        let now = self.now;
        self.resume_at(now, false)
    }

    /// Moves the clock to `instant` and lets it run on from there at the pace of real time, as
    /// one publication. Going backwards needs `allow_backwards`, as for a set; a refused resume
    /// changes nothing.
    pub fn resume_at(
        &mut self,
        instant: LogicalInstant,
        allow_backwards: bool,
    ) -> Result<(), ClockError> {
        self.resume_to(instant, allow_backwards, None)
    }

    /// Moves the clock to the wall clock's instant at `wall` and lets it run on from that same
    /// reading: what is judged, where the clock lands and what it runs from are one read, so a
    /// clock already at the wall time is not refused and a synced clock does not lag.
    pub fn resume_at_wall(
        &mut self,
        wall: WallReading,
        allow_backwards: bool,
    ) -> Result<(), ClockError> {
        self.resume_to(wall.instant, allow_backwards, Some(wall.reading))
    }

    fn resume_to(
        &mut self,
        instant: LogicalInstant,
        allow_backwards: bool,
        reading: Option<i128>,
    ) -> Result<(), ClockError> {
        if self.follow.is_none() && self.paused.is_none() {
            return Err(ClockError::NoTimeSource);
        }
        // One sample, taken before a frozen clock starts to run, so that the resume lands at
        // the instant it was judged against.
        let sample = self.sample_at(reading);
        if instant < sample.instant && !allow_backwards {
            return Err(ClockError::WouldMoveBackwards {
                current: sample.instant,
                requested: instant,
            });
        }
        self.check(instant, &sample)?;
        if let Some(source) = self.paused.take() {
            let at = reading.unwrap_or_else(|| source());
            self.follow = Some(Follow {
                source,
                at,
                peak: PeakDrift::new(0),
            });
        }
        if instant < sample.instant {
            self.backwards_sets = self.backwards_sets.saturating_add(1);
        }
        if let (Some(reading), Some(follow)) = (reading, &mut self.follow) {
            // The clock lands at the wall instant of `reading` and runs from that reading, even
            // when the source stepped back below the high-water mark the sample held. The anchor
            // is set before the publication (which folds the sample's drift in), so the snapshot
            // the observers get and the high-water mark it records hold for every later read.
            follow.at = reading - sample.drift;
        }
        self.publish(instant, &sample, true);
        Ok(())
    }

    /// Whether the clock runs with real time.
    #[must_use]
    pub const fn is_following(&self) -> bool {
        self.follow.is_some()
    }

    /// Nanoseconds the clock has run since its last move (zero for a frozen clock).
    fn drift_nanos(&self, reading: Option<i128>, record_peak: bool) -> i128 {
        self.follow.as_ref().map_or(0, |follow| {
            let reading = reading.unwrap_or_else(|| (follow.source)());
            let candidate = reading - follow.at;
            if record_peak {
                follow.peak.observe_max(candidate)
            } else {
                candidate.max(follow.peak.get())
            }
        })
    }

    /// One reading of the running time, taken once per operation so that what an operation
    /// checks, counts and publishes all come from the same sample of the source.
    fn sample(&self) -> Sample {
        self.sample_with_record(None, true)
    }

    /// [`Self::sample`] at a given reading of the source, or a fresh one.
    fn sample_at(&self, reading: Option<i128>) -> Sample {
        self.sample_with_record(reading, true)
    }

    /// Read-only sample that does not mutate `Follow::peak`, used by previews so concurrent
    /// `snapshot()` calls never lose a higher observed peak.
    fn sample_peek(&self) -> Sample {
        self.sample_with_record(None, false)
    }

    fn sample_with_record(&self, reading: Option<i128>, record_peak: bool) -> Sample {
        let drift = self.drift_nanos(reading, record_peak);
        let mut instant = if drift == 0 {
            self.now
        } else {
            self.now
                .checked_add(LogicalDuration::from_nanos(drift))
                .unwrap_or(self.now)
        };
        // Reads stay inside the runtime range that writers are held to.
        if let Some((_, maximum)) = self.range {
            instant = instant.min(maximum);
        }
        Sample {
            instant,
            drift,
            counted: instant
                .as_nanos()
                .saturating_sub(self.now.as_nanos())
                .max(0),
        }
    }

    /// The instant now: the last move plus the real time that has passed since.
    fn live(&self) -> LogicalInstant {
        self.sample().instant
    }

    /// Publishes the running time to the observers when a following clock has moved since its
    /// last publication, so a schedule or a waiting task notices that time has passed.
    /// Returns whether anything was published; a frozen clock has nothing to publish.
    pub fn sync(&mut self) -> bool {
        if self.follow.is_none() {
            return false;
        }
        let sample = self.sample();
        if sample.instant <= self.now || self.check(sample.instant, &sample).is_err() {
            return false;
        }
        self.publish(sample.instant, &sample, true);
        true
    }

    /// Advances by `duration` and returns the new instant.
    pub fn advance(&mut self, duration: LogicalDuration) -> Result<LogicalInstant, ClockError> {
        if duration.as_nanos() < 0 {
            return Err(ClockError::NegativeDuration);
        }
        let sample = self.sample();
        let next = sample
            .instant
            .checked_add(duration)
            .ok_or(ClockError::Overflow)?;
        self.check(next, &sample)?;
        self.publish(next, &sample, true);
        Ok(next)
    }

    /// Advances to `instant`; rejects going backwards.
    pub fn advance_to(&mut self, instant: LogicalInstant) -> Result<LogicalInstant, ClockError> {
        let sample = self.sample();
        if instant < sample.instant {
            return Err(ClockError::WouldMoveBackwards {
                current: sample.instant,
                requested: instant,
            });
        }
        self.check(instant, &sample)?;
        self.publish(instant, &sample, true);
        Ok(instant)
    }

    /// Plans and publishes a move from one clock sample. The plan returns the target and
    /// whether it permits a rewind. A refused move leaves the clock unchanged.
    pub fn move_from_sample<E>(
        &mut self,
        plan: impl FnOnce(LogicalInstant) -> Result<(LogicalInstant, bool), E>,
    ) -> Result<LogicalInstant, MoveFromSampleError<E>> {
        let (sample, target, rewinds) = self.plan_from_sample(plan)?;
        if rewinds {
            self.backwards_sets = self.backwards_sets.saturating_add(1);
        }
        self.publish(target, &sample, false);
        Ok(target)
    }

    /// Validates a move against one sample and returns the target without publishing it.
    pub fn preview_move_from_sample<E>(
        &self,
        plan: impl FnOnce(LogicalInstant) -> Result<(LogicalInstant, bool), E>,
    ) -> Result<LogicalInstant, MoveFromSampleError<E>> {
        self.plan_from_sample(plan).map(|(_, target, _)| target)
    }

    fn plan_from_sample<E>(
        &self,
        plan: impl FnOnce(LogicalInstant) -> Result<(LogicalInstant, bool), E>,
    ) -> Result<(Sample, LogicalInstant, bool), MoveFromSampleError<E>> {
        let sample = self.sample_peek();
        let (target, allow_backwards) = plan(sample.instant).map_err(MoveFromSampleError::Plan)?;
        let rewinds = target < sample.instant;
        if rewinds && !allow_backwards {
            return Err(MoveFromSampleError::Clock(ClockError::WouldMoveBackwards {
                current: sample.instant,
                requested: target,
            }));
        }
        self.check(target, &sample)
            .map_err(MoveFromSampleError::Clock)?;
        Ok((sample, target, rewinds))
    }

    /// Sets the clock. Equivalent to `advance_to`: the default policy forbids going backwards.
    pub fn set(&mut self, instant: LogicalInstant) -> Result<LogicalInstant, ClockError> {
        self.advance_to(instant)
    }

    /// Sets the clock even if it moves backwards. Only allowed right after session creation
    /// or while idle; the caller is responsible for that check. The event is counted so that
    /// traces can flag it. A configured runtime range is still enforced; use
    /// `try_set_allow_backwards` to observe rejection.
    pub fn set_allow_backwards(&mut self, instant: LogicalInstant) {
        let _ = self.try_set_allow_backwards(instant);
    }

    /// Checked rewind for clocks with configured runtime representation bounds.
    pub fn try_set_allow_backwards(&mut self, instant: LogicalInstant) -> Result<(), ClockError> {
        let sample = self.sample();
        self.check(instant, &sample)?;
        if instant < sample.instant {
            self.backwards_sets = self.backwards_sets.saturating_add(1);
        }
        self.publish(instant, &sample, true);
        Ok(())
    }

    /// Restrict every writer, including fault delays and fixture ticks, to a runtime range.
    pub fn restrict_range(
        &mut self,
        minimum: LogicalInstant,
        maximum: LogicalInstant,
    ) -> Result<(), ClockError> {
        let (minimum, maximum) = self.range.map_or((minimum, maximum), |(low, high)| {
            (low.max(minimum), high.min(maximum))
        });
        let now = self.live();
        if minimum > maximum || now < minimum || now > maximum {
            return Err(ClockError::OutOfRange);
        }
        self.range = Some((minimum, maximum));
        Ok(())
    }

    /// Validate without changing the wall, elapsed, revision or observer state.
    pub fn validate_target(&self, instant: LogicalInstant) -> Result<(), ClockError> {
        self.check(instant, &self.sample())
    }

    /// [`Self::validate_target`] against one sample of the running time.
    fn check(&self, instant: LogicalInstant, sample: &Sample) -> Result<(), ClockError> {
        if self.revision == u64::MAX
            || (instant > sample.instant
                && self
                    .elapsed_nanos
                    .saturating_add(sample.counted.unsigned_abs())
                    .checked_add(instant.as_nanos().abs_diff(sample.instant.as_nanos()))
                    .is_none())
        {
            return Err(ClockError::Overflow);
        }
        if self
            .range
            .is_some_and(|(minimum, maximum)| instant < minimum || instant > maximum)
        {
            return Err(ClockError::OutOfRange);
        }
        Ok(())
    }

    /// Adds a weak observer and immediately publishes the initial state to it.
    pub fn observe(&mut self, observer: &Arc<ClockObserver>) {
        self.observers.push(Arc::downgrade(observer));
        observer(self.snapshot());
    }

    /// Current instant and monotonic timer/revision axes.
    #[must_use]
    pub fn snapshot(&self) -> ClockSnapshot {
        let sample = self.sample();
        ClockSnapshot {
            instant: sample.instant,
            elapsed_nanos: self
                .elapsed_nanos
                .saturating_add(sample.counted.unsigned_abs()),
            revision: self.revision,
        }
    }

    /// Moves the clock to `instant`, folding in elapsed time from `sample`. Existing writers also
    /// refresh the observer snapshot from the source after publication.
    fn publish(&mut self, instant: LogicalInstant, sample: &Sample, resample_observers: bool) {
        self.elapsed_nanos = self
            .elapsed_nanos
            .saturating_add(sample.counted.unsigned_abs());
        if instant > sample.instant {
            self.elapsed_nanos = self
                .elapsed_nanos
                .saturating_add(instant.as_nanos().abs_diff(sample.instant.as_nanos()));
        }
        self.now = instant;
        if let Some(follow) = &mut self.follow {
            // The drift just folded in is not counted again.
            follow.at += sample.drift;
            follow.peak.set(0);
        }
        self.revision = self.revision.saturating_add(1);
        let snapshot = if resample_observers {
            self.snapshot()
        } else {
            ClockSnapshot {
                instant,
                elapsed_nanos: self.elapsed_nanos,
                revision: self.revision,
            }
        };
        self.observers.retain(|weak| {
            let Some(observer) = weak.upgrade() else {
                return false;
            };
            observer(snapshot);
            true
        });
    }

    /// Current instant (same as [`Clock::now`]; convenient where the trait is not imported).
    #[must_use]
    pub fn now_for_test(&self) -> LogicalInstant {
        self.live()
    }

    /// Number of times the clock was explicitly moved backwards.
    #[must_use]
    pub const fn backwards_sets(&self) -> u32 {
        self.backwards_sets
    }

    /// Advances by one nanosecond. Fixture loaders use this so that documents created in
    /// sequence never share a create time unless a test asks for a tie (spec 8.9.10).
    pub fn tick(&mut self) -> Result<LogicalInstant, ClockError> {
        self.advance(LogicalDuration::from_nanos(1))
    }
}

impl Clock for VirtualClock {
    fn now(&self) -> LogicalInstant {
        self.live()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publication_budget_exhaustion_rejects_without_mutating_any_clock_axis() {
        let mut clock = VirtualClock::new(LogicalInstant::UNIX_EPOCH);
        clock.revision = u64::MAX;
        let before = clock.snapshot();
        assert_eq!(clock.tick(), Err(ClockError::Overflow));
        assert_eq!(clock.snapshot(), before);
        assert_eq!(
            clock.try_set_allow_backwards(LogicalInstant::from_nanos(-1)),
            Err(ClockError::Overflow)
        );
        assert_eq!(clock.backwards_sets(), 0);
        assert_eq!(clock.snapshot(), before);

        clock.revision = 0;
        clock.elapsed_nanos = u128::MAX - 1;
        let before = clock.snapshot();
        assert_eq!(
            clock.advance(LogicalDuration::from_nanos(2)),
            Err(ClockError::Overflow)
        );
        assert_eq!(clock.snapshot(), before);
        clock.tick().unwrap();
        assert_eq!(clock.snapshot().elapsed_nanos, u128::MAX);
        assert_eq!(clock.tick(), Err(ClockError::Overflow));
        // Rewinds and equal instants consume no elapsed budget.
        clock
            .try_set_allow_backwards(LogicalInstant::UNIX_EPOCH)
            .unwrap();
        clock.advance(LogicalDuration::ZERO).unwrap();
    }

    #[test]
    fn virtual_clock_is_send_and_sync_and_peak_drift_handles_overflow() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<VirtualClock>();

        let peak = PeakDrift::new(0);
        assert_eq!(peak.observe_max(42), 42);
        assert_eq!(peak.observe_max(10), 42);
        let huge = i128::from(i64::MAX) + 12345;
        assert_eq!(peak.observe_max(huge), huge);
        assert_eq!(peak.get(), huge);
        assert_eq!(peak.observe_max(huge - 1), huge);
        peak.set(7);
        assert_eq!(peak.get(), 7);
    }
}
