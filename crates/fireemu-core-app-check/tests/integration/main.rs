//! Consolidated integration test harness for `fireemu-core-app-check`.
#[path = "../admin.rs"]
mod admin;
#[path = "../admission.rs"]
mod admission;
#[path = "../app_check_admission_lean_corpus.rs"]
mod app_check_admission_lean_corpus;
#[path = "../app_check_claims_lean_corpus.rs"]
mod app_check_claims_lean_corpus;
#[path = "../app_check_registry_lean_corpus.rs"]
mod app_check_registry_lean_corpus;
#[path = "../config.rs"]
mod config;
#[path = "../exchange.rs"]
mod exchange;
#[path = "../header.rs"]
mod header;
#[path = "../jwt.rs"]
mod jwt;
#[path = "../token.rs"]
mod token;
