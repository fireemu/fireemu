//! Strict answers pinned to the STORAGE-STRICTNESS-OBS v4.1 production recording (run recorded 2026-11-17):
//! list delimiters, page tokens, `matchGlob` limits, copy bodies, the bucket resource and XML DELETE.
//! Each test names the recorded rows (V4-...) it follows; the emulator profile keeps its answers.

use std::sync::{Arc, Mutex};

use fireemu_adapter_http::storage::{StorageRulesRegistry, StorageState};
use fireemu_adapter_http::storage_server::{serve_storage_with_budget, BodyBudget};
use fireemu_core_auth::jwt::TokenAcceptance;
use fireemu_core_auth::mfa::TotpPolicy;
use fireemu_core_auth::store::AuthStore;
use fireemu_core_rules::runtime::{LoadedRules, RulesetSlot};
use fireemu_core_session::clock::VirtualClock;
use fireemu_core_storage::name::{BucketName, ObjectName};
use fireemu_core_storage::store::StorageState as ObjectStore;
use fireemu_core_storage::store::{NewMetadata, Precondition};
use fireemu_core_types::determinism::SplitMix64;
use fireemu_core_types::time::LogicalInstant;
use serde_json::{json, Value};
use std::fmt::Write as _;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const START: LogicalInstant = LogicalInstant::from_unix_seconds(1_788_004_860);
const ALLOW_ALL_RULES: &str = "rules_version = '2'; service firebase.storage { match /b/{bucket}/o { match /{path=**} { allow read, write: if true; } } }";

fn state(acceptance: TokenAcceptance) -> StorageState {
    StorageState {
        store: Mutex::new(ObjectStore::new(9)),
        clock: Arc::new(Mutex::new(VirtualClock::new(START))),
        auth: Arc::new(fireemu_core_auth::store::AuthRegistry::new(
            "demo-app",
            Arc::new(Mutex::new(AuthStore::new(
                "demo-app",
                SplitMix64::new(3),
                TotpPolicy::default(),
            ))),
        )),
        tenancy: None,
        rules: Arc::new(StorageRulesRegistry::global(Arc::new(RulesetSlot::new(
            LoadedRules::from_source(ALLOW_ALL_RULES).unwrap(),
        )))),
        project: "demo-app".to_owned(),
        events: None,
        barrier: None,
        firestore: None,
        faults: None,
        clock_observer: None,
        app_check_policy: None,
        admin_capability: None,
        server_requests: fireemu_adapter_http::storage::StorageServerRequests::default(),
        token_acceptance: acceptance,
        allow_unsigned_id_tokens: acceptance == TokenAcceptance::EmulatorMock,
        control_token: Some("storage-test-control-token".to_owned()),
    }
}

static BUDGET: BodyBudget = BodyBudget::new(8 * 1024 * 1024);
const BUCKET: &str = "demo-app.appspot.com";

struct Answer {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Answer {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    /// Every value of a header that is written on several lines, joined with ", ".
    fn all(&self, name: &str) -> String {
        self.headers
            .iter()
            .filter(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    }
    fn text(&self) -> String {
        String::from_utf8(self.body.clone()).unwrap()
    }
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap()
    }
}

/// Serves `state` on a loopback port; the returned handle lets a test change the store between requests.
async fn serve(
    state: StorageState,
) -> (
    std::net::SocketAddr,
    Arc<StorageState>,
    tokio::task::JoinHandle<()>,
) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let shared = Arc::new(state);
    let served = shared.clone();
    let task = tokio::spawn(async move {
        let _ = serve_storage_with_budget(listener, served, &BUDGET).await;
    });
    (addr, shared, task)
}

async fn send_with(
    addr: std::net::SocketAddr,
    method: &str,
    path: &str,
    extra: &[(&str, &str)],
    body: Option<&str>,
) -> Answer {
    let mut head = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n",
        addr.port()
    );
    head.push_str("Authorization: Bearer owner\r\n");
    for (name, value) in extra {
        write!(head, "{name}: {value}\r\n").unwrap();
    }
    let payload = body.unwrap_or("");
    write!(
        head,
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    )
    .unwrap();
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    stream.write_all(head.as_bytes()).await.unwrap();
    stream.write_all(payload.as_bytes()).await.unwrap();
    let mut raw = Vec::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(20),
        stream.read_to_end(&mut raw),
    )
    .await
    .expect("no answer within 20 s")
    .unwrap();
    let boundary = raw
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .unwrap();
    let head = std::str::from_utf8(&raw[..boundary]).unwrap();
    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(n, v)| (n.trim().to_owned(), v.trim().to_owned()))
        .collect();
    Answer {
        status,
        headers,
        body: raw[boundary + 4..].to_vec(),
    }
}

