"""Opt-in virtual application clock for the fireemu Python Functions runner.

Follows the same `FIREEMU_CLOCK_JSON` and `clock:set` frame protocol as `tools/runner-node/clock.mjs`.
When `date == "virtual"`, patches `time.time`, `time.time_ns`, `datetime.datetime.now`,
`datetime.datetime.utcnow`, and `datetime.date.today` so Python functions observe deterministic
emulator time while keeping monotonic timers and runner lifecycle timeouts on real time.
"""

from __future__ import annotations

import datetime as _datetime_mod
import json
import threading
import time as _time_mod
from typing import Any

_NANOS_PER_SEC = 1_000_000_000
_REAL_TIME = _time_mod.time
_REAL_TIME_NS = _time_mod.time_ns
_REAL_MONOTONIC_NS = _time_mod.monotonic_ns
_REAL_DATETIME = _datetime_mod.datetime
_REAL_DATE = _datetime_mod.date


def _parse_nanos(value: Any, name: str) -> int:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if stripped and (stripped.isdigit() or (stripped.startswith("-") and stripped[1:].isdigit())):
            return int(stripped)
    raise ValueError(f"invalid clock {name}: {value!r}")


class RuntimeClock:
    """Thread-safe virtual clock state synchronized with the fireemu daemon."""

    def __init__(self, options: dict[str, Any] | None = None) -> None:
        opts = options or {}
        date_policy = opts.get("date", "real")
        if date_policy not in ("real", "virtual"):
            raise ValueError(f"invalid runtime clock date policy: {date_policy!r}")
        self._lock = threading.Lock()
        self.date_virtual = date_policy == "virtual"
        self._instant_nanos = _parse_nanos(opts.get("instantNanos", "0"), "instantNanos")
        self._elapsed_nanos = _parse_nanos(opts.get("elapsedNanos", "0"), "elapsedNanos")
        if self._elapsed_nanos < 0:
            raise ValueError("negative timer elapsed time")
        self._following = bool(opts.get("following", False))
        self._anchor_monotonic = _REAL_MONOTONIC_NS()
        self._revision = _parse_nanos(opts.get("revision", "0"), "revision")
        self._installed = False

    def current_instant_nanos(self) -> int:
        with self._lock:
            return self._instant_unlocked()

    def _instant_unlocked(self) -> int:
        if not self._following:
            return self._instant_nanos
        delta = max(0, _REAL_MONOTONIC_NS() - self._anchor_monotonic)
        return self._instant_nanos + delta

    def _elapsed_unlocked(self) -> int:
        if not self._following:
            return self._elapsed_nanos
        delta = max(0, _REAL_MONOTONIC_NS() - self._anchor_monotonic)
        return self._elapsed_nanos + delta

    def update(self, frame: dict[str, Any]) -> dict[str, Any]:
        revision = _parse_nanos(frame.get("revision"), "revision")
        instant = _parse_nanos(frame.get("instantNanos"), "instantNanos")
        elapsed = _parse_nanos(frame.get("elapsedNanos", "0"), "elapsedNanos")
        if elapsed < 0:
            raise ValueError("negative timer elapsed time")
        following = bool(frame.get("following", False))
        with self._lock:
            if revision < self._revision:
                raise ValueError("stale clock revision")
            self._instant_nanos = instant
            self._elapsed_nanos = elapsed
            self._following = following
            self._anchor_monotonic = _REAL_MONOTONIC_NS()
            self._revision = revision
            return self._status_unlocked()

    def status(self) -> dict[str, Any]:
        with self._lock:
            return self._status_unlocked()

    def _status_unlocked(self) -> dict[str, Any]:
        return {
            "executed": 0,
            "pending": 0,
            "due": 0,
            "instantNanos": str(self._instant_unlocked()),
            "elapsedNanos": str(self._elapsed_unlocked()),
        }

    def install(self) -> None:
        if not self.date_virtual or self._installed:
            return
        self._installed = True
        clock = self

        def _virtual_time_ns() -> int:
            return clock.current_instant_nanos()

        def _virtual_time() -> float:
            return clock.current_instant_nanos() / _NANOS_PER_SEC

        class _VirtualDatetime(_REAL_DATETIME):
            @classmethod
            def now(cls, tz=None):
                seconds, nanos = divmod(clock.current_instant_nanos(), _NANOS_PER_SEC)
                return cls.fromtimestamp(seconds, tz=tz).replace(microsecond=nanos // 1_000)

            @classmethod
            def utcnow(cls):
                return cls.now(_datetime_mod.timezone.utc).replace(tzinfo=None)

            @classmethod
            def today(cls):
                return cls.now()

        class _VirtualDate(_REAL_DATE):
            @classmethod
            def today(cls):
                dt = _VirtualDatetime.now()
                return cls(dt.year, dt.month, dt.day)

        _time_mod.time_ns = _virtual_time_ns
        _time_mod.time = _virtual_time
        _datetime_mod.datetime = _VirtualDatetime  # type: ignore[misc]
        _datetime_mod.date = _VirtualDate  # type: ignore[misc]

    def uninstall(self) -> None:
        if not self._installed:
            return
        self._installed = False
        _time_mod.time_ns = _REAL_TIME_NS
        _time_mod.time = _REAL_TIME
        _datetime_mod.datetime = _REAL_DATETIME  # type: ignore[misc]
        _datetime_mod.date = _REAL_DATE  # type: ignore[misc]


def from_environment(env: dict[str, str] | Any) -> RuntimeClock:
    raw = env.get("FIREEMU_CLOCK_JSON")
    if not raw:
        return RuntimeClock({})
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("FIREEMU_CLOCK_JSON must be a JSON object")
    return RuntimeClock(parsed)
