"""Offline acceptance tests for the bounded AUTH-EDGES v3 stage."""
from __future__ import annotations

import base64
import copy
import json
import random
import re
import sys
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / 'auth-totp-enroll'))
import edges
from mfa_totp import TotpParameters, totp_code

NONCE = '0123456789abcdef' * 2
PARAMETERS = TotpParameters(30, 6, 'HMAC_SHA1')
SECRET = 'JBSWY3DPEHPK3PXP'


class Clock:
    def __init__(self, overshoot=0.0):
        self.now = 1000.0
        self.overshoot = overshoot

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        # a machine that wakes late: only the long planned waits are stretched
        self.now += seconds + (self.overshoot if seconds >= 1 and seconds != 2 else 0.0)


class World:
    """A small Identity Toolkit that answers the shapes the stage sends; no network, no secrets."""

    def __init__(self, clock=None, *, fault=None, pending_ttl=300, quota_after=5, below_scalar='ignore', reset_target='issue', mfa_start_status=200, admin_duplicates=True, after=None, precedence='refuse'):
        self.clock = clock or Clock()
        self.fault, self.pending_ttl, self.quota_after = fault, pending_ttl, quota_after
        self.below_scalar, self.reset_target, self.mfa_start_status, self.admin_duplicates = below_scalar, reset_target, mfa_start_status, admin_duplicates
        self.after = after or {}
        self.precedence = precedence
        self.accounts, self.codes, self.pendings, self.sessions, self.wrong, self.tokens = {}, {}, {}, {}, {}, {}
        self.sent, self.bodies, self.seq = [], {}, 0
        self.config = {'signIn': {'email': {'enabled': True, 'passwordRequired': True}, 'phoneNumber': {'enabled': True, 'testPhoneNumbers': {n: edges.TEST_PHONE_CODE for n in edges.TEST_PHONES}}}, 'authorizedDomains': [edges.DOMAIN], 'mfa': {'state': 'DISABLED'}, 'notification': {'defaultLocale': 'en'}}

    # -- helpers --------------------------------------------------------------------------
    def uid(self):
        self.seq += 1
        return f'uid{self.seq:04d}'

    def user(self, a):
        out = {'localId': a['localId'], 'emailVerified': a.get('emailVerified', False), 'passwordUpdatedAt': a['pua'], 'validSince': str(a['pua'])}
        if a.get('email'):
            out['email'] = a['email']
        if a.get('disabled'):
            out['disabled'] = True
        if a.get('password'):
            out['passwordHash'] = 'hash'
            out['providerUserInfo'] = [{'providerId': 'password'}]
        if a.get('mfa'):
            out['mfaInfo'] = copy.deepcopy(a['mfa'])
        return out

    def new(self, email=None, password=None, uid=None):
        if email and not self.config['signIn'].get('allowDuplicateEmails') and any(a.get('email') == email for a in self.accounts.values()):
            return None
        a = {'localId': uid or self.uid(), 'email': email, 'password': password, 'pua': 1000 + self.seq}
        self.accounts[a['localId']] = a
        return a

    def tokens_for(self, a):
        self.tokens['id-' + a['localId']] = self.clock()
        return {'localId': a['localId'], 'idToken': 'id-' + a['localId'], 'refreshToken': 'rt-' + a['localId']}

    def err(self, message, status=400):
        return status, {'error': {'code': status, 'message': message}}

    def token_owner(self, token):
        uid = token.removeprefix('id-') if isinstance(token, str) else None
        return self.accounts.get(uid)

    # -- dispatch -------------------------------------------------------------------------
    def send_stage(self, row, body):
        self.sent.append(row['id'])
        self.bodies[row['id']] = copy.deepcopy(body)
        if self.fault == 'before-create' and row['kind'] == 'create':
            raise TimeoutError('fixture failure')
        if self.fault == 'delete' and row['kind'] == 'delete':
            return self.err('UNAVAILABLE', 503)
        if self.fault == 'silent-delete' and row['kind'] == 'delete':
            return 200, {}
        if self.fault == 'absence' and row['id'] == 'recover-absence':
            return 200, {}
        if self.fault == row['id']:
            raise TimeoutError('fixture failure')
        result = self.route(row, body)
        if row['id'] in self.after:
            self.after[row['id']](self)
        if self.fault == 'after-create' and row['kind'] == 'create':
            raise TimeoutError('lost acknowledgement')
        if self.fault == 'after-' + row['id']:
            raise TimeoutError('lost acknowledgement')
        return result

    def route(self, row, body):
        path = row['path']
        if path.startswith(edges.CONFIG):
            return self.config_route(row, body)
        if path == edges.TOKEN:
            uid = body['refresh_token'].removeprefix('rt-')
            return (200, {'id_token': 'id-' + uid, 'refresh_token': body['refresh_token'], 'user_id': uid}) if uid in self.accounts else self.err('INVALID_REFRESH_TOKEN')
        route = path.rsplit(':', 1)[-1] if path != edges.ADMIN_CREATE else 'create'
        if path.startswith(edges.MFA_V2):
            return self.mfa_route(path.removeprefix(edges.MFA_V2), body)
        if route == 'create':
            if not self.admin_duplicates and any(a.get('email') == body['email'].lower() for a in self.accounts.values()):
                return self.err('EMAIL_EXISTS')
            a = self.new(body['email'].lower())
            return (200, {'localId': a['localId'], 'email': a['email']}) if a else self.err('EMAIL_EXISTS')
        if route == 'signUp':
            a = self.new(body['email'].lower(), body['password'])
            return (200, {**self.tokens_for(a), 'email': a['email']}) if a else self.err('EMAIL_EXISTS')
        if route == 'lookup':
            if 'email' in body:
                users = [a for a in self.accounts.values() if a.get('email') in body['email']]
            else:
                users = [self.accounts[u] for u in body['localId'] if u in self.accounts]
            return 200, {'kind': 'identitytoolkit#GetAccountInfoResponse', 'users': [self.user(a) for a in users]} if users else {'kind': 'identitytoolkit#GetAccountInfoResponse'}
        if route == 'delete':
            return (200, {}) if self.accounts.pop(body['localId'], None) else self.err('USER_NOT_FOUND')
        if route == 'update' and 'localId' in body:
            a = self.accounts[body['localId']]
            for key, field in (('email', 'email'), ('password', 'password'), ('emailVerified', 'emailVerified')):
                if key in body:
                    a[field] = body[key].lower() if key == 'email' else body[key]
            if 'disableUser' in body:
                a['disabled'] = body['disableUser']
            if 'password' in body:
                a['pua'] += 7
            if 'mfa' in body:
                a['mfa'] = [{'mfaEnrollmentId': f'e{len(a.get("mfa") or [])}', **e} for e in body['mfa']['enrollments']]
            return 200, {'localId': a['localId']}
        if route == 'sendOobCode':
            return self.oob(row, body)
        if route == 'resetPassword':
            record = self.codes.get(body['oobCode'])
            if not record:
                return self.err('INVALID_OOB_CODE')
            a = self.accounts[record['uid']]
            if self.reset_target == 'holder':
                a = next(x for x in self.accounts.values() if x.get('email') == record['email'])
            a['password'], a['pua'] = body['newPassword'], a['pua'] + 7
            return 200, {'email': record['email'], 'requestType': 'PASSWORD_RESET'}
        if route == 'signInWithPassword':
            a = next((x for x in self.accounts.values() if x.get('email') == body['email'] and x.get('password') == body['password']), None)
            if not a:
                return self.err('INVALID_LOGIN_CREDENTIALS')
            if a.get('mfa'):
                self.seq += 1
                self.pendings[f'pend{self.seq}'] = (a['localId'], self.clock())
                return 200, {'mfaPendingCredential': f'pend{self.seq}', 'mfaInfo': [{'mfaEnrollmentId': a['mfa'][0]['mfaEnrollmentId']}]}
            return 200, self.tokens_for(a)
        return self.err('UNKNOWN_ROUTE')

    def oob(self, row, body):
        email = body['email']
        holders = [a for a in self.accounts.values() if a.get('email') == email]
        if body['requestType'] == 'EMAIL_SIGNIN' and self.config['signIn']['email']['passwordRequired'] is not False and self.config['signIn']['email'].get('passwordRequired') is not None:
            return self.err('OPERATION_NOT_ALLOWED')
        url = body.get('continueUrl')
        if holders and url:
            if url.startswith('/'):
                return self.err('INVALID_CONTINUE_URI')
            if edges.DOMAIN not in url:
                return self.err('UNAUTHORIZED_DOMAIN')
        if row['owner']:
            if not holders:
                return self.err('EMAIL_NOT_FOUND')
            code = f'oob{len(self.codes) + 1}'
            self.codes[code] = {'uid': holders[0]['localId'], 'email': email}
            return 200, {'email': email, 'oobCode': code, 'oobLink': 'https://x/' + code}
        return 200, {'email': email}

    def mfa_route(self, route, body):
        a = self.token_owner(body.get('idToken'))
        if self.config['mfa']['state'] != 'ENABLED':
            return self.err('OPERATION_NOT_ALLOWED')
        if route == 'mfaEnrollment:start':
            if self.mfa_start_status != 200:
                return self.err('OPERATION_NOT_ALLOWED', self.mfa_start_status)
            if self.clock() - self.tokens.get(body.get('idToken'), 0) > 333 and 'phoneEnrollmentInfo' in body:
                return self.err('REQUIRES_RECENT_LOGIN')
            if not a:
                return self.err('INVALID_ID_TOKEN')
            self.seq += 1
            if 'totpEnrollmentInfo' in body:
                self.sessions[f'tot{self.seq}'] = {'uid': a['localId'], 'done': False, 'kind': 'totp'}
                return 200, {'totpSessionInfo': {'sessionInfo': f'tot{self.seq}', 'sharedSecretKey': SECRET, 'periodSec': 30, 'verificationCodeLength': 6, 'hashingAlgorithm': 'SHA1'}}
            self.sessions[f'ph{self.seq}'] = {'uid': a['localId'], 'done': False, 'kind': 'phone'}
            return 200, {'phoneSessionInfo': {'sessionInfo': f'ph{self.seq}'}}
        if route == 'mfaEnrollment:finalize':
            if not a:
                return self.err('INVALID_ID_TOKEN')
            info = body.get('totpVerificationInfo') or body['phoneVerificationInfo']
            session = self.sessions.get(info['sessionInfo'])
            if not session:
                return self.err('INVALID_SESSION_INFO')
            if session['done']:
                return self.err('MFA_ENROLLMENT_ALREADY_COMPLETE')
            if self.clock() - self.tokens[body['idToken']] > 333:
                return self.err('REQUIRES_RECENT_LOGIN')
            if 'totpVerificationInfo' in body:
                if not any(totp_code(SECRET, int(time.time()) + k * 30, PARAMETERS) == info['verificationCode'] for k in range(-5, 6)):
                    return self.err('INVALID_CODE')
                a.setdefault('mfa', []).append({'mfaEnrollmentId': f'e{len(a.get("mfa") or [])}', 'totpInfo': {}})
            else:
                if info['code'] != edges.TEST_PHONE_CODE:
                    return self.err('INVALID_CODE')
                a.setdefault('mfa', []).append({'mfaEnrollmentId': f'e{len(a.get("mfa") or [])}', 'phoneInfo': '+1650555****'})
            session['done'] = True
            return 200, self.tokens_for(a)
        pending = self.pendings.get(body.get('mfaPendingCredential'))
        if not pending or self.clock() - pending[1] >= self.pending_ttl:
            return self.err('INVALID_MFA_PENDING_CREDENTIAL : MFA pending credential is expired.')
        uid = pending[0]
        right = any(totp_code(SECRET, int(time.time()) + k * 30, PARAMETERS) == body['totpVerificationInfo']['verificationCode'] for k in range(-5, 6))
        if self.wrong.get(uid, 0) >= self.quota_after:
            return self.err('QUOTA_EXCEEDED : Exceeded quota.')
        if not right:
            self.wrong[uid] = self.wrong.get(uid, 0) + 1
            return self.err('INVALID_CODE')
        return 200, self.tokens_for(self.accounts[uid])

    def config_route(self, row, body):
        config = self.config
        if row['method'] == 'GET':
            return 200, copy.deepcopy(config)
        mask = row['path'].split('updateMask=')[1]
        if mask == 'signIn.email.passwordRequired':
            config['signIn']['email'].update(body['signIn']['email'])
            if config['signIn']['email']['passwordRequired'] is False:
                del config['signIn']['email']['passwordRequired']
                config['signIn']['email']['passwordRequired'] = None
        elif mask == 'signIn.allowDuplicateEmails':
            if body['signIn']['allowDuplicateEmails'] is False:
                if len({a.get('email') for a in self.accounts.values() if a.get('email')}) != len([a for a in self.accounts.values() if a.get('email')]):
                    return self.err('DUPLICATE_ACCOUNTS_EXIST')
                config['signIn'].pop('allowDuplicateEmails', None)
            else:
                config['signIn']['allowDuplicateEmails'] = True
        elif mask in ('mfa', 'mfa.state'):
            value = body['mfa']
            if value['state'] not in ('DISABLED', 'ENABLED', 2):
                return self.err('INVALID_ARGUMENT', 400)
            if mask == 'mfa':
                config['mfa'] = {**value, 'state': 'ENABLED' if value['state'] in ('ENABLED', 2) else value['state']}
                for p in config['mfa'].get('providerConfigs', []):
                    p['totpProviderConfig']['adjacentIntervals'] = int(p['totpProviderConfig']['adjacentIntervals'])
            else:
                config['mfa']['state'] = value['state']
        elif mask == 'mfa.state,mobileLinksConfig.domain' and self.precedence == 'apply':
            config['mobileLinksConfig'] = {'domain': 'CUSTOM_DOMAIN'}
        elif mask == 'notification.defaultLocale.a':
            if self.below_scalar == 'apply':
                config['notification']['defaultLocale'] = 'zz'
            return self.err('INVALID_ARGUMENT') if self.below_scalar == 'refuse' else (200, copy.deepcopy(config))
        else:
            return self.err('INVALID_ARGUMENT')
        return 200, copy.deepcopy(config)


