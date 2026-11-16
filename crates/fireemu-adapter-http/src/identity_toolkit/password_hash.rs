//! Verification of password hashes imported through `accounts:batchCreate`.
//!
//! Production accepts fourteen hash algorithms. The conventions below are the ones production
//! Identity Toolkit was observed to accept in the 2026-09-23 sandbox exploration, not the ones
//! a reader of the reference might assume:
//!
//! - `MD5`: `x = md5(salt || password)`, then `rounds` times `x = md5(x || password)`; the
//!   stored hash is the lowercase hex of `x`. `passwordHashOrder` is not consulted.
//! - `SHA1`/`SHA256`/`SHA512`: `x = H(salt || password)` (or `password || salt` for
//!   `PASSWORD_AND_SALT`), then `x = H(x)` until `max(rounds, 1)` applications.
//! - `HMAC_*`: `HMAC(signerKey, password || salt)` by default, `salt || password` for
//!   `SALT_AND_PASSWORD`.
//! - `PBKDF_SHA1`/`PBKDF2_SHA256`: PBKDF2 with `rounds` iterations and the stored hash's length.
//! - `SCRYPT` (Firebase): `AES-256-CTR(scrypt(password, salt || saltSeparator, 2^memoryCost,
//!   rounds, 1)[..32], iv = 0)` applied to `signerKey`.
//! - `STANDARD_SCRYPT`: scrypt with `cpuMemCost`, `blockSize`, `parallelization`, `dkLen`.
//! - `BCRYPT`: a modular-crypt `$2a$`/`$2b$`/`$2y$` string.
//! - `ARGON2`: the raw Argon2 output for `argon2Parameters`.

use aes::cipher::{KeyIvInit, StreamCipher};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Digest;
use subtle::ConstantTimeEq;

/// The digest family of a SHA, HMAC or PBKDF algorithm.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Family {
    Md5,
    Sha1,
    Sha256,
    Sha512,
}

/// Which of salt and password comes first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Order {
    SaltFirst,
    PasswordFirst,
}

/// One import's hash algorithm and parameters, as production validated them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HashSpec {
    Md5 {
        rounds: u32,
    },
    Sha {
        family: Family,
        rounds: u32,
        order: Order,
    },
    Hmac {
        family: Family,
        key: Vec<u8>,
        order: Order,
    },
    Pbkdf {
        family: Family,
        rounds: u32,
    },
    FirebaseScrypt {
        key: Vec<u8>,
        separator: Vec<u8>,
        rounds: u32,
        memory_cost: u8,
    },
    StandardScrypt {
        log_n: u8,
        block_size: u32,
        parallelization: u32,
        dk_len: usize,
    },
    Bcrypt,
    Argon2 {
        variant: argon2::Algorithm,
        version: argon2::Version,
        iterations: u32,
        memory_kib: u32,
        parallelism: u32,
        hash_len: usize,
        associated_data: Vec<u8>,
    },
}

fn digest(family: Family, input: &[u8]) -> Vec<u8> {
    match family {
        Family::Md5 => md5::Md5::digest(input).to_vec(),
        Family::Sha1 => sha1::Sha1::digest(input).to_vec(),
        Family::Sha256 => sha2::Sha256::digest(input).to_vec(),
        Family::Sha512 => sha2::Sha512::digest(input).to_vec(),
    }
}

fn hmac(family: Family, key: &[u8], message: &[u8]) -> Vec<u8> {
    fn run<M: Mac + hmac::digest::KeyInit>(key: &[u8], message: &[u8]) -> Vec<u8> {
        let mut mac = <M as hmac::digest::KeyInit>::new_from_slice(key)
            .expect("HMAC accepts keys of any length");
        mac.update(message);
        mac.finalize().into_bytes().to_vec()
    }
    match family {
        Family::Md5 => run::<Hmac<md5::Md5>>(key, message),
        Family::Sha1 => run::<Hmac<sha1::Sha1>>(key, message),
        Family::Sha256 => run::<Hmac<sha2::Sha256>>(key, message),
        Family::Sha512 => run::<Hmac<sha2::Sha512>>(key, message),
    }
}

fn joined(order: Order, salt: &[u8], password: &[u8]) -> Vec<u8> {
    match order {
        Order::SaltFirst => [salt, password].concat(),
        Order::PasswordFirst => [password, salt].concat(),
    }
}

fn to_hex(bytes: &[u8]) -> Vec<u8> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    bytes
        .iter()
        .flat_map(|b| [HEX[usize::from(b >> 4)], HEX[usize::from(b & 15)]])
        .collect()
}

/// The hash this spec derives from `password` and `salt`, or `None` when the stored hash
/// itself carries the derivation (bcrypt) or the parameters cannot derive one.
fn derive(spec: &HashSpec, password: &[u8], salt: &[u8], stored_len: usize) -> Option<Vec<u8>> {
    Some(match spec {
        HashSpec::Md5 { rounds } => {
            let mut x = digest(Family::Md5, &[salt, password].concat());
            for _ in 0..*rounds {
                x = digest(Family::Md5, &[x.as_slice(), password].concat());
            }
            to_hex(&x)
        }
        HashSpec::Sha {
            family,
            rounds,
            order,
        } => {
            let mut x = digest(*family, &joined(*order, salt, password));
            for _ in 1..(*rounds).max(1) {
                x = digest(*family, &x);
            }
            x
        }
        HashSpec::Hmac { family, key, order } => {
            hmac(*family, key, &joined(*order, salt, password))
        }
        HashSpec::Pbkdf { family, rounds } => {
            let mut out = vec![0; stored_len];
            match family {
                Family::Sha1 => {
                    pbkdf2::pbkdf2_hmac::<sha1::Sha1>(password, salt, *rounds, &mut out);
                }
                Family::Sha256 => {
                    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password, salt, *rounds, &mut out);
                }
                Family::Md5 | Family::Sha512 => return None,
            }
            out
        }
        HashSpec::FirebaseScrypt {
            key,
            separator,
            rounds,
            memory_cost,
        } => {
            let params = scrypt::Params::new(*memory_cost, *rounds, 1, 64).ok()?;
            let mut derived = [0_u8; 64];
            scrypt::scrypt(password, &[salt, separator].concat(), &params, &mut derived).ok()?;
            let mut out = key.clone();
            ctr::Ctr128BE::<aes::Aes256>::new(derived[..32].into(), &[0_u8; 16].into())
                .apply_keystream(&mut out);
            out
        }
        HashSpec::StandardScrypt {
            log_n,
            block_size,
            parallelization,
            dk_len,
        } => {
            // `Params` only admits 10..=64-byte keys, but `scrypt::scrypt` sizes its output by
            // the buffer, so any positive `dkLen` derives (external review 2026-09-24).
            let params = scrypt::Params::new(
                *log_n,
                *block_size,
                *parallelization,
                scrypt::Params::RECOMMENDED_LEN,
            )
            .ok()?;
            let mut out = vec![0; *dk_len];
            scrypt::scrypt(password, salt, &params, &mut out).ok()?;
            out
        }
        HashSpec::Argon2 {
            variant,
            version,
            iterations,
            memory_kib,
            parallelism,
            hash_len,
            associated_data,
        } => {
            let params = argon2::ParamsBuilder::new()
                .m_cost(*memory_kib)
                .t_cost(*iterations)
                .p_cost(*parallelism)
                .output_len(*hash_len)
                .data(argon2::AssociatedData::new(associated_data).ok()?)
                .build()
                .ok()?;
            let mut out = vec![0; *hash_len];
            argon2::Argon2::new(*variant, *version, params)
                .hash_password_into(password, salt, &mut out)
                .ok()?;
            out
        }
        HashSpec::Bcrypt => return None,
    })
}

