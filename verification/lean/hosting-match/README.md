# Hosting rule matching

The reference models literal segments, whole-segment asterisks, globstars, explicit dotted literals, slash runs, empty path parts, comments, negation and case-sensitive literal regexes. It distinguishes the two profile rules for dots and trailing empty parts. Selection uses the first nonempty `glob` or `source` and falls back to `regex` when both are empty.

The Lean theorems cover rule precedence, first-match order, the dot shield and a trailing empty component. The Rust replay invokes the unchanged matcher for each rule and checks the first matching position for ordered lists. Other glob grammar, redirect interpolation, filesystem asset lookup and HTTP dispatch are outside this model.

```sh
lake build
lake exe corpus > ../../../crates/fireemu/tests/fixtures/lean-hosting-match.corpus
```