async fn get(addr: std::net::SocketAddr, path: &str) -> Answer {
    send_with(addr, "GET", path, &[], None).await
}

fn put(s: &StorageState, name: &str) {
    seed_named(s, BUCKET, name, b"fire");
}

fn names(list: &Value, key: &str) -> Vec<String> {
    list.get(key)
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .map(|entry| {
                    entry
                        .get("name")
                        .unwrap_or(entry)
                        .as_str()
                        .unwrap()
                        .to_owned()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn seed_named(s: &StorageState, bucket: &str, name: &str, body: &[u8]) {
    s.store
        .lock()
        .unwrap()
        .put(
            &BucketName::try_new(bucket).unwrap(),
            &ObjectName::try_new(name).unwrap(),
            body.to_vec(),
            NewMetadata::default(),
            Precondition::default(),
            START,
        )
        .unwrap();
}

fn remove(s: &StorageState, name: &str) {
    s.store
        .lock()
        .unwrap()
        .delete(
            &BucketName::try_new(BUCKET).unwrap(),
            &ObjectName::try_new(name).unwrap(),
            Precondition::default(),
            START,
        )
        .unwrap();
}

fn trailing_fixture(acceptance: TokenAcceptance) -> StorageState {
    let s = state(acceptance);
    for name in ["tl/d1/", "tl/d1/a.txt", "tl/d2/a.txt", "tl/f.txt"] {
        put(&s, name);
    }
    s
}

fn paging_fixture(acceptance: TokenAcceptance) -> StorageState {
    let s = state(acceptance);
    for name in ["pg/a", "pg/b", "pg/c", "pg/d", "pg/e"] {
        put(&s, name);
    }
    s
}

const LIST: &str = "/storage/v1/b/demo-app.appspot.com/o";

async fn page(addr: std::net::SocketAddr, query: &str, token: Option<&str>) -> Value {
    let url = match token {
        Some(t) => format!("{LIST}?{query}&pageToken={t}"),
        None => format!("{LIST}?{query}"),
    };
    get(addr, &url).await.json()
}

fn token_of(page: &Value) -> Option<String> {
    page.get("nextPageToken")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

/// The member names of the object at `indent` spaces in the pretty-printed body, in the order written.
fn raw_keys(answer: &Answer, indent: usize, within: Option<&str>) -> Vec<String> {
    let text = answer.text();
    let pad = " ".repeat(indent);
    let outer = " ".repeat(indent.saturating_sub(2));
    let mut inside = within.is_none();
    let mut keys = Vec::new();
    for line in text.lines() {
        if let Some(parent) = within {
            if line.starts_with(&format!("{outer}\"{parent}\": {{")) {
                inside = true;
                continue;
            }
            if inside && line.starts_with(&format!("{outer}}}")) {
                break;
            }
        }
        if inside && line.starts_with(&format!("{pad}\"")) {
            if let Some(key) = line[pad.len() + 1..].split('"').next() {
                keys.push(key.to_owned());
            }
        }
    }
    keys
}

/// V4-L-delim, -itd-true, -itd-false, -sub, -itd-sub, -itd-nodelim (recorded 2026-11-17).
#[tokio::test]
async fn strict_include_trailing_delimiter_lists_the_placeholder_as_item_and_prefix() {
    let (addr, _s, task) = serve(trailing_fixture(TokenAcceptance::Verified)).await;
    let base = format!("{LIST}?prefix=tl%2F&delimiter=%2F");
    let plain = get(addr, &base).await.json();
    assert_eq!(names(&plain, "items"), ["tl/f.txt"]);
    assert_eq!(names(&plain, "prefixes"), ["tl/d1/", "tl/d2/"]);
    let yes = get(addr, &format!("{base}&includeTrailingDelimiter=true")).await;
    assert_eq!(yes.status, 200);
    assert_eq!(raw_keys(&yes, 2, None), ["kind", "prefixes", "items"]);
    let yes = yes.json();
    assert_eq!(names(&yes, "items"), ["tl/d1/", "tl/f.txt"]);
    assert_eq!(names(&yes, "prefixes"), ["tl/d1/", "tl/d2/"]);
    let no = get(addr, &format!("{base}&includeTrailingDelimiter=false"))
        .await
        .json();
    assert_eq!(names(&no, "items"), ["tl/f.txt"]);
    // Under the placeholder's own prefix the flag changes nothing: the object is already an item.
    for suffix in ["", "&includeTrailingDelimiter=true"] {
        let sub = get(
            addr,
            &format!("{LIST}?prefix=tl%2Fd1%2F&delimiter=%2F{suffix}"),
        )
        .await
        .json();
        assert_eq!(names(&sub, "items"), ["tl/d1/", "tl/d1/a.txt"], "{suffix}");
        assert!(sub.get("prefixes").is_none(), "{suffix}");
    }
    // The flag needs a delimiter.
    let without_delimiter = get(
        addr,
        &format!("{LIST}?prefix=tl%2F&includeTrailingDelimiter=true"),
    )
    .await;
    assert_eq!(without_delimiter.status, 400);
    let error = without_delimiter.json();
    assert_eq!(
        error["error"]["message"],
        "delimiter field required if include_trailing_delimiter field is set to true"
    );
    assert_eq!(error["error"]["errors"][0]["reason"], "required");
    task.abort();
}

/// V4-L-itd-p1..p3 and V4-L-nf-p1..p3: the placeholder and its prefix are one entry of the page.
#[tokio::test]
async fn strict_pages_count_the_placeholder_and_its_prefix_once() {
    let (addr, _s, task) = serve(trailing_fixture(TokenAcceptance::Verified)).await;
    let q = "prefix=tl%2F&delimiter=%2F&maxResults=1&includeTrailingDelimiter=true";
    let mut seen = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..4 {
        let p = page(addr, q, token.as_deref()).await;
        seen.push((names(&p, "items"), names(&p, "prefixes")));
        token = token_of(&p);
        if token.is_none() {
            break;
        }
    }
    let owned = |names: &[&str]| names.iter().map(|n| (*n).to_owned()).collect::<Vec<_>>();
    assert_eq!(
        seen,
        [
            (owned(&["tl/d1/"]), owned(&["tl/d1/"])),
            (vec![], owned(&["tl/d2/"])),
            (owned(&["tl/f.txt"]), vec![]),
        ]
    );
    // Without the flag the same prefix is one entry holding no item.
    let first = page(addr, "prefix=tl%2F&delimiter=%2F&maxResults=1", None).await;
    assert!(first.get("items").is_none());
    assert_eq!(names(&first, "prefixes"), ["tl/d1/"]);
    task.abort();
}

/// The emulator profile ignores the flag, whatever its value, as the official emulator does.
#[tokio::test]
async fn the_emulator_profile_still_ignores_include_trailing_delimiter() {
    let (addr, _s, task) = serve(trailing_fixture(TokenAcceptance::EmulatorMock)).await;
    for query in [
        "prefix=tl%2F&delimiter=%2F&includeTrailingDelimiter=true",
        "prefix=tl%2F&includeTrailingDelimiter=true",
    ] {
        assert_eq!(
            get(addr, &format!("{LIST}?{query}")).await.status,
            200,
            "{query}"
        );
    }
    let list = page(
        addr,
        "prefix=tl%2F&delimiter=%2F&includeTrailingDelimiter=true",
        None,
    )
    .await;
    assert_eq!(names(&list, "items"), ["tl/f.txt"]);
    task.abort();
}

/// V4-G-p1..p2c (recorded): a token continues after the entries already returned, whatever was deleted.
#[tokio::test]
async fn strict_a_token_whose_entry_was_deleted_continues_after_it() {
    let (addr, s, task) = serve(paging_fixture(TokenAcceptance::Verified)).await;
    let q = "prefix=pg%2F&maxResults=2";
    let p1 = page(addr, q, None).await;
    assert_eq!(names(&p1, "items"), ["pg/a", "pg/b"]);
    remove(&s, "pg/b");
    let p2 = page(addr, q, token_of(&p1).as_deref()).await;
    assert_eq!(names(&p2, "items"), ["pg/c", "pg/d"]);
    // The first entry of the next page is deleted.
    let p1b = page(addr, q, None).await;
    assert_eq!(names(&p1b, "items"), ["pg/a", "pg/c"]);
    remove(&s, "pg/d");
    let p2b = page(addr, q, token_of(&p1b).as_deref()).await;
    assert_eq!(names(&p2b, "items"), ["pg/e"]);
    assert!(token_of(&p2b).is_none());
    // Every entry after the page is deleted: an empty page, nothing is repeated.
    let q1 = "prefix=pg%2F&maxResults=1";
    let p1c = page(addr, q1, None).await;
    assert_eq!(names(&p1c, "items"), ["pg/a"]);
    remove(&s, "pg/c");
    remove(&s, "pg/e");
    let p2c = page(addr, q1, token_of(&p1c).as_deref()).await;
    assert_eq!(p2c, json!({"kind": "storage#objects"}));
    task.abort();
}

/// V4-G-d1, -del-d2a, -d2 (recorded): a prefix that vanished is skipped, not restarted.
#[tokio::test]
async fn strict_a_token_naming_a_vanished_prefix_continues_after_it() {
    let (addr, s, task) = serve(trailing_fixture(TokenAcceptance::Verified)).await;
    let q = "prefix=tl%2F&delimiter=%2F&maxResults=1";
    let p1 = page(addr, q, None).await;
    assert_eq!(names(&p1, "prefixes"), ["tl/d1/"]);
    remove(&s, "tl/d2/a.txt");
    let p2 = page(addr, q, token_of(&p1).as_deref()).await;
    assert_eq!(names(&p2, "items"), ["tl/f.txt"]);
    assert!(p2.get("prefixes").is_none());
    assert!(token_of(&p2).is_none());
    task.abort();
}

/// The same rule holds with a `matchGlob` (strict only).
#[tokio::test]
async fn strict_a_glob_listing_continues_after_a_deleted_token_entry() {
    let (addr, s, task) = serve(paging_fixture(TokenAcceptance::Verified)).await;
    let q = "matchGlob=pg%2F*&maxResults=2";
    let p1 = page(addr, q, None).await;
    remove(&s, "pg/c");
    let p2 = page(addr, q, token_of(&p1).as_deref()).await;
    assert_eq!(names(&p2, "items"), ["pg/d", "pg/e"]);
    task.abort();
}

/// The emulator profile keeps the official behaviour: a token whose entry is gone starts over.
#[tokio::test]
async fn the_emulator_profile_still_restarts_after_a_token_whose_entry_was_deleted() {
    let (addr, s, task) = serve(paging_fixture(TokenAcceptance::EmulatorMock)).await;
    let q = "prefix=pg%2F&maxResults=2";
    let p1 = page(addr, q, None).await;
    let p2 = page(addr, q, token_of(&p1).as_deref()).await;
    assert_eq!(names(&p2, "items"), ["pg/c", "pg/d"]);
    remove(&s, "pg/e");
    let p3 = page(addr, q, token_of(&p2).as_deref()).await;
    assert_eq!(names(&p3, "items"), ["pg/a", "pg/b"]);
    task.abort();
}

fn glob_fixture(acceptance: TokenAcceptance) -> StorageState {
    let s = state(acceptance);
    for name in ["gl/a.txt", "gl/ab.txt", "gl/sub/c.txt", "md/plain.txt"] {
        put(&s, name);
    }
    s
}

fn error_of(answer: &Answer) -> (u16, String, String) {
    let value = answer.json();
    (
        answer.status,
        value["error"]["message"].as_str().unwrap().to_owned(),
        value["error"]["errors"][0]["reason"]
            .as_str()
            .unwrap()
            .to_owned(),
    )
}

/// V4-M-len-64..8000 (recorded): the pattern is limited to 1024 bytes.
#[tokio::test]
async fn strict_match_glob_longer_than_1024_bytes_is_refused() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::Verified)).await;
    for length in [1024usize, 1025, 2048, 4096, 8000] {
        let pattern = format!("gl/{}", "a".repeat(length - 3));
        let answer = get(
            addr,
            &format!("{LIST}?matchGlob={}", pattern.replace('/', "%2F")),
        )
        .await;
        if length == 1024 {
            assert_eq!(answer.status, 200);
            assert_eq!(answer.json(), json!({"kind": "storage#objects"}));
        } else {
            assert_eq!(
                error_of(&answer),
                (
                    400,
                    format!("Maximum length of the glob pattern is 1024 bytes in UTF-8 encoding, but glob was {length} bytes long."),
                    "invalid".to_owned()
                ),
                "{length}"
            );
        }
    }
    // Bytes, not characters: 400 characters of 3 bytes are 1200 bytes.
    let wide = "あ".repeat(400);
    let answer = get(
        addr,
        &format!("{LIST}?matchGlob={}", "%E3%81%82".repeat(400)),
    )
    .await;
    assert_eq!(
        error_of(&answer).1,
        format!("Maximum length of the glob pattern is 1024 bytes in UTF-8 encoding, but glob was {} bytes long.", wide.len())
    );
    task.abort();
}

/// V4-M-unterm-bracket, -unterm-brace, -unterm-escape (recorded).
#[tokio::test]
async fn strict_match_glob_with_an_unterminated_class_or_brace_is_refused() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::Verified)).await;
    let bracket = get(addr, &format!("{LIST}?matchGlob=gl%2F%5Ba")).await;
    assert_eq!(
        error_of(&bracket),
        (
            400,
            "Glob pattern character class has no closing ']' for opening '[' at index 3. Either add a closing ']' or use '\\[' to match a literal '['.".to_owned(),
            "invalid".to_owned()
        )
    );
    let brace = get(addr, &format!("{LIST}?matchGlob=gl%2F%7Ba%2Cb")).await;
    assert_eq!(
        error_of(&brace),
        (
            400,
            "Glob pattern brace expansion opening '{' at index 3 has no closing '}'. Use '\\{' to match a literal '{'.".to_owned(),
            "invalid".to_owned()
        )
    );
    // A trailing escape is accepted and matches nothing.
    let escape = get(addr, &format!("{LIST}?matchGlob=gl%2Fa%5C")).await;
    assert_eq!(escape.status, 200);
    assert_eq!(escape.json(), json!({"kind": "storage#objects"}));
    task.abort();
}