/// Whether `password` matches an imported `hash` under `spec`. An empty hash never matches:
/// a derivation sized by it would be empty too and compare equal.
pub(crate) fn verify(spec: &HashSpec, password: &str, salt: &[u8], hash: &[u8]) -> bool {
    if hash.is_empty() {
        return false;
    }
    if let HashSpec::Bcrypt = spec {
        return std::str::from_utf8(hash)
            .ok()
            .and_then(|text| bcrypt::verify(password, text).ok())
            .unwrap_or(false);
    }
    derive(spec, password.as_bytes(), salt, hash.len())
        .is_some_and(|derived| derived.len() == hash.len() && bool::from(derived.ct_eq(hash)))
}

// Two process-wide slots bound CPU pressure and scrypt buffers to two derivations even on high-core hosts. Waiters hold no permit while acquiring an Auth store lock.
const MAX_CONCURRENT_DERIVATIONS: usize = 2;
static DERIVATION_SLOTS: (std::sync::Mutex<usize>, std::sync::Condvar) =
    (std::sync::Mutex::new(0), std::sync::Condvar::new());

// The counted semaphore releases its slot on every return, including unwinding.
struct DerivationPermit;

impl Drop for DerivationPermit {
    fn drop(&mut self) {
        let mut active = DERIVATION_SLOTS
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *active -= 1;
        DERIVATION_SLOTS.1.notify_one();
    }
}

#[cfg(test)]
thread_local! {
    #[allow(clippy::type_complexity)] // Test observers capture per-test counters and synchronization.
    pub(super) static DERIVATION_OBSERVER: std::cell::RefCell<Option<Box<dyn Fn(bool)>>> = const { std::cell::RefCell::new(None) };
}

/// The core store's view of this module: an imported hash matches when its spec decodes and
/// the password derives the stored hash.
pub(crate) struct ImportedHashes {
    /// The strict profile fails a sign-in whose spec is outside the local work bounds; the
    /// emulator profile answers that no password matches, as firebase-tools 15.28.2 never
    /// compares a password with an imported hash (`operations.js:1303-1310`).
    pub(crate) strict: bool,
}

impl fireemu_core_auth::store::ImportedHashVerifier for ImportedHashes {
    fn verify(
        &self,
        imported: &fireemu_core_auth::store::ImportedPasswordHash,
        password: &str,
    ) -> Result<bool, fireemu_core_auth::store::ImportedHashFailure> {
        let Some(spec) = decode(&imported.spec) else {
            return Ok(false);
        };
        // An HMAC without a key cannot be computed; production accepts HMAC_SHA512 so at
        // import and fails the sign-in internally (sandbox recording 2026-09-23), in both
        // profiles as production is recorded.
        if matches!(&spec, HashSpec::Hmac { key, .. } if key.is_empty()) {
            return Err(fireemu_core_auth::store::ImportedHashFailure);
        }
        // A spec outside the local work bounds has no production record. Strict fails the
        // sign-in without deriving; the emulator profile answers no match, as firebase-tools
        // does.
        if !within_work_bounds(&spec, &imported.hash) {
            return if self.strict {
                Err(fireemu_core_auth::store::ImportedHashFailure)
            } else {
                Ok(false)
            };
        }
        let active = DERIVATION_SLOTS
            .0
            .lock()
            .map_err(|_| fireemu_core_auth::store::ImportedHashFailure)?;
        let mut active = DERIVATION_SLOTS
            .1
            .wait_while(active, |active| *active >= MAX_CONCURRENT_DERIVATIONS)
            .map_err(|_| fireemu_core_auth::store::ImportedHashFailure)?;
        *active += 1;
        drop(active);
        let _permit = DerivationPermit;
        #[cfg(test)]
        DERIVATION_OBSERVER.with_borrow(|observer| {
            if let Some(observer) = observer {
                observer(true);
            }
        });
        let result = verify(&spec, password, &imported.salt, &imported.hash);
        #[cfg(test)]
        DERIVATION_OBSERVER.with_borrow(|observer| {
            if let Some(observer) = observer {
                observer(false);
            }
        });
        Ok(result)
    }
}

/// A verification computed before the request takes the Auth store lock (closure security
/// review 3, Should Fix 2): imported hashes can take seconds to derive, and holding the lock
/// meanwhile stalls every Auth request.
pub(crate) struct PreVerified {
    imported: fireemu_core_auth::store::ImportedPasswordHash,
    password: String,
    result: Result<bool, fireemu_core_auth::store::ImportedHashFailure>,
}

/// Verifies the imported hash a password sign-in would check, from a snapshot taken under a
/// short store lock that is released before the derivation runs. `None` when the request is
/// not a password sign-in against an imported hash.
pub(crate) fn preverify(
    store: &std::sync::Mutex<fireemu_core_auth::store::AuthStore>,
    email: Option<&str>,
    password: Option<&str>,
    verifier: &dyn fireemu_core_auth::store::ImportedHashVerifier,
) -> Option<PreVerified> {
    let (email, password) = (email?, password.filter(|p| !p.is_empty())?);
    let imported = store.lock().ok()?.imported_password_for_sign_in(email)?;
    let result = verifier.verify(&imported, password);
    Some(PreVerified {
        imported,
        password: password.to_owned(),
        result,
    })
}

/// The verifier the sign-in uses under the lock: it answers from the snapshot only when the
/// hash it is asked about is the one the snapshot verified (the commit-time check), and
/// otherwise derives again.
pub(crate) struct SnapshotHashes<'a> {
    pub(crate) snapshot: Option<&'a PreVerified>,
    pub(crate) fallback: &'a dyn fireemu_core_auth::store::ImportedHashVerifier,
}

impl fireemu_core_auth::store::ImportedHashVerifier for SnapshotHashes<'_> {
    fn verify(
        &self,
        imported: &fireemu_core_auth::store::ImportedPasswordHash,
        password: &str,
    ) -> Result<bool, fireemu_core_auth::store::ImportedHashFailure> {
        match self.snapshot {
            Some(snapshot) if snapshot.imported == *imported && snapshot.password == password => {
                snapshot.result
            }
            _ => self.fallback.verify(imported, password),
        }
    }
}

/// The spec as a canonical JSON string, which is what the core store keeps (it has no
/// cryptography of its own).
pub(crate) fn encode(spec: &HashSpec) -> String {
    let b64 = |bytes: &[u8]| fireemu_core_types::hash::base64_standard(bytes);
    let family = |family: &Family| match family {
        Family::Md5 => "MD5",
        Family::Sha1 => "SHA1",
        Family::Sha256 => "SHA256",
        Family::Sha512 => "SHA512",
    };
    let order = |order: &Order| match order {
        Order::SaltFirst => "SALT_AND_PASSWORD",
        Order::PasswordFirst => "PASSWORD_AND_SALT",
    };
    let value = match spec {
        HashSpec::Md5 { rounds } => json!({"algorithm": "MD5", "rounds": rounds}),
        HashSpec::Sha {
            family: f,
            rounds,
            order: o,
        } => json!({"algorithm": "SHA", "family": family(f), "rounds": rounds, "order": order(o)}),
        HashSpec::Hmac {
            family: f,
            key,
            order: o,
        } => json!({"algorithm": "HMAC", "family": family(f), "key": b64(key), "order": order(o)}),
        HashSpec::Pbkdf { family: f, rounds } => {
            json!({"algorithm": "PBKDF", "family": family(f), "rounds": rounds})
        }
        HashSpec::FirebaseScrypt {
            key,
            separator,
            rounds,
            memory_cost,
        } => json!({"algorithm": "SCRYPT", "key": b64(key), "separator": b64(separator),
                    "rounds": rounds, "memoryCost": memory_cost}),
        HashSpec::StandardScrypt {
            log_n,
            block_size,
            parallelization,
            dk_len,
        } => json!({"algorithm": "STANDARD_SCRYPT", "logN": log_n, "blockSize": block_size,
                    "parallelization": parallelization, "dkLen": dk_len}),
        HashSpec::Bcrypt => json!({"algorithm": "BCRYPT"}),
        HashSpec::Argon2 {
            variant,
            version,
            iterations,
            memory_kib,
            parallelism,
            hash_len,
            associated_data,
        } => json!({"algorithm": "ARGON2", "variant": variant.as_str(),
                    "version": u32::from(*version), "iterations": iterations,
                    "memoryKib": memory_kib, "parallelism": parallelism, "hashLen": hash_len,
                    "associatedData": b64(associated_data)}),
    };
    value.to_string()
}

