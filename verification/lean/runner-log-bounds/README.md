# Runner log byte bounds in Lean 4

The reference normalizes UTF-16 units to Unicode scalars, combines valid surrogate pairs and replaces lone surrogates. Its input is the text after JavaScript string coercion and a nonnegative integer byte budget. The clipping rule selects the longest fitting scalar prefix, reserves bytes for the truncation marker when required, and uses a partial marker when the budget is smaller than the marker itself.

The theorems give the output byte bound, exact output for fitting text, and the prefix and maximality laws for clipping. Normalization examples cover a supplementary scalar and lone surrogate units. The corpus uses explicit UTF-16 units to avoid relying on fixture decoding to preserve malformed input. The Node replay compares exact UTF-8 bytes. Structured log parsing and console formatting belong to other contracts.

From this directory, regenerate the corpus as follows.

~~~sh
lake build
lake exe corpus > ../../../tools/runner-node/tests/fixtures/lean-runner-log-bounds.corpus
cd ../../..
node --test tools/runner-node/runner-log-bounds-lean-corpus.test.mjs
~~~
