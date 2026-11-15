"""Offline acceptance tests for the complete bounded Auth edge stage."""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / 'auth-action-codes'))
from test_action_codes_collector import FakeService
import edges

NONCE = '0123456789abcdef' * 2


class World(FakeService):
    """Extend the existing action-code fake; no network or credential sources."""

    def __init__(self, fault=None, answer='accepted', family=None):
        super().__init__()
        self.fault, self.answer, self.family = fault, answer, family
        self.sent = []
        self.fired = False
        self.sessions = {}
        self.config = {'signIn': {'email': {'enabled': True, 'passwordRequired': True}}, 'authorizedDomains': [edges.DOMAIN], 'mfa': {'state': 'DISABLED'}}

    def send_stage(self, row, body):
        self.sent.append(row['id'])
        if self.fault == 'before-create' and row['kind'] == 'create':
            raise TimeoutError('fixture failure')
        if row['kind'] == 'diagnostic' and (self.family is None or row['family'] == self.family) and not self.fired:
            self.fired = True
            if self.fault == 'after-diagnostic':
                raise TimeoutError('fixture failure')
            if self.answer == 'unknown':
                return 400, {'error': {'message': 'NEW_BACKEND_ANSWER : sensitive-prose'}}
            if self.answer == 'refused':
                return 400, {'error': {'message': 'INVALID_OOB_CODE'}}
        if self.fault == 'delete' and row['kind'] == 'delete':
            return 503, {'error': {'message': 'UNAVAILABLE'}}
        if self.fault == 'absence' and row['id'] == 'recover-absence':
            return 200, {}
        if row['path'].startswith(edges.CONFIG):
            if row.get('method') == 'PATCH':
                self.config['signIn']['email'].update(body['signIn']['email'])
            return 200, copy.deepcopy(self.config)
        if body.get('requestType') == 'EMAIL_SIGNIN' and self.config['signIn']['email']['passwordRequired']:
            return 400, {'error': {'message': 'OPERATION_NOT_ALLOWED'}}
        if 'localhost' in body.get('continueUrl', ''):
            return 400, {'error': {'message': 'UNAUTHORIZED_DOMAIN : Domain not allowlisted by project'}}
        route = row['path'].rsplit(':', 1)[-1]
        if route in ('start', 'finalize'):
            if route == 'start':
                return 200, {'totpSessionInfo': {'sessionInfo': 'session-fixture', 'sharedSecretKey': 'JBSWY3DPEHPK3PXP', 'periodSec': 30, 'verificationCodeLength': 6, 'hashingAlgorithm': 'SHA1'}}
            return 200, {'idToken': body['idToken'], 'refreshToken': 'fixture-refresh'}
        if row['path'].endswith('/token'):
            uid = body['refresh_token'].removeprefix('refresh-token-')
            return 200, {'id_token': 'id-token-' + uid, 'refresh_token': body['refresh_token'], 'user_id': uid}
        if route == 'delete' and body['localId'] not in self.accounts:
            return 400, {'error': {'message': 'USER_NOT_FOUND'}}
        if route == 'batchCreate':
            assert body['allowOverwrite'] is True
            assert body['cpuMemCost'] == 16
            if body['parallelization'] == 0:
                return 400, {'error': {'message': 'INVALID_HASH_PARALLELIZATION'}}
            user = body['users'][0]
            self.accounts[user['localId']]['import'] = copy.deepcopy(body)
            return 200, {}
        if route == 'signInWithPassword':
            account = self._find(body['email'])
            valid = account and account.get('password') == body['password']
            if account and 'import' in account:
                import base64, hashlib
                imported = account['import']
                user = imported['users'][0]
                valid = base64.b64encode(hashlib.scrypt(body['password'].encode(), salt=base64.b64decode(user['salt']), n=imported['cpuMemCost'], r=imported['blockSize'], p=imported['parallelization'], dklen=imported['dkLen'])).decode() == user['passwordHash']
            if not valid:
                return 400, {'error': {'message': 'INVALID_LOGIN_CREDENTIALS'}}
            return 200, {'localId': account['localId'], 'idToken': 'id-token-' + account['localId'], 'refreshToken': 'refresh-token-' + account['localId']}
        if route == 'lookup' and 'idToken' in body:
            body = {'localId': [body['idToken'].removeprefix('id-token-')]}
        if route == 'lookup' and isinstance(body.get('localId'), list):
            return 200, {'kind': 'identitytoolkit#GetAccountInfoResponse', 'users': [copy.deepcopy(a) for a in self.accounts.values() if a['localId'] in body['localId']]}
        if route == 'update' and 'oobCode' not in body:
            account = self.accounts[body['localId']]
            account.update({k: v.lower() if k == 'email' else v for k, v in body.items() if k != 'localId'})
            return 200, {'localId': account['localId'], 'email': account['email']}
        if route == 'update' and 'oobCode' in body:
            record = self.codes.get(body['oobCode'])
            if record and record['requestType'] == 'VERIFY_AND_CHANGE_EMAIL':
                return 400, {'error': {'message': 'USER_DISABLED'}}
        result = super().send('POST', 'http://127.0.0.1:1' + row['path'], {'authorization': 'Bearer owner'}, body)
        if self.fault == 'after-create' and row['kind'] == 'create':
            raise TimeoutError('lost acknowledgement')
        return result


