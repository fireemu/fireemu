//! Isolated CRC32C hardware experiment.

#[allow(dead_code)]
mod frozen_core_hash;

const CRC32C_TABLES: [[u32; 256]; 8] = make_crc32c_tables();

const fn make_crc32c_tables() -> [[u32; 256]; 8] {
    let mut tables = [[0_u32; 256]; 8];
    let mut index = 0;
    while index < 256 {
        let mut value = index as u32;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 1 == 1 {
                (value >> 1) ^ 0x82f6_3b78
            } else {
                value >> 1
            };
            bit += 1;
        }
        tables[0][index] = value;
        index += 1;
    }
    let mut table = 1;
    while table < 8 {
        index = 0;
        while index < 256 {
            let previous = tables[table - 1][index];
            tables[table][index] = (previous >> 8) ^ tables[0][(previous & 0xff) as usize];
            index += 1;
        }
        table += 1;
    }
    tables
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Backend {
    Scalar,
    RustIntrinsic,
    CIntrinsic,
    Dependency,
}

impl Backend {
    pub const ALL: [Self; 4] = [
        Self::Scalar,
        Self::RustIntrinsic,
        Self::CIntrinsic,
        Self::Dependency,
    ];

    pub const fn label(self) -> &'static str {
        match self {
            Self::Scalar => "scalar-slicing-by-8",
            Self::RustIntrinsic => "rust-runtime-dispatch",
            Self::CIntrinsic => "c-runtime-dispatch",
            Self::Dependency => "crc32c-0.6.9-runtime-dispatch",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct BackendSelection {
    pub backend: Backend,
    pub hardware_supported: bool,
    pub hardware: bool,
    pub path: &'static str,
}

impl BackendSelection {
    pub fn detect(backend: Backend) -> Self {
        let feature = hardware_feature();
        let hardware_supported = feature.is_some();
        let hardware = match backend {
            Backend::Scalar => false,
            Backend::RustIntrinsic | Backend::CIntrinsic | Backend::Dependency => {
                hardware_supported
            }
        };
        let path = match (backend, feature) {
            (Backend::Scalar, _) => "scalar-slicing-by-8",
            (Backend::RustIntrinsic, Some(feature)) => feature.rust_label,
            (Backend::CIntrinsic, Some(feature)) => feature.c_label,
            (Backend::Dependency, Some(feature)) => feature.dependency_label,
            (_, None) => "scalar-fallback",
        };
        Self {
            backend,
            hardware_supported,
            hardware,
            path,
        }
    }
}

#[derive(Clone, Copy)]
struct HardwareFeature {
    rust_label: &'static str,
    c_label: &'static str,
    dependency_label: &'static str,
}

fn hardware_feature() -> Option<HardwareFeature> {
    #[cfg(target_arch = "x86_64")]
    if std::is_x86_feature_detected!("sse4.2") {
        return Some(HardwareFeature {
            rust_label: "rust-sse4.2",
            c_label: "c-sse4.2",
            dependency_label: "crc32c-sse4.2",
        });
    }
    #[cfg(target_arch = "aarch64")]
    if std::arch::is_aarch64_feature_detected!("crc") {
        return Some(HardwareFeature {
            rust_label: "rust-arm-crc",
            c_label: "c-arm-crc",
            dependency_label: "crc32c-arm-crc",
        });
    }
    None
}

pub fn raw_update(backend: Backend, raw_state: u32, bytes: &[u8]) -> u32 {
    match backend {
        Backend::Scalar => scalar_update(raw_state, bytes),
        Backend::RustIntrinsic => rust_update(raw_state, bytes),
        Backend::CIntrinsic => c_update(raw_state, bytes),
        Backend::Dependency => !crc32c::crc32c_append(!raw_state, bytes),
    }
}

pub fn crc32c(backend: Backend, bytes: &[u8]) -> u32 {
    !raw_update(backend, u32::MAX, bytes)
}

pub fn object_digests(backend: Backend, bytes: &[u8]) -> ([u8; 16], u32) {
    object_digests_from_raw_state(backend, bytes, u32::MAX)
}

pub fn object_digests_from_raw_state(
    backend: Backend,
    bytes: &[u8],
    raw_state: u32,
) -> ([u8; 16], u32) {
    (
        frozen_core_hash::md5(bytes),
        !raw_update(backend, raw_state, bytes),
    )
}

pub fn object_digests_chunks_997(backend: Backend, bytes: &[u8]) -> ([u8; 16], u32) {
    object_digests_chunks_997_from_raw_state(backend, bytes, u32::MAX)
}

pub fn object_digests_chunks_997_from_raw_state(
    backend: Backend,
    bytes: &[u8],
    mut raw_state: u32,
) -> ([u8; 16], u32) {
    let mut md5 = frozen_core_hash::Md5::new();
    for chunk in bytes.chunks(997) {
        md5.update(chunk);
        raw_state = raw_update(backend, raw_state, chunk);
    }
    (md5.finalize(), !raw_state)
}

pub fn selection(backend: Backend) -> BackendSelection {
    BackendSelection::detect(backend)
}

fn scalar_update(mut state: u32, bytes: &[u8]) -> u32 {
    let mut chunks = bytes.chunks_exact(8);
    for chunk in &mut chunks {
        let value = u64::from_le_bytes([
            chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7],
        ]) ^ u64::from(state);
        state = CRC32C_TABLES[7][(value & 0xff) as usize]
            ^ CRC32C_TABLES[6][((value >> 8) & 0xff) as usize]
            ^ CRC32C_TABLES[5][((value >> 16) & 0xff) as usize]
            ^ CRC32C_TABLES[4][((value >> 24) & 0xff) as usize]
            ^ CRC32C_TABLES[3][((value >> 32) & 0xff) as usize]
            ^ CRC32C_TABLES[2][((value >> 40) & 0xff) as usize]
            ^ CRC32C_TABLES[1][((value >> 48) & 0xff) as usize]
            ^ CRC32C_TABLES[0][(value >> 56) as usize];
    }
    for &byte in chunks.remainder() {
        let index = ((state ^ u32::from(byte)) & 0xff) as usize;
        state = (state >> 8) ^ CRC32C_TABLES[0][index];
    }
    state
}

fn rust_update(state: u32, bytes: &[u8]) -> u32 {
    if let Some(feature) = hardware_feature() {
        #[cfg(target_arch = "x86_64")]
        if feature.rust_label == "rust-sse4.2" {
            // SAFETY: runtime detection established SSE4.2 support on this CPU.
            return unsafe { rust_x86_64_update(state, bytes) };
        }
        #[cfg(target_arch = "aarch64")]
        if feature.rust_label == "rust-arm-crc" {
            // SAFETY: runtime detection established the ARM CRC extension on this CPU.
            return unsafe { rust_aarch64_update(state, bytes) };
        }
    }
    scalar_update(state, bytes)
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse4.2")]
unsafe fn rust_x86_64_update(mut state: u32, bytes: &[u8]) -> u32 {
    use std::arch::x86_64::{_mm_crc32_u64, _mm_crc32_u8};
    let mut chunks = bytes.chunks_exact(8);
    for chunk in &mut chunks {
        let word = u64::from_le_bytes([
            chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7],
        ]);
        state = _mm_crc32_u64(u64::from(state), word) as u32;
    }
    for &byte in chunks.remainder() {
        state = _mm_crc32_u8(state, byte);
    }
    state
}

#[cfg(target_arch = "aarch64")]
#[target_feature(enable = "crc")]
unsafe fn rust_aarch64_update(mut state: u32, bytes: &[u8]) -> u32 {
    use std::arch::aarch64::{__crc32cb, __crc32cd};
    let mut chunks = bytes.chunks_exact(8);
    for chunk in &mut chunks {
        let word = u64::from_le_bytes([
            chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5], chunk[6], chunk[7],
        ]);
        state = __crc32cd(state, word);
    }
    for &byte in chunks.remainder() {
        state = __crc32cb(state, byte);
    }
    state
}

#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
fn c_update(state: u32, bytes: &[u8]) -> u32 {
    if hardware_feature().is_some() {
        // SAFETY: runtime detection matches the target-specific function compiled in build.rs;
        // the pointer and length describe exactly the borrowed slice for the duration of the call.
        return unsafe { crc32c_c_hw(state, bytes.as_ptr(), bytes.len()) };
    }
    scalar_update(state, bytes)
}

#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
fn c_update(state: u32, bytes: &[u8]) -> u32 {
    scalar_update(state, bytes)
}

#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
unsafe extern "C" {
    fn crc32c_c_hw(state: u32, bytes: *const u8, len: usize) -> u32;
}
