# Auth phone normalization

This package models the formatted phone path and the raw E.164-shaped validator separately. Formatted input must begin with a literal plus. The normalizer removes the six supported ASCII separators, translates case-insensitive ASCII vanity letters, requires seven through fifteen decimal digits and refuses a leading zero. The raw validator admits a leading zero while refusing formatting and vanity characters.

The theorems establish that a successful normalization satisfies the raw validator and that supported separators contribute no digits. Concrete witnesses exercise the leading-zero distinction and a mixed-case vanity number. The corpus varies the prefix, output length, first normalized digit and invalid characters, then enumerates every ASCII letter. It records the exact normalized value and the independent validator outcome.

```sh
lake build
lake exe corpus | cmp - ../../../crates/fireemu-core-auth/tests/fixtures/lean-auth-phone-normalization.corpus
```

From the repository root:

```sh
cargo nextest run -p fireemu-core-auth --test auth_phone_normalization_lean_corpus
```