def run(tmp_path, world=None, clock=None, **options):
    world = world or World(clock)
    clock = world.clock
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=world.send_stage, sleep=clock.sleep, clock=clock, **options)
    return world, result


def stage(result, identifier):
    return next(r for r in result['stages'] if r['id'] == identifier)


# ---- the manifest ---------------------------------------------------------------------------

def test_manifest_is_frozen_unique_and_bounded():
    plan = edges.manifest(NONCE)
    ids = [r['id'] for r in plan['stages']]
    assert len(ids) == len(set(ids))
    assert plan['budget']['totalRequests'] < 400
    assert edges.manifest(NONCE) == plan
    assert edges.manifest('f' * 32) != plan
    assert set(edges.FAMILIES) <= {r['family'] for r in plan['stages']}
    with pytest.raises(ValueError):
        edges.manifest('not-hex')


def test_manifest_binds_every_placeholder_before_use():
    plan = edges.manifest(NONCE)
    known = {f'{role}.password' for role in edges.ROLES} | {'dup.newPassword1', 'dup.newPassword2'}
    known |= {f'{role}.email' for role in edges.ROLES}

    def refs(value):
        if isinstance(value, str) and value.startswith('$binding:'):
            yield value.removeprefix('$binding:')
        elif isinstance(value, dict):
            for item in value.values():
                yield from refs(item)
        elif isinstance(value, list):
            for item in value:
                yield from refs(item)

    for row in plan['stages']:
        if row['id'] == 'mask-below-scalar':
            known.add('config.defaultLocale')
        for op in row['pre']:
            known.add(op['out'])
        # computed codes need the TOTP secret the role's own start returned
        for name in refs(row['body']):
            assert name in known, (row['id'], name)
        known |= set(row['binds'])
        if row['kind'] == 'create':
            known.add(row['account'] + '.localId')
    for row in plan['recovery']:
        for name in refs(row['body']):
            assert name in known or name.endswith('.localId'), (row['id'], name)


def test_manifest_waits_reference_earlier_marked_rows():
    plan = edges.manifest(NONCE)
    marked = set()
    for row in plan['stages']:
        if row['wait']:
            assert row['wait']['after'] in marked, row['id']
            assert 0 < row['wait']['seconds'] <= 400
        if row['mark'] or row['wait']:
            marked.add(row['id'])
        if row['since']:
            assert row['since'] in marked, row['id']
    waits = {r['id']: r['wait'] for r in plan['stages'] if r['wait']}
    assert [waits[f'w-probe-{i}']['seconds'] for i in range(4)] == [296, 298, 300, 302]
    assert waits['p-start-aged']['seconds'] >= 345


def test_every_frozen_row_fits_the_reviewed_transport_shapes():
    import transport
    plan = edges.manifest(NONCE)
    for row in [*plan['stages'], *plan['recovery']]:
        body = copy.deepcopy(row['body'])
        assert transport.shape_ok(row['path'], row.get('method', 'POST'), row['owner'], body), row['id']
        host = row['path'].split('/')[1]
        assert host in transport.HOSTS
        assert row['owner'] or row['path'] in transport.CLIENT_ROUTES or row['path'] == edges.TOKEN


def test_only_toggles_probes_and_owned_accounts_are_mutated():
    plan = edges.manifest(NONCE)
    writes = [r for r in plan['stages'] if r.get('method') == 'PATCH']
    assert {r['id'] for r in writes if r['kind'] == 'config'} == {t + '-enable' for t in edges.TOGGLES}
    assert {r['kind'] for r in writes} == {'config', 'probe'}
    for row in plan['stages']:
        if row['owner'] and row['path'] in (edges.ADMIN + 'update', edges.ADMIN + 'delete') and isinstance(row['body'], dict):
            assert str(row['body']['localId']).startswith('$binding:'), row['id']
    for row in plan['recovery']:
        if row['kind'] == 'delete':
            assert row['body']['localId'].startswith('$binding:')


def test_addresses_are_example_invalid_and_duplicates_share_one_address():
    plan = edges.manifest(NONCE)
    assert all(a.endswith('@example.invalid') and NONCE in a for a in plan['addresses'])
    assert plan['ownedAccounts']['dupC']['email'] == plan['ownedAccounts']['dupD']['email']


def test_no_credential_rows_no_signing_route_and_no_premade_uid():
    plan = edges.manifest(NONCE)
    assert plan['contract'] == 'auth-edges-v3.2'
    assert 'cred' not in plan['ownedAccounts'] and 'cred' not in edges.ROLES
    ids = [r['id'] for r in plan['stages']]
    assert not [i for i in ids if i.startswith(('sign-', 'cred-'))]
    assert not [r for r in plan['stages'] if r['kind'] == 'sign' or 'premint' in r]
    assert not any('iamcredentials' in r['path'] for r in [*plan['stages'], *plan['recovery']])
    assert not any(f.startswith('cred-') for f in edges.FAMILIES)
    assert not hasattr(edges, 'SIGN_JWT') and not hasattr(edges, 'SIGNER')
    assert plan['budget']['observationRequests'] == len(ids) == 154
    assert plan['budget']['recoveryRequests'] == 55 and plan['budget']['totalRequests'] == 209


# ---- a whole stage --------------------------------------------------------------------------

def test_whole_stage_is_bounded_masked_restored_and_complete(tmp_path):
    clock = Clock()
    world, result = run(tmp_path, clock=clock)
    assert result['recordingComplete'] is True
    assert result['cleanupComplete'] is True
    assert not world.accounts
    assert world.config['mfa'] == {'state': 'DISABLED'}
    assert world.config['signIn']['email']['passwordRequired'] is True
    assert 'allowDuplicateEmails' not in world.config['signIn']
    assert world.config['notification'] == {'defaultLocale': 'en'}
    assert result['requests'] + result['recoveryRequests'] < 400
    saved = ''.join(p.read_text() for p in (tmp_path / 'run').glob('*'))
    for secret in ('id-uid', 'rt-uid', SECRET, 'pend1', 'oob1', 'e30.', 'Aa9!', 'Cc7!'):
        assert secret not in saved, secret
    assert result['productionExecuted'] is False


def test_probes_are_scheduled_by_each_rows_own_marked_response(tmp_path):
    clock = Clock()
    world, result = run(tmp_path, clock=clock)
    for i, seconds in enumerate((296, 298, 300, 302)):
        row = stage(result, f'w-probe-{i}')
        assert seconds <= row['age']['atSend'] < seconds + 3, row
    assert stage(result, 'p-start-aged')['age']['atSend'] >= 345
    assert stage(result, 'a-wrong-60')['age']['atSend'] >= 60
    assert stage(result, 'a-wrong-180')['age']['atSend'] >= 180
    assert max(r['age']['atSend'] for r in result['stages'] if 'age' in r) < 400


def test_pending_expiry_is_recorded_at_its_own_age(tmp_path):
    for ttl, expected in ((299.5, ['INVALID_CODE', 'INVALID_CODE', 'INVALID_MFA_PENDING_CREDENTIAL', 'INVALID_MFA_PENDING_CREDENTIAL']), (295, ['INVALID_MFA_PENDING_CREDENTIAL'] * 4), (310, ['INVALID_CODE'] * 4)):
        _, result = run(tmp_path / str(ttl), World(pending_ttl=ttl))
        assert [stage(result, f'w-probe-{i}').get('errorCode') for i in range(4)] == expected
        ages = [stage(result, f'w-probe-{i}')['age']['atSend'] for i in range(4)]
        assert ages == sorted(ages)


def test_quota_onset_and_post_quota_correct_codes_are_recorded(tmp_path):
    _, result = run(tmp_path)
    onset = next(k for k in range(1, 9) if stage(result, f'a-wrong-{k}').get('errorCode') == 'QUOTA_EXCEEDED')
    assert onset == 6
    assert all(stage(result, f'a-wrong-{k}')['errorCode'] == 'INVALID_CODE' for k in range(1, 6))
    for label in ('after', '60', '180'):
        assert stage(result, f'a-correct-{label}')['errorCode'] == 'QUOTA_EXCEEDED'


def test_wrong_codes_are_distinct_and_outside_the_accepted_window(tmp_path):
    world, _ = run(tmp_path)
    codes = [world.bodies[f'a-wrong-{k}']['totpVerificationInfo']['verificationCode'] for k in range(1, 9)]
    assert len(set(codes)) == 8
    now = int(time.time())
    valid = {totp_code(SECRET, now + k * 30, PARAMETERS) for k in range(-6, 7)}
    assert not valid & set(codes)
    right = [world.bodies[name]['totpVerificationInfo']['verificationCode'] for name in ('a-correct-after', 'a-correct-60', 'a-correct-180')]
    assert len(set(right)) == 3


def test_reuse_after_completion_and_phone_ages_are_recorded(tmp_path):
    _, result = run(tmp_path)
    assert stage(result, 'a-totp-reuse')['errorCode'] == 'MFA_ENROLLMENT_ALREADY_COMPLETE'
    assert stage(result, 'p-finalize-fresh')['status'] == 200
    assert stage(result, 'p-start-aged')['status'] == 400
    assert stage(result, 'p-finalize-aged')['errorCode'] == 'REQUIRES_RECENT_LOGIN'
    both = stage(result, 'b-admin-both-readback')
    assert both['users'][0]['mfaEntries'] == [{'phone': True, 'totp': True}]


@pytest.mark.parametrize('target', ['issue', 'holder'])
def test_duplicate_reset_records_which_account_changed_and_which_signs_in(tmp_path, target):
    world = World(reset_target=target)
    _, result = run(tmp_path, world)
    after = stage(result, 'dup-reset-1-readback')
    assert after['users'][0]['uidRole'] == 'dupA'
    changed_a = after['users'][0]['passwordUpdatedAtChanged']
    changed_b = stage(result, 'dup-after-reset-1-b-readback')['users'][0]['passwordUpdatedAtChanged']
    assert changed_a is True and changed_b is False
    assert stage(result, 'dup-signin-1-new1')['localIdRole'] == 'dupA'
    # B moved onto A's address; in the fake the holder rule changes the first holder (A) as well
    assert stage(result, 'dup-n3-signin')['localIdRole'] == 'dupD'