/// V4-M-doublestar-chain-8 and V4-M-empty (recorded): `**/` may match no directory; an empty glob filters nothing.
#[tokio::test]
async fn strict_match_glob_double_star_slash_matches_zero_directories_and_empty_is_no_filter() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::Verified)).await;
    let chain = format!("gl%2F{}c.txt", "**%2F".repeat(8));
    let answer = page(addr, &format!("matchGlob={chain}"), None).await;
    assert_eq!(names(&answer, "items"), ["gl/sub/c.txt"]);
    let zero = page(addr, "matchGlob=gl%2F**%2Fa.txt", None).await;
    assert_eq!(names(&zero, "items"), ["gl/a.txt"]);
    let all = page(addr, "matchGlob=", None).await;
    assert_eq!(names(&all, "items").len(), 4);
    task.abort();
}

/// The emulator profile ignores `matchGlob`, so none of its limits or syntax errors apply to it.
#[tokio::test]
async fn the_emulator_profile_ignores_a_malformed_or_long_match_glob() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::EmulatorMock)).await;
    for pattern in ["gl%2F%5Ba".to_owned(), "a".repeat(2000)] {
        let answer = get(addr, &format!("{LIST}?matchGlob={pattern}")).await;
        assert_eq!(answer.status, 200);
        assert_eq!(names(&answer.json(), "items").len(), 4);
    }
    task.abort();
}

