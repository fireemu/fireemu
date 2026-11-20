# RTDB forwarding preparation in Lean 4

This model specifies the pure input preparation in [database.rs](../../../crates/fireemu-adapter-ui/src/database.rs). Its inputs are an action, an HTTP method, a query, the body length, and the known sessions and endpoint mapping. The output is the status and error message or the complete target plan. The Rust replay checks the original body bytes as well.

The query reference separates percent-decoding from path encoding and preserves a literal plus. It models the second query layer for permitted data options and their sorted output. Proofs characterize rule methods, configured ownership precedence, anonymous action privilege, and refusal of oversize bodies before query parsing. The endpoint fixture also checks that loopback mapping preserves the port and address family.

The corpus crosses action, method, body, and target. Curated rows exercise UTF-8, duplicate decoded keys, query precedence, path encoding, and configured/default namespace resolution. Its trusted session and namespace inputs are local fixture values. Browser origin checks, discovered membership, header generation, and request delivery are separate stages outside this model. The replay opens no sockets.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-ui/tests/fixtures/lean-ui-rtdb-forwarding.corpus
```

Run `cargo nextest run -p fireemu-adapter-ui -E 'binary(ui_rtdb_forwarding_lean_corpus)'` from the repository root.
