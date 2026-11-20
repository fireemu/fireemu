# Shared percent, hexadecimal and JSON codecs in Lean 4

The percent reference translates complete ASCII hex escapes and records whether any malformed escape was encountered. A malformed percent remains visible and later bytes are still checked as usual, including form-mode plus handling. JSON escaping is specified independently for each Unicode scalar, with the two backspace and form-feed dialects. Hex decoding consumes exact pairs. The model compares raw percent bytes, before service-specific UTF-8 decoding.

The proofs show that percent decoding cannot grow the byte stream and that JSON escape output composes at arbitrary character boundaries. The corpus crosses escape form, plus policy and ASCII/Unicode context, checks all 256 escaped bytes, and covers every control scalar and the exact JSON wrapper.

~~~sh
lake build
lake exe corpus > ../../../crates/fireemu-core-types/tests/fixtures/lean-wire-codecs.corpus
cargo test -p fireemu-core-types --test wire_codecs_lean_corpus
~~~
