"""Lightweight Python Test World wrapper for fireemu.

Speaks the `fireemu up --ready-file ... --owner-stdin` readiness descriptor and Control REST API
using only the Python standard library.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

_BASELINE_SNAPSHOT = "__fireemu_baseline__"

_ENDPOINT_ENV_MAP = {
    "firestore": "FIRESTORE_EMULATOR_HOST",
    "auth": "FIREBASE_AUTH_EMULATOR_HOST",
    "storage": "FIREBASE_STORAGE_EMULATOR_HOST",
    "functions": "FIREEMU_FUNCTIONS_HOST",
    "eventarc": "CLOUD_EVENTARC_EMULATOR_HOST",
    "tasks": "CLOUD_TASKS_EMULATOR_HOST",
    "pubsub": "PUBSUB_EMULATOR_HOST",
    "database": "FIREBASE_DATABASE_EMULATOR_HOST",
    "appcheck": "FIREEMU_APP_CHECK_EMULATOR_HOST",
    "hub": "FIREBASE_EMULATOR_HUB",
    "logging": "FIREBASE_LOGGING_EMULATOR_HOST",
}


@dataclass(frozen=True)
class Endpoint:
    host: str
    port: int
    url: str


def _parse_endpoint(raw: str) -> Endpoint:
    target = raw if "://" in raw else f"http://{raw}"
    parsed = urllib.parse.urlparse(target)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return Endpoint(host=host, port=port, url=f"{parsed.scheme}://{parsed.netloc}")


class TestWorldClock:
    """Virtual clock controls for a running TestWorld."""

    def __init__(self, world: TestWorld) -> None:
        self._world = world

    def get(self) -> dict[str, Any]:
        return self._world.control("GET", "/v1/sessions/default")

    def set(self, instant: str, *, allow_backwards: bool = False) -> dict[str, Any]:
        return self._world.control(
            "POST",
            "/v1/sessions/default/clock:set",
            {"instant": instant, "allowBackwards": allow_backwards},
        )

    def advance(self, milliseconds: int) -> dict[str, Any]:
        return self._world.control(
            "POST",
            "/v1/sessions/default/clock:advance",
            {"millis": int(milliseconds)},
        )

    def advance_to(self, instant: str) -> dict[str, Any]:
        return self._world.control(
            "POST",
            "/v1/sessions/default/clock:advanceTo",
            {"instant": instant},
        )


class TestWorld:
    """Isolated fireemu daemon managed via `--ready-file` and `--owner-stdin`."""

    def __init__(
        self,
        *,
        binary_path: str | Path | None = None,
        project_id: str = "demo-fireemu",
        services: Sequence[str] = ("auth", "firestore", "storage"),
        startup_timeout_s: float = 30.0,
        request_timeout_s: float = 15.0,
        extra_args: Sequence[str] = (),
        cwd: str | Path | None = None,
    ) -> None:
        resolved_bin = str(binary_path) if binary_path is not None else shutil.which("fireemu")
        if not resolved_bin or not Path(resolved_bin).is_file():
            raise FileNotFoundError(
                "fireemu binary not found; pass binary_path=... or ensure `fireemu` is on PATH"
            )
        self._binary = resolved_bin
        self.project_id = project_id
        self._services = tuple(services)
        self._startup_timeout_s = startup_timeout_s
        self._request_timeout_s = request_timeout_s
        self._extra_args = tuple(extra_args)
        self._cwd = str(cwd) if cwd is not None else None
        self._dir = Path(tempfile.mkdtemp(prefix="fireemu-py-world-"))
        self._proc: subprocess.Popen[bytes] | None = None
        self._disposed = False
        self._has_baseline = False
        self._checkpoint_seq = 0
        self.descriptor: dict[str, Any] = {}
        self.endpoints: dict[str, Endpoint] = {}
        self.environment: dict[str, str] = {}
        self.clock = TestWorldClock(self)
        self._start()

    def _start(self) -> None:
        ready_file = self._dir / "ready.json"
        args = [
            self._binary,
            "up",
            "--project",
            self.project_id,
            "--only",
            ",".join(self._services),
            "--ready-file",
            str(ready_file),
            "--owner-stdin",
            "--log-verbosity",
            "quiet",
            "--firestore-port",
            "0",
            "--http-port",
            "0",
            "--storage-port",
            "0",
            "--functions-port",
            "0",
            "--eventarc-port",
            "0",
            "--tasks-port",
            "0",
            "--pubsub-port",
            "0",
            "--database-port",
            "0",
            "--logging-port",
            "0",
            "--hub-port",
            "0",
            "--ui-port",
            "0",
            *self._extra_args,
        ]
        if "hosting" in self._services:
            args.extend(["--hosting-port", "0"])
        self._proc = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self._cwd,
        )
        deadline = time.monotonic() + self._startup_timeout_s
        try:
            while time.monotonic() < deadline:
                if self._proc.poll() is not None:
                    stderr = (self._proc.stderr.read() if self._proc.stderr else b"").decode(
                        "utf-8", errors="replace"
                    )
                    raise RuntimeError(f"fireemu exited before becoming ready: {stderr}")
                if ready_file.is_file():
                    try:
                        data = json.loads(ready_file.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        time.sleep(0.01)
                        continue
                    if data.get("schemaVersion") == 1 and data.get("pid") == self._proc.pid:
                        self.descriptor = data
                        self._populate_endpoints()
                        self.control("GET", "/health/ready")
                        try:
                            self.control(
                                "POST",
                                "/v1/sessions/default/snapshots",
                                {"name": _BASELINE_SNAPSHOT},
                            )
                            self._has_baseline = True
                        except Exception:
                            self._has_baseline = False
                        return
                time.sleep(0.01)
            raise TimeoutError("fireemu test world startup timed out")
        except Exception:
            self.dispose()
            raise

    def _populate_endpoints(self) -> None:
        env = dict(self.descriptor.get("environment") or {})
        self.environment = env
        eps: dict[str, Endpoint] = {
            "control": _parse_endpoint(self.descriptor["controlUrl"]),
        }
        for svc, var in _ENDPOINT_ENV_MAP.items():
            if var in env and env[var]:
                eps[svc] = _parse_endpoint(env[var])
        if self.descriptor.get("hostingUrl"):
            eps["hosting"] = _parse_endpoint(self.descriptor["hostingUrl"])
        self.endpoints = eps

    def control(self, method: str, path: str, body: Any = None) -> Any:
        if self._disposed:
            raise RuntimeError("TestWorld is disposed")
        base = self.descriptor["controlUrl"].rstrip("/")
        url = f"{base}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Authorization": f"Bearer {self.descriptor['controlToken']}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=self._request_timeout_s) as resp:
                raw = resp.read()
                return json.loads(raw.decode("utf-8")) if raw else None
        except urllib.error.HTTPError as err:
            payload = err.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"fireemu control {method} {path} failed ({err.code}): {payload}") from err

    def reset_state(self) -> TestWorld:
        if self._has_baseline:
            encoded = urllib.parse.quote(_BASELINE_SNAPSHOT, safe="")
            self.control("POST", f"/v1/sessions/default/snapshots/{encoded}:restore", {})
        else:
            self.control("POST", "/v1/sessions/default:reset", {})
        return self

    def checkpoint(self, name: str | None = None) -> str:
        if name is None:
            self._checkpoint_seq += 1
            resolved = f"cp-{self._checkpoint_seq}"
        else:
            resolved = str(name)
        if not resolved or resolved == _BASELINE_SNAPSHOT:
            raise ValueError("checkpoint name must be a non-empty non-reserved string")
        self.control("POST", "/v1/sessions/default/snapshots", {"name": resolved})
        return resolved

    def restore(self, name: str) -> TestWorld:
        if not name:
            raise ValueError("checkpoint name must be non-empty")
        encoded = urllib.parse.quote(name, safe="")
        self.control("POST", f"/v1/sessions/default/snapshots/{encoded}:restore", {})
        return self

    def delete_checkpoint(self, name: str) -> None:
        if not name or name == _BASELINE_SNAPSHOT:
            raise ValueError("checkpoint name must be a non-empty non-reserved string")
        encoded = urllib.parse.quote(name, safe="")
        self.control("DELETE", f"/v1/sessions/default/snapshots/{encoded}")

    def dispose(self) -> None:
        if self._disposed:
            return
        self._disposed = True
        proc = self._proc
        self._proc = None
        if proc is not None:
            try:
                if proc.stdin is not None:
                    proc.stdin.close()
            except OSError:
                pass
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5.0)
            for stream in (proc.stdout, proc.stderr):
                if stream is not None:
                    try:
                        stream.close()
                    except OSError:
                        pass
        shutil.rmtree(self._dir, ignore_errors=True)

    def __enter__(self) -> TestWorld:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.dispose()


def create_test_world(**kwargs: Any) -> TestWorld:
    return TestWorld(**kwargs)
