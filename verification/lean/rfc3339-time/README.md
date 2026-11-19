# RFC 3339 timestamps and civil dates in Lean 4

A Lean 4 specification of `LogicalInstant::parse_rfc3339`, `LogicalInstant::to_rfc3339`, `days_from_civil`, and `civil_from_days` in `crates/fireemu-core-types/src/time.rs`, with machine-checked properties and a golden corpus replayed through their public Rust API. The Rust build and tests do not need Lean.

## Layout

- `Rfc3339Time/Spec.lean` defines March-based Gregorian arithmetic, the Rust integer operations and conversion fallbacks, the timestamp parser, and the canonical UTC formatter.
- `Rfc3339Time/Theorems.lean` proves both civil inverses over mathematical integers, validity of the inverse, strict calendar ordering, and the corresponding checked Rust properties. The inverse proof checks the endpoints of each of the 400 March-based years with kernel `decide` and proves the intervening days by monotonicity. `civil_i64_never_clamps` proves the Rust inverse's conversions always fit.
- `Rfc3339Time/Text.lean` gives a declarative text grammar and proves exact acceptance, equal parsing for equivalent spellings, the UTC range in nanoseconds, formatting followed by parsing, and the exact format error.
- `Rfc3339Time/Axioms.lean` guards the theorem dependencies at build time.
- `Main.lean` defines the tab-separated corpus format and produces the corpus.

## Scope

The grammar uses four ASCII year digits, two ASCII digits for the other calendar and clock fields, `T` or `t`, an optional dot followed by one to nine digits, and `Z`, `z`, or a signed `HH:MM` offset no larger than 23:59. It checks the Gregorian date and the clock fields. The parser's cursor is a list of Unicode scalars. Only ASCII advances that cursor, so a failure position is the exact UTF-8 byte offset, including on non-ASCII input.

Formatting uses Euclidean division and remainder, prints nine fractional digits if the remainder is nonzero, and returns the computed year as its error when UTC is outside 0000–9999. The model uses unbounded integers for the widened calculations. Its public civil helper model also records the checked `i64` intermediates and the wrapping result when overflow checks are disabled. The calendar theorems require valid dates; the public forward helper evaluates its arithmetic on raw fields, so the corpus also includes out-of-range month and day fields.

## Findings

- `0000-01-01T00:00:00+00:01` parses to `-62167219260000000000` ns and then fails formatting with year `-1`. `9999-12-31T23:59:59-00:01` parses to `253402300859000000000` ns and fails formatting with year `10000`. The parser constrains the local year and the formatter constrains the UTC year. `parsed_in_range_formats` gives the condition for a parsed timestamp to format and retain its instant.
- `2016-12-31T23:59:60Z` is refused at byte 17 with `second 00-59`, including at a leap-second date.
- Day `9223372036854775807` converts to `(25252734927768524, 7, 27)`, but converting this valid date back overflows the checked era multiplication before the epoch subtraction. The following date, `(25252734927768524, 7, 28)`, wraps to `i64::MIN` when checks are disabled, reversing calendar order across those two dates. The checked inverse and checked ordering theorems require the intermediate results to fit.
- `(i64::MIN, 1, 1)` is a valid proleptic Gregorian date but overflows when the forward helper subtracts one from the January year with checks enabled.
- `(1970, 2, 30)` is outside the calendar theorem's validity hypothesis. The public civil helper evaluates it as day 60, which maps back to March 2. The RFC 3339 parser refuses that date.

## Open

None.

## Commands

The toolchain is pinned in `lean-toolchain`. From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-types/tests/fixtures/lean-rfc3339-time.corpus
```

The Rust side is `crates/fireemu-core-types/tests/rfc3339_lean_corpus.rs`. It checks the corpus count, replays each row through the four public functions, compares parse errors by byte offset and expectation, and exercises the proved properties with the crate's existing proptest dependency. The private wide civil conversion is exercised through formatting, including both `i128` extremes.
