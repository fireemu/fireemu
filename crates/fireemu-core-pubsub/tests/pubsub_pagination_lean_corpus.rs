//! Replays pure ordered pagination against the policies in the Lean reference.

use fireemu_core_pubsub::{
    pagination::{paginate, PagingPolicy},
    Code,
};

const CORPUS: &str = include_str!("fixtures/lean-pubsub-pagination.corpus");

fn name(index: usize) -> String {
    format!("projects/p/subscriptions/sub-{index:04}")
}

fn token_for(boundary: usize) -> String {
    let page = paginate(
        vec![name(boundary), "zz-cursor-probe".into()],
        1,
        "",
        PagingPolicy::Strict,
        Clone::clone,
    )
    .unwrap();
    assert_eq!(page.resources, [name(boundary)]);
    assert!(!page.next_page_token.is_empty());
    assert_ne!(page.next_page_token, name(boundary));
    page.next_page_token
}

#[test]
fn replay_pagination() {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(count, 252);
    assert_eq!(lines.clone().count(), count);
    for line in lines {
        let fields: Vec<_> = line.split('\t').collect();
        let [policy, _, cursor, count, page_size, outcome, first, len, next] = fields.as_slice()
        else {
            panic!("malformed pagination row: {line}");
        };
        let policy = match *policy {
            "strict" => PagingPolicy::Strict,
            "emulator" => PagingPolicy::Emulator,
            _ => panic!("unknown pagination policy"),
        };
        let token = match (*cursor, policy) {
            ("initial", _) => String::new(),
            ("known", PagingPolicy::Strict) => token_for(0),
            ("last", PagingPolicy::Strict) => token_for(2),
            ("known", PagingPolicy::Emulator) => name(0),
            ("last", PagingPolicy::Emulator) => name(2),
            ("between", _) => format!("{}-extra", name(0)),
            ("past", _) => "zz-past".into(),
            ("garbage", _) => "!opaque?".into(),
            _ => panic!("unknown cursor input"),
        };
        let count: usize = count.parse().unwrap();
        let page_size = page_size.parse().unwrap();
        let page = paginate(
            (0..count).map(name).collect(),
            page_size,
            &token,
            policy,
            Clone::clone,
        );
        match *outcome {
            "size" => {
                let error = page.unwrap_err();
                assert_eq!(error.code(), Code::InvalidArgument, "{line}");
                assert_eq!(error.message(), format!("The value for page_size is out of bounds. You passed {page_size} in the request, but the value must be between 0 and 1000."));
            }
            "cursor" => {
                let error = page.unwrap_err();
                assert_eq!(error.code(), Code::InvalidArgument, "{line}");
                assert_eq!(
                    error.message(),
                    format!("Invalid page token given (token={token}).")
                );
            }
            "page" => {
                let page = page.unwrap();
                let first: usize = first.parse().unwrap();
                let len: usize = len.parse().unwrap();
                assert_eq!(
                    page.resources,
                    (first..first + len).map(name).collect::<Vec<_>>(),
                    "{line}"
                );
                let expected_token = if *next == "-" {
                    String::new()
                } else {
                    let index = next.parse().unwrap();
                    match policy {
                        PagingPolicy::Strict => token_for(index),
                        PagingPolicy::Emulator => name(index),
                    }
                };
                assert_eq!(page.next_page_token, expected_token, "{line}");
            }
            _ => panic!("unknown pagination result"),
        }
    }
}
