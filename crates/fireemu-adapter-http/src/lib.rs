//! HTTP shell (`AUTH-CORE-1`, `AUTH-MFA-TOTP-1`): the Identity Toolkit REST subset used by the
//! Firebase client and Admin SDKs, served over hyper. Handlers are pure functions over JSON so
//! that every flow is testable without a socket; [`server`] is the thin network glue.

pub mod app_check;
pub mod control;
pub mod identity_framing;
pub mod identity_toolkit;
pub mod oidc;
pub mod remote_config;
pub mod remote_config_client;
mod remote_config_client_conditions;
mod remote_config_conditions;
mod remote_config_defaults;
pub mod remote_config_http;
pub mod saml;
pub mod server;
pub mod signing;
pub mod storage;
pub mod storage_cors;
pub mod storage_production;
pub mod storage_server;
pub mod storage_signature;
pub mod storage_xml;

/// Host wall time, on which callers outside fireemu (the Admin SDK, test code with a real
/// `Date`) mint their times; see [`crate::CallerTimes`].
#[must_use]
pub fn host_wall_now() -> fireemu_core_types::time::LogicalInstant {
    let since_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    fireemu_core_types::time::LogicalInstant::from_nanos(
        i128::try_from(since_epoch.as_nanos()).unwrap_or(i128::MAX),
    )
}

/// `daemon.callerTimes`: how fireemu judges a time that a caller minted on its own clock, such
/// as the `iat` of an Admin SDK custom token, the date of a signed URL or a task `scheduleTime`
/// computed with the caller's `Date.now()`.
///
/// Production has one clock, so it judges such a time against its own. fireemu's clock can be
/// pinned or moved away from the host's wall time, where those callers mint their times; judged
/// against that clock alone, every such time fails. The development default accepts a time that
/// holds against either clock; `productionExact` restores the emulator clock alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CallerTimes {
    /// Judge against the emulator clock only, as production judges against its one clock.
    Clock,
    /// Accept a time that holds against the emulator clock or against host wall time.
    #[default]
    ClockOrWall,
}

impl CallerTimes {
    /// Whether `judge` accepts the time against the clock, or, under [`Self::ClockOrWall`],
    /// against wall time.
    pub fn holds(
        self,
        clock: fireemu_core_types::time::LogicalInstant,
        wall: fireemu_core_types::time::LogicalInstant,
        judge: impl Fn(fireemu_core_types::time::LogicalInstant) -> bool,
    ) -> bool {
        judge(clock) || (self == Self::ClockOrWall && judge(wall))
    }

    /// The configuration spelling (`"clock"` or `"clockOrWall"`).
    #[must_use]
    pub const fn as_config_str(self) -> &'static str {
        match self {
            Self::Clock => "clock",
            Self::ClockOrWall => "clockOrWall",
        }
    }
}

#[cfg(test)]
mod caller_times_tests {
    use super::CallerTimes;
    use fireemu_core_types::time::LogicalInstant;
    use proptest::prelude::*;

    proptest! {
        /// `clock` judges on the emulator clock alone; `clockOrWall` accepts exactly what either
        /// clock accepts, so it never refuses what `clock` accepts.
        #[test]
        fn caller_times_combine_the_two_clocks(
            clock in any::<i64>(),
            wall in any::<i64>(),
            lo in any::<i64>(),
            width in 0_i64..1_000_000,
        ) {
            let (lo, hi) = (
                LogicalInstant::from_unix_seconds(lo),
                LogicalInstant::from_unix_seconds(lo.saturating_add(width)),
            );
            let judge = |at: LogicalInstant| at >= lo && at <= hi;
            let c = LogicalInstant::from_unix_seconds(clock);
            let w = LogicalInstant::from_unix_seconds(wall);
            prop_assert_eq!(CallerTimes::Clock.holds(c, w, judge), judge(c));
            prop_assert_eq!(CallerTimes::ClockOrWall.holds(c, w, judge), judge(c) || judge(w));
        }
    }

    #[test]
    fn caller_times_default_and_spelling() {
        assert_eq!(CallerTimes::default(), CallerTimes::ClockOrWall);
        assert_eq!(CallerTimes::Clock.as_config_str(), "clock");
        assert_eq!(CallerTimes::ClockOrWall.as_config_str(), "clockOrWall");
        // A time only wall time accepts.
        let judge = |at: LogicalInstant| at == LogicalInstant::from_unix_seconds(2);
        let (c, w) = (
            LogicalInstant::from_unix_seconds(1),
            LogicalInstant::from_unix_seconds(2),
        );
        assert!(!CallerTimes::Clock.holds(c, w, judge));
        assert!(CallerTimes::ClockOrWall.holds(c, w, judge));
    }
}
