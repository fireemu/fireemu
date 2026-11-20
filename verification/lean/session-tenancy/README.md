# Session tenancy

The model specifies registration refusal order, atomic refusal, bucket ownership, API key lookup and the complementary default scope. A registered project can claim a key also declared by the default project. Such a key is visible to both ownership queries, and it is accepted by the default-key policy. Conventional bucket prefixes take precedence when recognized, while an unknown prefix falls through to explicit ownership or the default project.

Each fixture starts from a prepared tenancy and attempts one registration before unregistering the proposed project. The Rust replayer checks the exact refusal, both state snapshots, and the original object's equality after a refusal. Snapshots include sorted declared buckets, first keys, API key decisions, owners and scope membership. This model covers the in-memory tenancy decision. Request authentication and adapter-specific routing are outside its scope.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-session/tests/fixtures/lean-session-tenancy.corpus
```

From the repository root, run `cargo test -p fireemu-core-session --test session_tenancy_lean_corpus`.
