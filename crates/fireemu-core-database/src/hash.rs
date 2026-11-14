//! Node hashes: the `ETag`s of the REST API and the compare-and-set hashes of transactions.
//!
//! The hash is the one the SDKs compute (`LeafNode.hash` / `ChildrenNode.hash` in
//! `@firebase/database`), and the official emulator answers it as the `ETag`: the base64
//! SHA-1 of a text that names the priority, the type and the value of a leaf, or the keys and
//! hashes of the children in priority order. Numbers enter it as the hexadecimal IEEE 754
//! bits of their double value.

use std::fmt::Write as _;

use crate::node::{Content, Leaf, Node, Priority};
use crate::number::Number;
use crate::query::{OrderBy, QueryParams};

/// The `ETag` of an absent value.
pub const NULL_ETAG: &str = "null_etag";

/// The `ETag` of `node`: its hash, or [`NULL_ETAG`] when it is absent.
pub fn etag(node: Option<&Node>) -> String {
    node.map_or_else(|| NULL_ETAG.to_owned(), |n| node_hash(Some(n)))
}

/// The hash of `node`; the empty string when it is absent.
pub fn node_hash(node: Option<&Node>) -> String {
    let Some(node) = node else {
        return String::new();
    };
    if let Content::Children(children) = &node.content {
        return hash_children(
            children
                .iter()
                .map(|(key, child)| (key.as_str(), child))
                .collect(),
            node.priority.as_deref(),
        );
    }
    let mut text = Sha1Writer::new();
    if let Some(priority) = &node.priority {
        text.write_str("priority:")
            .expect("writing to SHA-1 cannot fail");
        write_priority(&mut text, priority);
        text.write_char(':').expect("writing to SHA-1 cannot fail");
    }
    if let Content::Leaf(leaf) = &node.content {
        write_leaf(&mut text, leaf);
    }
    base64(&text.finish())
}

/// Hashes selected children as a synthetic parent with no priority, without cloning them.
///
/// The children are ordered by priority, regardless of the query order that selected them.
/// An empty selection represents an absent value and therefore has the empty hash.
pub fn children_hash_without_priority(children: Vec<(&str, &Node)>) -> String {
    if children.is_empty() {
        String::new()
    } else {
        hash_children(children, None)
    }
}

fn hash_children(mut children: Vec<(&str, &Node)>, priority: Option<&Priority>) -> String {
    let order = QueryParams::ordered_by(OrderBy::Priority);
    children.sort_by(|(ka, a), (kb, b)| order.compare_children(ka, a, kb, b));
    let mut text = Sha1Writer::new();
    if let Some(priority) = priority {
        text.write_str("priority:")
            .expect("writing to SHA-1 cannot fail");
        write_priority(&mut text, priority);
        text.write_char(':').expect("writing to SHA-1 cannot fail");
    }
    for (key, child) in children {
        // A stored child is never empty, so its hash is never the empty string.
        write!(text, ":{key}:{}", node_hash(Some(child))).expect("writing to SHA-1 cannot fail");
    }
    base64(&text.finish())
}

fn write_priority(text: &mut impl std::fmt::Write, priority: &Priority) {
    match priority {
        Priority::Number(number) => write_number(text, *number),
        Priority::String(string) => {
            write!(text, "string:{string}").expect("writing to SHA-1 cannot fail");
        }
    }
}

fn write_leaf(text: &mut impl std::fmt::Write, leaf: &Leaf) {
    match leaf {
        Leaf::Bool(value) => {
            write!(text, "boolean:{value}").expect("writing to SHA-1 cannot fail");
        }
        Leaf::Number(number) => write_number(text, *number),
        Leaf::String(string) => {
            write!(text, "string:{string}").expect("writing to SHA-1 cannot fail");
        }
    }
}