def run(tmp_path, **options):
    world = World(**options)
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=world.send_stage, sleep=lambda _: None)
    return world, result


def test_whole_stage_is_bounded_masked_and_recovers(tmp_path):
    world, result = run(tmp_path)
    assert result['recordingComplete'] is True
    assert result['cleanupComplete'] is True
    assert not world.accounts
    assert result['requests'] + result['recoveryRequests'] < 200
    assert set(edges.FAMILIES) <= {r['family'] for r in result['stages'] if r['kind'] == 'diagnostic'}
    saved = ''.join(p.read_text() for p in (tmp_path / 'run').glob('*'))
    for secret in ('id-token-', 'refresh-token-', 'JBSWY3DPEHPK3PXP', 'session-fixture', 'sensitive-prose'):
        assert secret not in saved
    assert result['productionExecuted'] is False


@pytest.mark.parametrize('fault', ['before-create', 'after-create', 'after-diagnostic', 'delete', 'absence'])
def test_partial_failure_preserves_cleanup_responsibility(tmp_path, fault):
    world, result = run(tmp_path, fault=fault)
    assert result['cleanupComplete'] is (fault == 'after-diagnostic')
    if fault == 'after-create':
        assert world.accounts
        assert not any(x.startswith('recover-delete') for x in world.sent)
    if fault == 'after-diagnostic':
        assert not world.accounts
    assert result['classification'] == 'INDETERMINATE'


@pytest.mark.parametrize('family', ['link-unverified', 'link-verified', 'disabled-link', 'change-reuse', 'continue-url', 'admin-email', 'scrypt', 'totp-reuse'])
def test_unknown_answers_reach_readback_and_never_pass(tmp_path, family):
    world, result = run(tmp_path, answer='unknown', family=family)
    assert result['cleanupComplete']
    assert result['classification'] == 'INDETERMINATE'
    index = next(i for i, r in enumerate(result['stages']) if r.get('errorCode') == 'NEW_BACKEND_ANSWER')
    assert result['stages'][index + 1]['kind'] == 'readback'
    assert result['stages'][index]['classification'] == 'INDETERMINATE'
    assert not world.accounts


@pytest.mark.parametrize('mutation', ['path', 'body', 'owner', 'binding', 'replay'])
def test_guard_rejects_drift_before_send(tmp_path, mutation):
    plan = edges.manifest(NONCE)
    guard = edges.Guard(plan['stages'], {'x': 'owned'})
    row = copy.deepcopy(plan['stages'][0])
    body = copy.deepcopy(row['body'])
    if mutation == 'path':
        row['path'] += '?foreign=1'
    elif mutation == 'body':
        body['unexpected'] = True
    elif mutation == 'owner':
        row['owner'] = not row['owner']
    elif mutation == 'binding':
        body['email'][0] = 'foreign@example.invalid'
    elif mutation == 'replay':
        guard.check(row, body)
    with pytest.raises(ValueError):
        guard.check(row, body)


@pytest.mark.parametrize('status,body', [(True, {}), (200, {}), (400, {'error': {}}), (503, {'error': {'message': 'UNAVAILABLE'}}), (503, {'localId': 'owned'})])
def test_judge_never_accepts_untyped_or_unknown_answers(status, body):
    row = {'kind': 'diagnostic', 'required': ['localId'], 'refusals': ['USER_DISABLED']}
    assert edges.judge(row, status, body)['classification'] == 'INDETERMINATE'


