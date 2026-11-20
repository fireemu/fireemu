//! Replays the Lean predicate for Hosting globstar consumption and hidden path parts.

#[path = "../src/hosting/matcher.rs"]
#[allow(dead_code)] // The rest of Hosting matching is exercised by its own replay and route tests.
mod matcher;

#[test]
fn the_globstar_suffix_search_agrees_with_lean() {
    let mut rows = include_str!("fixtures/lean-hosting-globstar-traversal.corpus").lines();
    assert_eq!(rows.next(), Some("# dot|path|suffix-length-bitset|match"));
    let mut count = 0;
    for row in rows {
        let columns: Vec<_> = row.split('|').collect();
        let [dot, labels, mask, expected] = columns.as_slice() else {
            panic!("invalid corpus row: {row}");
        };
        let path: Vec<_> = labels
            .chars()
            .map(|ch| match ch {
                'h' => ".hidden",
                'v' => "visible",
                _ => panic!("invalid path label: {ch}"),
            })
            .collect();
        let mask: u32 = mask.parse().unwrap();
        let observed = matcher::globstar_suffixes(&path, dot.parse().unwrap(), |suffix| {
            (mask & (1 << suffix.len())) != 0
        });
        assert_eq!(observed, expected.parse::<bool>().unwrap(), "{row}");
        count += 1;
    }
    assert_eq!(count, 340);
}
