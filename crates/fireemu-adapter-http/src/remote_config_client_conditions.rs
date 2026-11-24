//! The client-template condition refusals production recorded on 2026-11-21
//! (`validation-edges-*`, `validation-resume-*`, `validate-*` `invalid-expression`), refused by the
//! strict profile only (the emulator profile keeps accepting every expression, as before).
//!
//! Two families, with production's messages:
//! - parser errors, `at line 1, column <c>. <reason>`, at the column of the token production's
//!   parser stopped at: an expression that does not start with a condition, `app.build` or
//!   `app.version` compared without a method, a method given a string instead of a list,
//!   `app.firstOpenTimestamp` and `dateTime` with an operator they do not take, and a percent
//!   value that is negative, above 100 or finer than a micro-percent;
//! - atom checks, `CONDITION_ATOMS_FAIL_VALIDATION Validation error: <reason> @
//!   <name>.OR[0].AND[<i>].<atom>`: NOT, an inverted percent range, more than 50 or malformed
//!   Installation ids, a custom-signal name over 250 characters, a country code that is not two
//!   letters, an unknown time zone, an app-version regular expression with unbalanced brackets;
//!   and the two-term OR refusal.
//!
//! Not here, and documented as known differences: `app.id`, audience and user-property refusals,
//! which depend on the project's apps and its Analytics data, not on the expression.

/// One token of an expression and its 1-based column.
#[derive(Clone, Debug, PartialEq)]
struct Token {
    text: String,
    column: usize,
    kind: Kind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Word,
    Number,
    Text,
    Symbol,
}

fn lex(expression: &str) -> Option<Vec<Token>> {
    let chars: Vec<char> = expression.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let column = i + 1;
        if c.is_whitespace() {
            i += 1;
        } else if c.is_ascii_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            tokens.push(Token {
                text: chars[start..i].iter().collect(),
                column,
                kind: Kind::Word,
            });
        } else if c.is_ascii_digit()
            || (c == '-' && chars.get(i + 1).is_some_and(char::is_ascii_digit))
        {
            let start = i;
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            tokens.push(Token {
                text: chars[start..i].iter().collect(),
                column,
                kind: Kind::Number,
            });
        } else if c == '\'' || c == '"' {
            let start = i + 1;
            i += 1;
            while i < chars.len() && chars[i] != c {
                i += 1;
            }
            if i >= chars.len() {
                return None;
            }
            tokens.push(Token {
                text: chars[start..i].iter().collect(),
                column,
                kind: Kind::Text,
            });
            i += 1;
        } else {
            let pair: String = chars[i..chars.len().min(i + 2)].iter().collect();
            let symbol = if ["&&", "||", "<=", ">=", "==", "!="].contains(&pair.as_str()) {
                pair
            } else {
                c.to_string()
            };
            i += symbol.chars().count();
            tokens.push(Token {
                text: symbol,
                column,
                kind: Kind::Symbol,
            });
        }
    }
    Some(tokens)
}

const COMPARISONS: [&str; 7] = ["<", "<=", "==", "!=", ">", ">=", "="];