def test_pict_generated_matrix_runs_the_whole_stage(tmp_path):
    import csv
    table = HERE.parents[2] / 'target/codex-out/auth-edges/edges.tsv'
    assert table.is_file(), 'Generate the packet PICT table before this test'
    with table.open() as stream:
        rows = list(csv.DictReader(stream, delimiter='\t'))
    assert rows
    for index, row in enumerate(rows):
        world, result = run(tmp_path / str(index), family=row['Family'], answer=row['Answer'], fault=None if row['Fault'] == 'none' else row['Fault'])
        if row['Fault'] in ('before-create', 'after-create', 'delete', 'absence'):
            assert not result['cleanupComplete'], row
        else:
            assert result['cleanupComplete'], row
            assert not world.accounts, row
        if row['Answer'] == 'unknown' or row['Fault'] != 'none':
            assert result['classification'] == 'INDETERMINATE', row


def test_unknown_success_shape_does_not_skip_its_readback(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'totp-start':
            return 200, {'unexpected': 'must-not-be-recorded'}
        return world.send_stage(row, body)
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert result['cleanupComplete']
    assert result['classification'] == 'INDETERMINATE'
    assert 'totp-start-readback' in world.sent
    assert 'totp-finalize' not in world.sent
    assert 'totp-reuse' not in world.sent
    assert 'must-not-be-recorded' not in json.dumps(result)


def test_foreign_readback_stops_before_next_mutation(tmp_path):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'] == 'create-unverified-readback':
            answer['users'][0]['email'] = 'foreign@example.invalid'
        return status, answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert not result['recordingComplete']
    assert 'create-verified' not in world.sent
    assert result['cleanupComplete']


@pytest.mark.parametrize('origin', ['https://127.0.0.1:1', 'http://example.invalid', 'http://127.0.0.1:1/path', 'http://owner@127.0.0.1:1', 'http://127.0.0.1:1?redirect=yes'])
def test_local_transport_rejects_non_loopback_origins_before_io(origin):
    with pytest.raises(edges.CollectorError):
        edges.local_send(origin)


@pytest.mark.parametrize('field,value', [('periodSec', 0), ('verificationCodeLength', 5), ('hashingAlgorithm', 'UNKNOWN')])
def test_invalid_totp_parameters_are_unknown_before_readback(tmp_path, field, value):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'] == 'totp-start':
            answer['totpSessionInfo'][field] = value
        return status, answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert 'totp-start-readback' in world.sent
    assert 'totp-finalize' not in world.sent
    assert result['cleanupComplete']
    assert result['classification'] == 'INDETERMINATE'


def test_diagnostic_transport_failure_preserves_readback_before_cleanup(tmp_path):
    world, result = run(tmp_path, fault='after-diagnostic')
    diagnostic = world.sent.index('issue-unverified')
    assert world.sent[diagnostic + 1] == 'issue-unverified-readback'
    assert result['cleanupComplete']
    assert result['classification'] == 'INDETERMINATE'


def test_readback_projection_records_email_role_and_masks_malformed_values(tmp_path):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'] == 'admin-email-change-readback':
            answer['users'][0]['disabled'] = 'must-not-persist'
            answer['users'][0]['providerUserInfo'] = None
        return status, answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    row = next(r for r in result['stages'] if r['id'] == 'admin-email-change-readback')
    assert row['users'][0]['emailRole'] == 'sessionAlias'
    assert row['users'][0]['disabled'] is None
    assert 'must-not-persist' not in json.dumps(result)
    assert result['cleanupComplete']


def test_owned_addresses_are_canonical_for_email_readback():
    plan = edges.manifest(NONCE)
    assert all(a['email'] == a['email'].lower() for a in plan['ownedAccounts'].values())
    row = plan['stages'][0]
    assert edges.judge(row, 200, {'kind': 'identitytoolkit#GetAccountInfoResponse'})['classification'] == 'OBSERVED'
    assert edges.judge(row, 200, {})['classification'] == 'INDETERMINATE'


def test_scrypt_rejection_cannot_pass_with_the_original_password(tmp_path):
    _, result = run(tmp_path)
    rows = {r['id']: r for r in result['stages']}
    assert rows['scrypt-import-0']['errorCode'] == 'INVALID_HASH_PARALLELIZATION'
    assert rows['scrypt-login-0']['status'] == 400
    for p in (1, 4, 5, 16):
        assert rows['scrypt-login-' + str(p)]['status'] == 200


def test_totp_sha1_wire_spelling_runs_finalize_and_reuse(tmp_path):
    world, result = run(tmp_path)
    assert 'totp-finalize' in world.sent and 'totp-reuse' in world.sent
    row = next(r for r in result['stages'] if r['id'] == 'totp-start')
    assert row['totpParameters']['hashingAlgorithm'] == 'SHA1'
    assert result['cleanupComplete']


def test_expired_observation_budget_keeps_cleanup_reserve(tmp_path):
    world = World()
    now = [0.0]
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'] == 'link-unverified':
            now[0] = 301.0
        return answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None, clock=lambda: now[0])
    assert not result['recordingComplete']
    assert result['cleanupComplete']
    assert not world.accounts
    assert result['requests'] + result['recoveryRequests'] < 200


