# Python runner event data source selection

The reference model for `tools/runner-python/fireemu_runner/framing.py` works with decoded object member names, their source spellings and the local delimiter after a decoded value. It selects the first matching `event` and `data` members and keeps the original data text. A comma or closing brace after the value suffices for the slicer, even if the outer object suffix is missing. The frame reader separately requires a complete JSON message and preserves the slice for supported triggers when the parsed event has a `data` member.

The checked theorems cover first-member priority, skipped and escaped key spellings, non-object events, the local delimiter rule and frame attachment. The corpus has 420 direct slicer cases and 100 complete frame cases. It includes duplicate keys where source selection and the parsed event differ, UTF-8, escape spellings, interior whitespace and truncated input. The model assumes that a value's source and following delimiter have already been identified. The Python replay exercises that identification and the frame reader using in-memory byte streams.

From this directory, build the proofs and regenerate the corpus.

```sh
lake build
lake exe corpus > ../../../tools/runner-python/tests/fixtures/lean-python-runner-event-data.corpus
```

From the repository root, replay the corpus through Python 3.10 or later.

```sh
PYTHONPATH=tools/runner-python python3 -m unittest discover -s tools/runner-python/tests -p test_lean_event_data.py
```