def test_refused_duplicate_admin_create_skips_only_the_dependent_n3_rows(tmp_path):
    world, result = run(tmp_path, World(admin_duplicates=False))
    assert stage(result, 'create-dupD')['errorCode'] == 'EMAIL_EXISTS'
    assert stage(result, 'create-dupD-readback')['skipped'] == 'dependency-unavailable'
    assert stage(result, 'dup-set-password-d')['skipped'] == 'dependency-unavailable'
    assert result['recordingComplete'] and result['cleanupComplete'] and not world.accounts


def test_unknown_probe_answers_never_fail_the_stage(tmp_path):
    world = World(below_scalar='refuse')
    _, result = run(tmp_path, world)
    assert stage(result, 'mask-below-scalar')['errorCode'] in ('INVALID_ARGUMENT', '')
    assert result['recordingComplete'] and result['cleanupComplete']


# ---- failures keep cleanup responsibility ------------------------------------------------------

@pytest.mark.parametrize('fault', ['before-create', 'after-create', 'delete', 'absence'])
def test_partial_failure_preserves_cleanup_responsibility(tmp_path, fault):
    world, result = run(tmp_path, World(fault=fault))
    assert not result['cleanupComplete']
    assert result['classification'] == 'INDETERMINATE'
    if fault == 'after-create':
        assert world.accounts
        assert not any(x.startswith('recover-delete-') for x in world.sent)
    if fault in ('delete', 'absence'):
        assert world.config['mfa'] == {'state': 'DISABLED'}
    if fault == 'absence':
        assert 'allowDuplicateEmails' not in world.config['signIn']
    if fault == 'delete':
        # duplicates cannot be switched back while they exist; the stage reports it instead of claiming a restore
        assert world.config['signIn'].get('allowDuplicateEmails') is True


@pytest.mark.parametrize('stop', ['a-totp-reuse', 'dup-reset-1', 'mask-interval-string', 'el-reset-known-ok', 'st-unread-zz'])
def test_interrupted_stage_restores_every_attempted_toggle_after_deleting_accounts(tmp_path, stop):
    world = World(fault=stop)
    world, result = run(tmp_path, world)
    assert result['cleanupComplete'], result['recovery']
    assert not world.accounts
    assert world.config['mfa'] == {'state': 'DISABLED'}
    assert 'allowDuplicateEmails' not in world.config['signIn']
    assert world.config['signIn']['email']['passwordRequired'] is True


def test_duplicate_switch_is_restored_only_after_duplicate_accounts_are_deleted(tmp_path):
    world, result = run(tmp_path, World(fault='dup-set-password-d'))
    order = [r['id'] for r in result['recovery'] if 'status' in r]
    assert order.index('recover-delete-dupD') < order.index('recover-dup-restore')
    assert result['cleanupComplete']


def test_form_suffix_reaches_the_wire_unchanged(tmp_path):
    world, result = run(tmp_path)
    assert world.bodies['st-unread-zz']['rawSuffix'] == '&extra=%zz'
    assert world.bodies['st-key-zz']['rawSuffix'] == '&%zz=1'
    assert stage(result, 'st-control')['status'] == 200


# ---- guard, judge, baseline ---------------------------------------------------------------------

@pytest.mark.parametrize('mutation', ['path', 'body', 'owner', 'binding', 'replay'])
def test_guard_rejects_drift_before_send(mutation):
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


@pytest.mark.parametrize('status,body', [(True, {}), (200, {}), (400, {'error': {}}), (503, {'error': {'message': 'UNAVAILABLE'}}), (503, {'localId': 'owned'}), (None, None), (200, [])])
def test_judge_never_accepts_untyped_or_unknown_answers(status, body):
    row = {'kind': 'diagnostic', 'required': ['localId'], 'refusals': ['USER_DISABLED'], 'open': False}
    assert edges.judge(row, status, body)['classification'] == 'INDETERMINATE'


def test_closed_rows_refuse_typed_codes_outside_their_refusal_set():
    closed = {'kind': 'diagnostic', 'required': [], 'refusals': ['USER_DISABLED'], 'open': False}
    assert edges.judge(closed, 400, {'error': {'message': 'USER_DISABLED : x'}})['outcome'] == 'refused'
    assert edges.judge(closed, 400, {'error': {'message': 'NEW_BACKEND_CODE : x'}})['classification'] == 'INDETERMINATE'


@pytest.mark.parametrize('field,value', [('sessionInfo', ''), ('sessionInfo', 123), ('sharedSecretKey', None), ('sharedSecretKey', 5), ('hashingAlgorithm', 5), ('hashingAlgorithm', 'UNKNOWN'), ('hashingAlgorithm', ''), ('periodSec', 0), ('periodSec', '30'), ('verificationCodeLength', 5)])
def test_invalid_totp_parameters_are_unknown(field, value):
    row = next(r for r in edges.manifest(NONCE)['stages'] if r['id'] == 'mfaA-totp-start')
    info = {'sessionInfo': 's', 'sharedSecretKey': SECRET, 'periodSec': 30, 'verificationCodeLength': 6, 'hashingAlgorithm': 'SHA1'}
    assert edges.judge(row, 200, {'totpSessionInfo': info})['classification'] == 'OBSERVED'
    info[field] = value
    assert edges.judge(row, 200, {'totpSessionInfo': info})['classification'] == 'INDETERMINATE'
    assert edges.judge(row, 200, {'totpSessionInfo': 'x'})['classification'] == 'INDETERMINATE'


def test_judge_open_modes_accept_only_typed_answers():
    code = {'kind': 'diagnostic', 'required': [], 'refusals': [], 'open': 'code'}
    anything = {**code, 'open': 'any'}
    assert edges.judge(code, 400, {'error': {'message': 'NEW_CODE : prose'}})['classification'] == 'OBSERVED'
    assert edges.judge(code, 400, {'error': {'message': 'free prose without a code'}})['classification'] == 'INDETERMINATE'
    assert edges.judge(anything, 400, {'error': {'message': 'free prose without a code'}})['classification'] == 'OBSERVED'
    for row in (code, anything):
        assert edges.judge(row, 500, {'error': {'message': 'X'}})['classification'] == 'INDETERMINATE'
        assert edges.judge(row, 302, {})['classification'] == 'INDETERMINATE'
        assert edges.judge(row, 200, {'error': {'message': 'X'}})['classification'] == 'INDETERMINATE'


@pytest.mark.parametrize('seed', range(40))
def test_random_answers_are_observed_only_when_typed_and_required_fields_hold(seed):
    rng = random.Random(seed)
    row = {'kind': 'diagnostic', 'required': ['phoneSessionInfo.sessionInfo', 'idToken'], 'refusals': ['INVALID_CODE'], 'open': rng.choice([False, 'code', 'any'])}
    status = rng.choice([200, 400, 401, 403, 429, 500, 302, None, True])
    body = rng.choice([{}, {'idToken': 'x'}, {'idToken': 'x', 'phoneSessionInfo': {'sessionInfo': 'y'}}, {'idToken': '', 'phoneSessionInfo': {'sessionInfo': 'y'}}, {'error': {'message': 'INVALID_CODE : p'}}, {'error': {'message': 'other'}}, {'error': 'text'}, None, []])
    verdict = edges.judge(row, status, body)['classification']
    if verdict == 'OBSERVED':
        assert type(status) is int and isinstance(body, dict)
        if status == 200:
            assert 'error' not in body and body.get('idToken') and body['phoneSessionInfo']['sessionInfo']
        else:
            assert status == 400 and isinstance(body['error'], dict)


@pytest.mark.parametrize('change', ['mfa-enabled', 'mfa-provider', 'dup-on', 'phone-missing', 'phone-code', 'domain', 'password-not-required', 'locale-missing', 'custom-smtp'])
def test_baseline_drift_stops_before_any_mutation(tmp_path, change):
    world = World()
    c = world.config
    if change == 'mfa-enabled':
        c['mfa'] = {'state': 'ENABLED'}
    elif change == 'mfa-provider':
        c['mfa'] = {'state': 'DISABLED', 'providerConfigs': [{'state': 'ENABLED'}]}
    elif change == 'dup-on':
        c['signIn']['allowDuplicateEmails'] = True
    elif change == 'phone-missing':
        del c['signIn']['phoneNumber']['testPhoneNumbers'][edges.TEST_PHONES[1]]
    elif change == 'phone-code':
        c['signIn']['phoneNumber']['testPhoneNumbers'][edges.TEST_PHONES[0]] = '000000'
    elif change == 'domain':
        c['authorizedDomains'] = []
    elif change == 'locale-missing':
        c['notification'].pop('defaultLocale')
    elif change == 'custom-smtp':
        c['notification']['sendEmail'] = {'method': 'CUSTOM_SMTP'}
    else:
        c['signIn']['email']['passwordRequired'] = False
    world, result = run(tmp_path, world)
    assert not result['recordingComplete']
    assert not any(x.startswith('create-') or x.endswith('-enable') for x in world.sent)
    assert result['cleanupComplete']


@pytest.mark.parametrize('spelling', ['missing', None, False])
def test_recorded_false_config_readback_spelling(tmp_path, spelling):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'].startswith('emaillink-readback-') and status == 200:
            if spelling == 'missing':
                answer['signIn']['email'].pop('passwordRequired', None)
            else:
                answer['signIn']['email']['passwordRequired'] = spelling
        return status, answer
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert result['recordingComplete'] and result['cleanupComplete']


def test_toggle_that_never_reads_back_stops_and_still_restores(tmp_path):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'].startswith('mfa-readback-') and status == 200:
            answer['mfa'] = {'state': 'DISABLED'}
        return status, answer
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert result['stopReason'] == 'ValueError'
    assert not result['recordingComplete']
    assert world.config['mfa'] == {'state': 'DISABLED'}
    assert not world.accounts
    assert result['cleanupComplete']


def test_foreign_readback_stops_before_next_mutation(tmp_path):
    world = World()
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'] == 'create-dupA-readback':
            answer['users'][0]['email'] = 'foreign@example.invalid'
        return status, answer
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert not result['recordingComplete']
    assert 'create-dupB' not in world.sent


def test_expired_observation_budget_keeps_cleanup_reserve(tmp_path):
    world = World()
    clock = Clock()
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'] == 'mfaW-totp-finalize':
            clock.now += 1300
        return answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert not result['recordingComplete']
    assert result['cleanupComplete']
    assert not world.accounts


def test_missing_dependency_skips_diagnostics_and_never_invents_values(tmp_path):
    world = World(mfa_start_status=400)
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=world.send_stage, sleep=clock.sleep, clock=clock)
    assert stage(result, 'w-probe-0')['skipped'] == 'dependency-unavailable'
    assert 'w-probe-0' not in world.sent
    assert result['cleanupComplete']


def test_recovery_entry_replays_only_journaled_uids_and_toggles(tmp_path):
    world, first = run(tmp_path, World(fault='delete'))
    assert not first['cleanupComplete']
    journal = tmp_path / 'run' / 'ownership.jsonl'
    world.fault = None
    result = edges.collect(nonce=NONCE, output=tmp_path / 'again', send=world.send_stage, sleep=lambda _: None, recovery_journal=journal)
    assert result['cleanupComplete']
    assert not world.accounts
    assert world.config['mfa'] == {'state': 'DISABLED'}


@pytest.mark.parametrize('line', [{'kind': 'account-attempt', 'email': 'foreign@example.invalid', 'preflightAbsent': True}, {'kind': 'config-attempt', 'nonce': NONCE, 'restore': True, 'toggle': 'tenants'}, {'kind': 'account-created', 'email': 'foreign@example.invalid', 'uid': 'u'}])
def test_recovery_journal_outside_the_frozen_namespace_is_refused(tmp_path, line):
    journal = tmp_path / 'journal.jsonl'
    journal.write_text(json.dumps(line) + '\n')
    with pytest.raises(ValueError):
        edges.collect(nonce=NONCE, output=tmp_path / 'again', send=World().send_stage, sleep=lambda _: None, recovery_journal=journal)


