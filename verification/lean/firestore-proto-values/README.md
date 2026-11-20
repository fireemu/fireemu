# Firestore protobuf value representation

This model covers the gRPC adapter [value decoder](../../../crates/fireemu-adapter-grpc/src/decode.rs) and [encoder](../../../crates/fireemu-adapter-grpc/src/encode.rs). It distinguishes an exact vector sentinel from a map with a near-miss type, payload or additional field. Fallback map refusal follows key order. Ordinary nested maps and arrays count toward the depth bound. A valid vector sentinel is a leaf at this boundary.

Lean proves vector marker and extra-key requirements, reserved-name precedence, timestamp range and validation order, the depth boundary and rejection of a non-finite latitude. Corpus rows exercise exact wire choices at the public Rust seam, including unset and unsupported oneofs, the null-enum normalization, NaN payload and signed-zero preservation, and selected integer widening. Timestamp and geographical inputs exercise both edges. The Rust replay compares exact vector component bits and typed diagnostics. The model covers decoded protobuf messages rather than serialized field order, context-specific write validity or arbitrary IEEE conversion.

## Commands

```sh
cd verification/lean/firestore-proto-values
lake build
lake exe corpus > ../../../crates/fireemu-adapter-grpc/tests/fixtures/lean-firestore-proto-values.corpus
cd ../../..
cargo nextest run -p fireemu-adapter-grpc --test firestore_proto_values_lean_corpus
```