def test_lost_email_change_acknowledgement_uses_both_cleanup_addresses(tmp_path):
    world = World()
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'] == 'admin-email-change':
            raise TimeoutError('acknowledgement lost after mutation')
        return answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert not result['recordingComplete']
    assert 'admin-email-change-readback' in world.sent
    assert result['cleanupComplete']
    assert not world.accounts


def test_disabled_totp_returns_to_readback_without_project_changes(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'totp-start':
            return 400, {'error': {'message': 'OPERATION_NOT_ALLOWED'}}
        return world.send_stage(row, body)
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert 'totp-start-readback' in world.sent
    assert 'totp-finalize' not in world.sent
    assert result['recordingComplete']
    assert result['cleanupComplete']
    assert result['classification'] == 'INDETERMINATE'


def test_manifest_uses_recorded_toggle_and_authorized_host():
    plan = edges.manifest(NONCE)
    rows = {r['id']: r for r in plan['stages'] + plan['recovery']}
    assert rows['config-baseline']['method'] == 'GET'
    for identifier, value in [('email-link-enable', False), ('recover-config-restore', True)]:
        row = rows[identifier]
        assert row['method'] == 'PATCH'
        assert row['path'] == f'/identitytoolkit.googleapis.com/admin/v2/projects/{edges.PROJECT}/config?updateMask=signIn.email.passwordRequired'
        assert row['body'] == {'signIn': {'email': {'passwordRequired': value}}}
    assert sum(r['id'].startswith('email-link-readback-') for r in plan['stages']) == 30
    assert sum(r['id'].startswith('recover-config-readback-') for r in plan['recovery']) == 30
    for identifier in ('issue-unverified', 'issue-verified', 'issue-disabled', 'continue-javascript', 'continue-backslash'):
        assert edges.PROJECT + '.firebaseapp.com' in rows[identifier]['body']['continueUrl']
        assert 'localhost' not in rows[identifier]['body']['continueUrl']
    assert plan['budget']['totalRequests'] < 200


def test_lost_later_signup_does_not_hold_confirmed_accounts(tmp_path):
    world = World()
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'] == 'create-disabled':
            raise TimeoutError('lost acknowledgement')
        return answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert 'recover-delete-unverified' in world.sent
    assert 'recover-delete-verified' in world.sent
    assert 'recover-delete-disabled' not in world.sent
    assert len(world.accounts) == 1
    assert not result['cleanupComplete']
    events = [json.loads(line) for line in (tmp_path / 'run/ownership.jsonl').read_text().splitlines()]
    assert any(e['kind'] == 'recovery-required' for e in events)


def test_batch_import_records_leading_per_user_code_without_prose(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'scrypt-import-1':
            return 200, {'error': [{'index': 0, 'message': 'INVALID_EMAIL : private-prose'}, {'index': 1, 'message': 'INVALID_HASH_PARAMETER: private-prose'}]}
        return world.send_stage(row, body)
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    row = next(r for r in result['stages'] if r['id'] == 'scrypt-import-1')
    assert row['importResult']['error'] == [{'index': 0, 'message': 'INVALID_EMAIL'}, {'index': 1, 'message': 'INVALID_HASH_PARAMETER'}]
    assert row['classification'] == 'OBSERVED'
    assert 'private-prose' not in json.dumps(result)
    assert 'INVALID_HASH_PARAMETER' in edges.REFUSALS


@pytest.mark.parametrize('fault', ['none', 'email-link-enable', 'email-link-readback-0', 'create-verified', 'link-unverified', 'recover-delete-unverified'])
def test_toggle_restored_after_success_loss_and_interrupt(tmp_path, fault):
    world = World()
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'] == fault:
            raise KeyboardInterrupt('fixture interrupt')
        return answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert world.config['signIn']['email']['passwordRequired'] is True
    assert 'recover-config-restore' in world.sent
    assert 'recover-config-readback-0' in world.sent
    if fault == 'none':
        assert result['recordingComplete'] and result['cleanupComplete']
        assert world.sent.index('email-link-readback-0') < world.sent.index('issue-unverified')
    else:
        assert result['classification'] == 'INDETERMINATE'


@pytest.mark.parametrize('fault', ['enable-never-visible', 'restore-never-visible', 'restore-lost'])
def test_config_readback_is_bounded_and_cannot_claim_restore(tmp_path, fault):
    world = World()
    sleeps = []
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'].startswith('email-link-readback-') and fault == 'enable-never-visible':
            answer[1]['signIn']['email']['passwordRequired'] = True
        if row['id'].startswith('recover-config-readback-') and fault == 'restore-never-visible':
            answer[1]['signIn']['email']['passwordRequired'] = False
        if row['id'] == 'recover-config-restore' and fault == 'restore-lost':
            raise TimeoutError('lost restore acknowledgement')
        return answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=sleeps.append)
    if fault == 'enable-never-visible':
        assert 'email-link-readback-29' in world.sent
        assert 'create-unverified' not in world.sent
        assert result['cleanupComplete']
    else:
        assert not result['cleanupComplete']
        assert 'recover-config-readback-0' in world.sent
    if fault.endswith('never-visible'):
        assert sleeps.count(2) == 29
    assert result['classification'] == 'INDETERMINATE'


@pytest.mark.parametrize('fault', ['domain', 'password', 'mfa', 'enabled'])
def test_baseline_drift_stops_before_any_mutation(tmp_path, fault):
    world = World()
    if fault == 'domain':
        world.config['authorizedDomains'] = ['localhost']
    elif fault == 'password':
        world.config['signIn']['email']['passwordRequired'] = False
    elif fault == 'mfa':
        world.config['mfa']['state'] = 'ENABLED'
    else:
        world.config['signIn']['email']['enabled'] = False
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=world.send_stage, sleep=lambda _: None)
    assert 'email-link-enable' not in world.sent
    assert 'create-unverified' not in world.sent
    assert 'recover-config-restore' not in world.sent
    assert not result['recordingComplete']


