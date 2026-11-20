# Python runner JSON body layouts

The reference model covers the compact, Pub/Sub and Cloud Storage layouts in `tools/runner-python/fireemu_runner/bodies.py`. It retains number lexemes, applies each layout's object ordering, and writes the expected separators, indentation and final newline. Storage uses the resource field order at the root object and sorts nested keys. A Storage body with an array root keeps the source order of the objects it contains.

The checked theorems cover numeric spelling, empty aggregates, field permutation, compact source order, Pub/Sub and nested Storage lexical order, and Storage's known-field priority and lexical fallback. The 180-case corpus crosses layout, numeric spelling, object and array shape, and source order. Its inputs cover every ranked Storage field, unranked Unicode keys, nested arrays, empty aggregates and escaped text. A synthetic object under a ranked field exercises the generic writer's recursion on that path. The model uses bounded values, unique object keys and the string escapes used in these examples.

From this directory, build the proofs and regenerate the corpus.

```sh
lake build
lake exe corpus > ../../../tools/runner-python/tests/fixtures/lean-python-runner-wire-layout.corpus
```

From the repository root, replay the corpus through Python 3.10 or later.

```sh
PYTHONPATH=tools/runner-python python3 -m unittest discover -s tools/runner-python/tests -p test_lean_wire_layout.py
```
