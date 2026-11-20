# Functions runner command frames in Lean 4

This model specifies the in-memory frame boundary in `crates/fireemu-adapter-functions/src/protocol.rs`. The prefix is an ASCII decimal UTF-8 byte count followed by a newline, with an eight-digit input limit and a 16 MiB length cap. The prefix decoder distinguishes clean EOF from a short prefix or bad length, and the body split leaves exactly the bytes needed by the next read. JSON parsing is delegated to the existing parser. Message dispatch, schema validation, child process I/O, and socket behavior are outside the model.

`FunctionsProtocolFrame/Theorems.lean` proves a successful header is independent of later bytes and respects its cap, that a complete payload leaves its suffix untouched, and that an incomplete payload is refused. It also checks that encoding preserves raw body bytes, the ninth length digit is refused, and the exact maximum reaches the body split.

`Main.lean` emits small hexadecimal in-memory streams for a header, body, and stream-layout matrix, with an additional exact-maximum header probe. The Rust replay compares exact raw-frame bytes from both encode and write, including member order and UTF-8 byte counts. It also compares consecutive parsed values, clean EOF, and I/O error classes for invalid or incomplete fixture frames.

From this directory:

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-functions/tests/fixtures/lean-functions-protocol-frame.corpus
```

From the repository root, run `cargo nextest run -p fireemu-adapter-functions --test functions_protocol_frame_lean_corpus`. The Rust replay uses the checked-in fixture alone.
