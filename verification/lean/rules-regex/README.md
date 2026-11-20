# Security Rules full-match regexes in Lean 4

The specification describes whole-string matching on Unicode scalar values for the operator subset of `Regex::new` and `Regex::is_full_match` in `crates/fireemu-core-rules/src/regex.rs`. Lean proves the derivative matcher correct for every expression and subject. A golden corpus compares the Rust engine with the executable specification. The Rust implementation itself has no formal proof here.

## Scope

The grammar covers literals, quoted punctuation and space, dot, literal and inclusive-range character classes and their negations, concatenation, alternation, grouping, star, plus, optional and all three counted repetition forms. Empty branches and groups denote the empty word. A lazy suffix has the same full-match language. Anchors, flags, special groups, named classes, shorthand and numeric escapes, lone surrogate pieces, captures, replacement (`replace_all`), diagnostics and the execution step and depth budgets are outside the specification. A runtime budget error on a replay row fails the test.

Compilation checks the 2,048-byte UTF-8 limit before the separate nesting scan. The parser also checks the eight-group depth limit. A closing bracket in the first class-member position is literal, a trailing hyphen is literal, and reversed ranges are refused. Counted repetition starts only after an atom when an opening brace is followed by an ASCII digit. Hence `a{b}` matches the literal string `a{b}`, while `a{1` is refused. Bounds are parsed as natural numbers and checked against 1,000. Decimal overflow in Rust necessarily exceeds that limit and has the same refusal verdict.

## Layout and proofs

- `RulesRegex/Spec.lean` defines a language as a predicate on lists of characters. Concatenation splits a word into two factors. Star takes a finite sequence of nonempty factors, since deleting empty factors preserves their concatenation. Counted repetition permits empty required factors.
- `RulesRegex/Theorems.lean` proves `nullable_iff` for the empty word and `deriv_iff` for removal of one leading character. Their induction gives `matches_iff` for every word. `steps_eq_length` counts the derivative calls made by the recursion, including on dead states. The cost of each derivative depends on the expression.
- `copies_lang`, `optional_lang`, `bounded_expansion` and `open_expansion` relate the expanded expressions to factorizations. A finite upper bound has the form `lo + extra`. After the required factors, any count from zero through `extra` is allowed. An open upper bound permits a star tail.
- `RulesRegex/Parser.lean` compiles the scoped surface syntax into these expressions. `RulesRegex/Axioms.lean` guards the dependencies of every theorem. The Lake project uses only the pinned Lean toolchain.
- `Main.lean` generates the fixture and documents its encoding. The Rust integration test replays compilation and matching through the public API. Its proptests exercise nullability, denotation, one-character residuals and repetition expansion. The recursion count is specific to Lean's matcher.

## Findings

- `a{2,1}` is refused even on `aa`. Unchecked expansion would accept that subject because natural subtraction saturates at zero. `inverted_bounds_refused` pins the distinction, and `bounded_expansion` requires ordered bounds.
- Dot matches a singleton exactly when its scalar differs from LF (`dot_singleton`). The input consisting of a single LF is a counterexample to unconditional singleton matching (`dot_refuses_lf`). CR and non-BMP scalars are positive corpus cases.

### Fixed

- 2026-11-20. The nesting scan consumes a single negation caret at the start of a class. `[^^][](((((((((]` compiles and matches `a(`. `class_preflight_agrees_on_class_end` proves that the scan resumes at the suffix returned by the class parser for the regression cases. `compile_of_guards` gives parser equivalence when the byte and nesting checks pass.

## Commands

From this directory, build the proofs and regenerate the golden corpus:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-rules/tests/fixtures/lean-rules-regex.corpus
```

The Rust replay and property tests are in `crates/fireemu-core-rules/tests/regex_lean_corpus.rs`. The integration test target is `regex_lean_corpus` in package `fireemu-core-rules`.
