"""Bounded AUTH-EDGES stage; injected admitted transport or loopback rehearsal only."""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import os
import re
import secrets
import signal
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
for directory in (HERE.parent, HERE.parent / 'auth-action-codes', HERE.parent / 'auth-credential-tokens', HERE.parent / 'auth-totp-enroll'):
    sys.path.insert(0, str(directory))

from action_codes_collector import _Run, _recover, _loopback_origin, _http_send, BindingError, CollectorError
from action_codes_comparator import _indeterminate
from batch_adapter import Adapter
from broad_contract import digest
from credential_collector import publishable, assert_no_secret
from credential_gate import CredentialGate, absent_response
from mfa_totp import TotpParameters, totp_code

PROJECT = 'fireemu-oracle-idp'
CLIENT = '/identitytoolkit.googleapis.com/v1/accounts:'
ADMIN = f'/identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:'
FAMILIES = ('link-unverified', 'link-verified', 'disabled-link', 'change-reuse', 'continue-url', 'admin-email', 'scrypt', 'totp-reuse')
ROLES = ('unverified', 'verified', 'disabled', 'change', 'session', 'mfa', 'scrypt0', 'scrypt1', 'scrypt4', 'scrypt5', 'scrypt16')
REFUSALS = ('USER_DISABLED', 'INVALID_OOB_CODE', 'INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'TOKEN_EXPIRED', 'INVALID_ID_TOKEN', 'INVALID_REFRESH_TOKEN', 'UNAUTHORIZED_DOMAIN', 'INVALID_CONTINUE_URI', 'INVALID_HASH_PARAMETERS', 'INVALID_HASH_PARALLELIZATION', 'MFA_ENROLLMENT_ALREADY_COMPLETE', 'INVALID_CODE', 'OPERATION_NOT_ALLOWED')


def manifest(nonce):
    """Freeze every request, dependency and cleanup slot before the first write."""
    if not isinstance(nonce, str) or not re.fullmatch('[0-9a-f]{32}', nonce):
        raise ValueError('fresh 32-character hexadecimal nonce required')
    accounts = {r: {'email': f'edges-{nonce}-{r.lower()}@example.invalid'} for r in (*ROLES, 'sessionAlias')}
    rows = []

    def add(identifier, role, method, body, *, kind='setup', owner=False, family='', required=(), binds=None):
        row = dict(id=identifier, account=role, path=(ADMIN if owner else CLIENT) + method, body=body, owner=owner, kind=kind, family=family, required=list(required), refusals=list(REFUSALS), binds=binds or {})
        rows.append(row)
        return row

    def readback(identifier, role, family=''):
        return add(identifier + '-readback', role, 'lookup', {'localId': ['$binding:' + role + '.localId']}, kind='readback', owner=True, family=family, required=('users',))

    def diagnostic(identifier, role, method, body, family, *, owner=False, required=()):
        row = add(identifier, role, method, body, kind='diagnostic', owner=owner, family=family, required=required)
        readback(identifier, role, family)
        return row

    add('preflight-absence', None, 'lookup', {'email': [a['email'] for a in accounts.values()]}, kind='preflight', owner=True, required=('users',))
    for role in ROLES:
        add('create-' + role, role, 'signUp', {'email': accounts[role]['email'], 'password': '$binding:' + role + '.password', 'returnSecureToken': True}, kind='create', required=('localId', 'idToken', 'refreshToken'), binds={role + '.localId': 'localId', role + '.idToken': 'idToken', role + '.refreshToken': 'refreshToken'})
        readback('create-' + role, role)
    for role in ('verified', 'change', 'session', 'mfa'):
        add('verify-' + role, role, 'update', {'localId': '$binding:' + role + '.localId', 'emailVerified': True}, owner=True, required=('localId',))
    for role in ('unverified', 'verified'):
        family = 'link-' + role
        add('baseline-' + role, role, 'lookup', {'idToken': '$binding:' + role + '.idToken'}, required=('users',))
        add('issue-' + role, role, 'sendOobCode', {'email': accounts[role]['email'], 'requestType': 'EMAIL_SIGNIN', 'returnOobLink': True, 'continueUrl': 'http://localhost/edge', 'canHandleCodeInApp': True}, owner=True, required=('oobCode',), binds={role + '.code': 'oobCode'})
        diagnostic(family, role, 'signInWithEmailLink', {'email': accounts[role]['email'], 'oobCode': '$binding:' + role + '.code'}, family, required=('localId', 'idToken'))
        diagnostic(family + '-password', role, 'signInWithPassword', {'email': accounts[role]['email'], 'password': '$binding:' + role + '.password', 'returnSecureToken': True}, family, required=('localId', 'idToken'))
        diagnostic(family + '-old-id', role, 'lookup', {'idToken': '$binding:' + role + '.idToken'}, family, required=('users',))
        row = diagnostic(family + '-old-refresh', role, 'refresh', {'grant_type': 'refresh_token', 'refresh_token': '$binding:' + role + '.refreshToken'}, family, required=('id_token', 'user_id'))
        row['path'] = '/securetoken.googleapis.com/v1/token'
    # Issue while enabled, then disable: issuance refusal cannot hide sign-in behavior.
    add('issue-disabled', 'disabled', 'sendOobCode', {'email': accounts['disabled']['email'], 'requestType': 'EMAIL_SIGNIN', 'returnOobLink': True, 'continueUrl': 'http://localhost/edge', 'canHandleCodeInApp': True}, owner=True, required=('oobCode',), binds={'disabled.code': 'oobCode'})
    add('disable-link-owner', 'disabled', 'update', {'localId': '$binding:disabled.localId', 'disableUser': True}, owner=True, required=('localId',))
    diagnostic('disabled-link', 'disabled', 'signInWithEmailLink', {'email': accounts['disabled']['email'], 'oobCode': '$binding:disabled.code'}, 'disabled-link', required=('localId',))
    add('issue-change', 'change', 'sendOobCode', {'email': accounts['change']['email'], 'newEmail': f'edges-{nonce}-changed@example.invalid', 'requestType': 'VERIFY_AND_CHANGE_EMAIL', 'returnOobLink': True}, owner=True, required=('oobCode',), binds={'change.code': 'oobCode'})
    add('disable-change-owner', 'change', 'update', {'localId': '$binding:change.localId', 'disableUser': True}, owner=True, required=('localId',))
    diagnostic('change-disabled', 'change', 'update', {'oobCode': '$binding:change.code'}, 'change-reuse', required=('localId',))
    add('enable-change-owner', 'change', 'update', {'localId': '$binding:change.localId', 'disableUser': False}, owner=True, required=('localId',))
    diagnostic('change-retry', 'change', 'update', {'oobCode': '$binding:change.code'}, 'change-reuse', required=('localId',))
    # Restore by immutable UID before address-keyed cleanup.
    add('restore-change-address', 'change', 'update', {'localId': '$binding:change.localId', 'email': accounts['change']['email']}, owner=True, required=('localId',))
    for label, url in (('backslash', 'https://localhost\\@example.invalid/edge'), ('javascript', 'javascript://localhost/edge'), ('relative', '/edge'), ('untrusted', 'https://example.invalid/edge')):
        diagnostic('continue-' + label, 'verified', 'sendOobCode', {'email': accounts['verified']['email'], 'requestType': 'PASSWORD_RESET', 'returnOobLink': True, 'continueUrl': url}, 'continue-url', owner=True, required=('oobCode',))
    add('baseline-session', 'session', 'lookup', {'idToken': '$binding:session.idToken'}, required=('users',))
    diagnostic('admin-email-change', 'session', 'update', {'localId': '$binding:session.localId', 'email': accounts['sessionAlias']['email']}, 'admin-email', owner=True, required=('localId',))
    diagnostic('admin-email-old-id', 'session', 'lookup', {'idToken': '$binding:session.idToken'}, 'admin-email', required=('users',))
    row = diagnostic('admin-email-old-refresh', 'session', 'refresh', {'grant_type': 'refresh_token', 'refresh_token': '$binding:session.refreshToken'}, 'admin-email', required=('id_token', 'user_id'))
    row['path'] = '/securetoken.googleapis.com/v1/token'
    for p in (0, 1, 4, 5, 16):
        role = 'scrypt' + str(p)
        diagnostic('scrypt-import-' + str(p), role, 'batchCreate', {'hashAlgorithm': 'STANDARD_SCRYPT', 'cpuMemCost': 16, 'allowOverwrite': True, 'blockSize': 1, 'parallelization': p, 'dkLen': 32, 'users': [{'localId': '$binding:' + role + '.localId', 'email': accounts[role]['email'], 'passwordHash': '$binding:' + role + '.hash', 'salt': '$binding:' + role + '.salt'}]}, 'scrypt', owner=True)
        diagnostic('scrypt-login-' + str(p), role, 'signInWithPassword', {'email': accounts[role]['email'], 'password': '$binding:' + role + '.importPassword', 'returnSecureToken': True}, 'scrypt', required=('localId',))
    add('mfa-fresh-signin', 'mfa', 'signInWithPassword', {'email': accounts['mfa']['email'], 'password': '$binding:mfa.password', 'returnSecureToken': True}, required=('idToken',), binds={'mfa.freshId': 'idToken'})
    row = diagnostic('totp-start', 'mfa', 'start', {'idToken': '$binding:mfa.freshId', 'totpEnrollmentInfo': {}}, 'totp-reuse', required=('totpSessionInfo',))
    row['path'] = '/identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:start'
    row['binds'] = {'mfa.session': 'totpSessionInfo.sessionInfo', 'mfa.secret': 'totpSessionInfo.sharedSecretKey'}
    for label in ('finalize', 'reuse'):
        row = diagnostic('totp-' + label, 'mfa', 'finalize', {'idToken': '$binding:mfa.freshId', 'totpVerificationInfo': {'sessionInfo': '$binding:mfa.session', 'verificationCode': '$binding:mfa.code'}, 'displayName': 'auth-edges'}, 'totp-reuse', required=('idToken',))
        row['path'] = '/identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:finalize'
        if label == 'finalize':
            row['binds'] = {'mfa.finalizedId': 'idToken'}
        else:
            row['body']['idToken'] = '$binding:mfa.finalizedId'
    # Alias selectors cover both sides even if an email-change acknowledgement is lost.
    accounts['changeAlias'] = {'email': f'edges-{nonce}-changed@example.invalid'}
    rows[0]['body']['email'].append(accounts['changeAlias']['email'])
    recovery = []
    for identifier in ('recover-discover', 'recover-absence'):
        recovery.append(dict(id=identifier, path=ADMIN + 'lookup', body={'email': [a['email'] for a in accounts.values()]}, owner=True, kind='recovery', routeClass='admin'))
    for role in accounts:
        recovery.insert(-1, dict(id='recover-delete-' + role, path=ADMIN + 'delete', body={'localId': '$binding:' + role + '.localId'}, owner=True, kind='delete', routeClass='admin'))
    for role in accounts:
        recovery.insert(-1, dict(id='recover-uid-absence-' + role, path=ADMIN + 'lookup', body={'localId': ['$binding:' + role + '.localId']}, owner=True, kind='recovery', routeClass='admin'))
    return dict(contract='auth-edges-v1', project=PROJECT, nonce=nonce, ownedAccounts=accounts, stages=rows, recovery=recovery, budget=dict(observationRequests=len(rows), recoveryRequests=len(recovery), totalRequests=len(rows) + len(recovery), wallSeconds=300, recoverySeconds=180, requestsPerSecond=4, planningCeilingUsd=0.10), productionExecutable=False)


class Guard(CredentialGate):
    """Reuse the credential guard's exact recursive binding validator per frozen slot."""

    def __init__(self, rows, bindings):
        self.rows, self.index = copy.deepcopy(rows), 0
        self.bindings, self._observed, self.minted = bindings, {}, set()

    def check(self, row, body):
        if self.index >= len(self.rows) or digest(row) != digest(self.rows[self.index]):
            raise ValueError('request outside frozen edge stage')
        self._resolve(body, self.rows[self.index]['body'])
        self.index += 1


def judge(row, status, body):
    """Observation is not compatibility: unfamiliar answers require owned read-back."""
    unknown = {**_indeterminate('unknown edge answer; owned read-back required'), 'readBackRequired': True}
    if type(status) is not int or not isinstance(body, dict):
        return unknown
    if row['kind'] == 'preflight' and absent_response(status, body):
        return {'classification': 'OBSERVED', 'outcome': 'accepted', 'readBackRequired': False}
    error = body.get('error')
    if status == 400 and isinstance(error, dict) and isinstance(error.get('message'), str):
        code = error['message'].split(' : ', 1)[0]
        if code in row['refusals']:
            return {'classification': 'OBSERVED', 'outcome': 'refused', 'readBackRequired': True}
        return unknown
    if status != 200 or 'error' in body:
        return unknown
    for key in row['required']:
        value = body.get(key)
        if key == 'users':
            if not isinstance(value, list):
                return unknown
        elif key == 'totpSessionInfo':
            if not isinstance(value, dict) or any(not isinstance(value.get(k), str) or not value[k] for k in ('sessionInfo', 'sharedSecretKey', 'hashingAlgorithm')) or type(value.get('periodSec')) is not int or type(value.get('verificationCodeLength')) is not int:
                return unknown
            try:
                TotpParameters(value['periodSec'], value['verificationCodeLength'], {'SHA1': 'HMAC_SHA1', 'HMAC_SHA1': 'HMAC_SHA1'}.get(value['hashingAlgorithm'], ''))
            except (ValueError, TypeError):
                return unknown
        elif not isinstance(value, str) or not value:
            return unknown
    return {'classification': 'OBSERVED', 'outcome': 'accepted', 'readBackRequired': True}


class StageRun(_Run):
    """Use the action collector's phase budgets and cleanup with an exact slot guard."""

    def __init__(self, plan, output, send, sleep, clock):
        budget = plan['budget']
        super().__init__('', PROJECT, plan['nonce'], send, budget['observationRequests'], budget['recoveryRequests'], 300, 180, clock, 4, sleep)
        self.plan, self.output = plan, output
        self.journal = output / 'ownership.jsonl'
        self.guard = Guard(plan['stages'], self.secrets)
        self.recovery_guard = Guard(plan['recovery'], self.secrets)
        self.current = None
        self.record = lambda event: Adapter.record(self, event)

    def request(self, path, body, privileged):
        if self.recovering:
            guard = self.recovery_guard
            matches = [(i, row) for i, row in enumerate(guard.rows) if i >= guard.index and (row['path'], row['body'], row['owner']) == (path, body, privileged)]
            if not matches:
                raise ValueError('cleanup outside frozen edge stage')
            index, row = matches[0]
            guard.index = index
        else:
            guard, row = self.guard, self.current
            if (path, body, privileged) != (row['path'], row['body'], row['owner']):
                raise ValueError('request outside edge slot')
        resolved = self.resolve(body)
        guard.check(row, resolved)
        self.spend()
        self.pace()
        self.check_deadline()
        self.record({'kind': 'request-attempt', 'id': row['id'], 'phase': 'recovery' if self.recovering else 'observation'})
        status, answer = self.send(copy.deepcopy(row), resolved)
        # CredentialGate accepts the typed kind-only absence used by the REST API.
        # Adapt that spelling to the action cleanup's explicit users[] contract.
        if self.recovering and absent_response(status, answer) and 'users' not in answer:
            answer = {**answer, 'users': []}
        return status, answer


def collect(*, nonce, output, send, sleep=time.sleep, clock=time.monotonic):
    """Execute a stage through a coordinator-supplied, already admitted transport.

    The callable receives only a frozen request descriptor and its resolved body. This entry performs no credential discovery and supplies no remote transport.
    """
    plan = manifest(nonce)
    if plan['budget']['totalRequests'] >= 200:
        raise ValueError('edge request budget exceeds packet')
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    run = StageRun(plan, output, send, sleep, clock)
    for role, account in plan['ownedAccounts'].items():
        run.secrets[role + '.email'] = account['email']
        run.secrets[role + '.password'] = 'Aa9!' + secrets.token_urlsafe(24)
    for p in (0, 1, 4, 5, 16):
        role = 'scrypt' + str(p)
        salt = secrets.token_bytes(16)
        run.secrets[role + '.importPassword'] = 'Bb8!' + secrets.token_urlsafe(24)
        raw = hashlib.scrypt(run.secrets[role + '.importPassword'].encode(), salt=salt, n=16, r=1, p=max(1, p), dklen=32, maxmem=1024 * 1024)
        run.secrets[role + '.salt'] = base64.b64encode(salt).decode()
        run.secrets[role + '.hash'] = base64.b64encode(raw).decode()
    stages, stopped, parameters = [], None, None
    pending_stop = None
    try:
        for row in plan['stages']:
            run.current = row
            if row['id'] in ('totp-finalize', 'totp-reuse') and 'mfa.secret' in run.secrets:
                run.secrets['mfa.code'] = totp_code(run.secrets['mfa.secret'], int(time.time()), parameters)
            try:
                run.resolve(row['body'])
            except BindingError:
                if row['kind'] != 'diagnostic':
                    raise
                run.guard.index += 1
                stages.append({k: row[k] for k in ('id', 'kind', 'family')} | {'classification': 'INDETERMINATE', 'status': None, 'skipped': 'dependency-unavailable'})
                continue
            if row['kind'] == 'create':
                run.record({'kind': 'account-attempt', 'email': plan['ownedAccounts'][row['account']]['email'], 'preflightAbsent': True})
            try:
                status, body = run.request(row['path'], row['body'], row['owner'])
            except Exception as error:
                if row['kind'] != 'diagnostic':
                    raise
                status, body = None, {}
                pending_stop = type(error).__name__
            verdict = judge(row, status, body)
            projection = {k: row[k] for k in ('id', 'kind', 'family')}
            projection.update(status=status if type(status) is int else None, classification=verdict['classification'])
            if isinstance(body, dict):
                message = body.get('error', {}).get('message') if isinstance(body.get('error'), dict) else None
                code = message.split(' : ', 1)[0] if isinstance(message, str) else ''
                if re.fullmatch('[A-Z][A-Z0-9_]{0,63}', code):
                    projection['errorCode'] = code
                # Only declared fields are projected: arbitrary keys and prose are not logs.
                projection['fields'] = publishable({k: body[k] for k in ('idToken', 'refreshToken', 'oobCode', 'passwordHash') if k in body})
                if 'users' in body and isinstance(body['users'], list):
                    projection['userCount'] = len(body['users'])
                    projection['users'] = [{
                        'uidMatches': u.get('localId') == run.secrets.get(row.get('account', '') + '.localId'),
                        'emailRole': next((r for r, a in plan['ownedAccounts'].items() if a['email'] == u.get('email')), 'foreign'),
                        'disabled': u.get('disabled', u.get('disableUser', False)) if type(u.get('disabled', u.get('disableUser', False))) is bool else None,
                        'providers': sorted(p['providerId'] for p in (u['providerUserInfo'] if isinstance(u.get('providerUserInfo'), list) else []) if isinstance(p, dict) and p.get('providerId') in ('password', 'phone')),
                        'emailVerified': u.get('emailVerified') if type(u.get('emailVerified')) is bool else None,
                        'passwordHashPresent': bool(u.get('passwordHash')),
                        'providerCount': len(u['providerUserInfo']) if isinstance(u.get('providerUserInfo'), list) else None,
                        'mfaCount': len(u['mfaInfo']) if isinstance(u.get('mfaInfo'), list) else None,
                    } for u in body['users'] if isinstance(u, dict)]
                if row['id'] == 'totp-start' and status == 200 and verdict['classification'] == 'OBSERVED':
                    projection['totpParameters'] = {k: body['totpSessionInfo'][k] for k in ('periodSec', 'verificationCodeLength', 'hashingAlgorithm')}
                if row['path'].endswith('batchCreate'):
                    errors = body.get('error')
                    projection['importErrorCount'] = len(errors) if isinstance(errors, list) else None
                    projection['importResult'] = publishable({'error': [{'index': e.get('index'), 'message': e.get('message') if e.get('message') in REFUSALS else 'UNRECOGNIZED'} for e in errors if isinstance(e, dict)]}) if isinstance(errors, list) else None
            assert_no_secret(projection, [v for k, v in run.secrets.items() if not k.endswith(('.email', '.localId'))])
            stages.append(projection)
            run.record({'kind': 'response', 'observation': projection})
            if row['kind'] == 'preflight' and not absent_response(status, body):
                raise ValueError('owned namespace not absent')
            if row['kind'] in ('setup', 'create') and verdict['classification'] != 'OBSERVED':
                raise ValueError('setup answer unknown')
            if row['kind'] in ('setup', 'create') and status != 200:
                raise ValueError('setup refused')
            if row['kind'] == 'create':
                role, uid = row['account'], body['localId']
                if any(a['localId'] == uid for a in run.owned.values()) or any(ord(c) < 32 for c in uid):
                    raise ValueError('creation identity conflicts')
                run.secrets[role + '.localId'] = uid
                run.owned[role] = {'localId': uid, 'email': plan['ownedAccounts'][role]['email']}
                run.record({'kind': 'account-created', 'email': plan['ownedAccounts'][role]['email'], 'uid': uid})
                if role in ('session', 'change'):
                    run.secrets[role + 'Alias.localId'] = uid
            if row['kind'] == 'readback' or row['id'].startswith('baseline-'):
                users = body.get('users') if isinstance(body, dict) else None
                if type(status) is not int or status != 200 or not isinstance(users, list) or len(users) != 1 or not isinstance(users[0], dict) or users[0].get('localId') != run.secrets[row['account'] + '.localId']:
                    raise ValueError('owned read-back incomplete')
                role = row['account']
                allowed_emails = {plan['ownedAccounts'][role]['email']}
                if role in ('session', 'change'):
                    allowed_emails.add(plan['ownedAccounts'][role + 'Alias']['email'])
                if users[0].get('email') not in allowed_emails:
                    raise ValueError('owned email outside frozen namespace')
            if isinstance(body, dict) and status == 200 and verdict['classification'] == 'OBSERVED':
                for name, field in row['binds'].items():
                    value = body
                    for part in field.split('.'):
                        value = value.get(part) if isinstance(value, dict) else None
                    if not isinstance(value, str) or not value:
                        raise ValueError('response binding unavailable')
                    run.secrets[name] = value
                if row['id'] == 'totp-start':
                    info = body['totpSessionInfo']
                    parameters = TotpParameters(info['periodSec'], info['verificationCodeLength'], {'SHA1': 'HMAC_SHA1', 'HMAC_SHA1': 'HMAC_SHA1'}.get(info['hashingAlgorithm'], ''))
            if row['kind'] == 'readback' and pending_stop is not None:
                raise ValueError('diagnostic failed; read-back retained')
            if type(status) is not int or status in (401, 403, 429) or status >= 500:
                if row['kind'] == 'diagnostic':
                    pending_stop = 'transport-or-quota-stop'
                else:
                    raise ValueError('transport or quota stop')
    except (Exception, KeyboardInterrupt) as error:
        stopped = type(error).__name__
    finally:
        run.begin_recovery()
        recovery, complete, remaining, failures, proven = _recover(run, plan)
    receipt = dict(contract=plan['contract'], manifestDigest=digest(plan), productionExecuted=False, side='injected', recordingComplete=stopped is None and len(stages) == len(plan['stages']), stopReason=stopped, stages=stages, recovery=recovery, cleanupComplete=complete, remainingAccounts=remaining, deleteFailures=failures, absenceProven=proven, requests=run.requests, recoveryRequests=run.recovery_requests, requestBudget=plan['budget'], deliveredMessages=0)
    receipt['classification'] = 'RECORDED' if receipt['recordingComplete'] and complete and all(r['classification'] == 'OBSERVED' for r in stages) else 'INDETERMINATE'
    assert_no_secret(receipt, [v for k, v in run.secrets.items() if not k.endswith(('.email', '.localId'))])
    run.record({'kind': 'terminal', 'recordingComplete': receipt['recordingComplete'], 'cleanupComplete': complete, 'classification': receipt['classification']})
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    return receipt


def local_send(origin):
    """Use the existing bounded, no-proxy/no-redirect transport only on loopback."""
    origin = _loopback_origin(origin)

    def send(row, body):
        headers = {'content-type': 'application/json'}
        if row['owner']:
            headers['authorization'] = 'Bearer owner'
        path = row['path'] + ('' if row['owner'] else '?key=fake')
        return _http_send('POST', origin + path, headers, body)
    return send


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nonce', required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--origin')
    args = parser.parse_args()
    if args.origin is None:
        print(json.dumps(manifest(args.nonce), indent=2))
        return 0
    if args.output is None:
        parser.error('--output is required for a local rehearsal')
    sender = local_send(args.origin)

    def interrupted(_signum, _frame):
        raise KeyboardInterrupt('cleanup requested')

    signal.signal(signal.SIGTERM, interrupted)
    result = collect(nonce=args.nonce, output=args.output, send=sender)
    print(json.dumps({k: result[k] for k in ('recordingComplete', 'cleanupComplete', 'classification', 'requests', 'recoveryRequests')}))
    return 0 if result['recordingComplete'] and result['cleanupComplete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
