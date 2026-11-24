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

/// The shape of an expression: each token's text, with a number as `#` and a string as `'`.
fn shape(tokens: &[Token]) -> Vec<&str> {
    tokens
        .iter()
        .map(|token| match token.kind {
            Kind::Number => "#",
            Kind::Text => "'",
            Kind::Word | Kind::Symbol => token.text.as_str(),
        })
        .collect()
}

/// Whether `shape` is `prefix` followed by a bracketed list of strings and `suffix`.
fn list_shape(shape: &[&str], prefix: &[&str], suffix: &[&str]) -> bool {
    let Some(rest) = shape.strip_prefix(prefix) else {
        return false;
    };
    let Some(list) = rest.strip_suffix(suffix) else {
        return false;
    };
    list.len() >= 3
        && list[0] == "["
        && list[list.len() - 1] == "]"
        && list[1..list.len() - 1]
            .iter()
            .enumerate()
            .all(|(i, part)| *part == if i % 2 == 0 { "'" } else { "," })
        && list.len() % 2 == 1
}

fn parse_error(column: usize, reason: &str) -> String {
    format!("[VALIDATION_ERROR]: at line 1, column {column}. {reason}")
}

fn atom_error(name: &str, atom: &str, reason: &str) -> String {
    format!("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: {reason} @ {name}.OR[0].AND[0].{atom}")
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

/// The parser error production gave for one of the recorded expression forms, each a whole
/// expression of one condition (no `&&`, no outer parentheses).
fn parse_failure(tokens: &[Token], shape: &[&str]) -> Option<String> {
    let first = tokens.first()?;
    let start = [
        "(", "!", "true", "false", "app", "dateTime", "device", "percent", "version",
    ];
    if first.kind == Kind::Word && !start.contains(&first.text.as_str()) {
        // `unknown.thing = no` (2026-11-21 invalid-expression).
        return Some(parse_error(
            1,
            "Was expecting one of: '(' '!' 'true' 'false' 'app' 'dateTime' 'device' 'percent' 'version'",
        ));
    }
    match shape {
        // `app.build >= 123`, `app.version >= '1.2.3'` (app-build-number, app-version-semver).
        ["app", ".", "build" | "version", ">=", "#" | "'"] => {
            Some(parse_error(tokens[3].column, "Was expecting: '.'"))
        }
        // `app.build.>=('123')` (app-build-numeric-method, app-version-semver-method).
        ["app", ".", "build" | "version", ".", ">=", "(", "'", ")"] => {
            Some(parse_error(tokens[6].column, "Was expecting: '['"))
        }
        // `app.firstOpenTimestamp >= ('…')` (first-open-time).
        ["app", ".", "firstOpenTimestamp", ">=", "(", "'", ")"] => Some(parse_error(
            tokens[3].column,
            "Was expecting one of: '<=' '>'",
        )),
        // `dateTime <= dateTime('…'[, '…'])` (device-date-time, -no-zone, -invalid-zone).
        ["dateTime", "<=", "dateTime", "(", "'", ")"]
        | ["dateTime", "<=", "dateTime", "(", "'", ",", "'", ")"] => Some(parse_error(
            tokens[1].column,
            "Was expecting one of: '<' '>='",
        )),
        // `percent <= n`, `percent > n` (percent-negative, -above-max, -fraction-overprecision).
        ["percent", "<=" | ">", "#"] => {
            percent_value_error(&tokens[2].text).map(|reason| parse_error(tokens[2].column, reason))
        }
        _ => None,
    }
}

/// The condition check production gave for one of the recorded expression forms.
fn atom_failure(
    name: &str,
    tokens: &[Token],
    shape: &[&str],
    zone_known: Option<fn(&str) -> bool>,
) -> Option<String> {
    let texts = || {
        tokens
            .iter()
            .filter(|token| token.kind == Kind::Text)
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>()
    };
    // `!(percent > 0)` (negation): a whole expression under NOT.
    if shape.len() >= 3 && shape[0] == "!" && shape[1] == "(" && shape[shape.len() - 1] == ")" {
        return Some(atom_error(name, "NOT", "NOT condition is not allowed here"));
    }
    if let ["percent", "between", "#", "and", "#"] = shape {
        let (low, high) = (micro(&tokens[2].text)?, micro(&tokens[4].text)?);
        return (low > high).then(|| {
            atom_error(
                name,
                "PERCENT",
                &format!("Invalid micro percent range ({low}, {high}]."),
            )
        });
    }
    if list_shape(shape, &["app", ".", "firebaseInstallationId", "in"], &[]) {
        let ids = texts();
        if ids.len() > 50 {
            return Some(atom_error(
                name,
                "FIREBASE_INSTALLATION_ID",
                &format!(
                    "Too many target firebase installation ids (50 allowed, {} found)",
                    ids.len()
                ),
            ));
        }
        let invalid: Vec<&str> = ids.into_iter().filter(|id| !installation_id(id)).collect();
        return (!invalid.is_empty()).then(|| {
            atom_error(
                name,
                "FIREBASE_INSTALLATION_ID",
                &format!(
                    "Invalid firebase installation ids : [{}]",
                    invalid.join(", ")
                ),
            )
        });
    }
    if let ["app", ".", "customSignal", "[", "'", "]", ">=", "#"] = shape {
        let length = tokens[4].text.chars().count();
        return (length > 250).then(|| {
            atom_error(
                name,
                "CUSTOM_SIGNAL",
                &format!("Custom signal name too long (max 250, found {length})"),
            )
        });
    }
    if list_shape(shape, &["device", ".", "country", "in"], &[]) {
        let code = texts()
            .into_iter()
            .find(|code| !(code.len() == 2 && code.bytes().all(|b| b.is_ascii_alphabetic())))?;
        return Some(atom_error(
            name,
            "COUNTRIES",
            &format!("Invalid country code '{code}'"),
        ));
    }
    if let ["dateTime", "<", "dateTime", "(", "'", ",", "'", ")"] = shape {
        let zone = tokens[6].text.as_str();
        return (!zone_known?(zone))
            .then(|| atom_error(name, "TIME", &format!("Invalid time zone: '{zone}'")));
    }
    if list_shape(shape, &["app", ".", "version", ".", "matches", "("], &[")"]) {
        let pattern = texts().into_iter().find(|pattern| !balanced(pattern))?;
        return Some(atom_error(
            name,
            "APP_VERSION",
            &format!("Invalid app version regex target value: {pattern}"),
        ));
    }
    None
}

/// Whether two `||` terms are each one of the recorded percent conditions (`percent > 0 || percent
/// <= 100`, 2026-11-21 disjunction).
fn recorded_or(terms: &[&[Token]]) -> bool {
    terms.len() == 2
        && terms.iter().all(|term| {
            matches!(shape(term).as_slice(), ["percent", "<=" | ">", "#"])
                && percent_value_error(&term[2].text).is_none()
        })
}

/// Production's refusal of a client condition in one of the forms recorded on 2026-11-21, or
/// `None`: every other expression keeps the earlier acceptance (coordinator ruling 5).
pub(crate) fn client_refusal(
    name: &str,
    expression: &str,
    zone_known: Option<fn(&str) -> bool>,
) -> Option<String> {
    let tokens = lex(expression)?;
    let terms = split(&tokens, "||");
    if terms.len() > 1 {
        return recorded_or(&terms).then(|| {
            format!("[VALIDATION_ERROR]: Expected exactly one term in OR condition for condition with name [{name}], found 2")
        });
    }
    if split(&tokens, "&&").len() > 1 {
        return None;
    }
    let shape = shape(&tokens);
    parse_failure(&tokens, &shape).or_else(|| atom_failure(name, &tokens, &shape, zone_known))
}

/// The top-level parts of the tokens between `separator`s, ignoring brackets and parentheses.
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
            "a000000000000000000000",
            "c0000000000000000000000",
            "c00000000000000000000!",
        ] {
            assert!(!installation_id(id), "{id}");
        }
        assert_eq!(micro("0.5"), Some(500_000));
        assert_eq!(micro("60"), Some(60_000_000));
        assert_eq!(micro("0.000001"), Some(1));
    }

    /// Every expression outside the recorded forms keeps the earlier acceptance (coordinator
    /// ruling 5), including the review's three inputs; the recorded forms with other values
    /// still get production's answer.
    #[test]
    fn only_the_recorded_forms_are_refused() {
        let column = |c: usize, reason: &str| {
            Some(format!(
                "[VALIDATION_ERROR]: at line 1, column {c}. {reason}"
            ))
        };
        let atom = |kind: &str, reason: &str| {
            Some(format!("[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: {reason} @ c.OR[0].AND[0].{kind}"))
        };
        let start = "Was expecting one of: '(' '!' 'true' 'false' 'app' 'dateTime' 'device' 'percent' 'version'";
        let word_key = format!("app.customSignal[{}] >= 1", "k".repeat(251));
        let long_key = format!("app.customSignal['{}'] <= 1", "k".repeat(251));
        let cases: Vec<(&str, Option<String>)> = vec![
            // The review's inputs (coordinator ruling 5 item 2).
            ("percent != -1", None),
            ("percent <= -1e-6", None),
            ("(percent <= -1)", None),
            // Seeded, chained, parenthesised and other-operator variants were not recorded.
            ("percent('s') <= 101", None),
            ("percent > 0 && percent <= 101", None),
            ("percent <= 10 && device.country in ['xyz']", None),
            ("percent >= 101", None),
            ("percent < -1", None),
            ("percent('s') between 60 and 10", None),
            ("(percent > 0) || percent > 1", None),
            ("percent > 0 || percent <= 100 || percent > 1", None),
            ("percent > 0 || percent <= 101", None),
            ("percent > 0 || device.os == 'ios'", None),
            ("app.build > 123", None),
            ("app.build >=", None),
            ("app.build.>=('1'", None),
            ("app.build.<=('1')", None),
            ("app.firstOpenTimestamp >=", None),
            ("app.firstOpenTimestamp == ('2026-01-01T00:00:00')", None),
            ("dateTime <=", None),
            ("dateTime > dateTime('2026-12-31T23:59:59')", None),
            ("dateTime < dateTime('2026-12-31T23:59:59')", None),
            ("app.customSignal['x'].matches(['['])", None),
            (word_key.as_str(), None),
            (long_key.as_str(), None),
            ("device.country == 'xyz'", None),
            ("device.country in ['jp", None),
            ("device.os == '||'", None),
            ("app.firebaseInstallationId == 'bad'", None),
            ("app.firebaseInstallationId in ['c-00000000000000000000']", None),
            ("!percent", None),
            ("", None),
            // Near misses of the shapes: a first token that is not a word, a list without its
            // brackets, a NOT without its parentheses, nested parentheses, a chain of NOTs.
            ("'x' <= 101", None),
            ("5 > percent", None),
            ("device.country in ('xyz']", None),
            ("device.country in ['xyz')", None),
            ("!percent)", None),
            ("!(percent > 0", None),
            ("((percent > 0))", None),
            ("!(percent > 0) && !(percent > 1)", None),
            ("!(percent > 0) || !(percent > 1)", None),
            ("!(device.os == '(') || !(percent > 1)", None),
            // Separators and brackets inside parentheses or strings do not split the expression.
            ("!()", atom("NOT", "NOT condition is not allowed here")),
            ("!(percent > 0 || percent <= 100)", atom("NOT", "NOT condition is not allowed here")),
            ("!(percent > 0 && percent <= 100)", atom("NOT", "NOT condition is not allowed here")),
            ("!(device.os == ')' || percent > 0)", atom("NOT", "NOT condition is not allowed here")),
            ("!(device.os == '&&')", atom("NOT", "NOT condition is not allowed here")),
            // The recorded forms with other values.
            ("_percent <= 101", column(1, start)),
            ("percent_x <= 101", column(1, start)),
            ("percent <= 150", column(12, "A percent value is out of range")),
            ("percent > -5", column(11, "Percent value cannot be negative")),
            ("percent <= 0.12345678", column(12, "A percent value has more than 6 significant digits after the decimal point")),
            ("percent between 60 and 1", atom("PERCENT", "Invalid micro percent range (60000000, 1000000].")),
            ("percent between 10.000001 and 10", atom("PERCENT", "Invalid micro percent range (10000001, 10000000].")),
            ("percent between 10 and 10", None),
            ("percent > 1 || percent <= 2", Some("[VALIDATION_ERROR]: Expected exactly one term in OR condition for condition with name [c], found 2".to_owned())),
            ("app.version >= '2.0'", column(13, "Was expecting: '.'")),
            ("device.country in [\"xyz\"]", atom("COUNTRIES", "Invalid country code 'xyz'")),
            ("device.country in ['jp', '1x']", atom("COUNTRIES", "Invalid country code '1x'")),
            ("app.firebaseInstallationId in ['bad-1', 'cAAAAAAAAAAAAAAAAAAAAA', 'bad-2']", atom("FIREBASE_INSTALLATION_ID", "Invalid firebase installation ids : [bad-1, bad-2]")),
            ("!(app.build.exactlyMatches(['1']))", atom("NOT", "NOT condition is not allowed here")),
            ("app.version.matches(['^1', '('])", atom("APP_VERSION", "Invalid app version regex target value: (")),
        ];
        for (expression, expected) in cases {
            assert_eq!(
                client_refusal("c", expression, Some(zones)),
                expected,
                "{expression}"
            );
        }
        // Without a zone database the zone is not checked.
        assert_eq!(
            client_refusal(
                "c",
                "dateTime < dateTime('2026-01-01T00:00:00', 'Fireemu/Invalid')",
                None
            ),
            None
        );
    }

    #[test]
    fn list_shapes_follow_the_bracketed_strings() {
        let shape_of = |text: &str| -> Vec<String> {
            shape(&lex(text).unwrap())
                .into_iter()
                .map(str::to_owned)
                .collect()
        };
        let check = |text: &str| {
            list_shape(
                &shape_of(text)
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
                &["device", ".", "country", "in"],
                &[],
            )
        };
        assert!(check("device.country in ['a']"));
        assert!(check("device.country in ['a', 'b']"));
        for text in [
            "device.country in []",
            "device.country in ['a',]",
            "device.country in ['a' 'b']",
            "device.country in ['a', 1]",
            "device.country in ['a'",
            "device.country in 'a'",
        ] {
            assert!(!check(text), "{text}");
        }
    }

    proptest::proptest! {
        #[test]
        fn arbitrary_token_sequences_never_panic(parts in proptest::collection::vec(proptest::sample::select(vec![
            "app", ".", "build", "version", "firstOpenTimestamp", "firebaseInstallationId", "customSignal", "device", "country",
            "dateTime", "percent", "between", "and", "in", "matches", "(", ")", "[", "]", "'x'", "'['", ",", "&&", "||", "!",
            "<", "<=", ">", ">=", "==", "1", "-1", "101", "0.0000001",
        ]), 0..12)) {
            let _ = client_refusal("c", &parts.join(" "), Some(zones));
            let _ = client_refusal("c", &parts.concat(), Some(zones));
        }

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
