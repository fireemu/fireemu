//! Consolidated integration test harness for `fireemu-core-app-check`.
#[path = "../support/mod.rs"]
mod support;

mod admin;
mod admission;
mod app_check_admission_lean_corpus;
mod app_check_claims_lean_corpus;
mod app_check_registry_lean_corpus;
mod config;
mod exchange;
mod header;
mod jwt;
mod token;
