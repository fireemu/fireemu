# Auth Base32 in Lean 4

This package specifies the Auth TOTP Base32 codec in `crates/fireemu-core-auth/src/base32.rs`. The reference uses a list of bits with independent five-bit symbol and eight-bit octet grouping. The encoder uses the RFC 4648 alphabet and pads to eight-character boundaries. The decoder is case-insensitive, stops at the first equals sign, and discards an incomplete last octet. A failure reports the first invalid character before that sign. Every preceding symbol is ASCII, so its character index is also the Rust byte offset.

## Proofs and coverage

The model proves group lengths, eight-symbol padding alignment, and independence from any suffix following the first equals sign. `Axioms.lean` guards the permitted axioms. The fixture includes all octets, the standard ASCII examples spanning all residual input lengths, multiple blocks, lowercase and mixed case, and malformed or incomplete inputs. Decoder tolerance is a property of this helper. Canonical token validation for any wider protocol is outside the model.

## Reproduction

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-auth/tests/fixtures/lean-auth-base32.corpus
```

From the repository root, run `cargo nextest run -p fireemu-core-auth --test auth_base32_lean_corpus`. Encoding rows contain input hexadecimal and expected text. Decoding rows include the case tags, input text, and exact output bytes or invalid byte offset. The replay handles every line after the declared row count and uses no Lean executable.
