"""The runner process: load the codebase, say hello, serve frames until told to stop."""

import argparse
import os
import platform
import sys
import traceback

from . import appcheck, blocking
from .clock import RuntimeClock, from_environment as clock_from_environment
from .dispatch import Dispatcher
from .environment import EnvironmentGate, load_local_secrets
from .framing import FrameWriter, ProtocolError, read_frame
from .manifest import build_manifest
from .serve import HTTP_TRIGGERS, start_server


def _parse(argv):
    parser = argparse.ArgumentParser(prog="runner.py")
    parser.add_argument("--source", required=True)
    parser.add_argument("--codebase", default="default")
    # One function's instance (`functions.isolation = "function"`): the daemon fixed the function's identity and secrets
    # in the environment at spawn, so this runner serves that function only and rewrites nothing per call.
    parser.add_argument("--function", default=None)
    return parser.parse_args(argv)


def load_codebase(source: str) -> dict:
    """Imports the codebase's `main.py` the way the SDK's own admin server does and returns its functions."""
    os.chdir(source)
    from firebase_functions.private import serving

    return serving.get_functions()


def _start_debugpy_from_environment(env) -> int | None:
    raw = env.get("FIREEMU_PYTHON_INSPECT_PORT")
    if not raw:
        return None
    try:
        requested_port = int(raw)
    except ValueError:
        sys.stderr.write(f"[functions] invalid FIREEMU_PYTHON_INSPECT_PORT value: {raw!r}\n")
        return None
    try:
        import debugpy  # type: ignore[import-not-found]
    except ImportError:
        sys.stderr.write(
            "[functions] debugpy is not installed in the Python codebase venv; "
            "install debugpy to attach a Python debugger\n"
        )
        return None
    _host, bound_port = debugpy.listen(("127.0.0.1", requested_port))
    sys.stderr.write(f"[functions] debugpy listening on 127.0.0.1:{bound_port}\n")
    return int(bound_port)


def serve(
    functions: dict,
    codebase: str,
    secret: str,
    stdin,
    writer: FrameWriter,
    gate: EnvironmentGate | None = None,
    app_check_verified: bool = False,
    blocking_verified: bool = False,
    function: str | None = None,
    runtime_clock: RuntimeClock | None = None,
    inspector_port: int | None = None,
) -> int:
    """Says hello, then serves frames from `stdin` until `shutdown` or the end of the stream.

    With `function`, the runner is that function's instance: only it is announced and served.
    """
    clock = runtime_clock if runtime_clock is not None else RuntimeClock({})
    manifest = build_manifest(functions, app_check_verified)
    if function is not None:
        if not any(spec["name"] == function for spec in manifest["functions"]):
            sys.stderr.write(f"[functions] the function {function} is not exported by the codebase\n")
            return 1
        manifest = {**manifest, "functions": [spec for spec in manifest["functions"] if spec["name"] == function]}
    if not blocking_verified and any(spec["trigger"]["type"] == "blockingAuth" for spec in manifest["functions"]):
        blocking.announce_default_note(sys.stderr)
    server = None
    port = None
    if any(spec["trigger"]["type"] in HTTP_TRIGGERS for spec in manifest["functions"]):
        server, port = start_server(functions, manifest, secret, gate, function is not None)
    hello = {
        "type": "hello",
        "runner": "python",
        "clock": {"version": 1, "date": True, "timers": False},
        "codebase": codebase,
        "version": platform.python_version(),
        "httpPort": port,
        "manifest": manifest,
    }
    if inspector_port is not None:
        hello["inspectorPort"] = inspector_port
    writer.write(hello)
    dispatcher = Dispatcher(functions, manifest, writer, gate, fixed_identity=function is not None)
    try:
        while True:
            message = read_frame(stdin)
            if message is None or message["type"] == "shutdown":
                return 0
            if message["type"] == "clock:set":
                try:
                    status = clock.update(message)
                    writer.write(
                        {
                            "type": "result",
                            "invocationId": message.get("invocationId"),
                            "ok": True,
                            "timers": status,
                        }
                    )
                except Exception as error:
                    writer.write(
                        {
                            "type": "result",
                            "invocationId": message.get("invocationId"),
                            "ok": False,
                            "error": str(error),
                        }
                    )
                continue
            if not dispatcher.reserve():
                sys.stderr.write("[functions] too many active invocations\n")
                return 2
            dispatcher.start(message)
    except ProtocolError as error:
        sys.stderr.write(f"[functions] {error}\n")
        return 2
    finally:
        if server is not None:
            server.shutdown()


def run(argv) -> int:
    args = _parse(argv)
    # The protocol owns the original stdout. Everything that writes to file descriptor 1 afterwards
    # (print, C extensions, child processes, the SDK logger) goes to stderr instead.
    protocol = os.fdopen(os.dup(1), "wb", buffering=0)
    os.dup2(2, 1)
    writer = FrameWriter(protocol)
    secret = os.environ.get("FIREEMU_RUNNER_SECRET", "")
    # The daemon's local secrets are put back into the environment, a function at a time, by the gate; user code
    # does not see the channel that carried them, nor the key to this runner's HTTP port.
    os.environ.pop("FIREEMU_RUNNER_SECRET", None)
    try:
        gate = EnvironmentGate(load_local_secrets(os.environ))
    except ValueError as error:
        sys.stderr.write(f"[functions] {error}\n")
        return 1
    # Install virtual application clock (if requested via FIREEMU_CLOCK_JSON) and optional
    # debugpy listener before importing user code.
    try:
        runtime_clock = clock_from_environment(os.environ)
        runtime_clock.install()
    except (ValueError, TypeError) as error:
        sys.stderr.write(f"[functions] {error}\n")
        return 1
    inspector_port = _start_debugpy_from_environment(os.environ)
    # Before any user code runs, so the Admin SDK's App Check service is built against the emulator's keys.
    app_check_verified = appcheck.install_from_environment(os.environ)
    try:
        blocking_verified = blocking.install_from_environment(os.environ)
    except blocking.VerificationUnavailable as error:
        sys.stderr.write(f"[functions] error: Auth blocking token verification was requested but is unavailable ({error}); not serving\n")
        return 1
    try:
        functions = load_codebase(args.source)
    except BaseException:  # a failing import in user code is reported with its traceback
        traceback.print_exc()
        return 1
    # A dedicated runner (`--function`) names its function; otherwise the call is the one the daemon has always seen.
    options: dict = {"runtime_clock": runtime_clock, "inspector_port": inspector_port}
    if args.function is not None:
        options["function"] = args.function
    if blocking_verified:
        return serve(functions, args.codebase, secret, sys.stdin.buffer, writer, gate, app_check_verified, blocking_verified=True, **options)
    return serve(functions, args.codebase, secret, sys.stdin.buffer, writer, gate, app_check_verified, **options)
