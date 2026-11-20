import AuthSignupQuota.Theorems

/-- info: 'AuthSignupQuota.in_half_open_hour' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthSignupQuota.in_half_open_hour

/-- info: 'AuthSignupQuota.ends_exclude_start_plus_duration' depends on axioms: [propext] -/
#guard_msgs in #print axioms AuthSignupQuota.ends_exclude_start_plus_duration

/-- info: 'AuthSignupQuota.enforce_admits_below_limit' depends on axioms: [propext] -/
#guard_msgs in #print axioms AuthSignupQuota.enforce_admits_below_limit

/-- info: 'AuthSignupQuota.observe_does_not_refuse' depends on axioms: [propext] -/
#guard_msgs in #print axioms AuthSignupQuota.observe_does_not_refuse

/-- info: 'AuthSignupQuota.tracked_release_reverses_reserve' depends on axioms: [propext] -/
#guard_msgs in #print axioms AuthSignupQuota.tracked_release_reverses_reserve

/-- info: 'AuthSignupQuota.tracked_commit_preserves_total' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms AuthSignupQuota.tracked_commit_preserves_total

/-- info: 'AuthSignupQuota.consumed_token_cannot_commit' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthSignupQuota.consumed_token_cannot_commit

/-- info: 'AuthSignupQuota.stale_token_releases_usage' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms AuthSignupQuota.stale_token_releases_usage
