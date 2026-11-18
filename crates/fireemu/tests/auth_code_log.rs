//! The official Auth emulator prints every email action link and SMS code to its console
//! instead of sending it. A daemon does the same on standard output, once per issued code,
//! unless `auth.logActionCodes` is false or `--log-verbosity quiet` is given; the codes stay
//! readable from the emulator inspection routes either way.

#![cfg(unix)]

mod census;
mod scratch;
#[path = "../../../tests/support/trusted_temp.rs"]
mod trusted_temp;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use trusted_temp::TrustedTempDir;

fn free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    port
}

/// Reads a `Connection: close` response to its end. A reset after the whole response arrived
/// (headers and `Content-Length` bytes) is the server closing first, not a failure: under load
/// the kernel may answer the close with RST instead of FIN.
fn read_response(stream: &mut TcpStream) -> String {
    let mut raw = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset && complete(&raw) => break,
            Err(e) => panic!("reading the response: {e}"),
        }
    }
    String::from_utf8(raw).expect("the response is UTF-8")
}

fn complete(raw: &[u8]) -> bool {
    let text = String::from_utf8_lossy(raw);
    let Some((head, body)) = text.split_once("\r\n\r\n") else {
        return false;
    };
    head.lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .is_some_and(|length| body.len() >= length)
}

fn http(port: u16, method: &str, path: &str, body: &Value) -> (u16, Value) {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("the daemon accepts");
    stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .unwrap();
    let body = body.to_string();
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    stream.flush().unwrap();
    let raw = read_response(&mut stream);
    let (head, body) = raw.split_once("\r\n\r\n").unwrap_or((raw.as_str(), ""));
    let status = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    (status, serde_json::from_str(body).unwrap_or(Value::Null))
}

struct Daemon {
    child: Child,
    /// Every line the daemon has written to standard output so far, in order, appended by a
    /// reader thread as whole lines.
    stdout: Arc<Mutex<String>>,
    /// Set by the reader thread once standard output reached end of file.
    stdout_closed: Arc<AtomicBool>,
    hub_port: u16,
    /// The project the daemon's Hub locator is named after.
    project: String,
    /// Owned for the daemon's lifetime; removed when the test ends.
    _dir: TrustedTempDir,
}

impl Daemon {
    fn start(name: &str, auth: &Value, verbosity: &str) -> Self {
        Self::start_config(
            name,
            &json!({"schemaVersion": 1, "profile": "emulator", "auth": auth}),
            verbosity,
        )
    }