/// The inverse of [`encode`].
pub(crate) fn decode(text: &str) -> Option<HashSpec> {
    let value: Value = serde_json::from_str(text).ok()?;
    let u32_of = |key: &str| value.get(key)?.as_u64().and_then(|n| u32::try_from(n).ok());
    let bytes_of = |key: &str| base64_decode(value.get(key)?.as_str()?);
    let family = || match value.get("family")?.as_str()? {
        "MD5" => Some(Family::Md5),
        "SHA1" => Some(Family::Sha1),
        "SHA256" => Some(Family::Sha256),
        "SHA512" => Some(Family::Sha512),
        _ => None,
    };
    let order = || match value.get("order")?.as_str()? {
        "SALT_AND_PASSWORD" => Some(Order::SaltFirst),
        "PASSWORD_AND_SALT" => Some(Order::PasswordFirst),
        _ => None,
    };
    Some(match value.get("algorithm")?.as_str()? {
        "MD5" => HashSpec::Md5 {
            rounds: u32_of("rounds")?,
        },
        "SHA" => HashSpec::Sha {
            family: family()?,
            rounds: u32_of("rounds")?,
            order: order()?,
        },
        "HMAC" => HashSpec::Hmac {
            family: family()?,
            key: bytes_of("key")?,
            order: order()?,
        },
        "PBKDF" => HashSpec::Pbkdf {
            family: family()?,
            rounds: u32_of("rounds")?,
        },
        "SCRYPT" => HashSpec::FirebaseScrypt {
            key: bytes_of("key")?,
            separator: bytes_of("separator")?,
            rounds: u32_of("rounds")?,
            memory_cost: u8::try_from(u32_of("memoryCost")?).ok()?,
        },
        "STANDARD_SCRYPT" => HashSpec::StandardScrypt {
            log_n: u8::try_from(u32_of("logN")?).ok()?,
            block_size: u32_of("blockSize")?,
            parallelization: u32_of("parallelization")?,
            dk_len: usize::try_from(u32_of("dkLen")?).ok()?,
        },
        "BCRYPT" => HashSpec::Bcrypt,
        "ARGON2" => HashSpec::Argon2 {
            variant: value.get("variant")?.as_str()?.parse().ok()?,
            version: argon2::Version::try_from(u32_of("version")?).ok()?,
            iterations: u32_of("iterations")?,
            memory_kib: u32_of("memoryKib")?,
            parallelism: u32_of("parallelism")?,
            hash_len: usize::try_from(u32_of("hashLen")?).ok()?,
            associated_data: bytes_of("associatedData")?,
        },
        _ => return None,
    })
}

/// The hash spec of a `batchCreate` request, or the Identity Toolkit error code production
/// answers for its parameters. Codes not yet observed in production are provisional
/// (`INVALID_HASH_ALGORITHM` and friends) and follow the sandbox recording.
pub(crate) fn spec_from_options(options: &Value) -> Result<HashSpec, &'static str> {
    let text = |key: &str| options.get(key).and_then(Value::as_str);
    let int = |key: &str| options.get(key).and_then(Value::as_u64);
    let bytes = |key: &str| text(key).and_then(base64_decode);
    let rounds = || int("rounds").and_then(|n| u32::try_from(n).ok());
    // MD5 and SHA take 0..=8192 rounds (absent is 0); more is refused.
    let digest_rounds = || match options.get("rounds") {
        None | Some(Value::Null) => Ok(0),
        Some(_) => rounds().filter(|n| *n <= 8192).ok_or("INVALID_HASH_ROUNDS"),
    };
    let order = |default: Order| match text("passwordHashOrder") {
        Some("SALT_AND_PASSWORD") => Order::SaltFirst,
        Some("PASSWORD_AND_SALT") => Order::PasswordFirst,
        _ => default,
    };
    let family_of = |name: &str| match name {
        "MD5" => Family::Md5,
        "SHA1" => Family::Sha1,
        "SHA256" => Family::Sha256,
        _ => Family::Sha512,
    };
    let algorithm = text("hashAlgorithm").ok_or("MISSING_HASH_ALGORITHM")?;
    Ok(match algorithm {
        "MD5" => HashSpec::Md5 {
            rounds: digest_rounds()?,
        },
        "SHA1" | "SHA256" | "SHA512" => HashSpec::Sha {
            family: family_of(algorithm),
            rounds: digest_rounds()?,
            order: order(Order::SaltFirst),
        },
        "HMAC_MD5" | "HMAC_SHA1" | "HMAC_SHA256" | "HMAC_SHA512" => {
            let key = bytes("signerKey").unwrap_or_default();
            // Production refuses a missing key for every HMAC but HMAC_SHA512, which it
            // accepts at import and then fails at sign-in.
            if key.is_empty() && algorithm != "HMAC_SHA512" {
                return Err("EMPTY_HASH_KEY");
            }
            HashSpec::Hmac {
                family: family_of(&algorithm["HMAC_".len()..]),
                key,
                order: order(Order::PasswordFirst),
            }
        }
        "PBKDF_SHA1" | "PBKDF2_SHA256" => HashSpec::Pbkdf {
            family: if algorithm == "PBKDF_SHA1" {
                Family::Sha1
            } else {
                Family::Sha256
            },
            rounds: rounds()
                .filter(|n| (1..=120_000).contains(n))
                .ok_or("INVALID_HASH_ROUNDS")?,
        },
        "SCRYPT" => HashSpec::FirebaseScrypt {
            key: bytes("signerKey").unwrap_or_default(),
            separator: bytes("saltSeparator").unwrap_or_default(),
            rounds: rounds()
                .filter(|n| (1..=8).contains(n))
                .ok_or("INVALID_HASH_ROUNDS")?,
            memory_cost: int("memoryCost")
                .and_then(|n| u8::try_from(n).ok())
                .filter(|n| (1..=14).contains(n))
                .ok_or("INVALID_HASH_MEMORY_COSTS")?,
        },
        "STANDARD_SCRYPT" => standard_scrypt_spec(options)?,
        "BCRYPT" => HashSpec::Bcrypt,
        "ARGON2" => argon2_spec(options)?,
        _ => return Err("INVALID_HASH_ALGORITHM"),
    })
}