const OBJECT: &str = "/storage/v1/b/demo-app.appspot.com/o/gl%2Fa.txt";

/// V4-MD-copy (recorded): copyTo with no body and a text/plain content type (what the recorder's fetch
/// adds to an empty string body) is a parse error. Every other shape is unrecorded and served.
#[tokio::test]
async fn strict_copy_to_with_an_empty_text_body_is_a_parse_error() {
    let (addr, s, task) = serve(glob_fixture(TokenAcceptance::Verified)).await;
    let path = |name: &str| format!("{OBJECT}/copyTo/b/{BUCKET}/o/{name}");
    let recorded = send_with(
        addr,
        "POST",
        &path("gl%2Fcopy.txt"),
        &[("Content-Type", "text/plain;charset=UTF-8")],
        None,
    )
    .await;
    assert_eq!(
        error_of(&recorded),
        (400, "Parse Error".to_owned(), "parseError".to_owned())
    );
    assert!(s
        .store
        .lock()
        .unwrap()
        .get(
            &BucketName::try_new(BUCKET).unwrap(),
            &ObjectName::try_new("gl/copy.txt").unwrap()
        )
        .is_none());
    // Spelling of the recorded type: case and spaces do not matter, a charset of utf-8 may follow.
    for (name, content_type) in [
        ("gl%2Fb1.txt", "TEXT/PLAIN"),
        ("gl%2Fb2.txt", "text/plain; charset=utf-8"),
        ("gl%2Fb3.txt", " Text/Plain ;Charset=UTF-8"),
    ] {
        let answer = send_with(
            addr,
            "POST",
            &path(name),
            &[("Content-Type", content_type)],
            None,
        )
        .await;
        assert_eq!(error_of(&answer).1, "Parse Error", "{content_type}");
    }
    // Near misses, all served: no content type, a JSON content type without a body, a JSON body, rewriteTo.
    for (name, headers, body) in [
        ("gl%2Fa1.txt", vec![], None),
        (
            "gl%2Fa2.txt",
            vec![("Content-Type", "application/json")],
            None,
        ),
        (
            "gl%2Fa3.txt",
            vec![("Content-Type", "application/json")],
            Some("{}"),
        ),
        (
            "gl%2Fa4.txt",
            vec![("Content-Type", "text/plain;charset=UTF-8")],
            Some("{}"),
        ),
    ] {
        let answer = send_with(addr, "POST", &path(name), &headers, body).await;
        assert_eq!(answer.status, 200, "{name}");
    }
    let rewrite = send_with(
        addr,
        "POST",
        &format!("{OBJECT}/rewriteTo/b/{BUCKET}/o/gl%2Frewritten.txt"),
        &[("Content-Type", "text/plain;charset=UTF-8")],
        None,
    )
    .await;
    assert_eq!(rewrite.status, 200);
    task.abort();
}

