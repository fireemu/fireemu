# Realtime Database node hashes in Lean 4

The model constructs the hash preimage of a leaf or child collection. It prefixes the optional priority, renders leaf values with their type tags, encodes numbers as fixed-width hexadecimal binary64 bits, and joins child digests by priority and key. The corpus assigns explicit ordering ranks to its sample children, including a numeric key and a supplementary Unicode key that sorts before a private-use BMP key. It generates the final digest by computing SHA-1 and standard padded Base64 in Lean. The `abc` and empty SHA-1 vectors check that primitive independently of the Rust replay.

The proofs state fixed-width hexadecimal rendering, equal preimages for an integer and its widened binary64 bits, key order as the tie-breaker at equal priority, and composition of adjacent preimage fragments. The corpus compares exact public hashes and includes an absent tree, a synthetic selection supplied in reverse iteration order, a nested parent, signed zero, a large rounded integer and the largest finite double. It models the preimage and test-vector algorithm without proving cryptographic properties of SHA-1.

## Reproduce

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-database/tests/fixtures/lean-rtdb-node-hash.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-database --test rtdb_node_hash_lean_corpus`.
