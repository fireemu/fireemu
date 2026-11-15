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
        route = row['path'].rsplit(':', 1)[-1]
        if route in ('start', 'finalize'):
            if route == 'start':
                return 200, {'totpSessionInfo': {'sessionInfo': 'session-fixture', 'sharedSecretKey': 'JBSWY3DPEHPK3PXP', 'periodSec': 30, 'verificationCodeLength': 6, 'hashingAlgorithm': 'SHA1'}}
            return 200, {'idToken': body['idToken'], 'refreshToken': 'fixture-refresh'}
        if row['path'].endswith('/token'):
            uid = body['refresh_token'].removeprefix('refresh-token-')
            return 200, {'id_token': 'id-token-' + uid, 'refresh_token': body['refresh_token'], 'user_id': uid}
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
    assert result['cleanupComplete'] is (fault in ('before-create', 'after-diagnostic'))
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
        if row['Fault'] in ('after-create', 'delete', 'absence'):
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
    diagnostic = world.sent.index('link-unverified')
    assert world.sent[diagnostic + 1] == 'link-unverified-readback'
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
