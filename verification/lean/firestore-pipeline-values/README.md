# Firestore Pipeline scalar comparison and membership

This model describes the scalar fragment of [Pipeline expression evaluation](../../../crates/fireemu-core-firestore/src/pipeline_exec.rs). Its reference uses a domain and an exact order coordinate. Integral values and exactly representable half-unit floats can share a coordinate. NaN is its own comparable domain, while missing and null are distinct. An absent field compares equal only to another absent field, but membership of an absent field in an array is always false. Explicit null can be an array element.

Lean proves that comparison equality is a symmetric and transitive key equivalence, inequality is its complement, integer and double representations share equivalence when they have the same exact magnitude, and missing differs from explicit null in both comparison and membership. It also checks incomparability of NaN and infinities. Every stated theorem has an axiom guard.

The generated corpus crosses six comparisons, a finite set of scalar inputs, and three array-membership functions. Inputs include signed zero, distinct NaN payloads, opposite infinities, missing fields and adjacent integers around the double precision boundary. The Rust replay executes actual Pipeline expressions in both profiles, and checks scalar equality against the public canonical comparator. Arbitrary double exponents, nested values, type errors and other Pipeline functions remain separate contracts.

## Commands

```sh
cd verification/lean/firestore-pipeline-values
lake build
lake exe corpus > ../../../crates/fireemu-core-firestore/tests/fixtures/lean-firestore-pipeline-values.corpus
cd ../../..
cargo nextest run -p fireemu-core-firestore --test firestore_pipeline_values_lean_corpus
```
