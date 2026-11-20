//! Observable byte limits and secret matching through the adapter's public API.

use fireemu_adapter_support::connection::{close_gracefully, DrainBounds, DRAIN_IDLE, DRAIN_TOTAL};
use fireemu_adapter_support::secret::optional_str_matches;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

#[tokio::test]
async fn a_drain_that_reaches_the_exact_byte_limit_leaves_the_next_read_unread() {
    const ALIGNED_LIMIT: usize = 64 * 1024;
    let body = vec![1_u8; 600 * 1024];
    for (limit, expected) in [
        (ALIGNED_LIMIT, ALIGNED_LIMIT..=ALIGNED_LIMIT),
        (
            ALIGNED_LIMIT + 1,
            ALIGNED_LIMIT + 1..=ALIGNED_LIMIT + 32 * 1024,
        ),
    ] {
        let (mut server, mut client) = tokio::io::duplex(1024 * 1024);
        client.write_all(&body).await.unwrap();
        close_gracefully(
            &mut server,
            DrainBounds {
                limit_bytes: limit,
                idle: DRAIN_IDLE,
                total: DRAIN_TOTAL,
            },
        )
        .await;

        client.shutdown().await.unwrap();
        let mut unread = Vec::new();
        server.read_to_end(&mut unread).await.unwrap();
        let drained = body.len() - unread.len();
        assert!(expected.contains(&drained), "limit {limit}: read {drained}");
    }
}

#[test]
fn optional_secret_matching_requires_a_present_exact_match() {
    let expected = "public-test-sentinel";
    assert!(optional_str_matches(Some(expected), expected));
    assert!(!optional_str_matches(Some("different"), expected));
    assert!(!optional_str_matches(None, expected));
}
