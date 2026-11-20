# Functions fixed-offset schedules

The reference enumerates eligible civil minutes directly. It covers five-field cron with selected minutes and hours, a single optional day-of-month, weekday or month, and epoch-anchored positive intervals. The corpus covers both restricted day selectors, Sunday spelled `7`, a fixed offset with a seconds component, zero count cap, negative Unix time and the nanosecond edges of a run. Its finite reference horizon contains the next occurrence for every supplied schedule.

`FunctionsCron/Spec.lean` defines civil matching and window membership. `FunctionsCron/Theorems.lean` proves the day-selector disjunction, the exclusive/inclusive endpoints, the enumeration cap, the exact and lower-bound count rules, and the interval quotient boundaries. `FunctionsCron/Axioms.lean` checks the dependencies of those proofs.

The Rust replay compares the next run, first five window runs, latest run, and exact or lower-bound count for every case. This model covers fixed offsets and the represented selectors. Time-zone transitions, broader schedule grammar, overflow limits, and runtime dispatch are outside the model.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-functions/tests/fixtures/lean-functions-cron.corpus
```
