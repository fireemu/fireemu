//! Replays the executable Lean limit arithmetic and disposition contract.

use fireemu_core_limits::evaluate::{
    evaluate, ratio_micros, reaches_threshold, LimitAmount, LimitDisposition, RemediationCode,
    WarningSeverity, DEFAULT_THRESHOLDS, WIRE_MAPPING_REVISION,
};
use fireemu_core_limits::model::{
    EnforcementPrecision, EnforcementStage, ImplementationStatus, LimitBoundary, LimitClass,
    LimitDefinition, LimitMaximum, LimitUnit,
};
use fireemu_core_limits::plan::FirestorePlanProfile;

fn boundary(name: &str) -> LimitBoundary {
    match name {
        "inclusive" => LimitBoundary::InclusiveMaximum,
        "exclusive" => LimitBoundary::ExclusiveMaximum,
        "exact" => LimitBoundary::Exact,
        "range" => LimitBoundary::RangeInclusive,
        "syntax" => LimitBoundary::SyntaxConstraint,
        "truncating" => LimitBoundary::TruncatingMaximum,
        _ => panic!("unknown boundary {name}"),
    }
}

fn definition(
    name: &str,
    boundary: LimitBoundary,
    stage: &str,
) -> (LimitDefinition, FirestorePlanProfile) {
    let mut plan = FirestorePlanProfile::default();
    let mut id = "LEAN-EXAMPLE";
    let maximum = match name {
        "fixed" => LimitMaximum::Fixed(10_000),
        "none" => LimitMaximum::NotApplicable,
        "zero" => LimitMaximum::Fixed(0),
        "wide" => LimitMaximum::Fixed(u64::MAX),
        "billing-off" | "billing-on" | "override" | "unrelated" => {
            if name != "unrelated" {
                id = "FS-LIMIT-COMPOSITE-INDEXES";
            }
            plan.billing_enabled = name != "billing-off";
            if matches!(name, "override" | "unrelated") {
                plan.composite_index_limit_override = Some(30_000);
            }
            LimitMaximum::PlanDependent {
                billing_disabled: 20_000,
                billing_enabled: 40_000,
            }
        }
        _ => panic!("unknown profile {name}"),
    };
    let def = LimitDefinition {
        id,
        class: LimitClass::HardResource,
        boundary,
        unit: LimitUnit::Count,
        maximum,
        precision: EnforcementPrecision::Exact,
        enforcement_stage: match stage {
            "request" => EnforcementStage::Request,
            "observe" => EnforcementStage::Observe,
            _ => panic!("unknown stage {stage}"),
        },
        implemented: ImplementationStatus::Implemented,
        official_text: "",
        notes: "",
    };
    (def, plan)
}

#[test]
fn limit_disposition_and_arithmetic_match_lean() {
    let mut lines = include_str!("fixtures/lean-limit-evaluation.corpus").lines();
    assert_eq!(lines.next(), Some("# 960 cases."));
    assert_eq!(lines.clone().count(), 960);

    for line in lines {
        let columns: Vec<_> = line.split('\t').collect();
        let [boundary_name, profile, stage, _, current, maximum, zero, notice, upper, ratio, verdict] =
            columns.as_slice()
        else {
            panic!("malformed fixture row: {line}");
        };
        let (def, plan) = definition(profile, boundary(boundary_name), stage);
        let current: u64 = current.parse().unwrap();
        let effective = (*maximum != "-").then(|| maximum.parse().unwrap());
        let numeric = effective.unwrap_or(0);
        let ratio: u32 = ratio.parse().unwrap();
        assert_eq!(plan.resolve_maximum(&def), effective, "{line}");
        for (threshold, result) in [(0, zero), (7_500, notice), (u16::MAX, upper)] {
            assert_eq!(
                reaches_threshold(current, numeric, threshold),
                result.parse::<bool>().unwrap(),
                "{line}"
            );
        }
        assert_eq!(ratio_micros(current, numeric), ratio, "{line}");

        let actual = evaluate(&def, current, &plan, DEFAULT_THRESHOLDS);
        let observed = matches!(actual, LimitDisposition::ObservedOverLimit(_));
        let tag = match actual {
            LimitDisposition::Allow => "allow",
            LimitDisposition::AllowWithWarnings(warnings) => {
                let [warning] = warnings.as_slice() else {
                    panic!("expected one warning: {line}");
                };
                assert_eq!(warning.limit_id, def.id, "{line}");
                assert_eq!(warning.current, LimitAmount::new(current), "{line}");
                assert_eq!(warning.maximum, LimitAmount::new(numeric), "{line}");
                assert_eq!(warning.ratio_micros, ratio, "{line}");
                assert_eq!(warning.precision, def.precision, "{line}");
                assert!(warning.source_span.is_none());
                assert!(warning.largest_contributors.is_empty());
                assert_eq!(warning.remediation, RemediationCode::Split, "{line}");
                match warning.severity {
                    WarningSeverity::Notice => "notice",
                    WarningSeverity::Warning => "warning",
                    WarningSeverity::Critical => "critical",
                }
            }
            LimitDisposition::Reject(violation)
            | LimitDisposition::ObservedOverLimit(violation) => {
                assert_eq!(violation.limit_id, def.id, "{line}");
                assert_eq!(violation.current, LimitAmount::new(current), "{line}");
                assert_eq!(violation.maximum, LimitAmount::new(numeric), "{line}");
                assert_eq!(violation.boundary, def.boundary, "{line}");
                assert_eq!(violation.precision, def.precision, "{line}");
                assert_eq!(
                    violation.wire_mapping_revision, WIRE_MAPPING_REVISION,
                    "{line}"
                );
                if observed {
                    "observed"
                } else {
                    "reject"
                }
            }
        };
        assert_eq!(tag, *verdict, "{line}");
    }
}
