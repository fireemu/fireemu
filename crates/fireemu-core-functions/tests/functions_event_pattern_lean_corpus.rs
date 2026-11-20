use fireemu_core_functions::pattern::{PathPattern, PatternError, Segment};
use std::collections::BTreeSet;

const CORPUS: &str = include_str!("fixtures/lean-functions-event-pattern.corpus");

fn segment_code(segment: &Segment) -> String {
    match segment {
        Segment::Literal(s) => format!("literal={s}"),
        Segment::Wildcard => "single".into(),
        Segment::MultiWildcard => "multi".into(),
        Segment::Capture(s) => format!("capture={s}"),
        Segment::MultiCapture(s) => format!("capture-many={s}"),
    }
}

#[test]
fn event_path_patterns_agree_with_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let count: usize = lines
        .next()
        .unwrap()
        .strip_prefix("# ")
        .unwrap()
        .strip_suffix(" cases.")
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(count, 99);
    let mut seen = BTreeSet::new();
    for line in lines {
        let parts: Vec<_> = line.split('\t').collect();
        let [id, source, path, status, canonical, segments, expected] = parts.as_slice() else {
            panic!("invalid row: {line}");
        };
        assert!(seen.insert(*id), "duplicate row: {id}");
        match PathPattern::parse(source) {
            Ok(pattern) => {
                assert_eq!(*status, "ok", "{id}");
                assert_eq!(pattern.as_str(), *canonical, "{id}");
                assert_eq!(
                    pattern
                        .segments()
                        .iter()
                        .map(segment_code)
                        .collect::<Vec<_>>()
                        .join(","),
                    *segments,
                    "{id}"
                );
                let shape = if pattern.is_document_pattern() {
                    "document"
                } else {
                    "collection"
                };
                let matched = pattern.matches(path).map_or_else(
                    || "miss".to_owned(),
                    |params| {
                        let pairs = params
                            .into_iter()
                            .map(|(key, value)| format!("{key}={value}"))
                            .collect::<Vec<_>>()
                            .join(",");
                        format!("match:{pairs}")
                    },
                );
                assert_eq!(format!("{shape}:{matched}"), *expected, "{id}");
            }
            Err(error) => assert_eq!(
                match error {
                    PatternError::Empty => "empty".into(),
                    PatternError::MultiNotLast => "nonfinal".into(),
                    PatternError::MalformedCapture(s) => format!("malformed={s}"),
                    PatternError::DuplicateCapture(s) => format!("duplicate={s}"),
                },
                *status,
                "{id}"
            ),
        }
    }
    assert_eq!(seen.len(), count);
}