/// The top-level `&&` atoms of the tokens between `||`s, with the number of `||` terms.
fn split<'a>(tokens: &'a [Token], separator: &str) -> Vec<&'a [Token]> {
    let mut parts = Vec::new();
    let mut depth = 0_i32;
    let mut start = 0;
    for (i, token) in tokens.iter().enumerate() {
        match token.text.as_str() {
            "(" | "[" if token.kind == Kind::Symbol => depth += 1,
            ")" | "]" if token.kind == Kind::Symbol => depth -= 1,
            text if depth == 0 && token.kind == Kind::Symbol && text == separator => {
                parts.push(&tokens[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&tokens[start..]);
    parts
}

fn parse_error(column: usize, reason: &str) -> String {
    format!("[VALIDATION_ERROR]: at line 1, column {column}. {reason}")
}

fn atom_error(name: &str, index: usize, atom: &str, reason: &str) -> String {
    format!("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: {reason} @ {name}.OR[0].AND[{index}].{atom}")
}

/// The text of the tokens, for matching an atom's head.
fn words(tokens: &[Token]) -> Vec<&str> {
    tokens.iter().map(|token| token.text.as_str()).collect()
}

/// The parser error of one atom, if production's grammar stops inside it.
fn atom_parse_error(atom: &[Token]) -> Option<String> {
    let atom = strip_parens(atom);
    let first = atom.first()?;
    let start = [
        "(", "!", "true", "false", "app", "dateTime", "device", "percent", "version",
    ];
    if !start.contains(&first.text.as_str()) {
        return Some(parse_error(
            first.column,
            "Was expecting one of: '(' '!' 'true' 'false' 'app' 'dateTime' 'device' 'percent' 'version'",
        ));
    }
    let text = words(atom);
    // `app.build` and `app.version` take a method (2026-11-21 app-build-number, app-version-semver).
    if text.len() >= 4
        && text[0] == "app"
        && text[1] == "."
        && ["build", "version"].contains(&text[2])
    {
        if COMPARISONS.contains(&text[3]) {
            return Some(parse_error(atom[3].column, "Was expecting: '.'"));
        }
        // A method takes a list (app-build-numeric-method, app-version-semver-method).
        if text.len() >= 7
            && text[3] == "."
            && COMPARISONS.contains(&text[4])
            && text[5] == "("
            && atom[6].kind == Kind::Text
        {
            return Some(parse_error(atom[6].column, "Was expecting: '['"));
        }
    }
    if text.len() >= 4
        && text[..3] == ["app", ".", "firstOpenTimestamp"]
        && COMPARISONS.contains(&text[3])
        && !["<=", ">"].contains(&text[3])
    {
        return Some(parse_error(
            atom[3].column,
            "Was expecting one of: '<=' '>'",
        ));
    }
    if text.len() >= 2
        && text[0] == "dateTime"
        && COMPARISONS.contains(&text[1])
        && !["<", ">="].contains(&text[1])
    {
        return Some(parse_error(
            atom[1].column,
            "Was expecting one of: '<' '>='",
        ));
    }
    if text.first() == Some(&"percent") {
        for value in percent_values(atom) {
            if let Some(reason) = percent_value_error(&value.text) {
                return Some(parse_error(value.column, reason));
            }
        }
    }
    None
}

fn strip_parens(mut atom: &[Token]) -> &[Token] {
    while atom.len() >= 2 && atom[0].text == "(" && atom[atom.len() - 1].text == ")" {
        atom = &atom[1..atom.len() - 1];
    }
    atom
}

/// The number tokens of a `percent` atom: after its comparison, or the two bounds of `between`.
fn percent_values(atom: &[Token]) -> Vec<&Token> {
    let mut rest = &atom[1..];
    if rest.first().is_some_and(|token| token.text == "(") {
        rest = rest.get(3..).unwrap_or_default();
    }
    match rest.first().map(|token| token.text.as_str()) {
        Some("between") => rest
            .iter()
            .filter(|token| token.kind == Kind::Number)
            .take(2)
            .collect(),
        Some(op) if COMPARISONS.contains(&op) => rest
            .get(1)
            .filter(|t| t.kind == Kind::Number)
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

fn percent_value_error(value: &str) -> Option<&'static str> {
    if value.starts_with('-') {
        return Some("Percent value cannot be negative");
    }
    if value.parse::<f64>().ok()? > 100.0 {
        return Some("A percent value is out of range");
    }
    let decimals = value
        .split_once('.')
        .map_or(0, |(_, fraction)| fraction.len());
    (decimals > 6)
        .then_some("A percent value has more than 6 significant digits after the decimal point")
}

fn micro(value: &str) -> Option<u64> {
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    let fraction = format!("{fraction:0<6}");
    format!("{whole}{}", &fraction[..6]).parse().ok()
}

/// A Firebase Installation id: 22 base64url characters whose first one carries the FID prefix
/// (`c` to `f`); the recorded accepted ids have this form and the refused one does not.
fn installation_id(id: &str) -> bool {
    id.len() == 22
        && id.starts_with(['c', 'd', 'e', 'f'])
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn balanced(pattern: &str) -> bool {
    let mut stack = Vec::new();
    let mut chars = pattern.chars();
    let mut in_class = false;
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                chars.next();
            }
            ']' if in_class => in_class = false,
            _ if in_class => {}
            '[' => in_class = true,
            '(' => stack.push(c),
            ')' if stack.pop().is_none() => return false,
            _ => {}
        }
    }
    !in_class && stack.is_empty()
}

type Check = Option<(&'static str, String)>;

/// The text literals of an atom from token `from` on.
fn texts(atom: &[Token], from: usize) -> Vec<&str> {
    atom.get(from..)
        .unwrap_or_default()
        .iter()
        .filter(|token| token.kind == Kind::Text)
        .map(|token| token.text.as_str())
        .collect()
}

fn percent_range(atom: &[Token], text: &[&str]) -> Check {
    if text.first() != Some(&"percent") || !text.contains(&"between") {
        return None;
    }
    let [low, high] = percent_values(atom)[..] else {
        return None;
    };
    let (low, high) = (micro(&low.text)?, micro(&high.text)?);
    (low > high).then(|| {
        (
            "PERCENT",
            format!("Invalid micro percent range ({low}, {high}]."),
        )
    })
}

fn installation_ids(atom: &[Token], text: &[&str]) -> Check {
    if text.len() < 4 || text[..3] != ["app", ".", "firebaseInstallationId"] || text[3] != "in" {
        return None;
    }
    let ids = texts(atom, 4);
    if ids.len() > 50 {
        let reason = format!(
            "Too many target firebase installation ids (50 allowed, {} found)",
            ids.len()
        );
        return Some(("FIREBASE_INSTALLATION_ID", reason));
    }
    let invalid: Vec<&str> = ids.into_iter().filter(|id| !installation_id(id)).collect();
    (!invalid.is_empty()).then(|| {
        (
            "FIREBASE_INSTALLATION_ID",
            format!(
                "Invalid firebase installation ids : [{}]",
                invalid.join(", ")
            ),
        )
    })
}

fn custom_signal(atom: &[Token], text: &[&str]) -> Check {
    let at = text
        .windows(4)
        .position(|w| w == ["app", ".", "customSignal", "["])?;
    let key = atom.get(at + 4).filter(|token| token.kind == Kind::Text)?;
    let length = key.text.chars().count();
    (length > 250).then(|| {
        (
            "CUSTOM_SIGNAL",
            format!("Custom signal name too long (max 250, found {length})"),
        )
    })
}

fn country(atom: &[Token], text: &[&str]) -> Check {
    if text.len() < 4 || text[..3] != ["device", ".", "country"] || text[3] != "in" {
        return None;
    }
    let code = texts(atom, 4)
        .into_iter()
        .find(|code| !(code.len() == 2 && code.bytes().all(|b| b.is_ascii_alphabetic())))?;
    Some(("COUNTRIES", format!("Invalid country code '{code}'")))
}

fn time_zone(atom: &[Token], text: &[&str], zone_known: Option<fn(&str) -> bool>) -> Check {
    if text.first() != Some(&"dateTime") {
        return None;
    }
    let known = zone_known?;
    let [_, zone] = texts(atom, 1)[..] else {
        return None;
    };
    (!known(zone)).then(|| ("TIME", format!("Invalid time zone: '{zone}'")))
}

fn app_version_pattern(atom: &[Token], text: &[&str]) -> Check {
    if text.len() < 5 || text[..5] != ["app", ".", "version", ".", "matches"] {
        return None;
    }
    let pattern = texts(atom, 5)
        .into_iter()
        .find(|pattern| !balanced(pattern))?;
    Some((
        "APP_VERSION",
        format!("Invalid app version regex target value: {pattern}"),
    ))
}

/// The atom check of one parsed atom at `index` of the top-level `&&` chain.
fn atom_check(
    name: &str,
    index: usize,
    atom: &[Token],
    zone_known: Option<fn(&str) -> bool>,
) -> Option<String> {
    let atom = strip_parens(atom);
    let text = words(atom);
    let found = if text.first() == Some(&"!") {
        Some(("NOT", "NOT condition is not allowed here".to_owned()))
    } else {
        percent_range(atom, &text)
            .or_else(|| installation_ids(atom, &text))
            .or_else(|| custom_signal(atom, &text))
            .or_else(|| country(atom, &text))
            .or_else(|| time_zone(atom, &text, zone_known))
            .or_else(|| app_version_pattern(atom, &text))
    };
    found.map(|(kind, reason)| atom_error(name, index, kind, &reason))
}

/// Production's refusal of a client condition, or `None` when production's recorded rules
/// accept it (or it was not recorded).
pub(crate) fn client_refusal(
    name: &str,
    expression: &str,
    zone_known: Option<fn(&str) -> bool>,
) -> Option<String> {
    let tokens = lex(expression)?;
    let terms = split(&tokens, "||");
    for term in &terms {
        for atom in split(term, "&&") {
            if let Some(error) = atom_parse_error(atom) {
                return Some(error);
            }
        }
    }
    if terms.len() > 1 {
        return Some(format!(
            "[VALIDATION_ERROR]: Expected exactly one term in OR condition for condition with name [{name}], found {}",
            terms.len()
        ));
    }
    split(&tokens, "&&")
        .into_iter()
        .enumerate()
        .find_map(|(index, atom)| atom_check(name, index, atom, zone_known))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zones(zone: &str) -> bool {
        zone == "Asia/Tokyo"
    }

    /// Every recorded client expression (2026-11-21), with production's answer: `None` for an
    /// accepted one, the refusal message otherwise. Condition name `fireemu_match` throughout.
    fn recorded() -> Vec<(&'static str, String, Option<&'static str>)> {
        let ids = |n: usize, valid: bool| {
            let list: Vec<String> = (0..n)
                .map(|i| {
                    if valid {
                        format!("'c{i:021}'")
                    } else {
                        "'synthetic-not-valid'".into()
                    }
                })
                .collect();
            format!("app.firebaseInstallationId in [{}]", list.join(", "))
        };
        vec![
            ("percent-zero", "percent <= 0".into(), None),
            ("percent-fraction", "percent <= 0.000001".into(), None),
            ("percent-fraction-overprecision", "percent <= 0.0000001".into(), Some("[VALIDATION_ERROR]: at line 1, column 12. A percent value has more than 6 significant digits after the decimal point")),
            ("percent-negative", "percent <= -1".into(), Some("[VALIDATION_ERROR]: at line 1, column 12. Percent value cannot be negative")),
            ("percent-above-max", "percent <= 101".into(), Some("[VALIDATION_ERROR]: at line 1, column 12. A percent value is out of range")),
            ("percent-above", "percent > 50".into(), None),
            ("percent-range", "percent between 10 and 60".into(), None),
            ("percent-inverted-range", "percent between 60 and 10".into(), Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Invalid micro percent range (60000000, 10000000]. @ fireemu_match.OR[0].AND[0].PERCENT")),
            ("percent-seeded", "percent('fireemu') <= 50".into(), None),
            ("percent-seeded-range", "percent('fireemu') between 10 and 60".into(), None),
            ("conjunction", "percent > 0 && percent <= 100".into(), None),
            ("disjunction", "percent > 0 || percent <= 100".into(), Some("[VALIDATION_ERROR]: Expected exactly one term in OR condition for condition with name [fireemu_match], found 2")),
            ("parenthesized", "(percent > 0 && percent <= 100)".into(), None),
            ("negation", "!(percent > 0)".into(), Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: NOT condition is not allowed here @ fireemu_match.OR[0].AND[0].NOT")),
            ("app-build-number", "app.build >= 123".into(), Some("[VALIDATION_ERROR]: at line 1, column 11. Was expecting: '.'")),
            ("app-build-string", "app.build.exactlyMatches(['123'])".into(), None),
            ("app-version-semver", "app.version >= '1.2.3'".into(), Some("[VALIDATION_ERROR]: at line 1, column 13. Was expecting: '.'")),
            ("app-version-prerelease", "app.version >= '1.2.3-beta'".into(), Some("[VALIDATION_ERROR]: at line 1, column 13. Was expecting: '.'")),
            ("app-version-regex", "app.version.matches(['^1[.]2'])".into(), None),
            ("app-version-malformed-regex", "app.version.matches(['['])".into(), Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Invalid app version regex target value: [ @ fireemu_match.OR[0].AND[0].APP_VERSION")),
            ("app-browser", "app.browserAndVersion.inOne([browserName('Chrome').anyVersion])".into(), None),
            ("app-browser-unknown", "app.browserAndVersion.inOne([browserName('fireemu').anyVersion])".into(), None),
            ("app-os-version", "app.operatingSystemAndVersion.inOne([operatingSystemName('Macintosh').version.==('10.15')])".into(), None),
            ("install-id", "app.firebaseInstallationId in ['eyJhbGciOiJFUzI1N_iIs5']".into(), None),
            ("install-id-bad", "app.firebaseInstallationId in ['synthetic-not-valid']".into(), Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Invalid firebase installation ids : [synthetic-not-valid] @ fireemu_match.OR[0].AND[0].FIREBASE_INSTALLATION_ID")),
            ("custom-number", "app.customSignal['fireemu'] >= 12".into(), None),
            ("custom-exact", "app.customSignal['fireemu'].exactlyMatches(['synthetic'])".into(), None),
            ("custom-regex", "app.customSignal['fireemu'].matches(['^synthetic$'])".into(), None),
            ("custom-semver", "version(app.customSignal['fireemu']) >= '1.2.3'".into(), None),
            ("first-open-time", "app.firstOpenTimestamp >= ('2026-01-01T00:00:00')".into(), Some("[VALIDATION_ERROR]: at line 1, column 24. Was expecting one of: '<=' '>'")),
            ("device-country", "device.country in ['jp', 'us']".into(), None),
            ("device-invalid-country", "device.country in ['invalid']".into(), Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Invalid country code 'invalid' @ fireemu_match.OR[0].AND[0].COUNTRIES")),
            ("device-language", "device.language in ['ja-JP', 'en-US']".into(), None),
            ("device-os", "device.os == 'android'".into(), None),
            ("device-date-time", "dateTime <= dateTime('2026-12-31T23:59:59', 'Asia/Tokyo')".into(), Some("[VALIDATION_ERROR]: at line 1, column 10. Was expecting one of: '<' '>='")),
            ("device-date-no-zone", "dateTime <= dateTime('2026-12-31T23:59:59')".into(), Some("[VALIDATION_ERROR]: at line 1, column 10. Was expecting one of: '<' '>='")),
            ("device-date-invalid-zone", "dateTime <= dateTime('2026-12-31T23:59:59', 'Fireemu/Invalid')".into(), Some("[VALIDATION_ERROR]: at line 1, column 10. Was expecting one of: '<' '>='")),
            ("install-id-size-49", ids(49, true), None),
            ("install-id-size-50", ids(50, true), None),
            ("install-id-size-51", ids(51, true), Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Too many target firebase installation ids (50 allowed, 51 found) @ fireemu_match.OR[0].AND[0].FIREBASE_INSTALLATION_ID")),
            ("targeted-custom-key-250", format!("app.customSignal['{}'] >= 12", "k".repeat(250)), None),
            ("app-build-numeric-method", "app.build.>=('123')".into(), Some("[VALIDATION_ERROR]: at line 1, column 14. Was expecting: '['")),
            ("app-version-semver-method", "app.version.>=('1.2.3')".into(), Some("[VALIDATION_ERROR]: at line 1, column 16. Was expecting: '['")),
            ("first-open-lt", "app.firstOpenTimestamp <= ('2026-01-01T00:00:00')".into(), None),
            ("first-open-gt-zone", "app.firstOpenTimestamp > ('2026-01-01T00:00:00', 'Asia/Tokyo')".into(), None),
            ("date-time-before-tz", "dateTime < dateTime('2026-12-31T23:59:59', 'Asia/Tokyo')".into(), None),
            ("date-time-after-nozone", "dateTime >= dateTime('2026-12-31T23:59:59')".into(), None),
            ("date-time-before-invalid-zone", "dateTime < dateTime('2026-12-31T23:59:59', 'Fireemu/Invalid')".into(), Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Invalid time zone: 'Fireemu/Invalid' @ fireemu_match.OR[0].AND[0].TIME")),
            ("invalid-expression", "unknown.thing = no".into(), Some("[VALIDATION_ERROR]: at line 1, column 1. Was expecting one of: '(' '!' 'true' 'false' 'app' 'dateTime' 'device' 'percent' 'version'")),
            ("default", "percent <= 100".into(), None),
        ]
    }

    #[test]
    fn every_recorded_client_expression_gets_production_answer() {
        for (case, expression, expected) in recorded() {
            assert_eq!(
                client_refusal("fireemu_match", &expression, Some(zones)).as_deref(),
                expected,
                "{case}: {expression}"
            );
        }
        let long = format!("app.customSignal['{}'] >= 12", "k".repeat(251));
        assert_eq!(
            client_refusal("fireemu_match", &long, Some(zones)).as_deref(),
            Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Custom signal name too long (max 250, found 251) @ fireemu_match.OR[0].AND[0].CUSTOM_SIGNAL")
        );
    }

    #[test]
    fn atoms_are_indexed_in_the_and_chain_and_named_by_the_condition() {
        assert_eq!(
            client_refusal("c", "percent <= 10 && device.country in ['xyz']", Some(zones)).as_deref(),
            Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Invalid country code 'xyz' @ c.OR[0].AND[1].COUNTRIES")
        );
        assert_eq!(
            client_refusal("c", "percent > 0 && percent <= 101", None).as_deref(),
            Some("[VALIDATION_ERROR]: at line 1, column 27. A percent value is out of range")
        );
        // Without a zone database the zone is not checked.
        assert_eq!(
            client_refusal(
                "c",
                "dateTime < dateTime('2026-01-01T00:00:00', 'Fireemu/Invalid')",
                None
            ),
            None
        );
        assert_eq!(client_refusal("c", "percent between 0.5 and 0.25", None).as_deref(), Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Invalid micro percent range (500000, 250000]. @ c.OR[0].AND[0].PERCENT"));
        assert_eq!(
            client_refusal("c", "percent('s') <= 100.0000001", None).as_deref(),
            Some("[VALIDATION_ERROR]: at line 1, column 17. A percent value is out of range")
        );
        assert_eq!(client_refusal("c", "app.firebaseInstallationId in ['bad-1', 'cAAAAAAAAAAAAAAAAAAAAA', 'bad-2']", None).as_deref(), Some("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: Invalid firebase installation ids : [bad-1, bad-2] @ c.OR[0].AND[0].FIREBASE_INSTALLATION_ID"));
    }

    #[test]
    fn analytics_and_app_registry_conditions_are_not_judged() {
        for expression in [
            "app.id == 'fireemu.nonexistent.app'",
            "app.audiences.inAtLeastOne(['fireemu_missing'])",
            "app.userProperty['fireemu'] >= 12",
            "app.userProperty['fireemu'].matches(['^synthetic$'])",
        ] {
            assert_eq!(
                client_refusal("c", expression, Some(zones)),
                None,
                "{expression}"
            );
        }
    }

    #[test]
    fn regular_expressions_and_installation_ids_follow_their_shapes() {
        for (pattern, ok) in [
            ("[", false),
            ("(", false),
            (")", false),
            ("^1[.]2", true),
            (r"\[", true),
            ("[(]", true),
            ("(a)", true),
        ] {
            assert_eq!(balanced(pattern), ok, "{pattern}");
        }
        assert!(installation_id("eyJhbGciOiJFUzI1N_iIs5"));
        assert!(installation_id("c000000000000000000000"));
        for id in [
            "synthetic-not-valid",
            "a00000000000000000000",
            "c0000000000000000000000",
            "c00000000000000000000!",
        ] {
            assert!(!installation_id(id), "{id}");
        }
        assert_eq!(micro("0.5"), Some(500_000));
        assert_eq!(micro("60"), Some(60_000_000));
        assert_eq!(micro("0.000001"), Some(1));
    }

    proptest::proptest! {
        #[test]
        fn percent_values_within_range_and_precision_are_accepted(whole in 0_u32..100, fraction in 0_u32..1_000_000, digits in 0_usize..=6) {
            let value = if digits == 0 { whole.to_string() } else { format!("{whole}.{:0width$}", fraction % 10_u32.pow(u32::try_from(digits).unwrap()), width = digits) };
            proptest::prop_assert_eq!(client_refusal("c", &format!("percent <= {value}"), None), None);
            proptest::prop_assert_eq!(client_refusal("c", &format!("percent('s') between 0 and {value}"), None), None);
        }

        #[test]
        fn the_error_column_follows_the_value_token(spaces in 1_usize..5) {
            let expression = format!("percent{}<={}-1", " ".repeat(spaces), " ".repeat(spaces));
            let column = 7 + spaces + 2 + spaces + 1;
            proptest::prop_assert_eq!(
                client_refusal("c", &expression, None),
                Some(format!("[VALIDATION_ERROR]: at line 1, column {column}. Percent value cannot be negative"))
            );
        }
    }
}
