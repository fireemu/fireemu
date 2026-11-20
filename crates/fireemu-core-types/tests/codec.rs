//! Boundary tests for the public wire codecs.

use fireemu_core_types::codec::{echo, json_escape_into, JsonControlEscape, MAX_ECHO_BYTES};

#[test]
fn json_control_escaping_stops_at_the_first_printable_ascii_byte() {
    let mut output = String::new();
    json_escape_into(&mut output, "\r\t\u{1f} ", JsonControlEscape::Unicode);
    assert_eq!(output, "\\r\\t\\u001f ");
}

#[test]
fn echo_truncates_at_the_first_excess_byte_without_splitting_utf8() {
    let exact = "x".repeat(MAX_ECHO_BYTES);
    assert_eq!(echo(&format!("{exact}x")), format!("{exact}..."));

    let prefix = "x".repeat(MAX_ECHO_BYTES - 1);
    assert_eq!(echo(&format!("{prefix}é")), format!("{prefix}..."));
}
