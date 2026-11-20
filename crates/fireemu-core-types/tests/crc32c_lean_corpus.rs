//! Compares native CRC-32C with the Lean polynomial and streaming reference.

use fireemu_core_types::hash::{crc32c, Crc32c};

#[test]
fn rust_crc32c_agrees_with_the_castagnoli_reference_and_its_chunk_law() {
    let corpus = include_str!("fixtures/lean-crc32c.corpus");
    let mut rows = corpus.lines();
    assert_eq!(rows.next(), Some("# length offset chunk crc32c"));
    let mut count = 0;
    for row in rows {
        let fields: Vec<_> = row.split_ascii_whitespace().collect();
        let [length, offset, chunk, expected]: [&str; 4] = fields.try_into().expect("four fields");
        let (length, offset, chunk): (usize, usize, usize) = (
            length.parse().unwrap(),
            offset.parse().unwrap(),
            chunk.parse().unwrap(),
        );
        let expected: u32 = expected.parse().unwrap();
        let storage: Vec<_> = (0..length + offset)
            .map(|i| u8::try_from((i * 31 + 7) % 256).unwrap())
            .collect();
        let bytes = &storage[offset..];
        assert_eq!(crc32c(bytes), expected, "one shot: {row}");
        let mut streaming = Crc32c::new();
        for chunk in bytes.chunks(chunk) {
            streaming.update(chunk);
            streaming.update(&[]);
        }
        assert_eq!(streaming.finalize(), expected, "incremental: {row}");
        count += 1;
    }
    assert_eq!(count, 132);
}