@pytest.mark.parametrize('origin', ['https://127.0.0.1:1', 'http://example.invalid', 'http://127.0.0.1:1/path', 'http://owner@127.0.0.1:1', 'http://127.0.0.1:1?redirect=yes'])
def test_local_transport_rejects_non_loopback_origins_before_io(origin):
    with pytest.raises(edges.CollectorError):
        edges.local_send(origin)


# ---- production transport ------------------------------------------------------------------------

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
        seen.append(('HOST', parsed.hostname, {}, b''))
        return wire(f'http://127.0.0.1:{server.server_port}{parsed.path}' + ('?' + parsed.query if parsed.query else ''), method, body, headers, local=True, **options)

    monkeypatch.setattr(transport.batch_adapter, 'wire', local_wire)
    monkeypatch.setenv('AUTH_EDGES_ACCESS_TOKEN', 'fixture-owner-value')
    monkeypatch.setenv('AUTH_EDGES_BROWSER_API_KEY', 'fixture-browser+value')
    monkeypatch.setenv('PRODUCTION_ORACLE_API_KEY', 'wrong-generic-key')
    monkeypatch.setattr(transport.batch_adapter, 'HOSTS', set(transport.batch_adapter.HOSTS))
    try:
        yield transport.production_send(), seen, response
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        assert not thread.is_alive()


def wire_rows(seen):
    return [s for s in seen if s[0] != 'HOST']


def test_transport_headers_and_form_suffix(http_wire, capsys):
    from urllib.parse import parse_qs, urlsplit
    import transport
    send, seen, _ = http_wire
    assert not hasattr(transport, 'IAM_HOST')
    rows = {r['id']: r for r in edges.manifest(NONCE)['stages']}
    cases = [('config-baseline', None), ('mfa-enable', rows['mfa-enable']['body']), ('create-dupA', {'email': 'fixture@example.invalid', 'password': 'fixture-pass', 'returnSecureToken': True}), ('st-unread-zz', {'grant_type': 'refresh_token', 'refresh_token': 'fixture-refresh+/=& value', 'rawSuffix': '&extra=%zz'})]
    for identifier, body in cases:
        assert send(rows[identifier], body) == (200, {})
    calls = wire_rows(seen)
    assert {s[1] for s in seen if s[0] == 'HOST'} == {'identitytoolkit.googleapis.com', 'securetoken.googleapis.com'}
    for method, path, headers, raw in (calls[0], calls[1]):
        headers = {k.lower(): v for k, v in headers.items()}
        assert headers['authorization'] == 'Bearer fixture-owner-value'
        assert headers['x-goog-user-project'] == edges.PROJECT
        assert 'key=' not in path
    assert calls[0][0] == 'GET' and calls[0][3] == b''
    assert calls[1][0] == 'PATCH'
    assert parse_qs(urlsplit(calls[1][1]).query) == {'updateMask': ['mfa']}
    for method, path, headers, raw in calls[2:4]:
        assert 'authorization' not in {k.lower() for k in headers}
        assert parse_qs(urlsplit(path).query) == {'key': ['fixture-browser+value']}
    headers = {k.lower(): v for k, v in calls[3][2].items()}
    assert headers['content-type'] == 'application/x-www-form-urlencoded'
    assert calls[3][3].decode() == 'grant_type=refresh_token&refresh_token=fixture-refresh%2B%2F%3D%26+value&extra=%zz'
    assert json.loads(calls[2][3])['password'] == 'fixture-pass'
    assert capsys.readouterr() == ('', '')


@pytest.mark.parametrize('status', [401, 403])
def test_transport_latches_auth_failure_and_never_logs_secrets(http_wire, tmp_path, capsys, status):
    send, seen, response = http_wire
    response.update(status=status, body=b'{"error":{"message":"fixture-owner-value fixture-browser+value"}}')
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert len(wire_rows(seen)) == 1
    assert not result['recordingComplete'] and not result['cleanupComplete']
    saved = ''.join(p.read_text() for p in (tmp_path / 'run').glob('*'))
    logs = ''.join(capsys.readouterr())
    for value in ('fixture-owner-value', 'fixture-browser+value', 'wrong-generic-key'):
        assert value not in saved + logs


def test_any_403_or_401_latches_the_transport(http_wire):
    send, seen, response = http_wire
    rows = {r['id']: r for r in edges.manifest(NONCE)['stages']}
    response.update(status=403, body=b'{"error":{"message":"denied"}}')
    assert send(rows['config-baseline'], None)[0] == 403
    with pytest.raises(ValueError, match='latched'):
        send(rows['config-baseline'], None)
    assert len(wire_rows(seen)) == 1


def test_transport_non_json_unknown_and_refusals(http_wire):
    send, seen, response = http_wire
    response['body'] = b'not-json private response'
    row = edges.manifest(NONCE)['stages'][0]
    assert send(row, row['body']) == (200, None)
    assert len(wire_rows(seen)) == 1
    bad = ['/example.invalid/v1/accounts:lookup', '/identitytoolkit.googleapis.com.evil.invalid/v1/accounts:lookup', edges.ADMIN + 'lookup?key=foreign', edges.CONFIG + '?updateMask=signIn', edges.ADMIN + 'batchDelete', edges.IDT + '/v1/accounts:delete']
    for path in bad:
        with pytest.raises(ValueError):
            send({**row, 'path': path}, row['body'])
    with pytest.raises(ValueError):
        send({**row, 'path': '/iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/x:signJwt'}, {'payload': 'x'})
    for suffix in ('&extra=<script>', 'extra=1', '&' + 'a' * 40):
        with pytest.raises(ValueError):
            send({**row, 'path': edges.TOKEN, 'owner': False}, {'grant_type': 'refresh_token', 'rawSuffix': suffix})
    with pytest.raises(ValueError):
        send({**row, 'path': edges.CONFIG + '?updateMask=mfa'}, {'tenants': {}})
    assert len(wire_rows(seen)) == 1


def test_launcher_selects_reviewed_transport(monkeypatch, tmp_path):
    import signal
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
    previous = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT)}
    try:
        assert edges.main() == 0
        assert called == ['transport']
    finally:
        for s, handler in previous.items():
            signal.signal(s, handler)


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
    assert row['path'] == edges.CONFIG + '?updateMask=signIn.email.enabled,signIn.email.passwordRequired,signIn.phoneNumber,authorizedDomains,notification.defaultLocale,mfa'
    assert body['signIn']['phoneNumber']['testPhoneNumbers'] == {n: edges.TEST_PHONE_CODE for n in edges.TEST_PHONES}
    assert body['mfa'] == {'state': 'DISABLED'} and body['authorizedDomains'] == [edges.DOMAIN]


def test_rehearsal_child_refuses_failed_baseline(monkeypatch, tmp_path):
    import rehearse
    monkeypatch.setattr(sys, 'argv', ['rehearse.py', '--child', str(tmp_path / 'child'), '--project', edges.PROJECT, '--nonce', NONCE])
    monkeypatch.setenv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:1234')
    monkeypatch.setattr(edges, 'local_send', lambda origin: lambda row, body: (400, {}))
    monkeypatch.setattr(edges, 'collect', lambda **kwargs: pytest.fail('stage must not run'))
    with pytest.raises(ValueError, match='baseline preparation failed'):
        rehearse.main()


def test_rehearsal_supervisor_covers_all_phase_budgets(monkeypatch, tmp_path):
    import rehearse
    monkeypatch.setattr(sys, 'argv', ['rehearse.py', '--project', edges.PROJECT, '--nonce', NONCE, '--artifact', str(tmp_path / 'artifact'), '--output', str(tmp_path / 'output')])

    def supervisor(*args, **kwargs):
        budget = edges.manifest(NONCE)['budget']
        assert kwargs['timeout'] >= budget['wallSeconds'] + budget['recoverySeconds'] + 30
        return {'status': 'shadow-complete'}

    monkeypatch.setattr(rehearse.shadow, 'run', supervisor)
    assert rehearse.main() == 0


def test_pict_generated_matrix_runs_the_whole_stage(tmp_path):
    import csv
    import os
    table = Path(os.environ.get('EDGES_PICT_TABLE', ''))
    if not table.is_file():
        pytest.skip('set EDGES_PICT_TABLE to the packet PICT table')
    with table.open() as stream:
        rows = list(csv.DictReader(stream, delimiter='\t'))
    assert rows
    for index, row in enumerate(rows):
        world = World(fault=None if row['Fault'] == 'none' else row['Fault'], below_scalar=row['MaskAnswer'], reset_target=row['ResetTarget'], quota_after=int(row['Quota']))
        _, result = run(tmp_path / str(index), world)
        if row['Fault'] in ('before-create', 'after-create', 'delete', 'absence'):
            assert not result['cleanupComplete'], row
        else:
            assert result['cleanupComplete'], row
            assert not world.accounts, row
            assert world.config['mfa'] == {'state': 'DISABLED'}, row


# ---- judges replay recorded production bodies ------------------------------------------------------

RECORDING = HERE.parents[2] / 'conformance' / 'auth-mfa-production.json'


def recorded_step(program, step):
    steps = json.loads(RECORDING.read_text())['programs'][program]['steps']
    return steps[step]['status'], steps[step]['body']


def with_real_tokens(value):
    """Turn the recording's decoded-token placeholder back into a compact token shape."""
    if isinstance(value, dict) and set(value) == {'<jwt>'}:
        claims = value['<jwt>']['claims']
        payload = base64.urlsafe_b64encode(json.dumps({'user_id': claims['user_id'], 'sub': claims['sub']}).encode()).rstrip(b'=').decode()
        return 'e30.' + payload + '.sig'
    if isinstance(value, dict):
        return {k: with_real_tokens(v) for k, v in value.items()}
    if isinstance(value, list):
        return [with_real_tokens(v) for v in value]
    if isinstance(value, str) and value.startswith('<') and value.endswith('>'):
        return 'x' + value[1:-1].replace(':', '-')
    return value


@pytest.mark.parametrize('row_id,program,step,expected', [
    ('create-dupC', 'auth-mfa/totp/sign-in', 'create-c', ('OBSERVED', 'accepted')),
    ('mfaA-signin', 'auth-mfa/totp/sign-in', 'sign-in-c', ('OBSERVED', 'accepted')),
    ('mfaA-totp-start', 'auth-mfa/totp/sign-in', 'start-c', ('OBSERVED', 'accepted')),
    ('mfaA-totp-finalize', 'auth-mfa/totp/sign-in', 'finalize-c', ('OBSERVED', 'accepted')),
    ('a-pending-1', 'auth-mfa/totp/sign-in', 'pending-1', ('OBSERVED', 'accepted')),
    ('a-wrong-1', 'auth-mfa/totp/sign-in', 'finalize-wrong-code', ('OBSERVED', 'refused')),
    ('a-correct-after', 'auth-mfa/totp/sign-in', 'pending-1-again', ('OBSERVED', 'accepted')),
])
def test_judge_replays_recorded_production_answers(row_id, program, step, expected):
    row = next(r for r in edges.manifest(NONCE)['stages'] if r['id'] == row_id)
    status, body = recorded_step(program, step)
    verdict = edges.judge(row, status, with_real_tokens(body))
    assert (verdict['classification'], verdict['outcome']) == expected


def test_recorded_baseline_still_carries_the_provider_state_the_stage_checks():
    recorded = json.loads(RECORDING.read_text())['recordedAgainst']['baselineConfig']
    assert recorded['signIn.phoneNumber.enabled'] is True
    numbers = recorded['signIn.phoneNumber.testPhoneNumbers']
    assert all(n in numbers for n in edges.TEST_PHONES)
    assert recorded['signIn.email.passwordRequired'] is True


# ---- toggle predicates, ordering and cleanup edges ---------------------------------------------------

LINK = lambda **email: {'signIn': {'email': {'enabled': True, **email}}}
MFA = lambda state, intervals=5, provider='ENABLED': {'mfa': {'state': state, 'providerConfigs': [{'state': provider, 'totpProviderConfig': {'adjacentIntervals': intervals}}]}}


