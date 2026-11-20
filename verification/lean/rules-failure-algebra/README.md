# Security Rules boolean failure algebra

The model covers one concrete Firestore get evaluated against one matching allow, with a flat chain of boolean `&&` or `||` operands. An absorbing boolean stops the chain. Missing-resource and checked arithmetic errors are recoverable if a later operand decides the value. An unsupported document read stops this chain immediately. The model also records whether a missing resource was read before evaluation stopped.

`RulesFailureAlgebra/Spec.lean` proves that an absorbing operand skips its suffix, a recoverable prefix cannot prevent an absorbing answer, a missing read is still observed, an unsupported operand has precedence over a later absorber, and an all-neutral chain returns its identity. The guarded theorems are checked by the default build.

The observations are a fragment of `Evaluator::binary`, `evaluate_allows`, and the public `EvaluationReport` in `crates/fireemu-core-rules/src/eval.rs`. Expression budgets, multiple allows, query proof errors, and fine-grained diagnostics for soft errors are outside the model.

## Replay

The corpus exhausts conjunction and disjunction with three operands drawn from true, false, missing resource, division by zero, and unsupported document access. Each row contains the operator, the three operand tags, the public decision classes of the expression and its negation, and the missing-resource observation. Negation distinguishes a deferred error from a returned false. The replayer loads Rules text and checks both outputs.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-rules/tests/fixtures/lean-rules-failure-algebra.corpus
cargo test -p fireemu-core-rules --test rules_failure_algebra_lean_corpus
```
