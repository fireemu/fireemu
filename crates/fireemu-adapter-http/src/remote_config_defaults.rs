//! `remoteConfig:downloadDefaults`: a template's default values as the JSON, XML or property
//! list file production serves (2026-11-21 `defaults-*`, Web campaign `defaults-client-*`).
//!
//! Recorded, and followed here:
//! - every top-level parameter and then every parameter of every group, each with its default
//!   value, an in-app default and a parameter without a default value as the empty string;
//! - an empty template is an empty body in every format;
//! - JSON: two-space indentation, `"key": "value"`, `<` and `&` written as `<` and `&`,
//!   no final newline;
//! - XML: the declaration followed directly by `<defaults>`, one `<entry>` per value indented by
//!   two spaces, `<value/>` for the empty string, `<` and `&` escaped as entities and `"` kept;
//! - property list: the Apple DOCTYPE, tab-indented `<key>` and `<string>` pairs, a value with `<`
//!   or `&` inside a CDATA section, no final newline.
//!
//! - the entries in the template's own order: top-level parameters as written, then each group
//!   as written with its parameters as written (2026-11-25 RC-CLOSURE-A passes; coordinator
//!   ruling 6). A template whose order is unknown (the initial empty one) falls back to sorted.
//!
//! Not recorded: how `>`, `'`, `=` or control characters are written in each format.

use std::fmt::Write as _;

use serde_json::Value;

/// The three file formats production serves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Format {
    Json,
    Xml,
    Plist,
}

impl Format {
    /// The `format` query value, as the API names it.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "JSON" => Some(Self::Json),
            "XML" => Some(Self::Xml),
            "PLIST" => Some(Self::Plist),
            _ => None,
        }
    }

    /// The recorded `Content-Type` of each format (no charset parameter).
    pub(crate) const fn content_type(self) -> &'static str {
        match self {
            Self::Json => "application/json",
            Self::Xml => "application/xml",
            Self::Plist => "application/x-plist",
        }
    }
}

/// The parameter names of a template body in the order it writes them: top-level parameters,
/// then each group's, groups in their order (serde sees an object's members in document order).
/// `None` when the body is not an object of that shape; validation answers those.
pub(crate) fn written_order(bytes: &[u8]) -> Option<Vec<String>> {
    serde_json::from_slice::<Written>(bytes)
        .ok()
        .map(|written| {
            let mut names = written.parameters.0;
            names.extend(
                written
                    .parameter_groups
                    .0
                    .into_iter()
                    .flat_map(|(_, group)| group.parameters.0),
            );
            names
        })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Written {
    #[serde(default)]
    parameters: Keys,
    #[serde(default)]
    parameter_groups: Ordered<WrittenGroup>,
}

#[derive(serde::Deserialize)]
struct WrittenGroup {
    #[serde(default)]
    parameters: Keys,
}

/// An object's member names in document order, values ignored.
#[derive(Default)]
struct Keys(Vec<String>);

impl<'de> serde::Deserialize<'de> for Keys {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ordered::<serde::de::IgnoredAny>::deserialize(deserializer)
            .map(|ordered| Self(ordered.0.into_iter().map(|(key, _)| key).collect()))
    }
}

/// An object's members in document order.
struct Ordered<T>(Vec<(String, T)>);

impl<T> Default for Ordered<T> {
    fn default() -> Self {
        Self(Vec::new())
    }
}

impl<'de, T: serde::Deserialize<'de>> serde::Deserialize<'de> for Ordered<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor<T>(std::marker::PhantomData<T>);
        impl<'de, T: serde::Deserialize<'de>> serde::de::Visitor<'de> for Visitor<T> {
            type Value = Ordered<T>;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Self::Value, A::Error> {
                let mut members = Vec::new();
                while let Some(member) = map.next_entry::<String, T>()? {
                    members.push(member);
                }
                Ok(Ordered(members))
            }
        }
        deserializer.deserialize_map(Visitor(std::marker::PhantomData))
    }
}