#[tokio::test]
async fn the_emulator_profile_still_copies_with_an_empty_body() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::EmulatorMock)).await;
    let path = format!("{OBJECT}/copyTo/b/{BUCKET}/o/gl%2Fcopy.txt");
    for headers in [vec![], vec![("Content-Type", "text/plain;charset=UTF-8")]] {
        assert_eq!(
            send_with(addr, "POST", &path, &headers, None).await.status,
            200
        );
    }
    task.abort();
}

const BUCKET_PATH: &str = "/storage/v1/b/demo-app.appspot.com";

/// V4-W-verify, V4-B-full, V4-B-patch (recorded): member order, members and framing of the bucket resource.
#[tokio::test]
async fn strict_bucket_resource_has_the_recorded_members_order_and_headers() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::Verified)).await;
    let answer = get(addr, BUCKET_PATH).await;
    assert_eq!(answer.status, 200);
    let bucket = answer.json();
    assert_eq!(
        raw_keys(&answer, 2, None),
        [
            "kind",
            "selfLink",
            "id",
            "name",
            "projectNumber",
            "generation",
            "metageneration",
            "location",
            "storageClass",
            "etag",
            "timeCreated",
            "updated",
            "softDeletePolicy",
            "iamConfiguration",
            "locationType",
            "satisfiesPZI"
        ]
    );
    assert_eq!(
        raw_keys(&answer, 4, Some("iamConfiguration")),
        [
            "bucketPolicyOnly",
            "uniformBucketLevelAccess",
            "publicAccessPrevention"
        ]
    );
    assert_eq!(bucket["etag"], "CAE=");
    assert_eq!(bucket["satisfiesPZI"], true);
    assert_eq!(answer.header("etag"), Some("CAE="));
    assert_eq!(answer.all("vary"), "Origin, X-Origin");
    assert!(answer.header("access-control-expose-headers").is_none());
    assert_eq!(
        answer.header("cache-control"),
        Some("private, max-age=0, must-revalidate, no-transform")
    );
    // `projection=full` of an access-uniform bucket is the same resource.
    assert_eq!(
        get(addr, &format!("{BUCKET_PATH}?projection=full"))
            .await
            .json(),
        bucket
    );
    task.abort();
}