def test_recorded_email_link_refusal_skips_only_dependent_family(tmp_path):
    recorded = json.loads((HERE.parents[2] / 'conformance/auth-action-production.json').read_text())
    refusal = recorded['programs']['auth-action/generate/admin']['steps']['sign-in-link-password-required']
    world = World()
    def send(row, body):
        if row['id'] == 'issue-unverified':
            world.sent.append(row['id'])
            return refusal['status'], refusal['body']
        return world.send_stage(row, body)
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert 'issue-unverified-readback' in world.sent
    assert 'link-unverified' not in world.sent
    assert 'link-verified' in world.sent and 'scrypt-import-16' in world.sent
    assert result['recordingComplete'] and result['cleanupComplete']


@pytest.mark.parametrize('kind_only', [True, False])
def test_recovery_typed_absence_adaptation(tmp_path, kind_only):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'].startswith('recover-') and answer.get('users') == []:
            answer = {'kind': 'identitytoolkit#GetAccountInfoResponse'} if kind_only else {}
        return status, answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert result['cleanupComplete'] is kind_only


def test_recovery_entry_replays_only_journaled_uids_and_config(tmp_path):
    world = World(fault='delete')
    first = edges.collect(nonce=NONCE, output=tmp_path / 'first', send=world.send_stage, sleep=lambda _: None)
    assert not first['cleanupComplete']
    world.fault = None
    world.sent.clear()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'recovery', send=world.send_stage, sleep=lambda _: None, recovery_journal=tmp_path / 'first/ownership.jsonl')
    assert result['cleanupComplete']
    assert not world.accounts
    assert all(identifier.startswith('recover-') for identifier in world.sent)
    assert 'recover-config-readback-0' in world.sent