/// The default values of a template document in `order` (names not in it follow, sorted).
pub(crate) fn defaults_in(document: &Value, order: &[String]) -> Vec<(String, String)> {
    let mut entries = defaults(document);
    let position = |name: &str| order.iter().position(|o| o == name).unwrap_or(usize::MAX);
    // A stable sort keeps the sorted order among names the order does not hold.
    entries.sort_by_key(|(name, _)| position(name));
    entries
}

/// The default values of a template document, top-level parameters first.
pub(crate) fn defaults(document: &Value) -> Vec<(String, String)> {
    let value_of = |parameter: &Value| {
        parameter
            .pointer("/defaultValue/value")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let parameters = |set: Option<&Value>| {
        set.and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(key, parameter)| (key.clone(), value_of(parameter)))
            .collect::<Vec<_>>()
    };
    let mut entries = parameters(document.get("parameters"));
    for group in document
        .get("parameterGroups")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|groups| groups.values())
    {
        entries.extend(parameters(group.get("parameters")));
    }
    entries
}

fn json_string(text: &str) -> String {
    serde_json::to_string(text)
        .unwrap_or_default()
        .replace('<', "\\u003c")
        .replace('&', "\\u0026")
}

fn xml_text(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;")
}

/// The file of `entries` in `format`.
pub(crate) fn render(entries: &[(String, String)], format: Format) -> Vec<u8> {
    if entries.is_empty() {
        return Vec::new();
    }
    let mut out = String::new();
    match format {
        Format::Json => {
            out.push_str("{\n");
            let lines: Vec<String> = entries
                .iter()
                .map(|(key, value)| format!("  {}: {}", json_string(key), json_string(value)))
                .collect();
            out.push_str(&lines.join(",\n"));
            out.push_str("\n}");
        }
        Format::Xml => {
            out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?><defaults>\n");
            for (key, value) in entries {
                out.push_str("  <entry>\n");
                let _ = writeln!(out, "    <key>{}</key>", xml_text(key));
                if value.is_empty() {
                    out.push_str("    <value/>\n");
                } else {
                    let _ = writeln!(out, "    <value>{}</value>", xml_text(value));
                }
                out.push_str("  </entry>\n");
            }
            out.push_str("</defaults>");
        }
        Format::Plist => {
            out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n");
            for (key, value) in entries {
                let _ = writeln!(out, "\t<key>{}</key>", plist_text(key));
                let _ = writeln!(out, "\t<string>{}</string>", plist_text(value));
            }
            out.push_str("</dict>\n</plist>");
        }
    }
    out.into_bytes()
}

