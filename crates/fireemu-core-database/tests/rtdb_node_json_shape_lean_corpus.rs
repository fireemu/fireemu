//! Replays the Realtime Database plain and export JSON shape contract.

use fireemu_core_database::{Format, Json, Limits, Node, Path};

#[test]
fn largest_machine_index_is_a_sparse_object_key() {
    let json = Json::object([(usize::MAX.to_string(), Json::Bool(true))]);
    let node = Node::from_json(&json, &Path::root(), &Limits::default())
        .unwrap()
        .unwrap();
    assert!(node.to_json(Format::Plain).same_form(&json));
    assert!(node.to_json(Format::Export).same_form(&json));
}

fn children(shape: &str) -> Vec<(&'static str, Json)> {
    match shape {
        "dense" => vec![("0", Json::int(1)), ("2", Json::int(2))],
        "sparse" => vec![("0", Json::int(1)), ("5", Json::int(2))],
        "threshold" => vec![("0", Json::int(1)), ("4", Json::int(2))],
        "empty" => vec![],
        "nulls" => vec![("0", Json::Null), ("1", Json::int(2)), ("2", Json::Null)],
        "noncanonical" => vec![
            ("0", Json::int(1)),
            ("01", Json::int(2)),
            ("١", Json::int(3)),
            ("-1", Json::int(4)),
        ],
        "huge" => vec![
            ("18446744073709551615", Json::int(1)),
            ("18446744073709551616", Json::int(2)),
        ],
        "forbidden" => vec![("0", Json::int(1)), ("invalid.key", Json::Null)],
        _ => panic!("unknown fixture children {shape}"),
    }
}

fn input(container: &str, shape: &str, priority: &str) -> Json {
    let mut fields = match container {
        "object" => children(shape),
        "array" => {
            return Json::Array(
                children(shape)
                    .into_iter()
                    .map(|(_, value)| value)
                    .collect(),
            )
        }
        "wrapper" => {
            let wrapped = match shape {
                "empty" => Json::Null,
                "sparse" => Json::Array(vec![Json::int(1)]),
                _ => Json::int(1),
            };
            let mut fields = vec![(".value", wrapped)];
            if shape == "forbidden" {
                fields.push(("sibling", Json::Null));
            }
            fields
        }
        "server" => vec![
            (".sv", Json::string("timestamp")),
            ("invalid.key", Json::Null),
        ],
        _ => panic!("unknown fixture container {container}"),
    };
    let priority = match priority {
        "none" => return Json::object(fields),
        "number" => Json::int(2),
        "string" => Json::string("label"),
        "invalid" => Json::Bool(true),
        _ => panic!("unknown fixture priority {priority}"),
    };
    fields.push((".priority", priority));
    Json::object(fields)
}

fn render(value: &Json) -> String {
    use fireemu_core_database::Number;

    match value {
        Json::Null => "null".to_owned(),
        Json::Number(Number::Int(n)) => format!("i{n}"),
        Json::Number(Number::Double(n)) => format!("d{n}"),
        Json::String(s) => format!("s{s}"),
        Json::Array(items) => format!(
            "[{}]",
            items.iter().map(render).collect::<Vec<_>>().join(",")
        ),
        Json::Object(fields) => format!(
            "{{{}}}",
            fields
                .iter()
                .map(|(key, value)| format!("{key}={}", render(value)))
                .collect::<Vec<_>>()
                .join(",")
        ),
        Json::Bool(_) => panic!("unexpected boolean output: {value:?}"),
    }
}

#[test]
fn core_plain_and_export_shapes_match_lean() {
    use fireemu_core_database::ErrorKind;

    let corpus = include_str!("fixtures/lean-rtdb-node-json-shape.corpus");
    let mut rows = corpus.lines();
    assert_eq!(
        rows.next(),
        Some("# Container\tChildren\tPriority\tOutput\tExpected")
    );
    assert_eq!(rows.clone().count(), 256);
    for row in rows {
        let fields: Vec<_> = row.split('\t').collect();
        let [container, shape, priority, output, expected] = fields.as_slice() else {
            panic!("unexpected corpus row {row}");
        };
        let format = match *output {
            "plain" => Format::Plain,
            "export" => Format::Export,
            _ => panic!("unknown fixture format {output}"),
        };
        let observed = match Node::from_json_owned(
            input(container, shape, priority),
            &Path::root(),
            &Limits::default(),
        ) {
            Ok(Some(node)) => render(&node.to_json(format)),
            Ok(None) => "absent".to_owned(),
            Err(err) => match err.kind {
                ErrorKind::InvalidServerValue => "!server".to_owned(),
                ErrorKind::InvalidPriority => "!priority".to_owned(),
                ErrorKind::InvalidData => "!data".to_owned(),
                ErrorKind::InvalidKey => "!key".to_owned(),
                _ => panic!("unexpected database error {err:?}"),
            },
        };
        assert_eq!(&observed, expected, "{row}");
    }
}