/// V4-B-patch (recorded): `labels` are accepted and come back after `updated`, before `softDeletePolicy`.
#[tokio::test]
async fn strict_bucket_patch_accepts_labels() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::Verified)).await;
    let patch = send_with(
        addr,
        "PATCH",
        BUCKET_PATH,
        &[("Content-Type", "application/json")],
        Some(r#"{"labels":{"fireemu-obs":"v4"}}"#),
    )
    .await;
    assert_eq!(patch.status, 200);
    let bucket = patch.json();
    assert_eq!(bucket["labels"], json!({"fireemu-obs": "v4"}));
    assert_eq!(bucket["metageneration"], "2");
    assert_eq!(bucket["etag"], "CAI=");
    assert_eq!(patch.header("etag"), Some("CAI="));
    assert_eq!(
        patch.header("cache-control"),
        Some("no-cache, no-store, max-age=0, must-revalidate")
    );
    let order = raw_keys(&patch, 2, None);
    let at = |name: &str| order.iter().position(|member| member == name).unwrap();
    assert!(at("updated") + 1 == at("labels") && at("labels") + 1 == at("softDeletePolicy"));
    // The label stays on a later read, and a null value removes it.
    assert_eq!(
        get(addr, BUCKET_PATH).await.json()["labels"],
        json!({"fireemu-obs": "v4"})
    );
    let cleared = send_with(
        addr,
        "PATCH",
        BUCKET_PATH,
        &[("Content-Type", "application/json")],
        Some(r#"{"labels":{"fireemu-obs":null}}"#),
    )
    .await;
    assert_eq!(cleared.status, 200);
    let cleared = cleared.json();
    assert!(cleared.get("labels").is_none());
    assert_eq!(cleared["metageneration"], "3");
    // A patch without labels (versioning only) is still a patch: the metageneration moves on.
    let versioning = send_with(
        addr,
        "PATCH",
        BUCKET_PATH,
        &[("Content-Type", "application/json")],
        Some(r#"{"versioning":{"enabled":true}}"#),
    )
    .await;
    assert_eq!(versioning.status, 200);
    assert_eq!(versioning.json()["metageneration"], "4");
    assert_eq!(versioning.header("etag"), Some("CAQ="));
    // Other fields stay refused, with the same message as before, and a refused patch changes nothing.
    let refused = send_with(
        addr,
        "PATCH",
        BUCKET_PATH,
        &[("Content-Type", "application/json")],
        Some(r#"{"location":"EU"}"#),
    )
    .await;
    assert_eq!(error_of(&refused).1, "unsupported bucket field: location");
    assert_eq!(get(addr, BUCKET_PATH).await.json()["metageneration"], "4");
    // A label must be a string; null removes one in a patch only.
    for body in [
        r#"{"labels":{"k":1}}"#,
        r#"{"labels":["k"]}"#,
        r#"{"labels":"k"}"#,
    ] {
        let bad = send_with(
            addr,
            "PATCH",
            BUCKET_PATH,
            &[("Content-Type", "application/json")],
            Some(body),
        )
        .await;
        assert_eq!(
            error_of(&bad).1,
            "labels must be an object of strings",
            "{body}"
        );
    }
    task.abort();
}

/// The emulator profile has no bucket route in the official emulator: nothing there changes.
#[tokio::test]
async fn the_emulator_profile_keeps_its_bucket_stub() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::EmulatorMock)).await;
    let bucket = get(addr, BUCKET_PATH).await;
    assert_eq!(bucket.status, 200);
    let value = bucket.json();
    assert!(value.get("satisfiesPZI").is_none());
    assert!(value.get("softDeletePolicy").is_none());
    assert_eq!(value["etag"], "====");
    assert_eq!(value["metageneration"], "1");
    assert!(bucket.header("etag").is_none());
    task.abort();
}