    fn start_config(name: &str, document: &Value, verbosity: &str) -> Self {
        let dir = TrustedTempDir::new(&format!("auth-code-log-{name}"));
        let config = dir.join("fireemu.json");
        std::fs::write(&config, document.to_string()).unwrap();
        let hub_port = free_port();
        let mut child = Command::new(env!("CARGO_BIN_EXE_fireemu"))
            .args([
                "up",
                "--config",
                config.to_str().unwrap(),
                "--project",
                &format!("demo-{name}"),
                "--only",
                "auth",
                "--firestore-port",
                "0",
                "--http-port",
                "0",
                "--storage-port",
                "0",
                "--functions-port",
                "0",
                "--pubsub-port",
                "0",
                "--logging-port",
                "0",
                "--ui-port",
                "0",
                "--log-verbosity",
                verbosity,
                "--hub-port",
            ])
            .arg(hub_port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        // The child is owned (and killed on drop) before anything below can panic.
        let daemon = Self {
            child,
            stdout: Arc::new(Mutex::new(String::new())),
            stdout_closed: Arc::new(AtomicBool::new(false)),
            hub_port,
            project: format!("demo-{name}"),
            _dir: dir,
        };
        let collected = Arc::clone(&daemon.stdout);
        let closed = Arc::clone(&daemon.stdout_closed);
        let (tx, rx) = mpsc::channel::<()>();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut ready = Some(tx);
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    closed.store(true, Ordering::SeqCst);
                    return;
                }
                collected.lock().unwrap().push_str(&line);
                if line.contains("control API:") {
                    if let Some(tx) = ready.take() {
                        let _ = tx.send(());
                    }
                }
            }
        });
        if verbosity == "quiet" {
            // Nothing is printed: wait for the hub instead.
            let deadline = Instant::now() + Duration::from_secs(60);
            while TcpStream::connect(("127.0.0.1", hub_port)).is_err() {
                assert!(Instant::now() < deadline, "the daemon became ready");
                std::thread::sleep(Duration::from_millis(50));
            }
        } else {
            rx.recv_timeout(Duration::from_secs(60))
                .expect("the daemon became ready");
        }
        daemon
    }

    fn auth_port(&self) -> u16 {
        let (status, emulators) = http(self.hub_port, "GET", "/emulators", &Value::Null);
        assert_eq!(status, 200, "{emulators}");
        u16::try_from(emulators["auth"]["port"].as_u64().unwrap()).unwrap()
    }

    /// Standard output so far, once `needle` has appeared in it. Standard output is one
    /// ordered pipe read line by line, so everything the daemon printed before the line holding
    /// `needle` is in the returned text too. Fails with the captured output after
    /// [`OUTPUT_DEADLINE`], so a line that never comes is reported instead of hanging.
    fn stdout_through(&self, needle: &str) -> String {
        let deadline = Instant::now() + OUTPUT_DEADLINE;
        loop {
            let text = self.stdout.lock().unwrap().clone();
            if text.contains(needle) {
                return text;
            }
            assert!(
                Instant::now() < deadline,
                "the daemon did not print {needle:?} within {OUTPUT_DEADLINE:?}; standard output so far:\n{text}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Everything the daemon printed to standard output in its whole life: stops it with
    /// SIGTERM and waits until its standard output reaches end of file. Used where nothing
    /// may be printed, so there is no line to wait for. Fails with the captured output after
    /// [`OUTPUT_DEADLINE`].
    fn stdout_at_exit(&self) -> String {
        let pid = rustix::process::Pid::from_child(&self.child);
        rustix::process::kill_process(pid, rustix::process::Signal::TERM).expect("SIGTERM is sent");
        let deadline = Instant::now() + OUTPUT_DEADLINE;
        while !self.stdout_closed.load(Ordering::SeqCst) {
            assert!(
                Instant::now() < deadline,
                "the daemon's standard output did not close within {OUTPUT_DEADLINE:?} of SIGTERM; standard output so far:\n{}",
                self.stdout.lock().unwrap()
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        self.stdout.lock().unwrap().clone()
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        scratch::remove_killed_daemon_locator(&self.project, self.child.id());
    }
}

/// How long a test waits for the daemon's standard output to show what it waits for.
const OUTPUT_DEADLINE: Duration = Duration::from_secs(30);

const V1: &str = "/identitytoolkit.googleapis.com/v1";

/// Asks the Auth emulator for an SMS sign-in code for `phone_number`.
fn send_sms_code(port: u16, phone_number: &str) {
    let (status, sent) = http(
        port,
        "POST",
        &format!("{V1}/accounts:sendVerificationCode?key=fake-api-key"),
        &json!({"phoneNumber": phone_number, "recaptchaToken": "x"}),
    );
    assert_eq!(status, 200, "{sent}");
}

/// Signs one account up, asks for an email verification link and a phone code, and reports
/// the codes the inspection routes hold.
fn issue(daemon: &Daemon, project: &str) -> (String, String) {
    let port = daemon.auth_port();
    let (status, user) = http(
        port,
        "POST",
        &format!("{V1}/accounts:signUp?key=fake-api-key"),
        &json!({"email": "codes@example.com", "password": "hunter22", "returnSecureToken": true}),
    );
    assert_eq!(status, 200, "{user}");
    let (status, sent) = http(
        port,
        "POST",
        &format!("{V1}/accounts:sendOobCode?key=fake-api-key"),
        &json!({"requestType": "VERIFY_EMAIL", "idToken": user["idToken"]}),
    );
    assert_eq!(status, 200, "{sent}");
    send_sms_code(port, "+15550001");
    let (_, oob) = http(
        port,
        "GET",
        &format!("/emulator/v1/projects/{project}/oobCodes"),
        &Value::Null,
    );
    let (_, sms) = http(
        port,
        "GET",
        &format!("/emulator/v1/projects/{project}/verificationCodes"),
        &Value::Null,
    );
    let oob_code = oob["oobCodes"][0]["oobCode"].as_str().unwrap().to_owned();
    let sms_code = sms["verificationCodes"][0]["code"]
        .as_str()
        .unwrap()
        .to_owned();
    (oob_code, sms_code)
}

#[test]
fn action_links_and_sms_codes_are_printed_once_like_the_official_emulator() {
    let daemon = Daemon::start("default", &json!({}), "info");
    let port = daemon.auth_port();
    let (oob_code, sms_code) = issue(&daemon, "demo-default");
    let sms = format!("  auth: To verify the phone number +15550001, use the code {sms_code}.\n");
    let text = daemon.stdout_through(&sms);
    assert!(
        text.contains("  auth codes:       email action links and SMS codes are printed here"),
        "the banner says what is printed:\n{text}"
    );
    let link = format!(
        "  auth: To verify the email address codes@example.com, follow this link: http://127.0.0.1:{port}/emulator/action?mode=verifyEmail&lang=en&oobCode={oob_code}&apiKey=fake-api-key\n"
    );
    assert_eq!(text.matches(&link).count(), 1, "{text}");
    assert_eq!(text.matches(&sms).count(), 1, "{text}");
    // Reading the inspection routes again prints nothing more. A code for another number is
    // issued afterwards as a sentinel: once its line is on standard output, anything the
    // daemon printed for the earlier requests (a repeated link or code included) is there too,
    // so the counts below see it without depending on how long the daemon takes to write.
    for kind in ["oobCodes", "verificationCodes"] {
        let (status, codes) = http(
            port,
            "GET",
            &format!("/emulator/v1/projects/demo-default/{kind}"),
            &Value::Null,
        );
        assert_eq!(status, 200, "{codes}");
    }
    send_sms_code(port, "+15550002");
    let again =
        daemon.stdout_through("  auth: To verify the phone number +15550002, use the code ");
    assert_eq!(again.matches(&link).count(), 1, "{again}");
    assert_eq!(again.matches(&sms).count(), 1, "{again}");
    assert_eq!(again.matches("  auth: To ").count(), 3, "{again}");
}

#[test]
fn action_code_logging_can_be_switched_off_and_is_quiet_under_quiet_verbosity() {
    let off = Daemon::start("off", &json!({"logActionCodes": false}), "info");
    let (oob_code, sms_code) = issue(&off, "demo-off");
    // Nothing should be printed, so there is no line to wait for: the whole output is read
    // once the daemon has exited and its standard output is closed.
    let text = off.stdout_at_exit();
    assert!(
        text.contains("  auth codes:       not printed (auth.logActionCodes = false)"),
        "{text}"
    );
    assert!(!text.contains(&oob_code), "{text}");
    assert!(!text.contains(&sms_code), "{text}");
    assert!(!text.contains("  auth: To "), "{text}");
    drop(off);

    let quiet = Daemon::start("quiet", &json!({}), "quiet");
    let (oob_code, sms_code) = issue(&quiet, "demo-quiet");
    let text = quiet.stdout_at_exit();
    assert!(!text.contains(&oob_code), "{text}");
    assert!(!text.contains(&sms_code), "{text}");
    assert!(!text.contains("auth: To "), "{text}");
}

/// Signs an account up, verifies its email with the issued link's code and starts a TOTP
/// enrollment; returns the account id and the code listed on the totpCodes route (or the
/// route's status when it is not 200).
fn start_totp_enrollment(daemon: &Daemon, project: &str) -> (String, Result<String, u16>) {
    let port = daemon.auth_port();
    let (status, user) = http(
        port,
        "POST",
        &format!("{V1}/accounts:signUp?key=fake-api-key"),
        &json!({"email": "totp@example.com", "password": "hunter22", "returnSecureToken": true}),
    );
    assert_eq!(status, 200, "{user}");
    let (status, sent) = http(
        port,
        "POST",
        &format!("{V1}/accounts:sendOobCode?key=fake-api-key"),
        &json!({"requestType": "VERIFY_EMAIL", "idToken": user["idToken"]}),
    );
    assert_eq!(status, 200, "{sent}");
    let (_, oob) = http(
        port,
        "GET",
        &format!("/emulator/v1/projects/{project}/oobCodes"),
        &Value::Null,
    );
    let (status, verified) = http(
        port,
        "POST",
        &format!("{V1}/accounts:update?key=fake-api-key"),
        &json!({"oobCode": oob["oobCodes"][0]["oobCode"]}),
    );
    assert_eq!(status, 200, "{verified}");
    let (status, signed_in) = http(
        port,
        "POST",
        &format!("{V1}/accounts:signInWithPassword?key=fake-api-key"),
        &json!({"email": "totp@example.com", "password": "hunter22", "returnSecureToken": true}),
    );
    assert_eq!(status, 200, "{signed_in}");
    let (status, started) = http(
        port,
        "POST",
        "/identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:start?key=fake-api-key",
        &json!({"idToken": signed_in["idToken"], "totpEnrollmentInfo": {}}),
    );
    assert_eq!(status, 200, "{started}");
    let (status, codes) = http(
        port,
        "GET",
        &format!("/emulator/v1/projects/{project}/totpCodes"),
        &Value::Null,
    );
    let uid = user["localId"].as_str().unwrap().to_owned();
    if status != 200 {
        return (uid, Err(status));
    }
    let code = codes["totpCodes"][0]["code"].as_str().unwrap().to_owned();
    (uid, Ok(code))
}

#[test]
fn totp_enrollment_codes_are_printed_and_listed_by_default() {
    let daemon = Daemon::start("totp", &json!({"totp": {}}), "info");
    let (uid, code) = start_totp_enrollment(&daemon, "demo-totp");
    let code = code.expect("the totpCodes route answers 200");
    let line =
        format!("  auth: To enroll TOTP MFA for user {uid} (project demo-totp), use the code ");
    let text = daemon.stdout_through(&line);
    let printed = text
        .lines()
        .find(|l| l.starts_with(line.trim_end_matches(' ')))
        .unwrap();
    assert!(printed.ends_with("s left)."), "{printed}");
    let printed_code = printed
        .split("use the code ")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .unwrap();
    assert_eq!(printed_code.len(), 6, "{printed}");
    assert!(
        printed_code.bytes().all(|b| b.is_ascii_digit()),
        "{printed}"
    );
    assert_eq!(code.len(), 6);
    assert!(!text.contains("otpauth://"), "{text}");
}

/// The owner's repro (2026-11-18): with `daemon.clockStart` pinned the clock stands still, so
/// the sign-in challenge reveals the very code that finalized the enrollment, which verification
/// refuses as already used. The reveal says so, gives no countdown, and names the clock move
/// that yields a fresh code; after that move the revealed code signs in.
#[test]
#[allow(clippy::too_many_lines)]
fn a_pinned_clock_reveals_the_used_code_as_used_and_a_clock_move_gives_a_fresh_one() {
    let project = "demo-totp-still";
    let daemon = Daemon::start_config(
        "totp-still",
        &json!({
            "schemaVersion": 1,
            "profile": "emulator",
            "daemon": {"clockStart": "2026-11-18T00:00:00Z"},
            "auth": {"totp": {}},
        }),
        "info",
    );
    let port = daemon.auth_port();
    let codes = |port| {
        let (status, codes) = http(
            port,
            "GET",
            &format!("/emulator/v1/projects/{project}/totpCodes"),
            &Value::Null,
        );
        assert_eq!(status, 200, "{codes}");
        codes["totpCodes"][0].clone()
    };
    let (status, user) = http(
        port,
        "POST",
        &format!("{V1}/accounts:signUp?key=fake-api-key"),
        &json!({"email": "still@example.com", "password": "hunter22", "returnSecureToken": true}),
    );
    assert_eq!(status, 200, "{user}");
    let uid = user["localId"].as_str().unwrap().to_owned();
    let (status, sent) = http(
        port,
        "POST",
        &format!("{V1}/accounts:sendOobCode?key=fake-api-key"),
        &json!({"requestType": "VERIFY_EMAIL", "idToken": user["idToken"]}),
    );
    assert_eq!(status, 200, "{sent}");
    let (_, oob) = http(
        port,
        "GET",
        &format!("/emulator/v1/projects/{project}/oobCodes"),
        &Value::Null,
    );
    let (status, verified) = http(
        port,
        "POST",
        &format!("{V1}/accounts:update?key=fake-api-key"),
        &json!({"oobCode": oob["oobCodes"][0]["oobCode"]}),
    );
    assert_eq!(status, 200, "{verified}");
    let password = || {
        http(
            port,
            "POST",
            &format!("{V1}/accounts:signInWithPassword?key=fake-api-key"),
            &json!({"email": "still@example.com", "password": "hunter22", "returnSecureToken": true}),
        )
    };
    let (status, signed_in) = password();
    assert_eq!(status, 200, "{signed_in}");
    let (status, started) = http(
        port,
        "POST",
        "/identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:start?key=fake-api-key",
        &json!({"idToken": signed_in["idToken"], "totpEnrollmentInfo": {}}),
    );
    assert_eq!(status, 200, "{started}");
    let pending = codes(port);
    assert_eq!(pending["clockRunning"], json!(false), "{pending}");
    assert_eq!(pending["alreadyUsed"], json!(false), "{pending}");
    let enrolled_code = pending["code"].as_str().unwrap().to_owned();
    let enroll_line = format!(
        "  auth: To enroll TOTP MFA for user {uid} (project {project}), use the code {enrolled_code} (the emulator clock stands still, so the code stays the same until the clock moves)."
    );
    daemon.stdout_through(&enroll_line);
    let (status, finalized) = http(
        port,
        "POST",
        "/identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:finalize?key=fake-api-key",
        &json!({
            "idToken": signed_in["idToken"],
            "displayName": "phone",
            "totpVerificationInfo": {
                "sessionInfo": started["totpSessionInfo"]["sessionInfo"],
                "verificationCode": enrolled_code,
            },
        }),
    );
    assert_eq!(status, 200, "{finalized}");

    // Sign out and back in: the challenge's code is the one just used.
    let (status, challenge) = password();
    assert_eq!(status, 200, "{challenge}");
    let factor = challenge["mfaInfo"][0]["mfaEnrollmentId"].clone();
    let listed = codes(port);
    assert_eq!(listed["code"].as_str(), Some(enrolled_code.as_str()));
    assert_eq!(listed["alreadyUsed"], json!(true), "{listed}");
    assert_eq!(listed["clockRunning"], json!(false), "{listed}");
    assert_eq!(listed["periodSeconds"], json!(30), "{listed}");
    assert_eq!(listed["advanceSeconds"], json!(30), "{listed}");
    let used_line = format!(
        "  auth: To sign in with TOTP MFA as user {uid} (project {project}) factor {} (phone), the current code {enrolled_code} was already used by this factor; advance the clock by 30 seconds for a fresh code (Runtime page of the Emulator UI, or POST /v1/sessions/default/clock:advance with {{\"seconds\": 30}} on the Auth port).",
        factor.as_str().unwrap()
    );
    let text = daemon.stdout_through(&used_line);
    assert!(!text.contains("s left)"), "{text}");
    // Verification is unchanged: the used code is refused.
    let finalize = |code: &str| {
        http(
            port,
            "POST",
            "/identitytoolkit.googleapis.com/v2/accounts/mfaSignIn:finalize?key=fake-api-key",
            &json!({
                "mfaPendingCredential": challenge["mfaPendingCredential"],
                "mfaEnrollmentId": factor,
                "totpVerificationInfo": {"verificationCode": code},
            }),
        )
    };
    let (status, refused) = finalize(&enrolled_code);
    assert_eq!(status, 400, "{refused}");
    assert!(
        refused["error"]["message"]
            .as_str()
            .unwrap()
            .contains("verification code already used"),
        "{refused}"
    );

    // Half the named move leaves the code used, with the rest of the move named.
    let advance = |seconds: u64| {
        let (status, moved) = http(
            port,
            "POST",
            "/v1/sessions/default/clock:advance",
            &json!({ "seconds": seconds }),
        );
        assert_eq!(status, 200, "{moved}");
    };
    advance(15);
    let half = codes(port);
    assert_eq!(half["alreadyUsed"], json!(true), "{half}");
    assert_eq!(half["advanceSeconds"], json!(15), "{half}");
    // The rest of the move yields a fresh code that signs in.
    advance(15);
    let fresh = codes(port);
    assert_eq!(fresh["alreadyUsed"], json!(false), "{fresh}");
    assert!(fresh.get("advanceSeconds").is_none(), "{fresh}");
    let fresh_code = fresh["code"].as_str().unwrap().to_owned();
    assert_ne!(fresh_code, enrolled_code);
    let (status, done) = finalize(&fresh_code);
    assert_eq!(status, 200, "{done}");

    // Switching the clock at runtime switches what the reveal reports.
    let switch = |action: &str| {
        let (status, clock) = http(
            port,
            "POST",
            &format!("/v1/sessions/default/{action}"),
            &json!({}),
        );
        assert_eq!(status, 200, "{clock}");
    };
    switch("clock:resume");
    assert_eq!(codes(port)["clockRunning"], json!(true));
    switch("clock:freeze");
    assert_eq!(codes(port)["clockRunning"], json!(false));
    // On the wire: a literal `null` body is refused, and an empty POST is a plain resume.
    let (status, refused) = http(
        port,
        "POST",
        "/v1/sessions/default/clock:resume",
        &Value::Null,
    );
    assert_eq!(status, 400, "{refused}");
    assert_eq!(codes(port)["clockRunning"], json!(false));
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .unwrap();
    write!(
        stream,
        "POST /v1/sessions/default/clock:resume HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let raw = read_response(&mut stream);
    assert!(raw.starts_with("HTTP/1.1 200"), "{raw}");
    assert_eq!(codes(port)["clockRunning"], json!(true));
    // The same contract for a form-encoded body: `null` sent as a form is not an object.
    switch("clock:freeze");
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(20)))
        .unwrap();
    write!(
        stream,
        "POST /v1/sessions/default/clock:resume HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 4\r\nConnection: close\r\n\r\nnull"
    )
    .unwrap();
    let raw = read_response(&mut stream);
    assert!(raw.starts_with("HTTP/1.1 400"), "{raw}");
    assert_eq!(codes(port)["clockRunning"], json!(false));
}

#[test]
fn totp_reveal_can_be_switched_off() {
    let daemon = Daemon::start(
        "totp-off",
        &json!({"totp": {"revealCodes": false, "digits": 6}}),
        "info",
    );
    let (_, code) = start_totp_enrollment(&daemon, "demo-totp-off");
    assert_eq!(code, Err(404));
    let text = daemon.stdout_at_exit();
    assert!(!text.contains("TOTP MFA"), "{text}");
}