def test_setup_refusal_stops_before_following_setup(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'verify-verified':
            return 400, {'error': {'message': 'OPERATION_NOT_ALLOWED'}}
        return world.send_stage(row, body)
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert 'verify-change' not in world.sent
    assert not result['recordingComplete'] and result['cleanupComplete']


@pytest.fixture
def http_wire(monkeypatch):
    """Use the real bounded worker against a joined, loopback-only HTTP server."""
    import http.server
    import threading
    import urllib.parse
    import transport
    seen = []
    response = {'status': 200, 'body': b'{}'}
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            seen.append((self.command, self.path, dict(self.headers), raw))
            self.send_response(response['status'])
            self.send_header('Content-Length', str(len(response['body'])))
            self.end_headers()
            self.wfile.write(response['body'])
        do_GET = do_POST
        do_PATCH = do_POST
    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    wire = transport.batch_adapter.wire
    def local_wire(url, method, body, headers, **options):
        assert options == {'timeout': 12, 'receipt': True}
        parsed = urllib.parse.urlsplit(url)
        assert parsed.scheme == 'https'
        return wire(f'http://127.0.0.1:{server.server_port}{parsed.path}' + ('?' + parsed.query if parsed.query else ''), method, body, headers, local=True, **options)
    monkeypatch.setattr(transport.batch_adapter, 'wire', local_wire)
    monkeypatch.setenv('AUTH_EDGES_ACCESS_TOKEN', 'fixture-owner-value')
    monkeypatch.setenv('AUTH_EDGES_BROWSER_API_KEY', 'fixture-browser+value')
    monkeypatch.setenv('PRODUCTION_ORACLE_API_KEY', 'wrong-generic-key')
    try:
        yield transport.production_send(), seen, response
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        assert not thread.is_alive()


def test_transport_headers_and_form_encoding_on_fake_http(http_wire, capsys):
    from urllib.parse import parse_qs, urlsplit
    send, seen, _ = http_wire
    rows = {r['id']: r for r in edges.manifest(NONCE)['stages']}
    for identifier, body in [('config-baseline', None), ('email-link-enable', {'signIn': {'email': {'passwordRequired': False}}}), ('create-unverified', {'email': 'fixture@example.invalid', 'password': 'fixture-pass'}), ('link-unverified-old-refresh', {'grant_type': 'refresh_token', 'refresh_token': 'fixture-refresh+/=& value'})]:
        assert send(rows[identifier], body) == (200, {})
    for method, path, headers, raw in seen[:2]:
        headers = {k.lower(): v for k, v in headers.items()}
        assert headers['authorization'] == 'Bearer fixture-owner-value'
        assert headers['x-goog-user-project'] == edges.PROJECT
        assert 'key=' not in path
    assert seen[0][0] == 'GET' and seen[0][3] == b''
    assert seen[1][0] == 'PATCH'
    assert parse_qs(urlsplit(seen[1][1]).query) == {'updateMask': ['signIn.email.passwordRequired']}
    for method, path, headers, raw in seen[2:]:
        assert 'authorization' not in {k.lower() for k in headers}
        assert parse_qs(urlsplit(path).query) == {'key': ['fixture-browser+value']}
    headers = {k.lower(): v for k, v in seen[-1][2].items()}
    assert headers['content-type'] == 'application/x-www-form-urlencoded'
    assert parse_qs(seen[-1][3].decode()) == {'grant_type': ['refresh_token'], 'refresh_token': ['fixture-refresh+/=& value']}
    assert json.loads(seen[2][3])['password'] == 'fixture-pass'
    assert capsys.readouterr() == ('', '')


@pytest.mark.parametrize('status', [401, 403])
def test_transport_latches_auth_failure_and_never_logs_secrets(http_wire, tmp_path, capsys, status):
    send, seen, response = http_wire
    response.update(status=status, body=b'{"error":{"message":"fixture-owner-value fixture-browser+value"}}')
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert len(seen) == 1
    assert not result['recordingComplete'] and not result['cleanupComplete']
    saved = ''.join(p.read_text() for p in (tmp_path / 'run').glob('*'))
    logs = ''.join(capsys.readouterr())
    for value in ('fixture-owner-value', 'fixture-browser+value', 'wrong-generic-key'):
        assert value not in saved + logs


def test_transport_non_json_unknown_and_host_refusal(http_wire):
    send, seen, response = http_wire
    response['body'] = b'not-json private response'
    row = edges.manifest(NONCE)['stages'][0]
    assert send(row, row['body']) == (200, None)
    assert len(seen) == 1
    for path in ('/example.invalid/v1/accounts:lookup', '/identitytoolkit.googleapis.com.evil.invalid/v1/accounts:lookup', edges.ADMIN + 'lookup?key=foreign', edges.CONFIG + '?updateMask=mfa'):
        with pytest.raises(ValueError):
            send({**row, 'path': path}, row['body'])
    assert len(seen) == 1


def test_launcher_selects_reviewed_transport(monkeypatch, tmp_path):
    import transport
    called = []
    sender = lambda row, body: (200, {})
    monkeypatch.setattr(transport, 'production_send', lambda: called.append('transport') or sender)
    def collect(**kwargs):
        assert kwargs['send'] is sender
        assert kwargs['production'] is True
        return dict(recordingComplete=True, cleanupComplete=True, classification='RECORDED', requests=0, recoveryRequests=0)
    monkeypatch.setattr(edges, 'collect', collect)
    monkeypatch.setattr(sys, 'argv', ['edges.py', '--production', '--nonce', NONCE, '--output', str(tmp_path / 'run')])
    import signal
    previous = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}
    try:
        assert edges.main() == 0
        assert called == ['transport']
    finally:
        for s, handler in previous.items():
            signal.signal(s, handler)