/// Writes `number:` and the big-endian IEEE 754 bits of the double value in lowercase hex.
fn write_number(text: &mut impl std::fmt::Write, number: Number) {
    write!(text, "number:{:016x}", number.as_f64().to_bits())
        .expect("writing to SHA-1 cannot fail");
}

/// Standard base64 with padding.
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(ALPHABET[(n >> (18 - 6 * i)) as usize & 63]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// SHA-1 (RFC 3174) of `data`. The same algorithm as `fireemu-core-auth`'s, kept here so
/// the core stays dependency-free.
pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut writer = Sha1Writer::new();
    writer.update(data);
    writer.finish()
}

/// Incremental SHA-1 state with one fixed block of scratch space.
struct Sha1Writer {
    hash: [u32; 5],
    buffer: [u8; 64],
    buffer_len: usize,
    message_len: u64,
}

impl Sha1Writer {
    fn new() -> Self {
        Self {
            hash: [
                0x6745_2301,
                0xEFCD_AB89,
                0x98BA_DCFE,
                0x1032_5476,
                0xC3D2_E1F0,
            ],
            buffer: [0; 64],
            buffer_len: 0,
            message_len: 0,
        }
    }

    fn update(&mut self, mut input: &[u8]) {
        self.message_len = self.message_len.wrapping_add(input.len() as u64);
        if self.buffer_len > 0 {
            let take = (64 - self.buffer_len).min(input.len());
            self.buffer[self.buffer_len..self.buffer_len + take].copy_from_slice(&input[..take]);
            self.buffer_len += take;
            input = &input[take..];
            if self.buffer_len == 64 {
                let block = self.buffer;
                self.process_block(&block);
                self.buffer_len = 0;
            }
        }
        while input.len() >= 64 {
            let block: &[u8; 64] = input[..64].try_into().expect("block length is 64");
            self.process_block(block);
            input = &input[64..];
        }
        if !input.is_empty() {
            self.buffer[..input.len()].copy_from_slice(input);
            self.buffer_len = input.len();
        }
    }

    fn finish(mut self) -> [u8; 20] {
        let bit_len = self.message_len.wrapping_mul(8);
        self.buffer[self.buffer_len] = 0x80;
        self.buffer_len += 1;
        if self.buffer_len > 56 {
            self.buffer[self.buffer_len..].fill(0);
            let block = self.buffer;
            self.process_block(&block);
            self.buffer = [0; 64];
        } else {
            self.buffer[self.buffer_len..56].fill(0);
        }
        self.buffer[56..].copy_from_slice(&bit_len.to_be_bytes());
        let block = self.buffer;
        self.process_block(&block);

        let mut output = [0u8; 20];
        for (index, word) in self.hash.iter().enumerate() {
            output[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
        }
        output
    }

    #[allow(clippy::many_single_char_names)] // RFC 3174 notation
    fn process_block(&mut self, block: &[u8; 64]) {
        let mut w = [0u32; 80];
        for (i, chunk) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = self.hash;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        self.hash[0] = self.hash[0].wrapping_add(a);
        self.hash[1] = self.hash[1].wrapping_add(b);
        self.hash[2] = self.hash[2].wrapping_add(c);
        self.hash[3] = self.hash[3].wrapping_add(d);
        self.hash[4] = self.hash[4].wrapping_add(e);
    }
}

impl std::fmt::Write for Sha1Writer {
    fn write_str(&mut self, input: &str) -> std::fmt::Result {
        self.update(input.as_bytes());
        Ok(())
    }
}

#[cfg(test)]
mod streaming_tests {
    use super::{sha1, Sha1Writer};
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn sha1_writer_is_independent_of_input_chunk_boundaries(
            input in prop::collection::vec(any::<u8>(), 0..4096),
            chunk_size in 1usize..129,
        ) {
            let mut writer = Sha1Writer::new();
            for chunk in input.chunks(chunk_size) {
                writer.update(chunk);
            }
            prop_assert_eq!(writer.finish(), sha1(&input));
        }
    }
}
