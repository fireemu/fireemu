//! The CLI export view holds one immutable account and credential generation.

use std::sync::{Arc, Mutex};

use fireemu_core_auth::mfa::TotpPolicy;
use fireemu_core_auth::store::{
    AuthArtifactNamespace, AuthExportAccounts, AuthRegistry, AuthStore, NewUser, TenantMetadata,
    TenantMetadataPatch,
};
use fireemu_core_types::{determinism::SplitMix64, time::LogicalInstant};

fn compare(full: &AuthStore, artifact: &AuthArtifactNamespace) {
    assert_eq!(full.config(), artifact.config);
    assert_eq!(full.signup_quota().config(), &artifact.quota);
    assert_eq!(full.stored_config_members(), &artifact.config_members);
    assert_eq!(full.password_policy(), &artifact.password_policy);
    let expected = full.users_by_creation();
    let selected: Vec<_> = artifact.users_by_creation().collect();
    assert_eq!(selected, expected);
    for user in selected {
        let (digest, updated) = artifact.export_password_fields(&user.local_id);
        assert_eq!(digest, full.password_digest(&user.local_id));
        assert_eq!(updated, full.password_updated_at(&user.local_id));
    }
}

fn check(namespace: &str, password: &str, key: &str, later: &str) {
    let now = LogicalInstant::from_unix_seconds(50);
    let store = Arc::new(Mutex::new(AuthStore::new(
        "demo",
        SplitMix64::new(1),
        TotpPolicy::default(),
    )));
    let registry = AuthRegistry::new("demo", store.clone());
    registry
        .create_tenant_with_id(
            "demo",
            "tenant",
            TenantMetadata::default(),
            TenantMetadataPatch::default(),
            None,
        )
        .unwrap();
    let store = if namespace == "Tenant" {
        registry.tenant_store("demo", "tenant").unwrap()
    } else {
        store
    };
    {
        let mut s = store.lock().unwrap();
        let a = s
            .create_user_with_id(NewUser::anonymous(), Some("z"), now)
            .unwrap();
        let b = s
            .create_user_with_id(NewUser::anonymous(), Some("a"), now)
            .unwrap();
        let c = s
            .create_user_with_id(NewUser::anonymous(), Some("c"), now)
            .unwrap();
        let owner = if key == "Other" { &b } else { &a };
        if password != "Absent" {
            s.set_password(owner, "local-example-password", now)
                .unwrap();
            if password == "Removed" {
                s.clear_password(owner).unwrap();
            }
        }
        let mut members = s.stored_config_members().clone();
        members.set("multiTenant.allowTenants", Some("true".to_owned()));
        s.set_stored_config_members(members);
        let mut config = s.config();
        config.allow_duplicate_emails = !config.allow_duplicate_emails;
        s.set_config(config);
        let mut policy = s.password_policy().clone();
        policy.min_length = 19;
        s.set_password_policy(policy);
        let mut quota = s.signup_quota().config().clone();
        quota.default_quota_per_hour = 17;
        s.set_signup_quota_config(quota).unwrap();
        if key == "Missing" {
            s.delete_user_by_id(c.as_str()).unwrap();
        }
        if key != "Own" {
            s.user_mut(&a).unwrap().local_id = if key == "Other" { b } else { c };
        }
    }
    let full = registry.capture_export_snapshot("demo").unwrap().unwrap();
    let artifact = registry.capture_artifact_snapshot("demo").unwrap().unwrap();
    if later == "Clear" {
        store.lock().unwrap().clear();
    }
    compare(full.default_store(), artifact.default_store());
    for ((tenant, f), (selected_tenant, selected)) in
        full.tenant_stores().zip(artifact.tenant_stores())
    {
        assert_eq!(tenant, selected_tenant);
        assert_eq!(
            full.tenant_metadata(tenant),
            artifact.tenant_metadata(tenant)
        );
        assert_eq!(
            full.tenant_config_override(tenant),
            artifact.tenant_config_override(tenant)
        );
        compare(f, selected);
    }
}

#[test]
fn artifact_accounts_preserve_creation_order_and_lookup_credentials_by_record_id() {
    for namespace in ["Project", "Tenant"] {
        for password in ["Absent", "Present", "Removed"] {
            for key in ["Own", "Other", "Missing"] {
                for later in ["Keep", "Clear"] {
                    check(namespace, password, key, later);
                }
            }
        }
    }
}
