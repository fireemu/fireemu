//! Verifies that Auth import rejects unsupported fields in versioned sidecars.

use fireemu_core_export::auth::{AuthSettings, PasswordPolicies};

#[test]
fn auth_settings_reject_unknown_members_at_each_strict_level() {
    let valid = r#"{
        "version":2,"projectId":"demo-app",
        "project":{
            "blocking":{
                "triggers":{"beforeCreate":{"functionUri":"fireemu://functions/demo-app/us-central1/check"}},
                "forwardInboundCredentials":{"idToken":true,"accessToken":false,"refreshToken":false}
            },
            "quota":{
                "mode":"enforce","algorithm":"fixed-window-v1","defaultQuotaPerHour":100,
                "maxTrackedBuckets":4096,
                "temporary":{"quota":200,"startTime":"2030-01-01T00:00:00Z","quotaDuration":"60s"}
            }
        },
        "namespaces":[{"tenantId":"tenant-a","settings":{},"configExplicit":false}]
    }"#;
    AuthSettings::parse(valid).expect("the control document must parse");

    for (first_member, context) in [
        ("version", "Auth settings sidecar"),
        ("tenantId", "Auth settings namespace"),
        ("triggers", "Auth settings sidecar project.blocking"),
        (
            "functionUri",
            "Auth settings sidecar project.blocking.triggers.beforeCreate",
        ),
        (
            "idToken",
            "Auth settings sidecar project.blocking.forwardInboundCredentials",
        ),
        ("mode", "Auth settings sidecar project.quota"),
        ("startTime", "Auth settings sidecar project.quota.temporary"),
    ] {
        let member = format!(r#""{first_member}":"#);
        let invalid = valid.replacen(&member, &format!(r#""future":true,{member}"#), 1);
        assert_eq!(
            AuthSettings::parse(&invalid).unwrap_err().to_string(),
            format!(r#"the {context} contains unsupported member "future""#)
        );
    }
}

#[test]
fn password_policies_reject_unknown_members_in_a_tenant_envelope() {
    let policy = r#"{
        "enforcementState":"OFF","forceUpgradeOnSignin":false,"minLength":6,
        "requireUppercase":false,"requireLowercase":false,"requireNumeric":false,
        "requireNonAlphanumeric":false,"allowedNonAlphanumericCharacters":["!"]
    }"#;
    let valid = format!(
        r#"{{"version":1,"projectId":"demo-app","project":{policy},"namespaces":[{{"tenantId":"tenant-a","policy":{policy}}}]}}"#
    );
    PasswordPolicies::parse(&valid).expect("the control document must parse");

    let invalid = valid.replace(r#""tenantId":"#, r#""future":true,"tenantId":"#);
    assert_eq!(
        PasswordPolicies::parse(&invalid).unwrap_err().to_string(),
        r#"the password policy namespace contains unsupported member "future""#
    );
}
