use fireemu_core_database::{ErrorKind, Format, Json, Path, ServerValueContext, Tree};

const CORPUS: &str = include_str!("fixtures/lean-rtdb-path-merge.corpus");
const CLOCK: ServerValueContext = ServerValueContext { now_millis: 15 };

fn operation(kind: &str, value: i64) -> Json {
    match kind {
        "set" => Json::int(value),
        "delete" => Json::Null,
        "increment" => Json::object([(".sv", Json::object([("increment", Json::int(value))]))]),
        "badValue" => Json::object([(".sv", Json::string("invalid"))]),
        _ => panic!("unknown operation {kind:?}"),
    }
}

fn initial_items(kind: &str) -> Json {
    match kind {
        "branch" => Json::object([("a", Json::int(4)), ("b", Json::int(7))]),
        "scalar" => Json::int(8),
        "empty" => Json::Null,
        _ => panic!("unknown initial shape {kind:?}"),
    }
}

fn pair(kind: &str) -> (&str, &str) {
    match kind {
        "siblings" => ("items/a", "items/b"),
        "alias" => ("items/a", "/items//a/"),
        "parent" => ("items", "items/a"),
        "reverse" => ("items/a", "items"),
        "invalid" => ("items/a", "items/b.d"),
        "readonly" => ("items/a", ".info/x"),
        _ => panic!("unknown path shape {kind:?}"),
    }
}

fn root_with_items(items: Json) -> Json {
    let mut entries = vec![("untouched", Json::int(99))];
    if items != Json::Null {
        entries.push(("items", items));
    }
    Json::object(entries)
}

fn describe(field: &str) -> Json {
    if let Some(number) = field.strip_prefix("leaf:") {
        return Json::int(number.parse().expect("leaf value"));
    }
    if let Some(children) = field.strip_prefix("branch:") {
        return Json::object(children.split(',').map(|entry| {
            let (key, number) = entry.split_once('=').expect("child record");
            (key, Json::int(number.parse().expect("child value")))
        }));
    }
    assert_eq!(field, "absent");
    Json::Null
}

#[test]
fn replay_lean_path_merge() {
    let root = Path::root();
    assert_eq!(CORPUS.lines().count(), 216);
    for line in CORPUS.lines() {
        let fields: Vec<_> = line.split('\t').collect();
        let [initial, paths, first, second, status, after] = fields.as_slice() else {
            panic!("malformed corpus row {line:?}");
        };
        let mut tree = Tree::default();
        let before = root_with_items(initial_items(initial));
        tree.set(&root, &before, CLOCK).expect("initial state");
        let (p, q) = pair(paths);
        let entries = [
            (p.to_owned(), operation(first, 2)),
            (q.to_owned(), operation(second, 3)),
        ];
        let expected = match *status {
            "ok" => Ok(()),
            "overlapping" => Err(ErrorKind::OverlappingUpdate),
            "invalidKey" => Err(ErrorKind::InvalidKey),
            "readOnly" => Err(ErrorKind::ReadOnlyPath),
            "invalidValue" => Err(ErrorKind::InvalidServerValue),
            _ => panic!("unknown status {status:?}"),
        };
        assert_eq!(
            tree.update(&root, &entries, CLOCK)
                .map_err(|error| error.kind),
            expected,
            "{line:?}"
        );
        let actual = tree.get_json(&root, Format::Export);
        assert!(
            actual.same_form(&root_with_items(describe(after))),
            "{line:?}: {actual:?}"
        );
        if expected.is_err() {
            assert!(
                actual.same_form(&before),
                "refusal changed the tree: {line:?}"
            );
        }
    }
}
