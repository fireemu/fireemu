# Firestore index definition admission

The reference starts with normalized composite index definitions. It models the shared field capacity and single array-field restrictions, followed in deploy mode by the necessity check. The Lean theorems establish capacity priority, acceptance of a valid composite, scope independence and the single-document-name and vector exceptions.

The Rust fixtures use `IndexDefinition::check_capacity` and `IndexDefinition::check_necessary`, the production predicates that index-file loading and Admin requests share. The corpus compares both load profiles, both scopes, shape cases and the 100-field boundary. JSON parsing and normalization, search configuration and TTL directives are outside this model.

```sh
lake build
lake exe corpus > ../../../crates/fireemu/tests/fixtures/lean-firestore-index-config.corpus
```
