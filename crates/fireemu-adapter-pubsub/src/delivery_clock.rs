//! The time delivery state is kept in: ack deadlines, retry backoff and push backoff.
//!
//! Those deadlines exist to pass. On a logical clock that stands still (`daemon.clock =
//! "frozen"`, a pinned `daemon.clockStart`, every `fireemu/testing` world) a deadline measured on
//! the logical clock alone never arrives, so an unacknowledged message is never redelivered and a
//! nack with a retry policy never comes back. The delivery clock is the logical clock plus the
//! wall time that passed while the logical clock stood still (not following real time), whether
//! or not it was moved by hand in that time. An interval between two readings counts in the mode
//! of the earlier one, so a freeze or resume in between does not reclassify it. On a clock that follows real time it is the logical
//! clock; on a still one it moves with wall time, and a move (`clock:advance`) moves it by the
//! same amount on top. A rewind starts it again at the rewound instant. Publish times and snapshot
//! lifetimes stay on the logical clock. Readings must be serialized with the update (the handle
//! reads the logical clock while it holds the delivery clock), or an older logical sample applied
//! after a newer one would look like a rewind.

use fireemu_core_types::time::{LogicalDuration, LogicalInstant};

/// The delivery clock's state between readings.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DeliveryClock {
    /// The logical instant at the last reading.
    logical: LogicalInstant,
    /// Wall time (nanoseconds on a monotonic scale) at the last reading.
    wall_nanos: u128,
    /// Wall time that passed while the logical clock stood still.
    offset_nanos: u128,
    /// Whether the logical clock stood still at the last reading: the interval up to the next
    /// reading counts in that mode, so a freeze or resume in between (which the next reading sees)
    /// does not reclassify the time before it.
    still: bool,
}

impl DeliveryClock {
    /// A delivery clock that starts at `logical`, read at `wall_nanos`, while the logical clock
    /// `stands_still` or not.
    pub(crate) const fn new(logical: LogicalInstant, wall_nanos: u128, stands_still: bool) -> Self {
        Self {
            logical,
            wall_nanos,
            offset_nanos: 0,
            still: stands_still,
        }
    }

    /// The delivery time for a reading of the logical clock at `logical`, of wall time at
    /// `wall_nanos`, and of whether the logical clock `stands_still` (does not follow real time).
    /// The wall time since the last reading counts when the clock stands still. It is never behind
    /// `logical` and never goes back while the logical clock does not.
    pub(crate) fn observe(
        &mut self,
        logical: LogicalInstant,
        wall_nanos: u128,
        stands_still: bool,
    ) -> LogicalInstant {
        if logical < self.logical {
            *self = Self::new(logical, wall_nanos, stands_still);
            return logical;
        }
        // The interval since the last reading ran in the mode of that reading (the outgoing
        // mode across a freeze or resume).
        let counted = self.still;
        self.still = stands_still;
        if counted {
            self.offset_nanos = self
                .offset_nanos
                .saturating_add(wall_nanos.saturating_sub(self.wall_nanos));
        }
        self.logical = logical;
        self.wall_nanos = self.wall_nanos.max(wall_nanos);
        self.at()
    }

    /// The delivery time at the last reading.
    fn at(&self) -> LogicalInstant {
        let offset =
            LogicalDuration::from_nanos(i128::try_from(self.offset_nanos).unwrap_or(i128::MAX));
        self.logical
            .checked_add(offset)
            .unwrap_or(LogicalInstant::MAX)
    }

    /// How far the delivery clock is ahead of the logical clock.
    pub(crate) fn offset(&self) -> LogicalDuration {
        LogicalDuration::from_nanos(i128::try_from(self.offset_nanos).unwrap_or(i128::MAX))
    }
}

#[cfg(test)]
mod tests {
    use super::DeliveryClock;
    use fireemu_core_types::time::LogicalInstant;
    use proptest::prelude::*;

    const SECOND: u128 = 1_000_000_000;

    #[test]
    fn a_frozen_clock_moves_with_wall_time_and_an_advance_moves_it_at_once() {
        let start = LogicalInstant::from_unix_seconds(1_767_225_600);
        let mut clock = DeliveryClock::new(start, 0, true);
        assert_eq!(clock.observe(start, 0, true), start);
        assert_eq!(
            clock.observe(start, 11 * SECOND, true),
            LogicalInstant::from_unix_seconds(1_767_225_611)
        );
        // An advance of an hour moves it by an hour; the 11 s counted so far are kept, and the
        // wall second before the advance was read counts too (the clock stood still).
        let advanced = LogicalInstant::from_unix_seconds(1_767_229_200);
        assert_eq!(
            clock.observe(advanced, 12 * SECOND, true),
            LogicalInstant::from_unix_seconds(1_767_229_212)
        );
        // On a clock that follows real time nothing is added.
        let mut following = DeliveryClock::new(start, 0, false);
        let later = LogicalInstant::from_unix_seconds(1_767_225_605);
        assert_eq!(following.observe(later, 5 * SECOND, false), later);
        // A rewind starts again from the rewound instant.
        let rewound = LogicalInstant::from_unix_seconds(1_767_000_000);
        assert_eq!(clock.observe(rewound, 22 * SECOND, true), rewound);
    }

    proptest! {
        /// Over any sequence of readings with wall time moving forward, against a reference
        /// model: the delivery clock is the logical clock plus the wall time between readings
        /// whose earlier reading saw the clock stand still (the mode in force through that
        /// interval), since the last rewind; so it is never behind the
        /// logical clock and never goes back unless the logical clock does.
        #[test]
        fn the_delivery_clock_matches_its_reference_model(
            steps in proptest::collection::vec(
                (0_i64..3, 0_u64..5_000_000_000, proptest::bool::ANY),
                1..40,
            ),
        ) {
            let mut logical = LogicalInstant::from_unix_seconds(1_000);
            let mut wall: u128 = 0;
            let mut clock = DeliveryClock::new(logical, wall, true);
            let mut previous_still = true;
            let mut offset: i128 = 0;
            let mut previous = logical;
            for (move_by, wall_step, still) in steps {
                let before = logical;
                wall += u128::from(wall_step);
                // 0 stands still, 1 advances a second, 2 rewinds a second.
                logical = match move_by {
                    0 => logical,
                    1 => LogicalInstant::from_nanos(logical.as_nanos() + 1_000_000_000),
                    _ => LogicalInstant::from_nanos(logical.as_nanos() - 1_000_000_000),
                };
                // The interval counts in the mode of the previous reading.
                if logical < before {
                    offset = 0;
                } else if previous_still {
                    offset += i128::from(wall_step);
                }
                previous_still = still;
                let at = clock.observe(logical, wall, still);
                prop_assert_eq!(at.as_nanos(), logical.as_nanos() + offset);
                prop_assert_eq!(clock.offset().as_nanos(), offset);
                prop_assert!(at >= logical);
                if logical >= before {
                    prop_assert!(at >= previous);
                }
                previous = at;
            }
        }
    }
}
