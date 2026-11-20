# Functions dotenv contracts

The Lean reference models reserved-key priority, ASCII key shape, exceptions to reserved prefixes, file precedence, and values whose quoting form is already known. Its theorems establish exact-key refusal, shape-before-prefix refusal, valid shape for accepted keys, placement of the local file, literal single quotes, and last-assignment precedence.

The Rust corpus checks key messages, file names, accepted values and strict errors. It includes all reserved exact keys, the prefix exceptions and their empty suffixes, bare comments, quoted hashes, escape expansion, three line endings, a multiline value and structured refusals. The model's value subset uses closed quoting and ASCII surrounding whitespace. Filesystem discovery, overlay between files and full parser recovery are outside the model.

```sh
lake build
lake exe corpus > ../../../crates/fireemu-core-functions/tests/fixtures/lean-functions-env.corpus
```
