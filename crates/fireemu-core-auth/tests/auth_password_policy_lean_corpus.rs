//! Replays the Lean password policy model through the public Auth core API.

use fireemu_core_auth::password_policy::{
    default_allowed_non_alphanumeric, ConfigError, EnforcementState, Operation, PasswordPolicy,
};

const CORPUS: &str = include_str!("fixtures/lean-auth-password-policy.corpus");

fn sample(tag: &str) -> String {
    match tag {
        "empty" => String::new(),
        "short" => "aA1!".into(),
        "min" => "abcA1!".into(),
        "max" => "abcdeA1!".into(),
        "above" => "abcdefA1!".into(),
        "emoji" => "😀😀😀".into(),
        "unicode" => "éÅ١😀+".into(),
        "symbols" => "abcA1+".into(),
        "custom" => "abcA1 ".into(),
        _ => panic!("unknown candidate {tag}"),
    }
}

fn check_policy(fields: [&str; 7], line: &str) {
    let [state, force, operation, profile, candidate, violations, rejected] = fields;
    let state = match state {
        "off" => EnforcementState::Off,
        "unspecified" => EnforcementState::Unspecified,
        "enforce" => EnforcementState::Enforce,
        _ => panic!("unknown state {state}"),
    };
    let operation = match operation {
        "register" => Operation::Registration,
        "add" => Operation::CredentialAddition,
        "change" => Operation::Change,
        "admin" => Operation::AdminUpdate,
        "reset" => Operation::Reset,
        "signin" => Operation::SignIn,
        _ => panic!("unknown operation {operation}"),
    };
    let needs_classes = match profile {
        "length" => false,
        "classes" | "custom" => true,
        _ => panic!("unknown profile {profile}"),
    };
    let allowed = if profile == "custom" {
        ['+', ' '].into_iter().collect()
    } else {
        default_allowed_non_alphanumeric()
    };
    let policy = PasswordPolicy::try_new(
        state,
        force == "yes",
        6,
        Some(8),
        needs_classes,
        needs_classes,
        needs_classes,
        needs_classes,
        allowed,
    )
    .unwrap();
    let password = sample(candidate);
    let actual = policy
        .violations(&password)
        .into_iter()
        .map(|code| code.as_str())
        .collect::<Vec<_>>()
        .join(",");
    assert_eq!(
        actual,
        if violations == "-" { "" } else { violations },
        "{line}"
    );
    assert_eq!(
        policy.rejects(operation, &password),
        rejected == "reject",
        "{line}"
    );
}

fn check_config(fields: [&str; 4], line: &str) {
    let [min, max, punctuation, failure] = fields;
    let punctuation = match punctuation {
        "empty" => "",
        "plus" => "+",
        "space" => " ",
        "alpha" => "A",
        "control" => "\u{7f}",
        "unicode" => "é",
        _ => panic!("unknown punctuation {punctuation}"),
    };
    let policy = PasswordPolicy::try_new(
        EnforcementState::Off,
        false,
        min.parse().unwrap(),
        (max != "-").then(|| max.parse().unwrap()),
        false,
        false,
        false,
        false,
        punctuation.chars().collect(),
    );
    let actual = match policy {
        Ok(policy) => {
            assert!(policy.configured && policy.min_length_written, "{line}");
            "valid"
        }
        Err(ConfigError::InvalidMinimumLength) => "min",
        Err(ConfigError::InvalidMaximumLength) => "max",
        Err(ConfigError::InvalidAllowedCharacter) => "punctuation",
    };
    assert_eq!(actual, failure, "{line}");
}

#[test]
fn password_policy_agrees_with_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let header = lines.next().unwrap().strip_prefix("# cases ").unwrap();
    assert_eq!(header.parse::<usize>().unwrap(), lines.clone().count());
    assert!(lines.clone().count() > 900);
    for line in lines {
        let columns = line.split_ascii_whitespace().collect::<Vec<_>>();
        match columns.split_first() {
            Some((&"policy", fields)) => check_policy(fields.try_into().unwrap(), line),
            Some((&"config", fields)) => check_config(fields.try_into().unwrap(), line),
            _ => panic!("malformed case {line}"),
        }
    }
}
