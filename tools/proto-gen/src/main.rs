//! Regenerates `crates/fireemu-proto-firestore/src/generated/` from the vendored protos
//! (ADR-008). A normal build never runs this; the generated files are checked in and
//! `check` mode fails CI on drift.
//!
//! ```text
//! proto-gen generate   # needs protoc on PATH (or PROTOC)
//! proto-gen check
//! ```

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// One generated-protobuf crate: its vendored proto root, its checked-in output directory and
/// the entry `.proto` files to compile.
struct Target {
    proto_root: &'static str,
    out_dir: &'static str,
    files: &'static [&'static str],
}

const TARGETS: &[Target] = &[
    Target {
        proto_root: "crates/fireemu-proto-firestore/proto",
        out_dir: "crates/fireemu-proto-firestore/src/generated",
        files: &[
            "google/firestore/v1/firestore.proto",
            "google/firestore/v1/pipeline.proto",
            "google/firestore/v1/explain_stats.proto",
            "google/firestore/admin/v1/firestore_admin.proto",
        ],
    },
    Target {
        proto_root: "crates/fireemu-proto-pubsub/proto",
        out_dir: "crates/fireemu-proto-pubsub/src/generated",
        files: &[
            "google/pubsub/v1/pubsub.proto",
            "google/pubsub/v1/schema.proto",
        ],
    },
];

fn generate_target(target: &Target, out: &Path) -> Result<(), String> {
    fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let files: Vec<PathBuf> = target
        .files
        .iter()
        .map(|f| Path::new(target.proto_root).join(f))
        .collect();
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .build_transport(false)
        .out_dir(out)
        .emit_rerun_if_changed(false)
        .compile_protos(&files, &[Path::new(target.proto_root)])
        .map_err(|e| format!("protoc failed: {e}"))?;
    // Stamp the upstream commit so that drift between protos and generated code is visible.
    let commit = fs::read_to_string(Path::new(target.proto_root).join("UPSTREAM_COMMIT"))
        .map_err(|e| e.to_string())?;
    fs::write(out.join("UPSTREAM_COMMIT"), format!("{}\n", commit.trim()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn read_dir_sorted(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut entries: Vec<(String, Vec<u8>)> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .filter(|e| e.path().is_file())
                .map(|e| {
                    (
                        e.file_name().to_string_lossy().into_owned(),
                        fs::read(e.path()).unwrap_or_default(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    entries.sort();
    entries
}

fn generate_all() -> Result<(), String> {
    for target in TARGETS {
        generate_target(target, Path::new(target.out_dir))?;
        println!("generated into {}", target.out_dir);
    }
    Ok(())
}

fn check_generated(expected: &Path, actual: &Path) -> Result<(), String> {
    if read_dir_sorted(expected) == read_dir_sorted(actual) {
        Ok(())
    } else {
        Err(format!(
            "generated protobuf code in {} differs from the vendored protos; run `cargo run -p proto-gen -- generate`",
            actual.display()
        ))
    }
}

fn check_all() -> Result<(), String> {
    for target in TARGETS {
        let tmp = std::env::temp_dir().join(format!(
            "fireemu-proto-gen-{}-{}",
            std::process::id(),
            target.out_dir.replace('/', "_")
        ));
        let outcome = generate_target(target, &tmp)
            .and_then(|()| check_generated(&tmp, Path::new(target.out_dir)));
        let _ = fs::remove_dir_all(&tmp);
        outcome?;
    }
    Ok(())
}

fn main() -> ExitCode {
    let mode = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "check".to_owned());
    match mode.as_str() {
        "generate" => match generate_all() {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("error: {e}");
                ExitCode::FAILURE
            }
        },
        "check" => match check_all() {
            Ok(()) => {
                println!("generated protobuf code is up to date");
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("error: {e}");
                ExitCode::FAILURE
            }
        },
        other => {
            eprintln!("error: unknown mode {other}; use generate or check");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn check_requires_exact_generated_file_names_and_contents() {
        let temp = std::env::temp_dir().join(format!("fireemu-proto-test-{}", std::process::id()));
        fs::create_dir(&temp).unwrap();
        let fixture = Fixture(temp);
        let expected = fixture.0.join("from-vendored");
        let actual = fixture.0.join("checked-in");
        fs::create_dir(&expected).unwrap();
        fs::create_dir(&actual).unwrap();
        for dir in [&expected, &actual] {
            fs::write(dir.join("UPSTREAM_COMMIT"), "fixture-revision\n").unwrap();
            fs::write(dir.join("wire.rs"), "pub struct Wire;\n").unwrap();
        }
        check_generated(&expected, &actual).unwrap();

        let wire = actual.join("wire.rs");
        fs::write(&wire, "pub struct Drift;\n").unwrap();
        let error = check_generated(&expected, &actual).unwrap_err();
        assert!(error.contains("checked-in") && error.contains("differs from the vendored protos"));
        fs::remove_file(&wire).unwrap();
        assert!(check_generated(&expected, &actual).is_err());
        fs::write(&wire, "pub struct Wire;\n").unwrap();
        fs::write(actual.join("orphan.rs"), "// additional file").unwrap();
        assert!(check_generated(&expected, &actual).is_err());
    }
}