/// Work bounds for imported hashes. Every algorithm keeps the parameter ranges production
/// validates at import, re-checked at sign-in so a spec restored from an export cannot bypass
/// them (closure re-review 2026-09-24). Standard scrypt block memory and total CPU work, PBKDF output and
/// bcrypt cost have no observed production bound; the local ones keep one sign-in from
/// exhausting the process. Standard scrypt parallelization 1, 4, 5 and 16 were recorded as
/// accepted (AUTH-EDGES-OBS-20261115-01); above 16 is unrecorded and refused.
const MAX_DIGEST_ROUNDS: u32 = 8192;
const MAX_PBKDF_ROUNDS: u32 = 120_000;
const MAX_PBKDF_OUTPUT_BYTES: usize = 128;
const MAX_FIREBASE_SCRYPT_ROUNDS: u32 = 8;
const MAX_FIREBASE_SCRYPT_MEMORY_COST: u8 = 14;
const MAX_STANDARD_SCRYPT_MEMORY_BYTES: u64 = 32 << 20;
const MAX_STANDARD_SCRYPT_PARALLELIZATION: u32 = 16;
/// Block memory times parallelization bounds CPU work, not peak memory, at the earlier allowance of 32 MiB blocks and four lanes. scrypt 0.11 processes lanes sequentially but allocates V=128*r*N, B=128*r*p and T=128*r simultaneously. With N>=2 and these bounds, peak algorithm buffers per derivation are at most 112 MiB plus 1024 output bytes (excluding inputs, stack and allocator overhead).
const MAX_STANDARD_SCRYPT_WORK_BYTES: u64 = 128 << 20;
const MAX_STANDARD_SCRYPT_DK_LEN: usize = 1024;
const MAX_ARGON2_MEMORY_KIB: u32 = 32_768;
const MAX_ARGON2_ITERATIONS: u32 = 16;
const MAX_ARGON2_PARALLELISM: u32 = 16;
const MAX_ARGON2_HASH_LEN: usize = 1024;
const MAX_BCRYPT_COST: u32 = 16;

/// Whether deriving under `spec` for a stored `hash` stays within the work bounds.
pub(crate) fn within_work_bounds(spec: &HashSpec, hash: &[u8]) -> bool {
    match spec {
        HashSpec::Md5 { rounds } | HashSpec::Sha { rounds, .. } => *rounds <= MAX_DIGEST_ROUNDS,
        HashSpec::Hmac { .. } => true,
        HashSpec::Pbkdf { rounds, .. } => {
            (1..=MAX_PBKDF_ROUNDS).contains(rounds) && hash.len() <= MAX_PBKDF_OUTPUT_BYTES
        }
        HashSpec::FirebaseScrypt {
            rounds,
            memory_cost,
            ..
        } => {
            (1..=MAX_FIREBASE_SCRYPT_ROUNDS).contains(rounds)
                && (1..=MAX_FIREBASE_SCRYPT_MEMORY_COST).contains(memory_cost)
        }
        HashSpec::StandardScrypt {
            log_n,
            block_size,
            parallelization,
            dk_len,
        } => {
            let memory = 1_u64
                .checked_shl(u32::from(*log_n))
                .and_then(|n| n.checked_mul(u64::from(*block_size)))
                .and_then(|n| n.checked_mul(128));
            memory.is_some_and(|m| {
                m <= MAX_STANDARD_SCRYPT_MEMORY_BYTES
                    && m.checked_mul(u64::from(*parallelization))
                        .is_some_and(|work| work <= MAX_STANDARD_SCRYPT_WORK_BYTES)
            }) && (1..=MAX_STANDARD_SCRYPT_PARALLELIZATION).contains(parallelization)
                && (1..=MAX_STANDARD_SCRYPT_DK_LEN).contains(dk_len)
        }
        HashSpec::Bcrypt => std::str::from_utf8(hash)
            .ok()
            .and_then(|text| text.split('$').nth(2))
            .and_then(|cost| cost.parse::<u32>().ok())
            .is_some_and(|cost| cost <= MAX_BCRYPT_COST),
        HashSpec::Argon2 {
            iterations,
            memory_kib,
            parallelism,
            hash_len,
            ..
        } => {
            (1..=MAX_ARGON2_MEMORY_KIB).contains(memory_kib)
                && (1..=MAX_ARGON2_ITERATIONS).contains(iterations)
                && (1..=MAX_ARGON2_PARALLELISM).contains(parallelism)
                && (1..=MAX_ARGON2_HASH_LEN).contains(hash_len)
        }
    }
}

/// Why a stored spec text (an export's `fireemuImportedPassword`) cannot be restored, or
/// `None` when it can. A restore accepts exactly what `accounts:batchCreate` accepts, so every
/// export fireemu writes can be imported again (closure review 3, Closure Should Fix 1); the
/// local work bounds stay a sign-in check, which fails such a sign-in with an internal error in
/// the strict profile and answers no match in the emulator profile.
#[must_use]
pub fn imported_hash_spec_error(spec: &str) -> Option<String> {
    if spec == UNSPECIFIED_SPEC {
        return None;
    }
    let Some(decoded) = decode(spec) else {
        return Some("the spec does not decode to a known algorithm".to_owned());
    };
    let outside = |name: &str, value: &dyn std::fmt::Display, range: &str| {
        Some(format!(
            "{name} {value} is outside the import range {range}"
        ))
    };
    match &decoded {
        HashSpec::Md5 { rounds } | HashSpec::Sha { rounds, .. } if *rounds > MAX_DIGEST_ROUNDS => {
            outside("rounds", rounds, "0..=8192")
        }
        HashSpec::Hmac { family, key, .. } if key.is_empty() && *family != Family::Sha512 => {
            Some("the HMAC signerKey is empty".to_owned())
        }
        HashSpec::Pbkdf { family, .. } if !matches!(family, Family::Sha1 | Family::Sha256) => Some(
            format!("PBKDF family {family:?} is not PBKDF_SHA1 or PBKDF2_SHA256"),
        ),
        HashSpec::Pbkdf { rounds, .. } if !(1..=MAX_PBKDF_ROUNDS).contains(rounds) => {
            outside("rounds", rounds, "1..=120000")
        }
        HashSpec::FirebaseScrypt { rounds, .. }
            if !(1..=MAX_FIREBASE_SCRYPT_ROUNDS).contains(rounds) =>
        {
            outside("rounds", rounds, "1..=8")
        }
        HashSpec::FirebaseScrypt { memory_cost, .. }
            if !(1..=MAX_FIREBASE_SCRYPT_MEMORY_COST).contains(memory_cost) =>
        {
            outside("memoryCost", memory_cost, "1..=14")
        }
        HashSpec::StandardScrypt {
            log_n,
            block_size,
            parallelization,
            dk_len,
            // The work bounds also require parallelization and dkLen of at least 1.
        } if *log_n == 0 || *block_size == 0 || !within_work_bounds(&decoded, &[]) => {
            Some(format!(
                "standard scrypt logN {log_n}, blockSize {block_size}, parallelization \
                 {parallelization}, dkLen {dk_len} are outside the import bounds"
            ))
        }
        HashSpec::Argon2 { .. } if !within_work_bounds(&decoded, &[]) => {
            Some("argon2 parameters are outside the import ranges".to_owned())
        }
        _ => None,
    }
}

/// Whether a stored spec text can be restored ([`imported_hash_spec_error`] finds nothing).
#[must_use]
pub fn restorable_spec(spec: &str) -> bool {
    imported_hash_spec_error(spec).is_none()
}

