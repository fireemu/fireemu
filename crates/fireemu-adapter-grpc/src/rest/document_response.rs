//! Root-only framing for the selected single Document success envelope.

use serde::ser::{SerializeMap as _, Serializer as _};
use serde_json::Value;

/// Serialize the root in wire order, keeping every nested value and escape with `serde_json`.
pub(crate) fn to_vec(body: &Value) -> Result<Vec<u8>, serde_json::Error> {
    let document = body.as_object().expect("selected Document is an object");
    let keys = ["name", "fields", "createTime", "updateTime"];
    // The selected envelope includes an empty line when no known fields are present.
    if !keys.iter().any(|key| document.contains_key(*key)) {
        return Ok(b"{\n\n}\n".to_vec());
    }

    let mut bytes = Vec::new();
    let mut serializer = serde_json::Serializer::pretty(&mut bytes);
    let mut root = serializer.serialize_map(None)?;
    for key in keys {
        if let Some(value) = document.get(key) {
            root.serialize_entry(key, value)?;
        }
    }
    root.end()?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ordered_document_keeps_exact_root_and_nested_layout() {
        let body = json!({
            "updateTime": "2000Z",
            "unknown": "omitted",
            "name": "projects/é/documents/🔥",
            "fields": {"z": [{"stringValue": "a\nb"}, true]},
            "createTime": "1999Z"
        });
        assert_eq!(
            to_vec(&body).unwrap(),
            r#"{
  "name": "projects/é/documents/🔥",
  "fields": {
    "z": [
      {
        "stringValue": "a\nb"
      },
      true
    ]
  },
  "createTime": "1999Z",
  "updateTime": "2000Z"
}
"#
            .as_bytes(),
        );
        assert_eq!(to_vec(&json!({})).unwrap(), b"{\n\n}\n");
    }
}