def test_signup_uid_survives_missing_session_fields(tmp_path):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'] == 'create-unverified':
            answer.pop('idToken')
        return status, answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert not result['recordingComplete']
    assert 'recover-delete-unverified' in world.sent
    assert result['cleanupComplete']
    assert not world.accounts


def test_recovery_deletes_confirmed_uids_even_when_discovery_is_unknown(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'recover-discover':
            return 200, {}
        return world.send_stage(row, body)
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert all('recover-delete-' + role in world.sent for role in edges.ROLES)
    assert not world.accounts
    assert not result['cleanupComplete']


def test_rehearsal_child_prepares_recorded_baseline(monkeypatch, tmp_path):
    import rehearse
    monkeypatch.setattr(sys, 'argv', ['rehearse.py', '--child', str(tmp_path / 'child'), '--project', edges.PROJECT, '--nonce', NONCE])
    monkeypatch.setenv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:1234')
    calls = []
    monkeypatch.setattr(edges, 'local_send', lambda origin: lambda row, body: calls.append((row, body)) or (200, {}))
    monkeypatch.setattr(edges, 'collect', lambda **kwargs: {'recordingComplete': True, 'cleanupComplete': True})
    assert rehearse.main() == 0
    row, body = calls[0]
    assert row['method'] == 'PATCH'
    assert row['path'] == edges.CONFIG + '?updateMask=signIn.email.enabled,signIn.email.passwordRequired,authorizedDomains,mfa'
    assert body == {'signIn': {'email': {'enabled': True, 'passwordRequired': True}}, 'authorizedDomains': [edges.DOMAIN], 'mfa': {'state': 'DISABLED'}}


def test_rehearsal_child_refuses_failed_baseline(monkeypatch, tmp_path):
    import rehearse
    monkeypatch.setattr(sys, 'argv', ['rehearse.py', '--child', str(tmp_path / 'child'), '--project', edges.PROJECT, '--nonce', NONCE])
    monkeypatch.setenv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:1234')
    monkeypatch.setattr(edges, 'local_send', lambda origin: lambda row, body: (400, {}))
    monkeypatch.setattr(edges, 'collect', lambda **kwargs: pytest.fail('stage must not run'))
    with pytest.raises(ValueError, match='baseline preparation failed'):
        rehearse.main()


@pytest.mark.parametrize('spelling', ['missing', None, False])
def test_recorded_false_config_readback_spelling(tmp_path, spelling):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'].startswith('email-link-readback-'):
            if spelling == 'missing':
                answer['signIn']['email'].pop('passwordRequired')
            else:
                answer['signIn']['email']['passwordRequired'] = spelling
        return status, answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert result['recordingComplete'] and result['cleanupComplete']
    assert 'email-link-readback-1' not in world.sent


@pytest.mark.parametrize('answer', [{}, {'localId': ''}, {'localId': 42}])
def test_unknown_setup_success_stops_before_next_mutation(tmp_path, answer):
    world = World()
    def send(row, body):
        if row['id'] == 'verify-verified':
            return 200, answer
        return world.send_stage(row, body)
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert 'verify-change' not in world.sent
    assert not result['recordingComplete'] and result['cleanupComplete']


def test_uid_absence_cannot_be_replaced_by_email_absence(tmp_path):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'] == 'recover-uid-absence-unverified':
            answer = {'kind': 'identitytoolkit#GetAccountInfoResponse', 'users': [{'localId': body['localId'][0]}]}
        return status, answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    assert not result['cleanupComplete']
    assert result['absenceProven']


@pytest.mark.parametrize('complete,kind', [(False, 'json'), (True, 'non-json')])
def test_transport_incomplete_worker_body_is_unknown(monkeypatch, complete, kind):
    import transport
    monkeypatch.setenv('AUTH_EDGES_ACCESS_TOKEN', 'fixture-owner')
    monkeypatch.setenv('AUTH_EDGES_BROWSER_API_KEY', 'fixture-browser')
    monkeypatch.setattr(transport.batch_adapter, 'wire', lambda *args, **kwargs: {'http': {'status': 200, 'complete': complete, 'bodyKind': kind}, 'body': {'localId': 'untrusted'}})
    row = edges.manifest(NONCE)['stages'][0]
    assert transport.production_send()(row, row['body']) == (200, None)


def test_recovery_after_lost_delete_does_not_redelete_absent_accounts(tmp_path):
    world = World()
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'] == 'recover-delete-unverified':
            raise TimeoutError('lost delete acknowledgement')
        return answer
    first = edges.collect(nonce=NONCE, output=tmp_path / 'first', send=send, sleep=lambda _: None)
    assert not first['cleanupComplete'] and not world.accounts
    world.sent.clear()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'recovery', send=world.send_stage, sleep=lambda _: None, recovery_journal=tmp_path / 'first/ownership.jsonl')
    assert result['cleanupComplete']
    assert not any(i.startswith('recover-delete-') for i in world.sent)
    assert all('recover-uid-absence-' + role in world.sent for role in edges.ROLES)


