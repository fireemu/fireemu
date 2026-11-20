//! Replays Lean's shared identifier grammar and refusal order.

use fireemu_core_types::ids::{
    CollectionId, DatabaseId, DocumentId, IdSyntaxError, LimitCatalogId, ProjectId,
};

fn text(encoded: &str) -> String {
    assert_eq!(encoded.len() % 2, 0);
    let bytes = (0..encoded.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&encoded[i..i + 2], 16).unwrap())
        .collect();
    String::from_utf8(bytes).unwrap()
}

#[test]
fn identifier_constructors_follow_the_lean_error_precedence_and_byte_counts() {
    let mut lines = include_str!("fixtures/lean-type-identifiers.corpus").lines();
    assert_eq!(lines.next(), Some("# kind|shape|width|utf8|result"));
    let mut count = 0;
    for row in lines {
        let fields: Vec<_> = row.split('|').collect();
        let [kind, _, _, encoded, expected]: [&str; 5] = fields.try_into().expect("five fields");
        let input = text(encoded);
        let result = match kind {
            "project" => ProjectId::try_new(input.clone()).map(ProjectId::into_inner),
            "database" => DatabaseId::try_new(input.clone()).map(DatabaseId::into_inner),
            "catalog" => LimitCatalogId::try_new(input.clone()).map(LimitCatalogId::into_inner),
            "collection" => CollectionId::try_new(input.clone()).map(CollectionId::into_inner),
            "document" => DocumentId::try_new(input.clone()).map(DocumentId::into_inner),
            _ => panic!("unknown kind: {kind}"),
        };
        let actual = match result {
            Ok(value) => {
                assert_eq!(value, input);
                "ok".to_owned()
            }
            Err(IdSyntaxError::Empty) => "empty".to_owned(),
            Err(IdSyntaxError::TooManyBytes { bytes, maximum }) => {
                format!("long:{bytes}:{maximum}")
            }
            Err(IdSyntaxError::InvalidCharacter { offset }) => format!("invalid:{offset}"),
            Err(IdSyntaxError::LeadingOrTrailingHyphen) => "hyphen".to_owned(),
            Err(IdSyntaxError::ContainsSlash) => "slash".to_owned(),
            Err(IdSyntaxError::DotSegment) => "dot".to_owned(),
            Err(IdSyntaxError::ReservedDunder) => "dunder".to_owned(),
            Err(IdSyntaxError::ControlCharacter { offset }) => format!("control:{offset}"),
        };
        assert_eq!(actual, expected, "case {kind}: {input:?}");
        count += 1;
    }
    assert_eq!(count, 155);
}
