# Security Rules lexical function selection

This reference models lookup of a named function through its lexical scopes. The parser rejects repeated declarations in a block. For admitted rulesets, the search stops at the closest enclosing block with a matching function. A wrapper's function calls use its declaration scope even if a caller in a nested match block has a shadowing function.

The checked cases compile and evaluate Rules text with two nested match scopes, a wrapper declared before its helper, and an optional sibling declaration. They exercise duplicate declaration refusal, successful return values, and the exact undefined cause for a missing function. The model covers ordinary function selection in a parsed ruleset. Cache planning for edited ASTs, evaluation budgets, parameter evaluation, and recursion are separate runtime contracts.

## Replay

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-rules/tests/fixtures/lean-rules-lexical-functions.corpus
cargo nextest run -p fireemu-core-rules --test rules_lexical_functions_lean_corpus
```
