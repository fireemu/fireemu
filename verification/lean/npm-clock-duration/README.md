# npm test-world clock requests

This package specifies the wire bodies produced by the npm test-world clock helper. It models plain inputs with unique enumerable keys, JavaScript safe integer validation, canonical unit order, omission of zero components, signed ISO duration assembly, and exact local validation priority. A legacy seconds or millis record retains its fields and object identity. A raw ISO duration or anchor string keeps its spelling for the daemon to interpret.

The guarded theorems cover unit order under zero elision, all-zero normalization, legacy dispatch and option rules, and validation precedence. The corpus crosses duration layouts, magnitudes, insertion orders, body shapes, anchors, and option presence. It includes conflicting errors, a fractional numeric millis body, and untouched fields on the legacy route.

```sh
lake build
lake exe corpus > ../../../npm/scripts/fixtures/lean-npm-clock-duration.corpus
```

From the repository root, replay the corpus with `node --test npm/scripts/testing-clock-lean-corpus.test.mjs`.
