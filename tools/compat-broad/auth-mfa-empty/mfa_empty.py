"""Bounded AUTH-MFA-EMPTY stage: what a whole `mfa` replace without a state does to an enabled project.

The issue `auth-project-config-whole-mfa-replace-with-empty-object` asks what production Identity
Platform does for `PATCH .../config?updateMask=mfa` when the `mfa` value carries no `state` (an empty
object, an explicit null state, providers without a state, a null `mfa`, or no `mfa` member at all)
while MFA is enabled. Each variant runs as: enable MFA, read back, send the variant, read back. The
stage then restores the baseline `mfa` (which the launch requires to be exactly `{state: DISABLED}` or
absent, so the whole replace restores it) and compares whole-config digests with the baseline.

Every request is frozen in `manifest`. Only the owner config route is reachable: GET and PATCH with the
mask `mfa`. The production transport is built only by `main` under `--production`, from credentials the
launcher puts in the environment; tests inject a fake `send`.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

PROJECT = 'fireemu-oracle-idp'
CONFIG = f'/identitytoolkit.googleapis.com/admin/v2/projects/{PROJECT}/config'
MASK = 'mfa'
CONTRACT = 'auth-mfa-empty-v1'
MFA_ENABLED = {'state': 'ENABLED', 'enabledProviders': ['PHONE_SMS'], 'providerConfigs': [{'state': 'ENABLED', 'totpProviderConfig': {'adjacentIntervals': 5}}]}
RESTORE = {'mfa': {'state': 'DISABLED'}}
# Variant id -> the whole PATCH body under updateMask=mfa. None of them carries a state.
VARIANTS = (
    ('empty-object', {'mfa': {}}),
    ('state-null', {'mfa': {'state': None}}),
    ('providers-without-state', {'mfa': {'providerConfigs': [{'state': 'ENABLED', 'totpProviderConfig': {'adjacentIntervals': 5}}]}}),
    ('sms-without-state', {'mfa': {'enabledProviders': ['PHONE_SMS']}}),
    ('mfa-null', {'mfa': None}),
    ('mfa-absent', {}),
)
FINAL_SLOTS = 3
DIGEST_MEMBERS = ('whole', 'mfa', 'mobileLinksConfig', 'notification')
MAX_REQUESTS = 1 + len(VARIANTS) * 4 + 1 + FINAL_SLOTS


def manifest(nonce):
    """The frozen request list; the stage never sends a row that is not here."""
    if not isinstance(nonce, str) or not re.fullmatch('[0-9a-f]{32}', nonce):
        raise ValueError('nonce must be 32 lowercase hex characters')
    rows = [{'id': 'config-baseline', 'method': 'GET', 'body': None}]
    for name, body in VARIANTS:
        rows += [
            {'id': f'{name}-enable', 'method': 'PATCH', 'body': {'mfa': MFA_ENABLED}},
            {'id': f'{name}-enable-readback', 'method': 'GET', 'body': None},
            {'id': f'{name}-variant', 'method': 'PATCH', 'body': body},
            {'id': f'{name}-variant-readback', 'method': 'GET', 'body': None},
        ]
    rows.append({'id': 'restore', 'method': 'PATCH', 'body': RESTORE})
    rows += [{'id': f'final-readback-{i}', 'method': 'GET', 'body': None} for i in range(FINAL_SLOTS)]
    for row in rows:
        row['path'] = CONFIG + ('?updateMask=' + MASK if row['method'] == 'PATCH' else '')
    plan = {'contract': CONTRACT, 'nonce': nonce, 'project': PROJECT, 'maxRequests': len(rows), 'rows': rows}
    plan['digest'] = _digest({k: v for k, v in plan.items() if k != 'digest'})
    return plan


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def normalized_config(body):
    """The config with the protobuf omissions made explicit, as AUTH-EDGES v3.3: absent mfa is DISABLED."""
    config = copy.deepcopy(body) if isinstance(body, dict) else {}
    if config.get('mfa') is None:
        config['mfa'] = {'state': 'DISABLED'}
    sign = config.get('signIn')
    if isinstance(sign, dict) and sign.get('allowDuplicateEmails') in (None, False):
        sign.pop('allowDuplicateEmails', None)
    return config


def config_digests(body):
    config = normalized_config(body)
    return {'whole': _digest(config), 'mfa': _digest(config.get('mfa')), 'mobileLinksConfig': _digest(config.get('mobileLinksConfig')), 'notification': _digest(config.get('notification'))}


def baseline_mfa_ok(body):
    """A1: the whole replace in `restore` puts back exactly this, so nothing else may be stored."""
    return isinstance(body, dict) and (body.get('mfa') is None or body.get('mfa') == {'state': 'DISABLED'})


def mfa_enabled(body):
    return isinstance(body, dict) and body.get('mfa') == MFA_ENABLED


def known(status):
    """A complete 2xx or 4xx answer; everything else (sub-200, 3xx, 5xx, no answer) is unknown."""
    return type(status) is int and (200 <= status < 300 or 400 <= status < 500)


def scrub(text):
    """A bounded copy of an error sentence with long digit runs (a project number) masked."""
    return re.sub(r'\d{6,}', '<n>', text)[:400] if isinstance(text, str) else None


def project(status, body):
    """What is recorded of an answer: status, error status and message, and the `mfa` member only."""
    out = {'status': status if type(status) is int else None, 'known': known(status)}
    if isinstance(body, dict) and isinstance(body.get('error'), dict):
        error = body['error']
        out['error'] = {'code': error.get('code') if type(error.get('code')) is int else None, 'status': error.get('status') if isinstance(error.get('status'), str) else None, 'message': scrub(error.get('message'))}
    elif isinstance(body, dict) and type(status) is int and 200 <= status < 300:
        out['mfaPresent'] = 'mfa' in body
        out['mfa'] = copy.deepcopy(body.get('mfa'))
        out['digests'] = config_digests(body)
    return out


def collect(*, nonce, output, send, sleep=time.sleep):
    """Run the frozen rows. Stops the variants at the first unknown, refusal of a needed step or latch,
    always attempts the restore and the final reads, and writes `receipt.json` (never overwrites)."""
    plan = manifest(nonce)
    output = Path(output)
    output.mkdir(mode=0o700)
    rows = {r['id']: r for r in plan['rows']}
    records = []
    journal = (output / 'journal.jsonl').open('x')
    state = {'requests': 0, 'latched': False, 'unknowns': []}

    def call(row_id):
        row = rows[row_id]
        journal.write(json.dumps({'before': row_id, 'at': time.time()}) + '\n')
        journal.flush()
        state['requests'] += 1
        if state['requests'] > plan['maxRequests']:
            raise RuntimeError('request budget exceeded')
        try:
            status, body = send(row, copy.deepcopy(row['body']))
        except Exception:
            status, body = None, None
        rec = {'id': row_id, 'method': row['method'], 'body': row['body'], **project(status, body)}
        if status in (401, 403):
            state['latched'] = True
        if not rec['known']:
            state['unknowns'].append(row_id)
        records.append(rec)
        journal.write(json.dumps({'after': row_id, 'status': rec['status']}) + '\n')
        journal.flush()
        sleep(1.0)
        return rec

    stop = None
    baseline = call('config-baseline')
    if baseline['status'] != 200 or not baseline_mfa_ok({'mfa': baseline.get('mfa')}) or 'digests' not in baseline:
        stop = 'baseline-not-confirmed'
    if stop is None:
        for name, _ in VARIANTS:
            enable = call(f'{name}-enable')
            if state['latched'] or enable['status'] != 200:
                stop = f'{name}-enable-failed'
                break
            readback = call(f'{name}-enable-readback')
            if readback['status'] != 200 or not mfa_enabled({'mfa': readback.get('mfa')}):
                stop = f'{name}-enable-not-read-back'
                break
            variant = call(f'{name}-variant')
            if state['latched']:
                stop = f'{name}-latched'
                break
            after = call(f'{name}-variant-readback')
            if state['latched'] or not variant['known'] or after['status'] != 200:
                stop = f'{name}-unknown'
                break
    restored = False
    final = None
    if stop != 'baseline-not-confirmed' and not state['latched']:
        call('restore')
        for i in range(FINAL_SLOTS):
            if state['latched']:
                break
            final = call(f'final-readback-{i}')
            if final['status'] == 200 and 'digests' in final:
                break
            sleep(2.0)
        restored = final is not None and final.get('digests') == baseline.get('digests')
    journal.close()
    receipt = {
        'contract': CONTRACT,
        'manifestDigest': plan['digest'],
        'nonce': nonce,
        'stopReason': stop,
        'recordingComplete': stop is None,
        'requests': state['requests'],
        'latched': state['latched'],
        'unknowns': state['unknowns'],
        'baselineDigests': baseline.get('digests'),
        'configEqualsBaseline': restored,
        'cleanupComplete': restored,
        'a2Required': True,
        'records': records,
    }
    with (output / 'receipt.json').open('x') as stream:
        stream.write(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    return receipt


def a2_evaluate(status, body, pre, stage):
    """A2 closes only on a 200 read whose digests equal both the pre-launch file and the stage baseline."""
    ok = status == 200 and isinstance(body, dict) and 'error' not in body
    digests = config_digests(body) if ok else None
    checks = {'configRead': ok, 'mfaAtBaseline': ok and baseline_mfa_ok(body), 'equalsPreLaunch': ok and digests == pre, 'equalsStageBaseline': ok and digests == stage, 'baselinesAgree': pre == stage and pre is not None}
    return {'status': status if type(status) is int else None, 'digests': digests, 'checks': checks, 'verdict': 'CLOSE-OK' if all(checks.values()) else 'NEEDS-RECOVERY'}


def valid_digests(value):
    return isinstance(value, dict) and set(value) == set(DIGEST_MEMBERS) and all(isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) for v in value.values())


def a2_run(out, pre_path, receipt_path, send):
    out = Path(out)
    if out.exists():
        raise FileExistsError('A2 output exists')
    pre = json.loads(Path(pre_path).read_text()).get('digests')
    stage = json.loads(Path(receipt_path).read_text()).get('baselineDigests')
    if not valid_digests(pre) or not valid_digests(stage):
        raise ValueError('A2 needs the pre-launch digests and the stage baseline digests')
    try:
        status, body = send({'id': 'a2-config', 'method': 'GET', 'path': CONFIG, 'body': None}, None)
    except Exception:
        status, body = None, None
    result = {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), **a2_evaluate(status, body, pre, stage)}
    with out.open('x') as stream:
        stream.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('status', 'checks', 'verdict')}))
    return 0 if result['verdict'] == 'CLOSE-OK' else 2


def shape_ok(row, body):
    """The only shapes the production transport carries: the frozen config GET and mask-`mfa` PATCHes."""
    if row.get('method') == 'GET':
        return row.get('path') == CONFIG and body is None
    return row.get('method') == 'PATCH' and row.get('path') == CONFIG + '?updateMask=' + MASK and isinstance(body, dict) and set(body) <= {'mfa'} and (body == RESTORE or body == {'mfa': MFA_ENABLED} or any(body == v for _, v in VARIANTS))


def production_send():
    """Owner transport; reads the admitted token from the environment at launch, never from files."""
    import batch_adapter

    token = os.environ['AUTH_MFA_EMPTY_ACCESS_TOKEN']
    if not token or any(ord(c) < 33 or ord(c) == 127 for c in token):
        raise ValueError('runtime credentials required')
    latched = False

    def send(row, body):
        nonlocal latched
        if latched:
            raise ValueError('credential rejection latched')
        if not shape_ok(row, body):
            raise ValueError('request shape refused')
        headers = {'Accept': 'application/json', 'Authorization': 'Bearer ' + token, 'x-goog-user-project': PROJECT}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        try:
            result = batch_adapter.wire('https:/' + row['path'], row['method'], body, headers, timeout=12, receipt=True)
        except Exception:
            raise ValueError('bounded exchange failed') from None
        http = result.get('http', {}) if isinstance(result, dict) else {}
        status = http.get('status')
        if status in (401, 403):
            latched = True
        answer = result.get('body') if http.get('complete') is True and http.get('bodyKind') == 'json' else None
        return (status if type(status) is int else None), (answer if isinstance(answer, dict) else None)
    return send


def read_baseline(out):
    """Launch check: one GET; prints the A1 line and four digests; writes the private baseline file."""
    status, body = production_send()({'id': 'launch-baseline', 'method': 'GET', 'path': CONFIG, 'body': None}, None)
    if status != 200 or not isinstance(body, dict) or 'error' in body:
        print('config-read: unknown')
        return 2
    print(f'A1-mfa-disabled-or-absent: {"ok" if baseline_mfa_ok(body) else "MISMATCH"}')
    digests = config_digests(body)
    for member in DIGEST_MEMBERS:
        print(f'digest-{member}: {digests[member]}')
    if not baseline_mfa_ok(body):
        return 2
    if out is not None:
        fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump({'digests': digests, 'mfa': body.get('mfa')}, stream, indent=2, sort_keys=True)
            stream.write('\n')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nonce')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--production', action='store_true')
    parser.add_argument('--read-baseline', action='store_true')
    parser.add_argument('--baseline-out', type=Path)
    parser.add_argument('--a2', type=Path, help='A2 output file (new)')
    parser.add_argument('--pre', type=Path)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args(argv)
    if not args.production:
        if args.nonce is None or args.output is not None or args.read_baseline or args.a2 is not None:
            parser.error('without --production only --nonce (print the manifest) is allowed')
        print(json.dumps(manifest(args.nonce), indent=2))
        return 0
    if args.read_baseline:
        return read_baseline(args.baseline_out)
    if args.a2 is not None:
        return a2_run(args.a2, args.pre, args.receipt, production_send())
    if args.nonce is None or args.output is None:
        parser.error('--production needs --nonce and --output')
    receipt = collect(nonce=args.nonce, output=args.output, send=production_send())
    print(json.dumps({k: receipt[k] for k in ('recordingComplete', 'cleanupComplete', 'stopReason', 'requests', 'unknowns')}))
    return 0 if receipt['recordingComplete'] and receipt['cleanupComplete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