/// V4-K-delete-bucket and V4-K-del-* (recorded, twice): a 204 answers with an explicit zero length and a JSON content type.
#[tokio::test]
async fn strict_bucket_delete_answers_204_with_zero_length_and_json_type() {
    let (addr, _s, task) = serve(state(TokenAcceptance::Verified)).await;
    let answer = send_with(addr, "DELETE", BUCKET_PATH, &[], None).await;
    assert_eq!(answer.status, 204);
    assert_eq!(answer.header("content-length"), Some("0"));
    assert_eq!(answer.header("content-type"), Some("application/json"));
    assert_eq!(answer.all("vary"), "Origin, X-Origin");
    assert_eq!(
        answer.header("cache-control"),
        Some("no-cache, no-store, max-age=0, must-revalidate")
    );
    assert!(answer.body.is_empty());
    task.abort();
}

/// The emulator profile has no bucket route in the official emulator; its 204 is untouched.
#[tokio::test]
async fn the_emulator_profile_keeps_its_bucket_delete_answer() {
    let (addr, _s, task) = serve(state(TokenAcceptance::EmulatorMock)).await;
    let answer = send_with(addr, "DELETE", BUCKET_PATH, &[], None).await;
    assert_eq!(answer.status, 501);
    assert!(answer
        .header("content-type")
        .is_some_and(|value| value.starts_with("text/plain")));
    assert_ne!(answer.header("content-length"), Some("0"));
    task.abort();
}

/// V4-X-xml-delete and V4-X-xml-delete-again (recorded).
#[tokio::test]
async fn strict_xml_delete_removes_an_object_and_repeats_as_no_such_key() {
    let (addr, s, task) = serve(glob_fixture(TokenAcceptance::Verified)).await;
    let first = send_with(addr, "DELETE", "/demo-app.appspot.com/gl/a.txt", &[], None).await;
    assert_eq!(first.status, 204);
    assert_eq!(first.header("content-length"), Some("0"));
    assert!(first.header("content-type").is_none());
    assert_eq!(first.all("vary"), "Origin");
    assert_eq!(first.header("cache-control"), Some("private, max-age=0"));
    assert!(first.header("expires").is_some());
    assert!(first.body.is_empty());
    assert!(s
        .store
        .lock()
        .unwrap()
        .get(
            &BucketName::try_new(BUCKET).unwrap(),
            &ObjectName::try_new("gl/a.txt").unwrap()
        )
        .is_none());
    let again = send_with(addr, "DELETE", "/demo-app.appspot.com/gl/a.txt", &[], None).await;
    assert_eq!(again.status, 404);
    assert_eq!(
        again.header("content-type"),
        Some("application/xml; charset=UTF-8")
    );
    assert_eq!(again.all("vary"), "Origin");
    assert_eq!(again.header("cache-control"), Some("private, max-age=0"));
    assert_eq!(
        again.text(),
        "<?xml version='1.0' encoding='UTF-8'?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Details>No such object: demo-app.appspot.com/gl/a.txt</Details></Error>"
    );
    task.abort();
}

