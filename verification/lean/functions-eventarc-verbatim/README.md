# Eventarc sentinel channel admission

The model distinguishes the outer JavaScript-style truthiness check from the sentinel channel's subsequent requirement for a string type. An empty string passes the latter conversion when invoked directly, while publication refuses it first. Truthy nonstrings pass the outer check without making a deliverable event.

The reference describes the projection of one filter attribute from a top-level string or the nested attributes object. It covers an empty top-level string, a nonstring top-level member, plain nested strings, the string and timestamp wrappers, and malformed wrappers. The replayer checks the exact diagnostic and verifies that the delivered event equals the original JSON with no raw-data override. Transport, credentials, strict custom-event conversion, and live registry mutation are outside this package.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-functions-eventarc-verbatim.corpus
```

From the workspace root:

```sh
cargo nextest run -p fireemu-adapter-functions --test functions_eventarc_verbatim_lean_corpus
```