@pytest.mark.parametrize('toggle,body,applied,restored', [
    ('emaillink', LINK(passwordRequired=False), True, False),
    ('emaillink', LINK(), True, False),
    ('emaillink', LINK(passwordRequired=None), True, False),
    ('emaillink', LINK(passwordRequired=True), False, True),
    ('emaillink', {'signIn': {'email': {'enabled': False, 'passwordRequired': False}}}, False, False),
    ('mfa', MFA('ENABLED'), True, False),
    ('mfa', MFA('ENABLED', intervals=4), False, False),
    ('mfa', MFA('ENABLED', provider='DISABLED'), False, False),
    ('mfa', MFA('DISABLED', provider='DISABLED'), False, False),
    ('mfa', {'mfa': {'state': 'DISABLED', 'enabledProviders': ['PHONE_SMS']}}, False, False),
    ('mfa', {'mfa': None}, False, True),
    ('mfa', {'mfa': {}}, False, False),
    ('mfa', {'mfa': {'state': 'ENABLED'}}, False, False),
    ('mfa', {'mfa': {'state': 'DISABLED'}}, False, True),
    ('mfa', {'mfa': {'state': 'MANDATORY'}}, False, False),
    ('mfa', MFA('DISABLED'), False, False),
    ('mfa', {}, False, True),
    ('dup', {'signIn': {'allowDuplicateEmails': True}}, True, False),
    ('dup', {'signIn': {'allowDuplicateEmails': False}}, False, True),
    ('dup', {'signIn': {}}, False, True),
])
def test_toggle_predicates_on_every_spelling(toggle, body, applied, restored):
    assert edges.toggle_applied(toggle, body) is applied
    assert edges.toggle_restored(toggle, body) is restored


def test_restore_order_is_frozen_and_rows_follow_it():
    plan = edges.manifest(NONCE)
    assert edges.RESTORE_ORDER == ('dup', 'mfa', 'emaillink')
    assert [r['toggle'] for r in plan['recovery'] if r['kind'] == 'config' and r['method'] == 'PATCH'] == ['dup', 'mfa', 'emaillink']
    kinds = [r['kind'] for r in plan['recovery']]
    assert kinds.index('config') > max(i for i, k in enumerate(kinds) if k in ('delete', 'recovery'))


def test_nothing_is_restored_that_was_never_attempted(tmp_path):
    world = World()
    world.config['mfa'] = {'state': 'ENABLED'}
    world, result = run(tmp_path, world)
    rows = {r['id']: r for r in result['recovery']}
    for toggle in edges.TOGGLES:
        assert rows[f'recover-{toggle}-restore'] == {'id': f'recover-{toggle}-restore', 'skipped': 'config-not-attempted'}
    assert not any('restore' in x or 'readback' in x and x.startswith('recover-') for x in world.sent if x.startswith('recover-') and x not in ('recover-discover', 'recover-absence'))
    assert world.config['mfa'] == {'state': 'ENABLED'}


def test_confirmed_toggles_read_back_once_each_way(tmp_path):
    world, result = run(tmp_path)
    for toggle in edges.TOGGLES:
        assert f'{toggle}-readback-0' in world.sent and f'{toggle}-readback-1' not in world.sent
        assert f'recover-{toggle}-readback-0' in world.sent and f'recover-{toggle}-readback-1' not in world.sent
    assert not [r for r in result['stages'] if r.get('skipped') and r['skipped'] != 'config-already-confirmed']
    assert stage(result, 'mfa-readback-1')['skipped'] == 'config-already-confirmed'


