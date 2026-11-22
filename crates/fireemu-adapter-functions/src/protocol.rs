//! Runner protocol (spec 12.2): length-prefixed JSON frames over the child's stdin / stdout.
//!
//! ```text
//! <decimal byte length>\n<JSON payload>
//! ```
//!
//! Runtime → runner: `{"type":"invoke", ...}`, `{"type":"shutdown"}`.
//! Runner → runtime: `{"type":"hello","runner":"node","httpPort":N,"manifest":{...}}`,
//! `{"type":"result","invocationId":"...","ok":true|false,"error":"..."}`,
//! `{"type":"log","level":"info","message":"...","fields":{},"invocationId":"...","functionName":"...","user":true}`.

use serde_json::Value;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};

/// Maximum accepted frame (an invocation carries at most one document pair plus metadata).
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const MAX_FRAME_LENGTH_DIGITS: usize = 8;

/// Encodes one JSON frame from a `Value` or `RawValue`, retaining raw member order.
#[must_use]
pub fn encode_frame(v: &impl std::fmt::Display) -> Vec<u8> {
    let payload = v.to_string().into_bytes();
    let mut out = format!("{}\n", payload.len()).into_bytes();
    out.extend_from_slice(&payload);
    out
}

/// Reads one frame; `Ok(None)` at a clean end of stream.
pub async fn read_frame<R: AsyncBufRead + Unpin>(reader: &mut R) -> std::io::Result<Option<Value>> {
    let Some(len) = read_frame_length(reader).await? else {
        return Ok(None);
    };
    read_frame_payload(reader, len).await
}

/// Reads a frame whose entire payload may already be buffered.
pub(crate) async fn read_buffered_frame<R: AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
) -> std::io::Result<Option<Value>> {
    // When a new read is needed, keep the ordinary prefix path. Consecutive frames
    // already in the reader can consume their prefix in one pass.
    let len = if reader.buffer().is_empty() {
        let Some(len) = read_frame_length(reader).await? else {
            return Ok(None);
        };
        len
    } else {
        let (mut len, mut digits) = (0, 0);
        loop {
            let bytes = reader.fill_buf().await?;
            if bytes.is_empty() {
                return eof_after_prefix(digits);
            }
            let (consumed, result) = scan_prefix(bytes, &mut len, &mut digits);
            reader.consume(consumed);
            if let Some(result) = result {
                result?;
                break len;
            }
        }
    };
    if let Some(payload) = reader.buffer().get(..len) {
        let decoded = decode_payload(payload);
        reader.consume(len);
        decoded
    } else {
        read_frame_payload(reader, len).await
    }
}

fn scan_prefix(
    available: &[u8],
    len: &mut usize,
    digits: &mut usize,
) -> (usize, Option<std::io::Result<()>>) {
    for (offset, byte) in available.iter().copied().enumerate() {
        match parse_length_byte(byte, len, digits) {
            Ok(false) => (),
            result => return (offset + 1, Some(result.map(|_| ()))),
        }
    }
    (available.len(), None)
}

fn eof_after_prefix<T>(digits: usize) -> std::io::Result<Option<T>> {
    if digits == 0 {
        Ok(None)
    } else {
        Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof))
    }
}

fn parse_length_byte(byte: u8, len: &mut usize, digits: &mut usize) -> std::io::Result<bool> {
    match byte {
        b'\n' if *digits > 0 => Ok(true),
        b'0'..=b'9' if *digits < MAX_FRAME_LENGTH_DIGITS => {
            *len = *len * 10 + usize::from(byte - b'0');
            *digits += 1;
            if *len > MAX_FRAME_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("frame of {len} bytes exceeds {MAX_FRAME_BYTES}"),
                ));
            }
            Ok(false)
        }
        _ => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "malformed frame length",
        )),
    }
}

async fn read_frame_length(
    reader: &mut (impl AsyncRead + Unpin),
) -> std::io::Result<Option<usize>> {
    let (mut len, mut digits) = (0, 0);
    loop {
        let mut byte = [0; 1];
        if reader.read(&mut byte).await? == 0 {
            return eof_after_prefix(digits);
        }
        if parse_length_byte(byte[0], &mut len, &mut digits)? {
            return Ok(Some(len));
        }
    }
}

async fn read_frame_payload(
    reader: &mut (impl AsyncRead + Unpin),
    len: usize,
) -> std::io::Result<Option<Value>> {
    let mut payload = vec![0; len];
    reader.read_exact(&mut payload).await?;
    decode_payload(&payload)
}

fn decode_payload(payload: &[u8]) -> std::io::Result<Option<Value>> {
    serde_json::from_slice(payload)
        .map(Some)
        .map_err(|e| std::io::Error::other(format!("malformed frame JSON: {e}")))
}

/// Writes one JSON frame from a `Value` or `RawValue`.
pub async fn write_frame<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    v: &impl std::fmt::Display,
) -> std::io::Result<()> {
    writer.write_all(&encode_frame(v)).await?;
    writer.flush().await
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, ErrorKind};

    use tokio::io::BufReader;

    use super::{encode_frame, read_frame};

    #[tokio::test]
    async fn length_prefix_rejects_excess_digits_without_reading_the_line() {
        let mut reader = BufReader::with_capacity(1, Cursor::new(vec![b'9'; 1024 * 1024]));
        let error = read_frame(&mut reader).await.unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        assert!(reader.get_ref().position() <= 9);
    }

    #[tokio::test]
    async fn length_prefix_rejects_non_decimal_input_without_reading_the_line() {
        let mut input = vec![b'9'; 1024 * 1024];
        input[1] = b'x';
        let mut reader = BufReader::with_capacity(1, Cursor::new(input));
        let error = read_frame(&mut reader).await.unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        assert!(reader.get_ref().position() <= 2);
    }

    #[tokio::test]
    async fn buffered_decode_consumes_an_invalid_frame_before_the_next_frame() {
        let valid = serde_json::json!({"result": "ok"});
        let mut wire = b"01\n{".to_vec();
        wire.extend(encode_frame(&valid));

        for capacity in [1, 7, 8192] {
            let mut reader = BufReader::with_capacity(capacity, wire.as_slice());
            let malformed = super::read_buffered_frame(&mut reader).await.unwrap_err();
            assert!(malformed.to_string().starts_with("malformed frame JSON:"));
            assert_eq!(
                super::read_buffered_frame(&mut reader).await.unwrap(),
                Some(valid.clone())
            );
            assert_eq!(super::read_buffered_frame(&mut reader).await.unwrap(), None);
        }
    }

    #[tokio::test]
    async fn consecutive_frames_and_clean_eof_remain_readable() {
        let first = serde_json::json!({"type": "first"});
        let second = serde_json::json!({"type": "second"});
        let mut wire = encode_frame(&first);
        wire.extend(encode_frame(&second));
        let mut reader = BufReader::new(wire.as_slice());
        assert_eq!(read_frame(&mut reader).await.unwrap(), Some(first));
        assert_eq!(read_frame(&mut reader).await.unwrap(), Some(second));
        assert_eq!(read_frame(&mut reader).await.unwrap(), None);
    }
}