/// The official emulator has no XML DELETE route: the emulator profile keeps answering 501.
#[tokio::test]
async fn the_emulator_profile_keeps_the_501_for_an_xml_delete() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::EmulatorMock)).await;
    assert_eq!(
        send_with(addr, "DELETE", "/demo-app.appspot.com/gl/a.txt", &[], None)
            .await
            .status,
        501
    );
    task.abort();
}

/// Creating a bucket with labels keeps metageneration 1; a null label is only meaningful in a patch.
#[tokio::test]
async fn strict_bucket_create_accepts_labels_without_a_patch() {
    let (addr, _s, task) = serve(state(TokenAcceptance::Verified)).await;
    let create = |body: &'static str| {
        send_with(
            addr,
            "POST",
            "/storage/v1/b?project=demo-app",
            &[("Content-Type", "application/json")],
            Some(body),
        )
    };
    let null = create(r#"{"name":"new-one.appspot.com","labels":{"k":null}}"#).await;
    assert_eq!(error_of(&null).1, "labels must be an object of strings");
    let made = create(r#"{"name":"new-two.appspot.com","labels":{"k":"v"}}"#).await;
    assert_eq!(made.status, 200);
    let made = made.json();
    assert_eq!(made["labels"], json!({"k": "v"}));
    assert_eq!(made["metageneration"], "1");
    assert_eq!(made["etag"], "CAE=");
    task.abort();
}

/// Routes the XML DELETE must not capture, and answers that stay unframed (the official emulator's headers).
#[tokio::test]
async fn strict_unrelated_deletes_and_unknown_routes_keep_their_501_and_their_unframed_headers() {
    let (addr, _s, task) = serve(glob_fixture(TokenAcceptance::Verified)).await;
    for (method, path) in [
        (
            "DELETE",
            "/download/storage/v1/b/demo-app.appspot.com/o/gl%2Fa.txt",
        ),
        ("DELETE", "/demo-app.appspot.com"),
        ("DELETE", "/storage/v1/b/demo-app.appspot.com/o"),
        ("DELETE", "/upload/storage/v1/b/demo-app.appspot.com/o/x"),
        ("PATCH", "/upload/storage/v1/b/demo-app.appspot.com/o"),
        ("PUT", "/storage/v1/b/demo-app.appspot.com"),
    ] {
        let answer = send_with(addr, method, path, &[], None).await;
        assert_eq!(answer.status, 501, "{method} {path}");
        assert_eq!(answer.all("vary"), "Origin", "{method} {path}");
        assert!(answer.header("pragma").is_none(), "{method} {path}");
        assert!(answer.header("etag").is_none(), "{method} {path}");
    }
    // The object survives all of it.
    assert_eq!(get(addr, &format!("{OBJECT}?alt=media")).await.status, 200);
    task.abort();
}

/// `includeTrailingDelimiter` with a `matchGlob`: the same entries, the placeholder once as item and prefix.
#[tokio::test]
async fn strict_include_trailing_delimiter_works_with_a_match_glob() {
    let (addr, _s, task) = serve(trailing_fixture(TokenAcceptance::Verified)).await;
    let q = |flag: &str| format!("prefix=tl%2F&delimiter=%2F&matchGlob=tl%2F**{flag}");
    let with = page(addr, &q("&includeTrailingDelimiter=true"), None).await;
    assert_eq!(names(&with, "items"), ["tl/d1/", "tl/f.txt"]);
    assert_eq!(names(&with, "prefixes"), ["tl/d1/", "tl/d2/"]);
    let without = page(addr, &q(""), None).await;
    assert_eq!(names(&without, "items"), ["tl/f.txt"]);
    assert_eq!(names(&without, "prefixes"), ["tl/d1/", "tl/d2/"]);
    // A glob that rejects the placeholder leaves its prefix but not its item.
    let hidden = page(
        addr,
        "prefix=tl%2F&delimiter=%2F&includeTrailingDelimiter=true&matchGlob=tl%2F*%2F%3F*",
        None,
    )
    .await;
    assert!(names(&hidden, "items").is_empty());
    assert_eq!(names(&hidden, "prefixes"), ["tl/d1/", "tl/d2/"]);
    // Paged one entry at a time, the pair is one entry and the token continues after it.
    let first = page(
        addr,
        &format!("{}&maxResults=1", q("&includeTrailingDelimiter=true")),
        None,
    )
    .await;
    assert_eq!(names(&first, "items"), ["tl/d1/"]);
    assert_eq!(names(&first, "prefixes"), ["tl/d1/"]);
    let second = page(
        addr,
        &format!("{}&maxResults=1", q("&includeTrailingDelimiter=true")),
        token_of(&first).as_deref(),
    )
    .await;
    assert!(second.get("items").is_none());
    assert_eq!(names(&second, "prefixes"), ["tl/d2/"]);
    task.abort();
}