/// The `signerKey` secrets a stored spec carries: HMAC and Firebase SCRYPT keep the key that
/// verifies the hash, which an export must carry for the account to be restorable.
#[must_use]
pub fn imported_hash_secret_fields(spec: &str) -> &'static [&'static str] {
    match decode(spec) {
        Some(HashSpec::Hmac { key, .. } | HashSpec::FirebaseScrypt { key, .. })
            if !key.is_empty() =>
        {
            &["signerKey"]
        }
        _ => &[],
    }
}

/// The spec of a hash imported without `hashAlgorithm`: production keeps it as the credential
/// and no password matches it.
pub(crate) const UNSPECIFIED_SPEC: &str = "{\"algorithm\":\"UNSPECIFIED\"}";

fn standard_scrypt_spec(options: &Value) -> Result<HashSpec, &'static str> {
    let int = |key: &str| options.get(key).and_then(Value::as_u64);
    let positive_u32 = |key: &str| {
        int(key)
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| *n > 0)
    };
    let cost = int("cpuMemCost").filter(|n| n.is_power_of_two() && *n > 1);
    let spec = HashSpec::StandardScrypt {
        log_n: cost
            .and_then(|n| u8::try_from(n.trailing_zeros()).ok())
            .ok_or("INVALID_HASH_PARAMETER")?,
        block_size: positive_u32("blockSize").ok_or("INVALID_HASH_PARAMETER")?,
        parallelization: positive_u32("parallelization").ok_or("INVALID_HASH_PARAMETER")?,
        dk_len: int("dkLen")
            .and_then(|n| usize::try_from(n).ok())
            .filter(|n| *n > 0)
            .ok_or("INVALID_HASH_PARAMETER")?,
    };
    if !within_work_bounds(&spec, &[]) {
        return Err("INVALID_HASH_PARAMETER");
    }
    Ok(spec)
}

fn argon2_spec(options: &Value) -> Result<HashSpec, &'static str> {
    let params = options.get("argon2Parameters");
    let text = |key: &str| params.and_then(|p| p.get(key)).and_then(Value::as_str);
    let within = |key: &str, range: std::ops::RangeInclusive<u32>| {
        params
            .and_then(|p| p.get(key))
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| range.contains(n))
    };
    let memory_kib = within("memoryCostKib", 1..=32768).ok_or("INVALID_ARGON2_MEMORY_COST")?;
    let iterations = within("iterations", 1..=16).ok_or("INVALID_ARGON2_ITERATIONS")?;
    let parallelism = within("parallelism", 1..=16).ok_or("INVALID_ARGON2_PARALLELISM")?;
    // The reference says 4..=1024, but production accepted 3 (such a hash never matches).
    let hash_len = within("hashLengthBytes", 1..=1024).ok_or("INVALID_ARGON2_HASH_LENGTH")?;
    let variant = match text("hashType") {
        Some("ARGON2_ID") => argon2::Algorithm::Argon2id,
        Some("ARGON2_I") => argon2::Algorithm::Argon2i,
        Some("ARGON2_D") => argon2::Algorithm::Argon2d,
        _ => return Err("INVALID_ARGON2_HASH_TYPE"),
    };
    let version = match text("version") {
        Some("VERSION_10") => argon2::Version::V0x10,
        _ => argon2::Version::V0x13,
    };
    let associated_data = text("associatedData")
        .map(|s| base64_decode(s).ok_or("INVALID_ARGON2_ASSOCIATED_DATA"))
        .transpose()?
        .unwrap_or_default();
    Ok(HashSpec::Argon2 {
        variant,
        version,
        iterations,
        memory_kib,
        parallelism,
        hash_len: usize::try_from(hash_len).map_err(|_| "INVALID_ARGON2_HASH_LENGTH")?,
        associated_data,
    })
}

