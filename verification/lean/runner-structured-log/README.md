# Node runner structured log projection

This model starts with a bounded message and describes when a single argument becomes a structured log entry. It covers JSON root objects, recognized ASCII severity spellings, the decoded UTF-16 key/value checks, and the maximum accepted depth. The model treats JavaScript parsing and UTF-8 normalization as input assumptions. Its fixture instantiates those assumptions as actual JSON, including invalid objects, arrays, numbers, escaped lone surrogates, and valid surrogate pairs.

The Node replay enters through `createInvocationLogger`. It checks level, message and fields along with the invocation metadata. [The log bounds model](../runner-log-bounds/README.md) covers the preceding byte limit and normalization step.

```sh
lake build
lake exe corpus > ../../../tools/runner-node/tests/fixtures/lean-runner-structured-log.corpus
```

From the workspace root, run `node --test tools/runner-node/runner-structured-log-lean-corpus.test.mjs`.
