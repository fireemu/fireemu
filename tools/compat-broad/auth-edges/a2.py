"""AUTH-EDGES A2 read-back: two read-only requests and a verdict that closes only on validated equality.

The launch script calls `run`. Everything it needs from the first run (the pre-launch digests and the
stage's baseline row) is loaded and validated before the first request, so a missing or malformed
receipt costs no read. The address lookup must itself answer 200 with the stage's typed absence
(`absent_response`); a config read alone can never close the run.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import edges
from edges import DIGEST_MEMBERS, absent_response, baseline_findings, config_digests, differing_members


def valid_digests(value):
    return isinstance(value, dict) and set(value) == set(DIGEST_MEMBERS) and all(isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) for v in value.values())


def load_baselines(pre_path, receipt_path):
    """The two digest sets A2 compares against; raises before any request when either is missing or malformed."""
    pre = json.loads(Path(pre_path).read_text()).get('digests')
    rows = [r for r in json.loads(Path(receipt_path).read_text()).get('stages', []) if isinstance(r, dict) and r.get('id') == 'config-baseline']
    stage = rows[0].get('configDigests') if len(rows) == 1 else None
    if not valid_digests(pre) or not valid_digests(stage):
        raise ValueError('A2 needs the pre-launch digests and exactly one valid config-baseline row')
    return pre, stage


def evaluate(lookup, config, pre, stage_baseline):
    """CLOSE-OK only if every condition holds; each condition is reported by name."""
    lookup_status, lookup_body = lookup
    config_status, config_body = config
    config_ok = type(config_status) is int and config_status == 200 and isinstance(config_body, dict) and 'error' not in config_body
    body = config_body if config_ok else {}
    findings = baseline_findings(body)
    digests = config_digests(body)
    checks = {
        'lookupAbsent': absent_response(lookup_status, lookup_body),
        'configRead': config_ok,
        'baselineFindings': config_ok and all(findings.values()),
        'equalsPreLaunch': config_ok and digests == pre,
        'equalsStageBaseline': config_ok and digests == stage_baseline,
        'baselinesAgree': pre == stage_baseline,
    }
    return {
        'lookup': {'status': lookup_status if type(lookup_status) is int else None, 'absent': checks['lookupAbsent']},
        'config': {'status': config_status if type(config_status) is int else None, 'baselineFindings': findings if config_ok else None, 'digests': digests if config_ok else None},
        'checks': checks,
        'differsFromPreLaunch': differing_members(pre, digests) if config_ok else list(DIGEST_MEMBERS),
        'differsFromStageBaseline': differing_members(stage_baseline, digests) if config_ok else list(DIGEST_MEMBERS),
        'verdict': 'CLOSE-OK' if all(checks.values()) else 'NEEDS-RECOVERY',
    }


def run(nonce, out, pre_path, receipt_path, send, sleep=time.sleep):
    out = Path(out)
    if out.exists():
        raise FileExistsError('A2 output exists')
    pre, stage_baseline = load_baselines(pre_path, receipt_path)
    plan = edges.manifest(nonce)

    def call(row, body):
        try:
            return send(row, body)
        except Exception:
            # A refused, latched or failed read is an unknown, never an absence or an equality.
            return None, None

    lookup = call({'path': edges.ADMIN + 'lookup', 'owner': True, 'method': 'POST'}, {'email': plan['addresses']})
    sleep(0.5)
    config = call({'path': edges.CONFIG, 'owner': True, 'method': 'GET'}, None)
    result = {'nonce': nonce, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), **evaluate(lookup, config, pre, stage_baseline)}
    with out.open('x') as stream:
        stream.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('lookup', 'checks', 'differsFromPreLaunch', 'differsFromStageBaseline', 'verdict')}))
    return 0 if result['verdict'] == 'CLOSE-OK' else 2
