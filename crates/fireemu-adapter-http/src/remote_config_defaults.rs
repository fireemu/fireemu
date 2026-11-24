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
//! Not recorded: how `>`, `'`, `=` or control characters are written in each format, and the
//! order of the entries, which Fireemu writes in its sorted member order (top-level parameters
//! first, then each group's).

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
}