def test_toggle_that_does_not_come_back_is_reported_and_the_others_still_restore(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'recover-mfa-restore':
            return 200, copy.deepcopy(world.config)
        return world.send_stage(row, body)
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert not result['cleanupComplete']
    rows = {r['id']: r for r in result['recovery']}
    assert rows['recover-mfa-readback-7']['failure'] == 'ValueError'
    assert all(f'recover-mfa-readback-{i}' in rows for i in range(8))
    assert world.config['signIn']['email']['passwordRequired'] is True
    journal = [json.loads(l) for l in (tmp_path / 'run' / 'ownership.jsonl').read_text().splitlines()]
    assert {'kind': 'recovery-required', 'reason': 'config-restore-unconfirmed', 'toggle': 'mfa'} in journal


def test_authorized_domain_is_the_idp_firebaseapp_host():
    assert edges.DOMAIN == 'fireemu-oracle-idp.firebaseapp.com'
    plan = edges.manifest(NONCE)
    urls = {r['body']['continueUrl'] for r in plan['stages'] if isinstance(r['body'], dict) and 'continueUrl' in r['body']}
    assert urls == {'https://fireemu-oracle-idp.firebaseapp.com/edge', 'https://example.invalid/edge', '/edge'}


def test_a_late_wake_is_recorded_not_hidden(tmp_path):
    world, result = run(tmp_path, clock=Clock(overshoot=3.0))
    late = [r['lateSeconds'] for r in result['stages'] if 'lateSeconds' in r]
    assert late and max(late) > 0


def test_refused_create_journal_is_replayed_without_responsibility(tmp_path):
    world, first = run(tmp_path, World(admin_duplicates=False))
    assert first['cleanupComplete']
    journal = tmp_path / 'run' / 'ownership.jsonl'
    assert any(json.loads(l)['kind'] == 'account-refused' for l in journal.read_text().splitlines())
    result = edges.collect(nonce=NONCE, output=tmp_path / 'again', send=world.send_stage, sleep=lambda _: None, recovery_journal=journal)
    assert result['cleanupComplete']


def test_refusal_without_a_create_attempt_is_refused_in_a_journal(tmp_path):
    journal = tmp_path / 'journal.jsonl'
    plan = edges.manifest(NONCE)
    journal.write_text(json.dumps({'kind': 'account-refused', 'role': 'dupD', 'email': plan['ownedAccounts']['dupD']['email']}) + '\n')
    with pytest.raises(ValueError):
        edges.collect(nonce=NONCE, output=tmp_path / 'again', send=World().send_stage, sleep=lambda _: None, recovery_journal=journal)


def test_delete_that_leaves_the_account_is_not_cleanup(tmp_path):
    world, result = run(tmp_path, World(fault='silent-delete'))
    assert world.accounts and not result['cleanupComplete']
    assert not any(r.get('uidAbsent') for r in result['recovery'] if r['id'].startswith('recover-uid-absence-dup'))


def test_an_account_gone_before_cleanup_is_not_deleted_again(tmp_path):
    world = World(after={'el-signin-known': lambda w: w.accounts.pop(next(u for u, a in w.accounts.items() if a.get('email') and 'elknown' in a['email']))})
    world, result = run(tmp_path, world)
    assert 'recover-delete-elKnown' not in world.sent
    assert {r['id']: r for r in result['recovery']}['recover-delete-elKnown']['skipped'] == 'absent at discovery'
    assert result['cleanupComplete']


def test_a_foreign_account_at_an_owned_address_is_never_deleted(tmp_path):
    world = World()
    world.new(edges.manifest(NONCE)['ownedAccounts']['mfaB']['email'], 'x', uid='foreign-uid')
    world, result = run(tmp_path, world)
    assert 'foreign-uid' in world.accounts
    assert not result['cleanupComplete']


def test_address_discovery_that_disagrees_with_a_created_uid_is_a_failure(tmp_path):
    world = World()
    plan = edges.manifest(NONCE)
    def send(row, body):
        status, answer = world.send_stage(row, body)
        if row['id'] == 'recover-discover':
            answer['users'] = [*answer.get('users', []), {'localId': 'impostor', 'email': plan['ownedAccounts']['dupC']['email']}]
        return status, answer
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert {r['id']: r for r in result['recovery']}['recover-discover']['failure'] == 'ValueError'
    assert not result['cleanupComplete']


def test_preexisting_account_at_an_owned_address_stops_before_any_write(tmp_path):
    world = World()
    world.new(edges.manifest(NONCE)['ownedAccounts']['dupA']['email'], 'x', uid='someone')
    world, result = run(tmp_path, world)
    assert not result['recordingComplete'] and result['stopReason'] == 'ValueError'
    assert 'create-dupA' not in world.sent and not any(x.endswith('-enable') for x in world.sent)
    assert 'someone' in world.accounts
    assert stage(result, 'preflight-absence')['users'][0]['uidMatches'] is False


def test_slow_account_cleanup_cannot_spend_config_restore_reserve(tmp_path):
    world = World()
    clock = Clock()
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'].startswith('recover-'):
            clock.now += 11.5
        return answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert 'recover-mfa-restore' in world.sent and 'recover-mfa-readback-0' in world.sent
    assert world.config['mfa'] == {'state': 'DISABLED'}
    assert world.config['signIn']['email']['passwordRequired'] is True
    assert not result['cleanupComplete']


def test_setup_failure_stops_at_once(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'verify-mfaW':
            return 503, {'error': {'message': 'UNAVAILABLE'}}
        return world.send_stage(row, body)
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert result['stopReason'] == 'ValueError' and 'mfaW-signin' not in world.sent
    assert result['cleanupComplete']


def test_lost_acknowledgements_keep_their_pair_or_stop_at_once(tmp_path):
    world, result = run(tmp_path, World(fault='el-signin-known'))
    assert not result['recordingComplete'] and 'el-reset-known-ok' not in world.sent and result['cleanupComplete']
    world, result = run(tmp_path / 'b', World(fault='dup-issue-1'))
    assert 'dup-issue-1-readback' in world.sent and 'dup-move-b' not in world.sent and result['cleanupComplete']
    world, result = run(tmp_path / 'c', World(fault='mask-state'))
    assert 'mask-state-observe' in world.sent and 'mask-interval-string' not in world.sent
    assert result['cleanupComplete'] and world.config['mfa'] == {'state': 'DISABLED'}


def test_unpaired_transport_failure_stops_at_once(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'el-signin-known':
            return 503, {'error': {'message': 'UNAVAILABLE'}}
        return world.send_stage(row, body)
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert result['stopReason'] == 'ValueError' and 'el-reset-known-ok' not in world.sent
    assert result['cleanupComplete']


def test_projection_secret_guard_fails_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(edges, 'publishable', lambda value, key='': value)
    world, result = run(tmp_path)
    assert result['stopReason'] == 'SecretLeak' and result['cleanupComplete']
    assert not any('e30.' in json.dumps(r) or 'id-uid' in json.dumps(r) for r in result['stages'])


def test_probe_error_text_is_number_masked_and_bounded():
    assert edges.scrub('project 123456789012 and 12345 failed') == 'project <n> and 12345 failed'
    assert len(edges.scrub('x' * 1000)) == 240


def test_baseline_findings_name_every_launch_assumption():
    body = World().config
    findings = edges.baseline_findings(body)
    assert set(findings) == {'A1-mfa-disabled', 'A2-email-link-baseline', 'A3-duplicates-off', 'A4-test-phones', 'A5-default-locale', 'A11-default-mail-sender'}
    assert all(findings.values())
    drift = {
        'A1-mfa-disabled': lambda c: c.update(mfa={'state': 'ENABLED'}),
        'A2-email-link-baseline': lambda c: c['signIn']['email'].update(passwordRequired=False),
        'A3-duplicates-off': lambda c: c['signIn'].update(allowDuplicateEmails=True),
        'A4-test-phones': lambda c: c['signIn']['phoneNumber']['testPhoneNumbers'].pop(edges.TEST_PHONES[2]),
        'A5-default-locale': lambda c: c['notification'].pop('defaultLocale'),
        'A11-default-mail-sender': lambda c: c['notification'].update(sendEmail={'method': 'CUSTOM_SMTP'}),
    }
    for name, change in drift.items():
        changed = World().config
        change(changed)
        result = edges.baseline_findings(changed)
        assert [k for k, v in result.items() if not v] == [name], name
        with pytest.raises(ValueError, match=name):
            edges.check_baseline(changed)
    disabled = World().config
    disabled['signIn']['phoneNumber']['enabled'] = False
    assert [k for k, v in edges.baseline_findings(disabled).items() if not v] == ['A4-test-phones']
    for locale in ('', 5, None, 'e\nn'):
        changed = World().config
        changed['notification']['defaultLocale'] = locale
        assert not edges.baseline_findings(changed)['A5-default-locale']
    for method in (None, 'DEFAULT'):
        changed = World().config
        changed['notification']['sendEmail'] = {} if method is None else {'method': method}
        assert edges.baseline_findings(changed)['A11-default-mail-sender']
    assert edges.baseline_findings({'notification': None, 'signIn': None})['A5-default-locale'] is False


def test_probe_bodies_and_address_moves_are_frozen():
    rows = {r['id']: r for r in edges.manifest(NONCE)['stages']}
    plan = edges.manifest(NONCE)
    assert rows['mask-precedence']['body'] == {'mfa': {'state': 'NOT_A_STATE'}, 'mobileLinksConfig': {'domain': 'CUSTOM_DOMAIN'}}
    assert rows['mask-interval-string']['body']['mfa']['providerConfigs'][0]['totpProviderConfig']['adjacentIntervals'] == '5'
    assert rows['mask-interval-number']['body'] == {'mfa': edges.MFA_ENABLED}
    assert rows['mask-state-numeric']['body']['mfa']['state'] == 2
    assert rows['mask-below-scalar']['body'] == {'notification': {'defaultLocale': '$binding:config.defaultLocale'}}
    assert rows['dup-move-b']['body']['email'] == plan['ownedAccounts']['dupA']['email']
    assert rows['b-admin-both']['body']['mfa']['enrollments'] == [{'phoneInfo': edges.TEST_PHONES[2], 'totpInfo': {}, 'displayName': 'edges-both'}]
    assert [r['body']['rawSuffix'] for r in plan['stages'] if r['id'].startswith('st-')] == ['', '&extra=%zz', '&extra=%', '&extra=%2', '&extra=%C3%28', '&%zz=1']
    assert [r['path'] for r in plan['stages'] if r['id'].startswith('el-signin-')] == [edges.CLIENT + 'sendOobCode'] * 3


def test_transport_host_set_and_config_write_shapes():
    import transport
    assert transport.HOSTS == {'identitytoolkit.googleapis.com', 'securetoken.googleapis.com'}
    write = edges.CONFIG + '?updateMask=mfa'
    assert transport.shape_ok(write, 'PATCH', True, {'mfa': {}})
    assert not transport.shape_ok(write, 'PATCH', True, {'tenants': {}})
    assert not transport.shape_ok(write, 'PATCH', False, {'mfa': {}})
    assert not transport.shape_ok(write, 'POST', True, {'mfa': {}})
    assert not transport.shape_ok(edges.CONFIG, 'GET', True, {})


@pytest.mark.parametrize('complete,kind', [(False, 'json'), (True, 'text')])
def test_transport_incomplete_worker_body_is_unknown(monkeypatch, complete, kind):
    import transport
    monkeypatch.setenv('AUTH_EDGES_ACCESS_TOKEN', 'fixture-owner-value')
    monkeypatch.setenv('AUTH_EDGES_BROWSER_API_KEY', 'fixture-browser+value')
    monkeypatch.setattr(transport.batch_adapter, 'HOSTS', set(transport.batch_adapter.HOSTS))
    monkeypatch.setattr(transport.batch_adapter, 'wire', lambda *a, **k: {'http': {'status': 200, 'complete': complete, 'bodyKind': kind}, 'body': {'localId': 'x'}})
    send = transport.production_send()
    row = next(r for r in edges.manifest(NONCE)['stages'] if r['id'] == 'preflight-absence')
    assert send(row, row['body']) == (200, None)


def test_local_send_posts_the_form_with_the_raw_suffix():
    import http.server
    import threading
    seen = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            seen.append((self.path, self.headers.get('Content-Type'), self.rfile.read(int(self.headers.get('Content-Length', 0)))))
            body = b'{}'
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        send = edges.local_send(f'http://127.0.0.1:{server.server_port}')
        row = next(r for r in edges.manifest(NONCE)['stages'] if r['id'] == 'st-unread-zz')
        assert send(row, {'grant_type': 'refresh_token', 'refresh_token': 'a b', 'rawSuffix': '&extra=%zz'}) == (200, {})
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    path, content_type, raw = seen[0]
    assert content_type == 'application/x-www-form-urlencoded'
    assert raw == b'grant_type=refresh_token&refresh_token=a+b&extra=%zz'
    assert path == edges.TOKEN + '?key=fake'


def test_recorded_enabled_config_read_satisfies_the_applied_predicates():
    steps = json.loads(RECORDING.read_text())['programs']['auth-mfa/config']['steps']
    enabled = steps['read-enabled']['body']
    assert edges.toggle_applied('mfa', enabled) and not edges.toggle_restored('mfa', enabled)
    assert edges.config_state(enabled)['totpIntervals'] == 5


@pytest.mark.parametrize('offset', [0, 1, 3, 5, 7])
def test_wrong_code_op_never_lands_inside_the_accepted_window(offset):
    class Run:
        secrets = {'r.secret': SECRET}
        totp = {'r': PARAMETERS}
        requested = {}

    run = Run()
    row = {'pre': [{'op': 'wrong-totp', 'role': 'r', 'offset': offset, 'out': 'r.wrong'}]}
    edges.execute_pre(run, row, edges.manifest(NONCE))
    now = int(time.time())
    assert run.secrets['r.wrong'] not in {totp_code(SECRET, now + k * 30, PARAMETERS) for k in range(-6, 7)}
    row = {'pre': [{'op': 'totp', 'role': 'r', 'offset': offset, 'out': 'r.right'}]}
    edges.execute_pre(run, row, edges.manifest(NONCE))
    assert run.secrets['r.right'] in {totp_code(SECRET, int(time.time()) + offset * 30 + d, PARAMETERS) for d in (-1, 0, 1)}


@pytest.mark.parametrize('answer,drift,code', [((200, 'ok'), None, 0), ((200, 'ok'), 'A3-duplicates-off', 2), ((200, 'ok'), 'A4-test-phones', 2), ((200, 'ok'), 'A5-default-locale', 2), ((200, 'ok'), 'A11-default-mail-sender', 2), ((403, None), None, 2), ((200, None), None, 2)])
def test_read_baseline_prints_booleans_and_refuses_a_mismatch(monkeypatch, capsys, answer, drift, code):
    import transport
    config = World().config
    changes = {'A3-duplicates-off': lambda c: c['signIn'].update(allowDuplicateEmails=True), 'A4-test-phones': lambda c: c['signIn']['phoneNumber']['testPhoneNumbers'].pop(edges.TEST_PHONES[0]), 'A5-default-locale': lambda c: c['notification'].pop('defaultLocale'), 'A11-default-mail-sender': lambda c: c['notification'].update(sendEmail={'method': 'CUSTOM_SMTP'})}
    if drift:
        changes[drift](config)
    calls = []
    def sender(row, body):
        calls.append((row, body))
        return answer[0], (config if answer[1] else None)
    monkeypatch.setattr(transport, 'production_send', lambda: sender)
    monkeypatch.setattr(sys, 'argv', ['edges.py', '--production', '--read-baseline'])
    assert edges.main() == code
    assert calls == [({'path': edges.CONFIG, 'method': 'GET', 'owner': True}, None)]
    out = capsys.readouterr().out
    if answer[1]:
        assert out.count(': ok') + out.count(': MISMATCH') == 6
        assert len(re.findall(r'(?m)^digest-(whole|mfa|mobileLinksConfig|notification): [0-9a-f]{64}$', out)) == 4
        assert (f'{drift}: MISMATCH' in out) == bool(drift)
    pattern = r'(A\d+-[a-z0-9-]+: (ok|MISMATCH))|(digest-[A-Za-z]+: [0-9a-f]{64})' if answer[1] else r'config-read: unknown'
    assert all(re.fullmatch(pattern, line) for line in out.splitlines()) and out.strip()


def test_read_baseline_refuses_any_other_argument(monkeypatch):
    for extra in (['--nonce', NONCE], ['--origin', 'http://127.0.0.1:1'], ['--output', 'x'], ['--recover', 'x']):
        monkeypatch.setattr(sys, 'argv', ['edges.py', '--production', '--read-baseline', *extra])
        with pytest.raises(SystemExit):
            edges.main()
    monkeypatch.setattr(sys, 'argv', ['edges.py', '--read-baseline'])
    with pytest.raises(SystemExit):
        edges.main()


def test_stage_entry_requires_a_nonce(monkeypatch):
    monkeypatch.setattr(sys, 'argv', ['edges.py', '--production', '--output', 'unused'])
    with pytest.raises(SystemExit):
        edges.main()
    monkeypatch.setattr(sys, 'argv', ['edges.py', '--production'])
    with pytest.raises(SystemExit):
        edges.main()


# ---- v3.2: exact baseline, whole-config digests, restore edge cases ----------------------------------

@pytest.mark.parametrize('mfa,ok', [
    ({'state': 'DISABLED'}, True),
    (None, True),
    ('absent', True),
    ({}, False),
    ({'state': 'DISABLED', 'providerConfigs': [{'state': 'DISABLED', 'totpProviderConfig': {'adjacentIntervals': 3}}]}, False),
    ({'state': 'DISABLED', 'enabledProviders': ['PHONE_SMS']}, False),
    ({'state': 'DISABLED', 'enabledProviders': []}, False),
    ({'state': 'ENABLED'}, False),
])
def test_baseline_mfa_must_be_exactly_disabled_or_absent(mfa, ok):
    config = World().config
    if mfa == 'absent':
        config.pop('mfa')
    else:
        config['mfa'] = mfa
    assert edges.baseline_findings(config)['A1-mfa-disabled'] is ok
    if not ok:
        with pytest.raises(ValueError, match='A1-mfa-disabled'):
            edges.check_baseline(config)


def test_config_digests_cover_the_whole_config_and_its_three_members():
    config = World().config
    config['mobileLinksConfig'] = {'domain': 'FIREBASE_DYNAMIC_LINK_DOMAIN'}
    base = edges.config_digests(config)
    assert set(base) == {'whole', 'mfa', 'mobileLinksConfig', 'notification'}
    assert all(re.fullmatch('[0-9a-f]{64}', v) for v in base.values())
    assert edges.config_digests(json.loads(json.dumps(config, sort_keys=True))) == base
    changes = {
        'mfa': lambda c: c.update(mfa={'state': 'ENABLED'}),
        'mobileLinksConfig': lambda c: c['mobileLinksConfig'].update(domain='CUSTOM_DOMAIN'),
        'notification': lambda c: c['notification'].update(defaultLocale='ja'),
    }
    for member, change in changes.items():
        changed = copy.deepcopy(config)
        change(changed)
        digests = edges.config_digests(changed)
        assert digests['whole'] != base['whole'] and digests[member] != base[member]
        assert edges.differing_members(base, digests) == ['whole', member]
    other = copy.deepcopy(config)
    other['authorizedDomains'].append('x.example.invalid')
    assert [m for m in edges.differing_members(base, edges.config_digests(other))] == ['whole']
    assert edges.differing_members(base, base) == []


def test_digest_treats_only_the_protobuf_omissions_as_equal():
    config = World().config
    base = edges.config_digests(config)
    absent_mfa = copy.deepcopy(config)
    absent_mfa.pop('mfa')
    assert edges.config_digests(absent_mfa) == base
    for spelling in (False, None):
        dup = copy.deepcopy(config)
        dup['signIn']['allowDuplicateEmails'] = spelling
        assert edges.config_digests(dup) == base
    dup = copy.deepcopy(config)
    dup['signIn']['allowDuplicateEmails'] = True
    assert edges.config_digests(dup)['whole'] != base['whole']
    required = copy.deepcopy(config)
    required['signIn']['email']['passwordRequired'] = False
    assert edges.config_digests(required)['whole'] != base['whole']


def test_baseline_digests_are_recorded_before_the_first_write(tmp_path):
    world, result = run(tmp_path)
    row = stage(result, 'config-baseline')
    assert row['configDigests'] == edges.config_digests(World().config)
    journal = [json.loads(l) for l in (tmp_path / 'run' / 'ownership.jsonl').read_text().splitlines()]
    index = next(i for i, e in enumerate(journal) if e['kind'] == 'config-baseline')
    assert journal[index]['digests'] == row['configDigests']
    assert index < next(i for i, e in enumerate(journal) if e.get('id') == 'dup-enable')
    assert result['configEqualsBaseline'] is True and result['cleanupComplete']


def test_cleanup_reads_the_whole_config_back_and_compares_it(tmp_path):
    world, result = run(tmp_path)
    final = [r for r in result['recovery'] if r['id'].startswith('recover-config-final-')]
    assert [r['id'] for r in final] == ['recover-config-final-0'] and final[0]['equalsBaseline'] is True
    order = [r['id'] for r in result['recovery'] if 'status' in r]
    assert order.index('recover-emaillink-readback-0') < order.index('recover-config-final-0')
    assert 'recover-config-final-1' not in world.sent


@pytest.mark.parametrize('option,changed', [({'precedence': 'apply'}, 'mobileLinksConfig'), ({'below_scalar': 'apply'}, 'notification')])
def test_a_probe_that_changed_something_outside_the_toggles_is_needs_recovery(tmp_path, option, changed):
    world, result = run(tmp_path, World(**option))
    final = [r for r in result['recovery'] if r['id'].startswith('recover-config-final-')]
    assert len(final) == 4 and all(r['equalsBaseline'] is False and changed in r['differs'] for r in final)
    assert result['configEqualsBaseline'] is False and not result['cleanupComplete']
    assert result['recordingComplete']
    journal = [json.loads(l) for l in (tmp_path / 'run' / 'ownership.jsonl').read_text().splitlines()]
    assert {'kind': 'recovery-required', 'reason': 'config-differs-from-baseline', 'members': ['whole', changed]} in journal


def test_final_read_retries_until_it_matches_or_the_slots_end(tmp_path):
    world = World()
    seen = []
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'] == 'recover-config-final-0':
            answer[1]['notification']['defaultLocale'] = 'lagging'
        return answer
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert result['configEqualsBaseline'] is True and result['cleanupComplete']
    assert 'recover-config-final-1' in world.sent and 'recover-config-final-2' not in world.sent


def test_no_final_read_without_a_recorded_baseline(tmp_path):
    world = World()
    world.config['mfa'] = {'state': 'DISABLED', 'providerConfigs': [{'state': 'DISABLED'}]}
    world, result = run(tmp_path, world)
    assert not any(x.startswith('recover-config-final') for x in world.sent)
    assert result['configEqualsBaseline'] is None and result['cleanupComplete']


def test_recovery_entry_compares_against_the_journaled_baseline(tmp_path):
    world, first = run(tmp_path, World(fault='delete'))
    world.fault = None
    result = edges.collect(nonce=NONCE, output=tmp_path / 'again', send=world.send_stage, sleep=lambda _: None, recovery_journal=tmp_path / 'run' / 'ownership.jsonl')
    assert result['configEqualsBaseline'] is True and result['cleanupComplete']
    world2, _ = run(tmp_path / 'b', World(fault='delete', precedence='apply'))
    world2.fault = None
    again = edges.collect(nonce=NONCE, output=tmp_path / 'b2', send=world2.send_stage, sleep=lambda _: None, recovery_journal=tmp_path / 'b' / 'run' / 'ownership.jsonl')
    assert again['configEqualsBaseline'] is False and not again['cleanupComplete']


@pytest.mark.parametrize('toggle', ['mfa', 'dup', 'emaillink'])
@pytest.mark.parametrize('applied', [True, False])
def test_a_lost_restore_acknowledgement_is_reported_and_read_back(tmp_path, toggle, applied):
    world = World()
    target = f'recover-{toggle}-restore'
    def send(row, body):
        if row['id'] == target:
            if applied:
                world.send_stage(row, body)
            raise TimeoutError('acknowledgement lost')
        return world.send_stage(row, body)
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    rows = {r['id']: r for r in result['recovery']}
    assert rows[target]['failure'] == 'TimeoutError'
    assert not result['cleanupComplete']
    journal = [json.loads(l) for l in (tmp_path / 'run' / 'ownership.jsonl').read_text().splitlines()]
    unconfirmed = {'kind': 'recovery-required', 'reason': 'config-restore-unconfirmed', 'toggle': toggle}
    if applied:
        assert rows[f'recover-{toggle}-readback-0']['restored'] is True
        assert unconfirmed not in journal
        assert edges.toggle_restored(toggle, world.config)
    else:
        assert all(f'recover-{toggle}-readback-{i}' in rows for i in range(8))
        assert not any(rows[f'recover-{toggle}-readback-{i}'].get('restored') for i in range(8))
        assert unconfirmed in journal
        assert not edges.toggle_restored(toggle, world.config)
    others = [t for t in edges.TOGGLES if t != toggle]
    assert all(edges.toggle_restored(t, world.config) for t in others)
    assert f'recover-{toggle}-restore' in world.sent or not applied


def test_a_failed_restore_read_back_still_tries_the_remaining_slots(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] in ('recover-mfa-readback-0', 'recover-mfa-readback-1'):
            raise TimeoutError('read lost')
        return world.send_stage(row, body)
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    rows = {r['id']: r for r in result['recovery']}
    assert rows['recover-mfa-readback-0']['failure'] == 'TimeoutError' and rows['recover-mfa-readback-0']['superseded'] is True
    assert rows['recover-mfa-readback-2']['restored'] is True and 'recover-mfa-readback-3' not in rows
    assert result['cleanupComplete'] and result['configEqualsBaseline'] is True


def test_every_restore_read_back_failing_leaves_the_toggle_unconfirmed(tmp_path):
    world = World()
    def send(row, body):
        if row['id'].startswith('recover-mfa-readback-'):
            return 503, {'error': {'message': 'UNAVAILABLE'}}
        return world.send_stage(row, body)
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    rows = {r['id']: r for r in result['recovery']}
    assert all(f'recover-mfa-readback-{i}' in rows for i in range(8))
    assert not result['cleanupComplete'] and rows['recover-mfa-readback-7']['failure'] == 'ValueError'
    assert 'superseded' not in rows['recover-mfa-readback-7']


def test_transport_has_no_custom_token_route():
    import transport
    assert not any('signInWithCustomToken' in route for route in transport.CLIENT_ROUTES)
    assert not any('Custom' in route for route in transport.CLIENT_ROUTES | transport.ADMIN_ROUTES)


def test_baseline_out_is_private_exclusive_and_holds_the_three_members(monkeypatch, tmp_path, capsys):
    import os
    import stat
    import transport
    config = World().config
    config['mobileLinksConfig'] = {'domain': 'FIREBASE_DYNAMIC_LINK_DOMAIN'}
    monkeypatch.setattr(transport, 'production_send', lambda: (lambda row, body: (200, config)))
    target = tmp_path / 'config-pre.json'
    monkeypatch.setattr(sys, 'argv', ['edges.py', '--production', '--read-baseline', '--baseline-out', str(target)])
    assert edges.main() == 0
    assert stat.S_IMODE(os.stat(target).st_mode) == 0o600
    saved = json.loads(target.read_text())
    assert saved['digests'] == edges.config_digests(config)
    assert saved['mfa'] == {'state': 'DISABLED'} and saved['mobileLinksConfig'] == config['mobileLinksConfig'] and saved['notification'] == config['notification']
    out = capsys.readouterr().out
    assert 'FIREBASE_DYNAMIC_LINK_DOMAIN' not in out and 'defaultLocale' not in out
    with pytest.raises(FileExistsError):
        edges.main()


def test_baseline_out_is_not_written_on_a_mismatch(monkeypatch, tmp_path):
    import transport
    config = World().config
    config['signIn']['allowDuplicateEmails'] = True
    monkeypatch.setattr(transport, 'production_send', lambda: (lambda row, body: (200, config)))
    target = tmp_path / 'config-pre.json'
    monkeypatch.setattr(sys, 'argv', ['edges.py', '--production', '--read-baseline', '--baseline-out', str(target)])
    assert edges.main() == 2 and not target.exists()


def test_compare_to_baseline_reports_the_named_members():
    config = World().config
    digests = edges.config_digests(config)
    assert edges.differing_members(digests, edges.config_digests(config)) == []
    moved = copy.deepcopy(config)
    moved['mobileLinksConfig'] = {'domain': 'CUSTOM_DOMAIN'}
    assert edges.differing_members(digests, edges.config_digests(moved)) == ['whole', 'mobileLinksConfig']


def test_baseline_out_needs_read_baseline(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, 'argv', ['edges.py', '--production', '--nonce', NONCE, '--output', str(tmp_path / 'run'), '--baseline-out', str(tmp_path / 'x.json')])
    with pytest.raises(SystemExit):
        edges.main()


def test_final_config_read_is_exempt_from_the_account_cleanup_deadline(tmp_path):
    world = World()
    clock = Clock()
    def send(row, body):
        answer = world.send_stage(row, body)
        if row['id'].startswith('recover-'):
            clock.now += 11.5
        return answer
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    assert 'recover-config-final-0' in world.sent
    assert result['configEqualsBaseline'] is not None


def test_baseline_survives_a_chain_of_recovery_runs(tmp_path):
    world, first = run(tmp_path, World(fault='delete'))
    world.fault = None
    second = edges.collect(nonce=NONCE, output=tmp_path / 'second', send=world.send_stage, sleep=lambda _: None, recovery_journal=tmp_path / 'run' / 'ownership.jsonl')
    journal = (tmp_path / 'second' / 'ownership.jsonl').read_text().splitlines()
    assert sum(1 for l in journal if json.loads(l)['kind'] == 'config-baseline') == 1
    world2, _ = run(tmp_path / 'b', World(fault='delete', precedence='apply'))
    world2.fault = None
    edges.collect(nonce=NONCE, output=tmp_path / 'b2', send=world2.send_stage, sleep=lambda _: None, recovery_journal=tmp_path / 'b' / 'run' / 'ownership.jsonl')
    third = edges.collect(nonce=NONCE, output=tmp_path / 'b3', send=world2.send_stage, sleep=lambda _: None, recovery_journal=tmp_path / 'b2' / 'ownership.jsonl')
    assert third['configEqualsBaseline'] is False


@pytest.mark.parametrize('event', [
    {'kind': 'config-baseline', 'nonce': '0' * 32, 'digests': {m: 'a' * 64 for m in edges.DIGEST_MEMBERS}},
    {'kind': 'config-baseline', 'nonce': NONCE, 'digests': {m: 'a' * 63 for m in edges.DIGEST_MEMBERS}},
    {'kind': 'config-baseline', 'nonce': NONCE, 'digests': {m: 'A' * 64 for m in edges.DIGEST_MEMBERS}},
    {'kind': 'config-baseline', 'nonce': NONCE, 'digests': {'whole': 'a' * 64}},
    {'kind': 'config-baseline', 'nonce': NONCE, 'digests': {**{m: 'a' * 64 for m in edges.DIGEST_MEMBERS}, 'extra': 'a' * 64}},
    {'kind': 'config-baseline', 'nonce': NONCE, 'digests': 'x'},
    {'kind': 'config-baseline', 'nonce': NONCE, 'digests': {m: 5 for m in edges.DIGEST_MEMBERS}},
])
def test_a_malformed_baseline_journal_line_is_refused(tmp_path, event):
    journal = tmp_path / 'journal.jsonl'
    journal.write_text(json.dumps(event) + '\n')
    with pytest.raises(ValueError, match='baseline journal'):
        edges.collect(nonce=NONCE, output=tmp_path / 'again', send=World().send_stage, sleep=lambda _: None, recovery_journal=journal)


def test_failed_restore_read_backs_wait_between_slots(tmp_path):
    world = World()
    sleeps = []
    clock = Clock()
    def sleep(seconds):
        sleeps.append(seconds)
        clock.sleep(seconds)
    def send(row, body):
        if row['id'].startswith('recover-mfa-readback-'):
            raise TimeoutError('read lost')
        return world.send_stage(row, body)
    edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=sleep, clock=clock)
    # the stage's own planned waits sleep float seconds; the restore slots sleep the integer 2
    assert [x for x in sleeps if type(x) is int and x == 2] == [2] * 7


def test_a_failed_final_read_is_superseded_by_a_later_equal_one(tmp_path):
    world = World()
    def send(row, body):
        if row['id'] == 'recover-config-final-0':
            raise TimeoutError('read lost')
        return world.send_stage(row, body)
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    rows = {r['id']: r for r in result['recovery']}
    assert rows['recover-config-final-0']['failure'] == 'TimeoutError' and rows['recover-config-final-0']['superseded'] is True
    assert rows['recover-config-final-1']['equalsBaseline'] is True
    assert result['configEqualsBaseline'] is True and result['cleanupComplete']


def test_final_reads_that_never_answer_are_failures_not_equality(tmp_path):
    world = World()
    def send(row, body):
        if row['id'].startswith('recover-config-final-'):
            return 503, {'error': {'message': 'UNAVAILABLE'}}
        return world.send_stage(row, body)
    clock = Clock()
    result = edges.collect(nonce=NONCE, output=tmp_path / 'run', send=send, sleep=clock.sleep, clock=clock)
    final = [r for r in result['recovery'] if r['id'].startswith('recover-config-final-')]
    assert len(final) == 4 and all(r['failure'] == 'ValueError' and 'differs' not in r and 'equalsBaseline' not in r for r in final)
    assert result['configEqualsBaseline'] is False and not result['cleanupComplete']
    journal = [json.loads(l) for l in (tmp_path / 'run' / 'ownership.jsonl').read_text().splitlines()]
    assert {'kind': 'recovery-required', 'reason': 'config-differs-from-baseline', 'members': ['unread']} in journal


def test_config_projections_carry_the_mobile_links_digest(tmp_path):
    world, result = run(tmp_path)
    expected = edges.config_digests(World().config)['mobileLinksConfig'][:16]
    for identifier in ('config-baseline', 'mask-precedence-observe', 'dup-readback-0'):
        row = stage(result, identifier)
        assert (row.get('config') or row)['mobileLinksDigest'] == expected


# ---- v3.3: A2 closes only on the lookup's own validated absence plus equal digests ---------------------------

ABSENT = (200, {'kind': 'identitytoolkit#GetAccountInfoResponse'})


def a2_setup(tmp_path, config=None, receipt='ok', pre_ok=True):
    tmp_path.mkdir(parents=True, exist_ok=True)
    config = config if config is not None else World().config
    digests = edges.config_digests(World().config)
    (tmp_path / 'pre.json').write_text(json.dumps({'digests': digests if pre_ok else {**digests, 'whole': 'z'}}))
    rows = [{'id': 'config-baseline', 'configDigests': digests}]
    if receipt == 'missing-row':
        rows = [{'id': 'preflight-absence'}]
    elif receipt == 'two-rows':
        rows = rows * 2
    elif receipt == 'no-digests':
        rows = [{'id': 'config-baseline'}]
    (tmp_path / 'receipt.json').write_text(json.dumps({'stages': rows}))
    sent = []

    def sender(lookup, answer=ABSENT):
        def send(row, body):
            sent.append((row['path'], row.get('method'), row['owner'], body))
            if row['path'] == edges.CONFIG:
                return 200, copy.deepcopy(config)
            if isinstance(lookup, Exception):
                raise lookup
            return lookup
        return send
    return sent, sender, config


def a2_run(tmp_path, lookup, config=None, **options):
    import a2
    sent, sender, _ = a2_setup(tmp_path, config, **options)
    code = a2.run(NONCE, tmp_path / 'out.json', tmp_path / 'pre.json', tmp_path / 'receipt.json', sender(lookup), sleep=lambda _: None)
    return code, json.loads((tmp_path / 'out.json').read_text()), sent


def test_a2_closes_on_a_typed_absence_and_equal_digests(tmp_path):
    code, result, sent = a2_run(tmp_path, ABSENT)
    assert code == 0 and result['verdict'] == 'CLOSE-OK' and all(result['checks'].values())
    assert [(p, m, o) for p, m, o, _ in sent] == [(edges.ADMIN + 'lookup', 'POST', True), (edges.CONFIG, 'GET', True)]
    assert sent[0][3] == {'email': edges.manifest(NONCE)['addresses']}
    code, result, _ = a2_run(tmp_path / 'users', (200, {'users': []}))
    assert code == 0


@pytest.mark.parametrize('lookup', [
    (500, {'users': []}),
    (500, {'kind': 'identitytoolkit#GetAccountInfoResponse'}),
    (200, {'users': {}}),
    (200, {'users': [1]}),
    (200, {'users': None}),
    (200, {'users': [{'email': 'edges3-x@example.invalid'}]}),
    (200, {'users': [], 'nextPageToken': 't'}),
    (200, {'users': [], 'error': {'message': 'X'}}),
    (200, {'kind': 'other'}),
    (200, {}),
    (200, None),
    (200, []),
    (True, {'users': []}),
    (None, None),
    (302, {'users': []}),
    (200, {'users': [], 'extra': 1}),
])
def test_a2_refuses_every_malformed_or_failed_lookup(tmp_path, lookup):
    code, result, sent = a2_run(tmp_path, lookup)
    assert code == 2 and result['verdict'] == 'NEEDS-RECOVERY' and result['checks']['lookupAbsent'] is False
    assert result['checks']['equalsPreLaunch'] is True and len(sent) == 2


def test_a2_treats_a_failed_send_as_an_unknown_not_a_close(tmp_path):
    code, result, sent = a2_run(tmp_path, TimeoutError('lost'))
    assert code == 2 and result['lookup'] == {'status': None, 'absent': False}


def test_a2_refuses_when_the_config_differs_or_cannot_be_read(tmp_path):
    for index, change in enumerate((lambda c: c.update(mfa={'state': 'ENABLED'}), lambda c: c.update(mobileLinksConfig={'domain': 'CUSTOM_DOMAIN'}), lambda c: c['notification'].update(defaultLocale='ja'), lambda c: c['signIn'].update(allowDuplicateEmails=True), lambda c: c['authorizedDomains'].append('x.example.invalid'))):
        config = World().config
        change(config)
        code, result, _ = a2_run(tmp_path / str(index), ABSENT, config)
        assert code == 2 and result['checks']['equalsPreLaunch'] is False and result['differsFromPreLaunch']
    import a2
    assert a2.evaluate(ABSENT, (503, {'error': {}}), edges.config_digests(World().config), edges.config_digests(World().config))['verdict'] == 'NEEDS-RECOVERY'
    assert a2.evaluate(ABSENT, (200, None), edges.config_digests(World().config), edges.config_digests(World().config))['checks']['configRead'] is False


def test_a2_refuses_when_the_two_baselines_disagree(tmp_path):
    import a2
    digests = edges.config_digests(World().config)
    other = {**digests, 'notification': 'f' * 64}
    result = a2.evaluate(ABSENT, (200, World().config), digests, other)
    assert result['checks']['baselinesAgree'] is False and result['verdict'] == 'NEEDS-RECOVERY'


@pytest.mark.parametrize('options', [{'receipt': 'missing-row'}, {'receipt': 'two-rows'}, {'receipt': 'no-digests'}, {'pre_ok': False}])
def test_a2_checks_its_baselines_before_sending_anything(tmp_path, options):
    import a2
    sent, sender, _ = a2_setup(tmp_path, **options)
    with pytest.raises(ValueError):
        a2.run(NONCE, tmp_path / 'out.json', tmp_path / 'pre.json', tmp_path / 'receipt.json', sender(ABSENT), sleep=lambda _: None)
    assert sent == [] and not (tmp_path / 'out.json').exists()


def test_a2_refuses_a_missing_receipt_or_an_existing_output_before_sending(tmp_path):
    import a2
    sent, sender, _ = a2_setup(tmp_path)
    (tmp_path / 'receipt.json').unlink()
    with pytest.raises(FileNotFoundError):
        a2.run(NONCE, tmp_path / 'out.json', tmp_path / 'pre.json', tmp_path / 'receipt.json', sender(ABSENT), sleep=lambda _: None)
    (tmp_path / 'receipt.json').write_text('{"stages": []}')
    (tmp_path / 'out.json').write_text('{}')
    with pytest.raises(FileExistsError):
        a2.run(NONCE, tmp_path / 'out.json', tmp_path / 'pre.json', tmp_path / 'receipt.json', sender(ABSENT), sleep=lambda _: None)
    assert sent == []
    assert a2.valid_digests({m: 'a' * 64 for m in edges.DIGEST_MEMBERS}) and not a2.valid_digests({'whole': 'a' * 64})


def test_a2_output_names_checks_and_never_the_config_body(tmp_path):
    code, result, _ = a2_run(tmp_path, ABSENT)
    text = (tmp_path / 'out.json').read_text()
    assert '+1650555' not in text and '"defaultLocale"' not in text and '"authorizedDomains"' not in text and '"passwordRequired"' not in text
    assert set(result['checks']) == {'lookupAbsent', 'configRead', 'baselineFindings', 'equalsPreLaunch', 'equalsStageBaseline', 'baselinesAgree'}


def test_a2_digest_validation_never_raises_on_odd_values():
    import a2
    assert a2.valid_digests({m: 5 for m in edges.DIGEST_MEMBERS}) is False
    assert a2.valid_digests({m: None for m in edges.DIGEST_MEMBERS}) is False
    assert a2.valid_digests([]) is False and a2.valid_digests(None) is False


def test_a2_takes_the_baseline_only_from_the_config_baseline_row(tmp_path):
    import a2
    sent, sender, _ = a2_setup(tmp_path)
    digests = edges.config_digests(World().config)
    (tmp_path / 'receipt.json').write_text(json.dumps({'stages': [{'id': 'something-else', 'configDigests': digests}]}))
    with pytest.raises(ValueError):
        a2.run(NONCE, tmp_path / 'out.json', tmp_path / 'pre.json', tmp_path / 'receipt.json', sender(ABSENT), sleep=lambda _: None)
    assert sent == []


def test_a2_needs_the_config_read_to_be_a_clean_200_and_baseline_findings_to_hold():
    import a2
    config = World().config
    digests = edges.config_digests(config)
    assert a2.evaluate(ABSENT, (200, config), digests, digests)['verdict'] == 'CLOSE-OK'
    for status in (500, 302, True, None):
        result = a2.evaluate(ABSENT, (status, config), digests, digests)
        assert result['verdict'] == 'NEEDS-RECOVERY' and result['checks']['configRead'] is False
        assert result['config'] == {'status': status if type(status) is int else None, 'baselineFindings': None, 'digests': None}
        assert result['differsFromPreLaunch'] == list(edges.DIGEST_MEMBERS) == result['differsFromStageBaseline']
    result = a2.evaluate(ABSENT, (200, {**config, 'error': {'message': 'X'}}), digests, digests)
    assert result['checks']['configRead'] is False and result['verdict'] == 'NEEDS-RECOVERY'
    # digests taken from a config that already violates a launch assumption must not close either
    drifted = World().config
    drifted['signIn']['allowDuplicateEmails'] = True
    drifted_digests = edges.config_digests(drifted)
    result = a2.evaluate(ABSENT, (200, drifted), drifted_digests, drifted_digests)
    assert result['checks']['equalsPreLaunch'] and result['checks']['baselineFindings'] is False and result['verdict'] == 'NEEDS-RECOVERY'


def test_a2_reports_each_baseline_separately():
    import a2
    config = World().config
    digests = edges.config_digests(config)
    other = {**digests, 'notification': 'f' * 64}
    result = a2.evaluate(ABSENT, (200, config), digests, other)
    assert result['differsFromPreLaunch'] == [] and result['differsFromStageBaseline'] == ['notification']
    assert a2.evaluate(ABSENT, (200, config), other, digests)['differsFromPreLaunch'] == ['notification']


def test_a2_records_only_integer_statuses(tmp_path):
    code, result, _ = a2_run(tmp_path, (True, {'users': []}))
    assert result['lookup'] == {'status': None, 'absent': False}


def test_a2_never_overwrites_an_output_that_appears_during_the_run(tmp_path):
    import a2
    sent, sender, _ = a2_setup(tmp_path)
    inner = sender(ABSENT)
    def send(row, body):
        (tmp_path / 'out.json').write_text('{"racing": true}')
        return inner(row, body)
    with pytest.raises(FileExistsError):
        a2.run(NONCE, tmp_path / 'out.json', tmp_path / 'pre.json', tmp_path / 'receipt.json', send, sleep=lambda _: None)
    assert (tmp_path / 'out.json').read_text() == '{"racing": true}'
