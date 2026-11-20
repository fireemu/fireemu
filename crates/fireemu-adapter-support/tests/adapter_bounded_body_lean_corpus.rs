//! Replays body collection with in-memory frames, including early errors.

use std::{cell::Cell, io};

use bytes::Bytes;
use fireemu_adapter_support::body::{collect_limited, CollectBodyError};
use http::HeaderMap;
use http_body::Frame;
use http_body_util::StreamBody;
use tokio_stream::{iter, StreamExt};

fn frame(code: &str) -> Result<Frame<Bytes>, io::Error> {
    match code {
        "t" => Ok(Frame::trailers(HeaderMap::new())),
        "e" => Err(io::Error::other("test transport error")),
        _ => {
            let (letter, count) = code.split_at(1);
            assert!(matches!(letter, "a" | "b"));
            Ok(Frame::data(Bytes::from(
                letter.repeat(count.parse().unwrap()),
            )))
        }
    }
}

#[tokio::test]
async fn bounded_collection_preserves_error_order_and_consumption() {
    let mut rows = include_str!("fixtures/lean-adapter-bounded-body.corpus").lines();
    assert_eq!(
        rows.next(),
        Some("# budget|first|second|layout|frames|result|reads")
    );
    let mut count = 0;
    for row in rows {
        let fields: Vec<_> = row.split('|').collect();
        let [budget, _, _, _, frames, output, reads]: [&str; 7] = fields.try_into().unwrap();
        let polled = Cell::new(0);
        let body = StreamBody::new(iter(frames.split(',').map(frame)).map(|item| {
            polled.set(polled.get() + 1);
            item
        }));
        let expected = match output {
            "large" => Err(CollectBodyError::TooLarge),
            "read" => Err(CollectBodyError::Read),
            _ => Ok(Bytes::copy_from_slice(
                output.strip_prefix("ok:").unwrap().as_bytes(),
            )),
        };
        assert_eq!(
            collect_limited(body, budget.parse().unwrap()).await,
            expected,
            "{row}"
        );
        assert_eq!(polled.get(), reads.parse::<usize>().unwrap(), "{row}");
        count += 1;
    }
    assert_eq!(count, 750);
}
