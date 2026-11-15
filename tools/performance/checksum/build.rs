use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=native/crc32c.c");
    let target = env::var("CARGO_CFG_TARGET_ARCH").expect("Cargo sets CARGO_CFG_TARGET_ARCH");
    if target != "aarch64" && target != "x86_64" {
        return;
    }

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo sets OUT_DIR"));
    let object = out_dir.join("crc32c.o");
    let archive = out_dir.join("libcrc32c_native.a");
    let cc = env::var_os("CC").unwrap_or_else(|| "cc".into());
    let ar = env::var_os("AR").unwrap_or_else(|| "ar".into());
    run(Command::new(cc)
        .args([
            "-std=c11",
            "-O3",
            "-fno-strict-aliasing",
            "-c",
            "native/crc32c.c",
            "-o",
        ])
        .arg(&object));
    run(Command::new(ar).arg("rcs").arg(&archive).arg(&object));
    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=crc32c_native");
}

fn run(command: &mut Command) {
    let display = format!("{command:?}");
    let status = command
        .status()
        .unwrap_or_else(|error| panic!("failed to start {display}: {error}"));
    assert!(status.success(), "native command failed: {display}");
}