def test_recorded_lowercase_import_messages_do_not_invent_codes(tmp_path):
    recorded = json.loads((HERE.parents[2] / 'conformance/auth-account-production.json').read_text())
    answer = recorded['programs']['auth-account/admin/import']['steps']['import-mixed-valid-and-invalid']
    world = World()
    def send(row, body):
        if row['id'] == 'scrypt-import-1':
            return answer['status'], answer['body']
        return world.send_stage(row, body)
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None)
    row = next(r for r in result['stages'] if r['id'] == 'scrypt-import-1')
    assert row['importErrorCount'] == 3
    assert row['importResult']['error'] == [{'index': i, 'message': 'UNRECOGNIZED'} for i in (1, 2, 3)]


def test_recovery_journal_restores_an_unresolved_toggle(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'recover-config-restore':
            raise TimeoutError('restore never reached server')
        return world.send_stage(row, body)
    first = edges.collect(nonce=NONCE, output=tmp_path / 'first', send=send, sleep=lambda _: None)
    assert not first['cleanupComplete']
    assert world.config['signIn']['email']['passwordRequired'] is False
    world.sent.clear()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'recovery', send=world.send_stage, sleep=lambda _: None, recovery_journal=tmp_path / 'first/ownership.jsonl')
    assert result['cleanupComplete']
    assert 'recover-config-restore' in world.sent
    assert world.config['signIn']['email']['passwordRequired'] is True


def test_slow_account_cleanup_cannot_spend_config_restore_reserve(tmp_path):
    world = World()
    now = [0.0]
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'].startswith('recover-'):
            now[0] += 11.5
        return answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=lambda _: None, clock=lambda: now[0])
    assert 'recover-config-restore' in world.sent
    assert 'recover-config-readback-0' in world.sent
    assert world.config['signIn']['email']['passwordRequired'] is True
    assert not result['cleanupComplete']
    assert now[0] < result['requestBudget']['recoverySeconds']


@pytest.mark.parametrize('mfa', [None, {}, {'state': 'DISABLED'}, {'state': 'DISABLED', 'providerConfigs': [{'state': 'ENABLED'}]}])
def test_baseline_uses_recorded_mfa_disabled_predicate(tmp_path, mfa):
    world = World()
    world.config['mfa'] = mfa
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=world.send_stage, sleep=lambda _: None)
    enabled_provider = isinstance(mfa, dict) and bool(mfa.get('providerConfigs'))
    assert result['recordingComplete'] is not enabled_provider
    assert ('email-link-enable' in world.sent) is not enabled_provider


def test_rehearsal_supervisor_covers_all_phase_budgets(monkeypatch, tmp_path):
    import rehearse
    monkeypatch.setattr(sys, 'argv', ['rehearse.py', '--project', edges.PROJECT, '--nonce', NONCE, '--artifact', str(tmp_path / 'artifact'), '--output', str(tmp_path / 'output')])
    def supervisor(*args, **kwargs):
        budget = edges.manifest(NONCE)['budget']
        assert kwargs['timeout'] >= budget['wallSeconds'] + budget['recoverySeconds'] + 30
        return {'status': 'shadow-complete'}
    monkeypatch.setattr(rehearse.shadow, 'run', supervisor)
    assert rehearse.main() == 0