/// Standard or URL-safe base64, padded or not: what proto3 JSON accepts for `bytes`.
pub(crate) fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let mut bits = 0_u32;
    let mut count = 0_u8;
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let trimmed = text.trim_end_matches('=');
    for c in trimmed.bytes() {
        let value = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        };
        bits = (bits << 6) | u32::from(value);
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push(u8::try_from((bits >> count) & 0xff).ok()?);
        }
    }
    if trimmed.len() % 4 == 1 {
        return None;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The corpus vectors (conformance/src/auth-account/hash-vectors.json): every one was
    /// accepted by production with the password `password123`.
    fn vectors() -> serde_json::Map<String, Value> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../conformance/src/auth-account/hash-vectors.json"
        );
        serde_json::from_str::<Value>(&std::fs::read_to_string(path).expect("vectors"))
            .expect("json")
            .as_object()
            .expect("object")
            .clone()
    }

    /// An HMAC without a key fails the sign-in in both profiles, as production does (sandbox
    /// recording 2026-09-23); a keyed HMAC verifies in both.
    #[test]
    fn a_keyless_hmac_fails_the_sign_in_in_both_profiles() {
        use fireemu_core_auth::store::{ImportedHashVerifier, ImportedPasswordHash};
        let imported = |key: Vec<u8>| {
            let spec = HashSpec::Hmac {
                family: Family::Sha512,
                key,
                order: Order::PasswordFirst,
            };
            let hash = derive(&spec, b"password", b"salt", 64).unwrap_or_default();
            ImportedPasswordHash {
                spec: encode(&spec),
                hash,
                salt: b"salt".to_vec(),
            }
        };
        let keyless = imported(Vec::new());
        for strict in [true, false] {
            assert!(ImportedHashes { strict }
                .verify(&keyless, "password")
                .is_err());
        }
        let keyed = imported(vec![1, 2, 3]);
        for strict in [true, false] {
            assert_eq!(
                ImportedHashes { strict }.verify(&keyed, "password"),
                Ok(true)
            );
        }
    }

    /// The bcrypt cost bound is inclusive at 16: cost 16 derives in both profiles, cost 17
    /// fails the strict sign-in and answers no match in the emulator profile, without
    /// deriving.
    #[test]
    fn bcrypt_cost_above_the_bound_never_derives() {
        use fireemu_core_auth::store::{ImportedHashVerifier, ImportedPasswordHash};
        let imported = |hash: String| ImportedPasswordHash {
            spec: encode(&HashSpec::Bcrypt),
            hash: hash.into_bytes(),
            salt: Vec::new(),
        };
        let over = imported(format!("$2b$17${}", "a".repeat(53)));
        assert!(!within_work_bounds(&HashSpec::Bcrypt, &over.hash));
        let derived = std::rc::Rc::new(std::cell::Cell::new(0));
        let seen = std::rc::Rc::clone(&derived);
        DERIVATION_OBSERVER.with_borrow_mut(|observer| {
            *observer = Some(Box::new(move |start| {
                if start {
                    seen.set(seen.get() + 1);
                }
            }));
        });
        assert!(ImportedHashes { strict: true }
            .verify(&over, "password")
            .is_err());
        assert_eq!(
            ImportedHashes { strict: false }.verify(&over, "password"),
            Ok(false)
        );
        assert_eq!(derived.get(), 0);
        let low = imported(
            bcrypt::hash_with_salt("password", 4, [7; 16])
                .unwrap()
                .format_for_version(bcrypt::Version::TwoB),
        );
        for strict in [true, false] {
            assert_eq!(ImportedHashes { strict }.verify(&low, "password"), Ok(true));
            assert_eq!(ImportedHashes { strict }.verify(&low, "wrong"), Ok(false));
        }
        assert_eq!(derived.get(), 4);
        DERIVATION_OBSERVER.with_borrow_mut(|observer| *observer = None);
        assert!(within_work_bounds(
            &HashSpec::Bcrypt,
            format!("$2b$16${}", "a".repeat(53)).as_bytes()
        ));
    }

    /// A spec outside the import ranges fails the sign-in instead of running, whichever way
    /// it reached the store (closure re-review 2026-09-24).
    #[test]
    fn out_of_range_specs_are_unevaluable() {
        use fireemu_core_auth::store::{ImportedHashVerifier, ImportedPasswordHash};
        let out_of_range = [
            HashSpec::FirebaseScrypt {
                key: vec![1; 32],
                separator: vec![2],
                rounds: 8,
                memory_cost: 40,
            },
            HashSpec::Argon2 {
                variant: argon2::Algorithm::Argon2id,
                version: argon2::Version::V0x13,
                iterations: 1,
                memory_kib: 1 << 30,
                parallelism: 1,
                hash_len: 32,
                associated_data: Vec::new(),
            },
            HashSpec::Pbkdf {
                family: Family::Sha256,
                rounds: 1 << 30,
            },
            HashSpec::Md5 { rounds: 1 << 30 },
            HashSpec::StandardScrypt {
                log_n: 20,
                block_size: 8,
                parallelization: 1,
                dk_len: 64,
            },
        ];
        for spec in out_of_range {
            let imported = ImportedPasswordHash {
                spec: encode(&spec),
                hash: vec![7; 32],
                salt: vec![1],
            };
            assert!(!restorable_spec(&imported.spec), "{spec:?}");
            assert!(
                ImportedHashes { strict: true }
                    .verify(&imported, "password123")
                    .is_err(),
                "{spec:?}"
            );
            assert_eq!(
                ImportedHashes { strict: false }.verify(&imported, "password123"),
                Ok(false),
                "{spec:?}"
            );
        }
        // A PBKDF output far longer than any digest is refused as well.
        let pbkdf = HashSpec::Pbkdf {
            family: Family::Sha1,
            rounds: 1000,
        };
        assert!(!within_work_bounds(&pbkdf, &[0; 4096]));
        assert!(within_work_bounds(&pbkdf, &[0; 20]));
        assert!(restorable_spec(UNSPECIFIED_SPEC));
    }

    #[test]
    fn an_empty_hash_never_matches_under_any_spec() {
        for spec in [
            HashSpec::Pbkdf {
                family: Family::Sha1,
                rounds: 1000,
            },
            HashSpec::Pbkdf {
                family: Family::Sha256,
                rounds: 1000,
            },
            HashSpec::Md5 { rounds: 0 },
        ] {
            assert!(!verify(&spec, "anything", b"salt", &[]), "{spec:?}");
            assert!(!verify(&spec, "", b"salt", &[]), "{spec:?}");
        }
    }

    /// Identity Platform documents any positive `dkLen`; the scrypt crate's `Params` accepts
    /// only 10..=64 bytes, so the output length must come from the buffer (external review
    /// 2026-09-24). scrypt's final step is PBKDF2, so shorter outputs are prefixes of longer.
    #[test]
    fn standard_scrypt_verifies_every_positive_key_length() {
        let spec = |dk_len| HashSpec::StandardScrypt {
            log_n: 10,
            block_size: 8,
            parallelization: 1,
            dk_len,
        };
        let reference = derive(&spec(64), b"password123", b"salt", 64).expect("64-byte key");
        for dk_len in [1, 9, 10, 64, 65, 128] {
            let derived = derive(&spec(dk_len), b"password123", b"salt", dk_len)
                .unwrap_or_else(|| panic!("dkLen {dk_len} derives"));
            assert_eq!(derived.len(), dk_len);
            let shared = dk_len.min(64);
            assert_eq!(derived[..shared], reference[..shared], "dkLen {dk_len}");
            assert!(verify(&spec(dk_len), "password123", b"salt", &derived));
            assert!(!verify(&spec(dk_len), "password124", b"salt", &derived));
        }
    }

    #[test]
    fn every_production_vector_verifies_only_its_password() {
        let vectors = vectors();
        assert_eq!(vectors.len(), 29);
        for (name, vector) in &vectors {
            let spec =
                spec_from_options(&vector["options"]).unwrap_or_else(|e| panic!("{name}: {e}"));
            let user = &vector["user"];
            let hash = base64_decode(user["passwordHash"].as_str().unwrap()).unwrap();
            let salt = user
                .get("salt")
                .and_then(Value::as_str)
                .map(|s| base64_decode(s).unwrap())
                .unwrap_or_default();
            assert!(
                verify(&spec, "password123", &salt, &hash),
                "{name} accepts its password"
            );
            assert!(
                !verify(&spec, "password124", &salt, &hash),
                "{name} refuses another"
            );
            // The bounds never refuse a recorded vector (closure review 3, Closure Should
            // Fix 5): it restores, and its sign-in stays within the work bounds.
            assert!(restorable_spec(&encode(&spec)), "{name} restores");
            assert!(
                within_work_bounds(&spec, &hash),
                "{name} is within the work bounds"
            );
            assert_eq!(decode(&encode(&spec)), Some(spec), "{name} round-trips");
        }
    }

    /// The options of one batchCreate import, drawn around every parameter edge.
    fn import_options() -> impl proptest::strategy::Strategy<Value = Value> {
        use proptest::prelude::*;
        let edge = |hi: u64| prop_oneof![Just(0_u64), Just(1), Just(hi), Just(hi + 1), 0..=hi + 2];
        prop_oneof![
            (
                prop_oneof![Just("MD5"), Just("SHA1"), Just("SHA256"), Just("SHA512")],
                edge(8192)
            )
                .prop_map(|(a, r)| json!({"hashAlgorithm": a, "rounds": r})),
            (
                prop_oneof![
                    Just("HMAC_MD5"),
                    Just("HMAC_SHA1"),
                    Just("HMAC_SHA256"),
                    Just("HMAC_SHA512")
                ],
                prop_oneof![Just(""), Just("AQID")]
            )
                .prop_map(|(a, k)| json!({"hashAlgorithm": a, "signerKey": k})),
            (
                prop_oneof![Just("PBKDF_SHA1"), Just("PBKDF2_SHA256")],
                edge(120_000)
            )
                .prop_map(|(a, r)| json!({"hashAlgorithm": a, "rounds": r})),
            (edge(8), edge(14)).prop_map(|(r, m)| json!({"hashAlgorithm": "SCRYPT",
                "signerKey": "AQID", "saltSeparator": "Bw==", "rounds": r, "memoryCost": m})),
            (0_u32..17, edge(64), edge(20), edge(1024)).prop_map(|(log_n, r, p, dk)| json!({
                "hashAlgorithm": "STANDARD_SCRYPT", "cpuMemCost": 1_u64 << log_n,
                "blockSize": r, "parallelization": p, "dkLen": dk})),
            (edge(32_768), edge(16), edge(16), edge(1024)).prop_map(|(m, t, p, h)| json!({
                "hashAlgorithm": "ARGON2", "argon2Parameters": {"hashType": "ARGON2_ID",
                "memoryCostKib": m, "iterations": t, "parallelism": p, "hashLengthBytes": h}})),
            Just(json!({"hashAlgorithm": "BCRYPT"})),
        ]
    }

    proptest::proptest! {
        /// Export and import are symmetric: every spec batchCreate accepts restores.
        #[test]
        fn every_importable_spec_restores(options in import_options()) {
            if let Ok(spec) = spec_from_options(&options) {
                let text = encode(&spec);
                proptest::prop_assert_eq!(imported_hash_spec_error(&text), None, "{}", text);
            }
        }
    }

    /// The restore refuses, naming the parameter, what batchCreate never creates; bcrypt
    /// cost and PBKDF output length, which batchCreate accepts unbounded, restore.
    #[test]
    fn restore_ranges_match_the_import_ranges() {
        let refused = [
            (json!({"algorithm": "MD5", "rounds": 8193}), "rounds 8193"),
            (
                json!({"algorithm": "SHA", "family": "SHA1", "rounds": 8193, "order": "SALT_AND_PASSWORD"}),
                "rounds 8193",
            ),
            (
                json!({"algorithm": "HMAC", "family": "SHA256", "key": "", "order": "PASSWORD_AND_SALT"}),
                "signerKey is empty",
            ),
            (
                json!({"algorithm": "PBKDF", "family": "MD5", "rounds": 1}),
                "PBKDF family",
            ),
            (
                json!({"algorithm": "PBKDF", "family": "SHA1", "rounds": 0}),
                "rounds 0",
            ),
            (
                json!({"algorithm": "PBKDF", "family": "SHA256", "rounds": 120_001}),
                "rounds 120001",
            ),
            (
                json!({"algorithm": "SCRYPT", "key": "AQ==", "separator": "", "rounds": 9, "memoryCost": 14}),
                "rounds 9",
            ),
            (
                json!({"algorithm": "SCRYPT", "key": "AQ==", "separator": "", "rounds": 0, "memoryCost": 14}),
                "rounds 0",
            ),
            (
                json!({"algorithm": "SCRYPT", "key": "AQ==", "separator": "", "rounds": 8, "memoryCost": 15}),
                "memoryCost 15",
            ),
            (
                json!({"algorithm": "SCRYPT", "key": "AQ==", "separator": "", "rounds": 8, "memoryCost": 0}),
                "memoryCost 0",
            ),
            (
                json!({"algorithm": "STANDARD_SCRYPT", "logN": 0, "blockSize": 8, "parallelization": 1, "dkLen": 64}),
                "logN 0",
            ),
            (
                json!({"algorithm": "STANDARD_SCRYPT", "logN": 4, "blockSize": 0, "parallelization": 1, "dkLen": 64}),
                "blockSize 0",
            ),
            (
                json!({"algorithm": "STANDARD_SCRYPT", "logN": 4, "blockSize": 1, "parallelization": 0, "dkLen": 64}),
                "parallelization 0",
            ),
            (
                json!({"algorithm": "STANDARD_SCRYPT", "logN": 4, "blockSize": 1, "parallelization": 17, "dkLen": 64}),
                "parallelization 17",
            ),
            (
                json!({"algorithm": "STANDARD_SCRYPT", "logN": 4, "blockSize": 1, "parallelization": 1, "dkLen": 0}),
                "dkLen 0",
            ),
            (
                json!({"algorithm": "STANDARD_SCRYPT", "logN": 4, "blockSize": 1, "parallelization": 1, "dkLen": 1025}),
                "dkLen 1025",
            ),
            (
                json!({"algorithm": "STANDARD_SCRYPT", "logN": 15, "blockSize": 8, "parallelization": 5, "dkLen": 64}),
                "parallelization 5",
            ),
            (
                json!({"algorithm": "ARGON2", "variant": "argon2id", "version": 19, "iterations": 17, "memoryKib": 64, "parallelism": 1, "hashLen": 32, "associatedData": ""}),
                "argon2",
            ),
            (json!({"algorithm": "NOPE"}), "does not decode"),
        ];
        for (spec, cause) in refused {
            let error = imported_hash_spec_error(&spec.to_string());
            assert!(
                error.as_deref().is_some_and(|e| e.contains(cause)),
                "{spec}: {error:?}"
            );
        }
        let restored = [
            json!({"algorithm": "MD5", "rounds": 8192}),
            json!({"algorithm": "HMAC", "family": "SHA512", "key": "", "order": "PASSWORD_AND_SALT"}),
            json!({"algorithm": "PBKDF", "family": "SHA256", "rounds": 120_000}),
            json!({"algorithm": "PBKDF", "family": "SHA1", "rounds": 1}),
            json!({"algorithm": "SCRYPT", "key": "AQ==", "separator": "", "rounds": 8, "memoryCost": 14}),
            json!({"algorithm": "SCRYPT", "key": "AQ==", "separator": "", "rounds": 1, "memoryCost": 1}),
            json!({"algorithm": "STANDARD_SCRYPT", "logN": 4, "blockSize": 1, "parallelization": 16, "dkLen": 1024}),
            json!({"algorithm": "STANDARD_SCRYPT", "logN": 1, "blockSize": 1, "parallelization": 1, "dkLen": 1}),
            json!({"algorithm": "STANDARD_SCRYPT", "logN": 15, "blockSize": 8, "parallelization": 4, "dkLen": 64}),
            json!({"algorithm": "BCRYPT"}),
        ];
        for spec in restored {
            assert_eq!(imported_hash_spec_error(&spec.to_string()), None, "{spec}");
        }
    }

    /// HMAC and Firebase SCRYPT carry their signerKey; nothing else is a secret.
    #[test]
    fn secret_fields_name_the_signer_key() {
        let with_key = [
            json!({"algorithm": "HMAC", "family": "SHA256", "key": "AQ==", "order": "PASSWORD_AND_SALT"}),
            json!({"algorithm": "SCRYPT", "key": "AQ==", "separator": "", "rounds": 8, "memoryCost": 14}),
        ];
        for spec in with_key {
            assert_eq!(
                imported_hash_secret_fields(&spec.to_string()),
                ["signerKey"],
                "{spec}"
            );
        }
        for spec in [
            json!({"algorithm": "HMAC", "family": "SHA512", "key": "", "order": "PASSWORD_AND_SALT"}),
            json!({"algorithm": "SCRYPT", "key": "", "separator": "", "rounds": 8, "memoryCost": 14}),
            json!({"algorithm": "MD5", "rounds": 1}),
            json!({"algorithm": "BCRYPT"}),
            json!("not a spec"),
        ] {
            assert!(
                imported_hash_secret_fields(&spec.to_string()).is_empty(),
                "{spec}"
            );
        }
    }

    #[test]
    fn base64_accepts_standard_and_url_safe_forms() {
        assert_eq!(base64_decode("+/8="), Some(vec![0xfb, 0xff]));
        assert_eq!(base64_decode("-_8"), Some(vec![0xfb, 0xff]));
        assert_eq!(base64_decode("not base64!"), None);
        assert_eq!(base64_decode("A"), None);
    }

    /// A deterministic stand-in for a derivation: the password matches when it equals the
    /// hash bytes; an empty salt is unevaluable.
    struct EqualBytes;

    impl fireemu_core_auth::store::ImportedHashVerifier for EqualBytes {
        fn verify(
            &self,
            imported: &fireemu_core_auth::store::ImportedPasswordHash,
            password: &str,
        ) -> Result<bool, fireemu_core_auth::store::ImportedHashFailure> {
            if imported.salt.is_empty() {
                return Err(fireemu_core_auth::store::ImportedHashFailure);
            }
            Ok(imported.hash == password.as_bytes())
        }
    }

    fn hash_of(
        spec: u8,
        hash: &[u8],
        salt: &[u8],
    ) -> fireemu_core_auth::store::ImportedPasswordHash {
        fireemu_core_auth::store::ImportedPasswordHash {
            spec: format!("spec{spec}"),
            hash: hash.to_vec(),
            salt: salt.to_vec(),
        }
    }

    proptest::proptest! {
        /// Model: a snapshot verifier always answers what a derivation of the hash it is asked
        /// about answers, whatever the hash and password were when the snapshot was taken, as
        /// long as the snapshot itself was honest (taken with the same verifier).
        #[test]
        fn a_snapshot_answer_equals_a_fresh_derivation(
            snap_spec in 0_u8..3, snap_hash in proptest::collection::vec(b'a'..b'd', 0..3),
            snap_salt in proptest::collection::vec(0_u8..2, 0..2),
            snap_password in "[a-c]{0,2}",
            ask_spec in 0_u8..3, ask_hash in proptest::collection::vec(b'a'..b'd', 0..3),
            ask_salt in proptest::collection::vec(0_u8..2, 0..2),
            ask_password in "[a-c]{0,2}",
        ) {
            use fireemu_core_auth::store::ImportedHashVerifier;
            let snapshot_hash = hash_of(snap_spec, &snap_hash, &snap_salt);
            let snapshot = PreVerified {
                result: EqualBytes.verify(&snapshot_hash, &snap_password),
                imported: snapshot_hash,
                password: snap_password,
            };
            let asked = hash_of(ask_spec, &ask_hash, &ask_salt);
            let answer = SnapshotHashes { snapshot: Some(&snapshot), fallback: &EqualBytes }
                .verify(&asked, &ask_password);
            proptest::prop_assert_eq!(answer, EqualBytes.verify(&asked, &ask_password));
        }
    }

    /// The snapshot answers only for the hash and password it verified: a credential that
    /// changed under the request (or another password) is derived again, never answered from
    /// a stale result.
    #[test]
    fn a_stale_snapshot_is_not_used() {
        use fireemu_core_auth::store::{ImportedHashFailure, ImportedHashVerifier};
        // The snapshot's answer differs from any derivation, so each assertion shows which
        // answer was used.
        let snapshot = PreVerified {
            imported: hash_of(0, b"old", b"s"),
            password: "old".to_owned(),
            result: Err(ImportedHashFailure),
        };
        let verifier = SnapshotHashes {
            snapshot: Some(&snapshot),
            fallback: &EqualBytes,
        };
        assert_eq!(
            verifier.verify(&hash_of(0, b"old", b"s"), "old"),
            Err(ImportedHashFailure)
        );
        assert_eq!(verifier.verify(&hash_of(0, b"new", b"s"), "old"), Ok(false));
        assert_eq!(verifier.verify(&hash_of(1, b"old", b"s"), "old"), Ok(true));
        assert_eq!(verifier.verify(&hash_of(0, b"old", b"t"), "old"), Ok(true));
        assert_eq!(verifier.verify(&hash_of(0, b"old", b"s"), "ol"), Ok(false));
        let none = SnapshotHashes {
            snapshot: None,
            fallback: &EqualBytes,
        };
        assert_eq!(none.verify(&hash_of(0, b"old", b"s"), "old"), Ok(true));
    }

    #[test]
    fn imported_derivations_are_bounded_and_waiters_complete() {
        use fireemu_core_auth::store::{ImportedHashVerifier, ImportedPasswordHash};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc, Arc, Condvar, Mutex,
        };
        use std::time::Duration;

        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let (entered, entries) = mpsc::channel();
        let imported = ImportedPasswordHash {
            spec: encode(&HashSpec::Argon2 {
                variant: argon2::Algorithm::Argon2id,
                version: argon2::Version::V0x13,
                iterations: 1,
                memory_kib: 32768,
                parallelism: 1,
                hash_len: 32,
                associated_data: Vec::new(),
            }),
            salt: b"synthetic-salt".to_vec(),
            hash: vec![0; 32],
        };
        let mut threads = Vec::new();
        for _ in 0..6 {
            let (active, peak, release, entered, imported) = (
                active.clone(),
                peak.clone(),
                release.clone(),
                entered.clone(),
                imported.clone(),
            );
            threads.push(std::thread::spawn(move || {
                DERIVATION_OBSERVER.with_borrow_mut(|observer| {
                    *observer = Some(Box::new(move |entering| {
                        if entering {
                            let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                            peak.fetch_max(count, Ordering::SeqCst);
                            entered.send(()).unwrap();
                            let ready = release.0.lock().unwrap();
                            drop(release.1.wait_while(ready, |ready| !*ready).unwrap());
                        } else {
                            active.fetch_sub(1, Ordering::SeqCst);
                        }
                    }));
                });
                assert_eq!(
                    ImportedHashes { strict: true }.verify(&imported, "password"),
                    Ok(false)
                );
                DERIVATION_OBSERVER.with_borrow_mut(|observer| *observer = None);
            }));
        }
        // Always release and join workers before asserting, even when a mutation lets too many enter.
        let first = entries.recv_timeout(Duration::from_secs(30));
        let second = entries.recv_timeout(Duration::from_secs(30));
        let excess = entries.recv_timeout(Duration::from_millis(200));
        *release.0.lock().unwrap() = true;
        release.1.notify_all();
        for thread in threads {
            thread.join().unwrap();
        }
        assert!(
            first.is_ok() && second.is_ok(),
            "two derivations must run concurrently"
        );
        assert!(
            excess.is_err(),
            "a third derivation entered before a permit was released"
        );
        assert_eq!(peak.load(Ordering::SeqCst), 2);
        assert_eq!(active.load(Ordering::SeqCst), 0);
        assert_eq!(entries.try_iter().count(), 4);
    }

    /// The derivation runs with the store unlocked; only the snapshot read takes the lock.
    #[test]
    fn preverify_derives_without_holding_the_store_lock() {
        use fireemu_core_auth::mfa::TotpPolicy;
        use fireemu_core_auth::store::{AuthStore, ImportedUser, Provider};
        use fireemu_core_types::determinism::SplitMix64;
        use std::sync::{Arc, Mutex};
        struct ProbesLock(Arc<Mutex<AuthStore>>);
        impl fireemu_core_auth::store::ImportedHashVerifier for ProbesLock {
            fn verify(
                &self,
                _imported: &fireemu_core_auth::store::ImportedPasswordHash,
                _password: &str,
            ) -> Result<bool, fireemu_core_auth::store::ImportedHashFailure> {
                Ok(self.0.try_lock().is_ok())
            }
        }
        let mut store = AuthStore::new("demo-app", SplitMix64::new(7), TotpPolicy::default());
        let at = fireemu_core_types::time::LogicalInstant::from_nanos(0);
        store
            .import_user(ImportedUser {
                local_id: "u".to_owned(),
                email: Some("u@example.com".to_owned()),
                email_verified: false,
                display_name: None,
                photo_url: None,
                phone_number: None,
                disabled: false,
                provider: Provider::Password,
                custom_claims: fireemu_core_auth::claims::CustomClaims::default(),
                created_at: at,
                last_refresh_at: None,
                last_sign_in_at: None,
                tokens_valid_after: at,
                federated: Vec::new(),
                password: None,
                imported_password: Some(hash_of(0, b"h", b"s")),
                allow_shared_email: false,
                totp_factors: Vec::new(),
                phone_factors: Vec::new(),
            })
            .expect("import");
        let store = Arc::new(Mutex::new(store));
        let verifier = ProbesLock(store.clone());
        let pre = preverify(&store, Some("u@example.com"), Some("pw"), &verifier)
            .expect("an imported hash is snapshotted");
        assert_eq!(
            pre.result,
            Ok(true),
            "the lock was held during the derivation"
        );
        assert!(preverify(&store, Some("none@example.com"), Some("pw"), &verifier).is_none());
        assert!(preverify(&store, Some("u@example.com"), Some(""), &verifier).is_none());
        assert!(preverify(&store, None, Some("pw"), &verifier).is_none());
    }
}