fn plist_text(text: &str) -> String {
    if text.contains(['<', '&']) && !text.contains("]]>") {
        format!("<![CDATA[{text}]]>")
    } else {
        xml_text(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The template the Web campaign published (2026-11-21, synthetic values only), and the three
    /// files production served for it, byte for byte.
    fn recorded() -> Value {
        json!({
            "parameters": {
                "fireemu_source": {"defaultValue": {"value": "first-default"}},
                "fireemu_count": {"defaultValue": {"value": "12.5"}},
                "fireemu_json": {"defaultValue": {"value": "{\"synthetic\":1}"}},
                "fireemu_bool": {"defaultValue": {"value": "true"}},
                "fireemu_inapp": {"defaultValue": {"useInAppDefault": true}},
                "fireemu_only_conditional": {"defaultValue": {"value": ""}, "conditionalValues": {"fireemu_premium": {"value": "<&\""}}},
            },
            "parameterGroups": {"Fireemu probe": {"description": "Disposable", "parameters": {"fireemu_grouped": {"defaultValue": {"value": "<&\""}}}}},
        })
    }

    /// The recorded entry order; Fireemu's map sorts the top-level parameters.
    const RECORDED_ORDER: [&str; 7] = [
        "fireemu_source",
        "fireemu_count",
        "fireemu_json",
        "fireemu_bool",
        "fireemu_inapp",
        "fireemu_only_conditional",
        "fireemu_grouped",
    ];

    fn in_recorded_order() -> Vec<(String, String)> {
        let entries = defaults(&recorded());
        RECORDED_ORDER
            .iter()
            .map(|key| entries.iter().find(|(k, _)| k == key).unwrap().clone())
            .collect()
    }

    const JSON: &str = "{\n  \"fireemu_source\": \"first-default\",\n  \"fireemu_count\": \"12.5\",\n  \"fireemu_json\": \"{\\\"synthetic\\\":1}\",\n  \"fireemu_bool\": \"true\",\n  \"fireemu_inapp\": \"\",\n  \"fireemu_only_conditional\": \"\",\n  \"fireemu_grouped\": \"\\u003c\\u0026\\\"\"\n}";
    const XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><defaults>\n  <entry>\n    <key>fireemu_source</key>\n    <value>first-default</value>\n  </entry>\n  <entry>\n    <key>fireemu_count</key>\n    <value>12.5</value>\n  </entry>\n  <entry>\n    <key>fireemu_json</key>\n    <value>{\"synthetic\":1}</value>\n  </entry>\n  <entry>\n    <key>fireemu_bool</key>\n    <value>true</value>\n  </entry>\n  <entry>\n    <key>fireemu_inapp</key>\n    <value/>\n  </entry>\n  <entry>\n    <key>fireemu_only_conditional</key>\n    <value/>\n  </entry>\n  <entry>\n    <key>fireemu_grouped</key>\n    <value>&lt;&amp;\"</value>\n  </entry>\n</defaults>";
    const PLIST: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>fireemu_source</key>\n\t<string>first-default</string>\n\t<key>fireemu_count</key>\n\t<string>12.5</string>\n\t<key>fireemu_json</key>\n\t<string>{\"synthetic\":1}</string>\n\t<key>fireemu_bool</key>\n\t<string>true</string>\n\t<key>fireemu_inapp</key>\n\t<string></string>\n\t<key>fireemu_only_conditional</key>\n\t<string></string>\n\t<key>fireemu_grouped</key>\n\t<string><![CDATA[<&\"]]></string>\n</dict>\n</plist>";

    #[test]
    fn the_recorded_files_are_reproduced_byte_for_byte() {
        let entries = in_recorded_order();
        for (format, expected, bytes) in [
            (Format::Json, JSON, 227),
            (Format::Xml, XML, 594),
            (Format::Plist, PLIST, 565),
        ] {
            let rendered = String::from_utf8(render(&entries, format)).unwrap();
            assert_eq!(rendered, expected, "{format:?}");
            assert_eq!(rendered.len(), bytes, "{format:?}");
        }
    }

    #[test]
    fn group_parameters_follow_the_top_level_ones_and_an_empty_template_is_empty() {
        let keys: Vec<_> = defaults(&recorded()).into_iter().map(|(k, _)| k).collect();
        assert_eq!(keys.last().map(String::as_str), Some("fireemu_grouped"));
        assert_eq!(keys.len(), 7);
        for format in [Format::Json, Format::Xml, Format::Plist] {
            assert!(render(&defaults(&json!({})), format).is_empty());
            assert!(render(
                &defaults(&json!({"parameters": {}, "parameterGroups": {"g": {"parameters": {}}}})),
                format
            )
            .is_empty());
        }
    }

    #[test]
    fn a_value_that_cannot_be_a_cdata_section_is_escaped() {
        let entries = vec![
            ("k".to_owned(), "a<]]>b".to_owned()),
            ("j".to_owned(), "x>y".to_owned()),
        ];
        let text = String::from_utf8(render(&entries, Format::Plist)).unwrap();
        assert!(text.contains("\t<string>a&lt;]]>b</string>\n"), "{text}");
        assert!(text.contains("\t<string>x>y</string>\n"), "{text}");
    }

    #[test]
    fn formats_parse_only_the_api_names() {
        assert_eq!(Format::parse("JSON"), Some(Format::Json));
        assert_eq!(Format::parse("XML"), Some(Format::Xml));
        assert_eq!(Format::parse("PLIST"), Some(Format::Plist));
        for other in ["json", "", "FORMAT_UNSPECIFIED", "INVALID"] {
            assert_eq!(Format::parse(other), None, "{other}");
        }
        assert_eq!(Format::Json.content_type(), "application/json");
        assert_eq!(Format::Xml.content_type(), "application/xml");
        assert_eq!(Format::Plist.content_type(), "application/x-plist");
    }

    proptest::proptest! {
        #[test]
        fn json_defaults_decode_to_their_values(key in "[a-z_]{1,10}", value in ".{0,30}") {
            let entries = vec![(key.clone(), value.clone())];
            let bytes = render(&entries, Format::Json);
            let decoded: serde_json::Map<String, Value> = serde_json::from_slice(&bytes).unwrap();
            proptest::prop_assert_eq!(decoded.get(&key).and_then(Value::as_str), Some(value.as_str()));
            proptest::prop_assert!(!bytes.contains(&b'<') && !bytes.contains(&b'&'));
        }
    }

    #[test]
    fn written_order_reads_members_as_written() {
        let body = br#"{"version": {}, "parameterGroups": {"g2": {"parameters": {"x": {}}, "description": "d"},
            "g1": {"parameters": {"w": {}, "a": {}}}}, "parameters": {"b": {}, "a2": {}}}"#;
        assert_eq!(written_order(body).unwrap(), ["b", "a2", "x", "w", "a"]);
        assert_eq!(written_order(b"{}").unwrap(), Vec::<String>::new());
        assert_eq!(
            written_order(br#"{"parameterGroups": {"g": {}}}"#).unwrap(),
            Vec::<String>::new()
        );
        for bad in [
            &b"{\"parameters\": []}"[..],
            b"{\"parameterGroups\": {\"g\": 1}}",
            b"not json",
        ] {
            assert_eq!(written_order(bad), None);
        }
    }

    #[test]
    fn defaults_in_orders_by_the_written_order_and_sorts_the_rest() {
        let document = json!({"parameters": {"a": {"defaultValue": {"value": "1"}}, "b": {"defaultValue": {"value": "2"}}, "c": {}}});
        let names = |order: &[&str]| {
            let order: Vec<String> = order.iter().map(|s| (*s).to_owned()).collect();
            defaults_in(&document, &order)
                .into_iter()
                .map(|(k, _)| k)
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&["c", "a", "b"]), ["c", "a", "b"]);
        assert_eq!(names(&["b"]), ["b", "a", "c"]);
        assert_eq!(names(&[]), ["a", "b", "c"]);
    }

    proptest::proptest! {
        /// Any order of distinct names written in a body is the order of the defaults file.
        #[test]
        fn the_written_order_survives_into_the_file(names in proptest::collection::btree_set("[a-z][a-z0-9_]{0,8}", 1..12), seed in proptest::prelude::any::<u64>()) {
            let mut names: Vec<String> = names.into_iter().collect();
            // A deterministic shuffle from the seed.
            let mut state = seed | 1;
            for i in (1..names.len()).rev() {
                state ^= state << 13; state ^= state >> 7; state ^= state << 17;
                let j = usize::try_from(state % (i as u64 + 1)).unwrap();
                names.swap(i, j);
            }
            let members: Vec<String> = names.iter().map(|n| format!("{n:?}: {{\"defaultValue\": {{\"value\": \"v\"}}}}")).collect();
            let body = format!("{{\"parameters\": {{{}}}}}", members.join(", "));
            let order = written_order(body.as_bytes()).unwrap();
            proptest::prop_assert_eq!(&order, &names);
            let document: Value = serde_json::from_str(&body).unwrap();
            let keys: Vec<String> = defaults_in(&document, &order).into_iter().map(|(k, _)| k).collect();
            proptest::prop_assert_eq!(keys, names);
        }
    }
}
