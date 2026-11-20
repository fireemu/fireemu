# Configuration discovery precedence

The reference selects among canonical files in the working directory, the local Firebase file, and two ancestor Firebase files. It covers ambiguity before reading, nearer-file precedence, read failures at the chosen path and stopping conditions for a world-writable candidate or directory. Directory metadata and text reads are provided independently to the real discovery function.

The replayer uses synthetic paths and in-memory callbacks and checks the selected or skipped path, exact text or failure, and count of reads. Parent canonical files are present in the fixture and never selected. Platform filesystem operations, UID/SUDO trust calculations and alias discovery are outside this model.

```sh
lake build
lake exe corpus > ../../../crates/fireemu/tests/fixtures/lean-config-discovery.corpus
```
