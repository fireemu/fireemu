# Functions trigger selection in Lean 4

The specification projects an ordered manifest into nonblocking dispatches and a single Blocking Auth target. The model covers Firestore event kind, database and the tested single-segment capture; Storage event and default bucket resolution; exact Pub/Sub topics and Auth event kinds; Eventarc's short and full channel spellings, event type and attribute conjunction; and Blocking Auth's ordered selection and refusal cases.

The proofs characterize which functions are selected and show that filter order composes with append and reversal. Disabled blocking hooks stay disabled, discovery picks the first matching entry, and an explicit target with the wrong event fails before region matching. The bounded corpus replays each family in both manifest orders, including an explicitly ambiguous name constructed after validation. Firestore's general path language and manifest validation are separate contracts.

Regenerate the fixture with the pinned Lean toolchain.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-functions-trigger-selection.corpus
```

Run the Rust replay from the workspace root.

```sh
cargo nextest run -p fireemu-adapter-functions -E 'binary(functions_trigger_selection_lean_corpus)'
```
