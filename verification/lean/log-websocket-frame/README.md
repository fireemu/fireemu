# Logging WebSocket framing in Lean 4

This package specifies the pure server frame encoder and XOR payload transform in `crates/fireemu-adapter-logging/src/wire.rs`. The server header sets FIN, uses the low opcode nibble and leaves the mask bit clear. It uses one, three, or nine length bytes for payloads below 126, below 65,536, or at least 65,536 bytes. The remaining length bytes are in network order. The payload is copied without modification. The mask transform applies a repeating position-indexed key.

## Proofs and coverage

The theorems establish big-endian field extent, the byte order of the two-byte field, minimum length-field width, opcode normalization, and payload preservation. The XOR theorem proves that applying the same mask at the same position twice yields the original payload for any key and sequence. The corpus crosses every encoder boundary with multiple opcodes and payload patterns, checks UTF-8 byte lengths and the fixed normal close, and compares the exact transformed bytes for short masks. The replay checks transmitted bodies as well as the generated headers.

This contract covers isolated wire helpers. It does not model handshake negotiation, network I/O, client receive validation, or the connection state machine.

## Reproduction

```sh
lake build
lake exe corpus > ../../../crates/fireemu-adapter-logging/tests/fixtures/lean-log-websocket-frame.corpus
```

From the repository root, run `cargo nextest run -p fireemu-adapter-logging --test log_websocket_frame_lean_corpus`. Each frame row supplies a length, opcode, payload recipe, and expected header bytes. Text and close rows have explicit payload bytes. Mask rows supply a length, payload recipe, and exact key and result bytes. The replay opens no socket and does not invoke Lean.
