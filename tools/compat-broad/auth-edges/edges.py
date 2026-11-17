"""Bounded AUTH-EDGES v3 stage; injected admitted transport or loopback rehearsal only.

v3 observes what the closed v2 recording left open: MFA with the project MFA switch enabled, the
duplicate-email reset path, the client email-link and reset routes, the project `mfa` mask and
error-precedence probes, custom-token claim edges and malformed form escapes on the refresh route.
Every request, dependency, wait and cleanup slot is frozen in `manifest` before the first write.
"""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import re
import secrets
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
for directory in (HERE.parent, HERE.parent / 'auth-action-codes', HERE.parent / 'auth-credential-tokens', HERE.parent / 'auth-totp-enroll'):
    sys.path.insert(0, str(directory))

from action_codes_collector import _Run, _loopback_origin, _read_bounded_response, http_opener, BindingError, CollectorError
from action_codes_comparator import _indeterminate
from batch_adapter import Adapter
from broad_contract import digest
from credential_collector import publishable, assert_no_secret
from credential_gate import CredentialGate, absent_response
from mfa_totp import TotpParameters, totp_code

PROJECT = 'fireemu-oracle-idp'
IDT = '/identitytoolkit.googleapis.com'
CLIENT = IDT + '/v1/accounts:'
ADMIN = IDT + f'/v1/projects/{PROJECT}/accounts:'
ADMIN_CREATE = IDT + f'/v1/projects/{PROJECT}/accounts'
MFA_V2 = IDT + '/v2/accounts/'
CONFIG = IDT + f'/admin/v2/projects/{PROJECT}/config'
TOKEN = '/securetoken.googleapis.com/v1/token'
SIGNER = f'firebase-adminsdk-fbsvc@{PROJECT}.iam.gserviceaccount.com'
SIGN_JWT = f'/iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{SIGNER}:signJwt'
AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'
DOMAIN = PROJECT + '.firebaseapp.com'
TEST_PHONES = ('+16505550101', '+16505550102', '+16505550103')
TEST_PHONE_CODE = '123456'
CONTRACT = 'auth-edges-v3'
READBACK_SLOTS = 8
ROLES = ('dupA', 'dupB', 'dupC', 'dupD', 'elDisabled', 'elKnown', 'mfaA', 'mfaW', 'mfaP', 'mfaB', 'sess', 'cred')
FAMILIES = ('dup-reset', 'dup-n3', 'el-client', 'mfa-reuse', 'mfa-quota', 'mfa-window', 'mfa-phone', 'mfa-both', 'mask', 'cred-iat', 'cred-claims', 'cred-lifetime', 'cred-size', 'securetoken-escape')
REFUSALS = ('USER_DISABLED', 'INVALID_OOB_CODE', 'INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'TOKEN_EXPIRED', 'INVALID_ID_TOKEN', 'INVALID_REFRESH_TOKEN', 'UNAUTHORIZED_DOMAIN', 'INVALID_CONTINUE_URI', 'MFA_ENROLLMENT_ALREADY_COMPLETE', 'INVALID_CODE', 'OPERATION_NOT_ALLOWED', 'QUOTA_EXCEEDED', 'INVALID_MFA_PENDING_CREDENTIAL', 'TOO_MANY_ATTEMPTS_TRY_LATER', 'INVALID_CUSTOM_TOKEN', 'CREDENTIAL_MISMATCH', 'EMAIL_EXISTS')
CODE = re.compile(r'[A-Z][A-Z0-9_]{0,63}(?=[:\s]|$)')
SECRET_SUFFIXES = ('.email', '.localId', '.premint', '.enrollment')
PLAIN_VALUES = ('config.defaultLocale',)
MFA_ENABLED = {'state': 'ENABLED', 'enabledProviders': ['PHONE_SMS'], 'providerConfigs': [{'state': 'ENABLED', 'totpProviderConfig': {'adjacentIntervals': 5}}]}
# Order of recovery: the duplicate switch cannot return while duplicate accounts exist.
TOGGLES = {
    'emaillink': dict(mask='signIn.email.passwordRequired', enable={'signIn': {'email': {'passwordRequired': False}}}, restore={'signIn': {'email': {'passwordRequired': True}}}),
    'mfa': dict(mask='mfa', enable={'mfa': MFA_ENABLED}, restore={'mfa': {'state': 'DISABLED'}}),
    'dup': dict(mask='signIn.allowDuplicateEmails', enable={'signIn': {'allowDuplicateEmails': True}}, restore={'signIn': {'allowDuplicateEmails': False}}),
}
RESTORE_ORDER = ('dup', 'mfa', 'emaillink')
# Probe writes: mask -> the only body shapes the transport may carry besides the toggles.
PROBE_MASKS = ('mfa.state', 'mfa', 'mfa.state,mobileLinksConfig.domain', 'notification.defaultLocale.a')
CONFIG_MASKS = tuple(dict.fromkeys([*(t['mask'] for t in TOGGLES.values()), *PROBE_MASKS]))
CONFIG_MEMBERS = ('signIn', 'mfa', 'mobileLinksConfig', 'notification')


def config_state(body):
    """Project the three toggled switches out of a config answer; None means omitted."""
    email = (body.get('signIn') or {}).get('email') or {}
    mfa = body.get('mfa') or {}
    providers = mfa.get('providerConfigs') or [] if isinstance(mfa, dict) else []
    return {
        'emailEnabled': email.get('enabled'),
        'passwordRequired': email.get('passwordRequired'),
        'mfaState': mfa.get('state') if isinstance(mfa, dict) else None,
        'mfaProviderEnabled': any(isinstance(p, dict) and p.get('state') in ('ENABLED', 'MANDATORY') for p in providers),
        'totpIntervals': next((p['totpProviderConfig'].get('adjacentIntervals') for p in providers if isinstance(p, dict) and isinstance(p.get('totpProviderConfig'), dict)), None),
        'allowDuplicateEmails': (body.get('signIn') or {}).get('allowDuplicateEmails'),
    }


def toggle_applied(name, body):
    state = config_state(body)
    if name == 'emaillink':
        return state['emailEnabled'] is True and state['passwordRequired'] in (False, None)
    if name == 'mfa':
        return state['mfaState'] == 'ENABLED' and state['totpIntervals'] == 5 and state['mfaProviderEnabled']
    return state['allowDuplicateEmails'] is True


def toggle_restored(name, body):
    state = config_state(body)
    if name == 'emaillink':
        return state['passwordRequired'] is True
    if name == 'mfa':
        return state['mfaState'] in (None, 'DISABLED') and not state['mfaProviderEnabled']
    return state['allowDuplicateEmails'] in (None, False)


def get_path(value, path):
    for part in path.split('.'):
        if isinstance(value, list):
            value = value[int(part)] if part.isdigit() and int(part) < len(value) else None
        else:
            value = value.get(part) if isinstance(value, dict) else None
    return value


def manifest(nonce):
    """Freeze every request, dependency, wait and cleanup slot before the first write."""
    if not isinstance(nonce, str) or not re.fullmatch('[0-9a-f]{32}', nonce):
        raise ValueError('fresh 32-character hexadecimal nonce required')

    def address(label):
        return f'edges3-{nonce}-{label}@example.invalid'

    emails = {'dupA': address('dup1'), 'dupB': address('dup2'), 'dupC': address('dup3'), 'dupD': address('dup3'), 'elDisabled': address('eldis'), 'elKnown': address('elknown'), 'mfaA': address('mfaa'), 'mfaW': address('mfaw'), 'mfaP': address('mfap'), 'mfaB': address('mfab'), 'sess': address('sess')}
    unknown_address = address('elunknown')
    accounts = {role: {'email': emails.get(role)} for role in ROLES}
    accounts['cred']['uid'] = 'edges3' + nonce + 'cred'
    aliases = {'dupB': [emails['dupA']]}
    addresses = sorted({*emails.values(), unknown_address})
    rows = []

    def add(identifier, role, path, body, *, kind='setup', owner=False, family='', required=(), binds=None, method='POST', open=False, readback=True, wait=None, mark=False, pre=(), since=None, premint=False, refusals=(), optional=False):
        row = dict(id=identifier, account=role, path=path, method=method, body=body, owner=owner, kind=kind, family=family, required=list(required), refusals=[*REFUSALS, *refusals], binds=binds or {}, open=open, wait=wait, mark=mark, pre=list(pre), since=since, premint=premint, optional=optional, paired=bool(readback and role is not None and kind == 'diagnostic'))
        rows.append(row)
        return row

    def read(identifier, role, family=''):
        return add(identifier + '-readback', role, ADMIN + 'lookup', {'localId': ['$binding:' + role + '.localId']}, kind='readback', owner=True, family=family, required=('users',))

    def diag(identifier, role, path, body, family, *, owner=False, required=(), readback=True, **extra):
        row = add(identifier, role, path, body, kind='diagnostic', owner=owner, family=family, required=required, readback=readback, **extra)
        if readback and role is not None:
            read(identifier, role, family)
        return row

    def config(identifier, toggle, phase, method, body, mask=None):
        path = CONFIG + ('?updateMask=' + mask if mask else '')
        row = add(identifier, None, path, body, kind='config', owner=True, method=method)
        row.update(toggle=toggle, phase=phase)
        return row

    def enable(toggle):
        spec = TOGGLES[toggle]
        config(toggle + '-enable', toggle, 'enable', 'PATCH', spec['enable'], spec['mask'])
        for i in range(READBACK_SLOTS):
            config(f'{toggle}-readback-{i}', toggle, 'readback', 'GET', None)

    def create(role, *, admin=False, optional=False):
        if admin:
            return add('create-' + role, role, ADMIN_CREATE, {'email': emails[role]}, kind='create', owner=True, required=('localId',), binds={role + '.localId': 'localId'}, open='code' if optional else False, optional=optional), read('create-' + role, role)
        row = add('create-' + role, role, CLIENT + 'signUp', {'email': emails[role], 'password': '$binding:' + role + '.password', 'returnSecureToken': True}, kind='create', required=('localId', 'idToken', 'refreshToken'), binds={role + '.localId': 'localId', role + '.idToken': 'idToken', role + '.refreshToken': 'refreshToken'})
        return row, read('create-' + role, role)

    def verify(role):
        add('verify-' + role, role, ADMIN + 'update', {'localId': '$binding:' + role + '.localId', 'emailVerified': True}, owner=True, required=('localId',))

    def password_sign_in(identifier, role, family, *, password=None, **extra):
        return diag(identifier, role, CLIENT + 'signInWithPassword', {'email': emails[role], 'password': '$binding:' + (password or role + '.password'), 'returnSecureToken': True}, family, readback=False, open='code', **extra)

    # ---- preflight and baseline ------------------------------------------------------
    add('preflight-absence', None, ADMIN + 'lookup', {'email': addresses}, kind='preflight', owner=True, required=('users',))
    add('preflight-cred-absence', None, ADMIN + 'lookup', {'localId': ['$binding:cred.premint']}, kind='preflight', owner=True, required=('users',))
    add('config-baseline', None, CONFIG, None, kind='config', owner=True, method='GET').update(toggle=None, phase='baseline')

    # ---- duplicate-email reset path (item: resetPassword in duplicate-email mode, N3) -----
    enable('dup')
    create('dupA')
    create('dupB')
    reset_family = 'dup-reset'
    password_sign_in('dup-signin-before-a', 'dupA', reset_family, password='dupA.password')
    diag('dup-issue-1', 'dupA', ADMIN + 'sendOobCode', {'email': emails['dupA'], 'requestType': 'PASSWORD_RESET', 'returnOobLink': True}, reset_family, owner=True, required=('oobCode',), binds={'dup.code1': 'oobCode'}, open='code')
    diag('dup-move-b', 'dupB', ADMIN + 'update', {'localId': '$binding:dupB.localId', 'email': emails['dupA']}, reset_family, owner=True, required=('localId',), open='code')
    diag('dup-reset-1', 'dupA', CLIENT + 'resetPassword', {'oobCode': '$binding:dup.code1', 'newPassword': '$binding:dup.newPassword1'}, reset_family, required=('email',), open='code')
    read('dup-after-reset-1-b', 'dupB', reset_family)
    for label, password in (('new1', 'dup.newPassword1'), ('a', 'dupA.password'), ('b', 'dupB.password')):
        password_sign_in('dup-signin-1-' + label, 'dupA', reset_family, password=password)
    diag('dup-issue-2', 'dupA', ADMIN + 'sendOobCode', {'email': emails['dupA'], 'requestType': 'PASSWORD_RESET', 'returnOobLink': True}, reset_family, owner=True, required=('oobCode',), binds={'dup.code2': 'oobCode'}, open='code')
    diag('dup-reset-2', 'dupA', CLIENT + 'resetPassword', {'oobCode': '$binding:dup.code2', 'newPassword': '$binding:dup.newPassword2'}, reset_family, required=('email',), open='code')
    read('dup-after-reset-2-b', 'dupB', reset_family)
    for label, password in (('new2', 'dup.newPassword2'), ('new1', 'dup.newPassword1')):
        password_sign_in('dup-signin-2-' + label, 'dupA', reset_family, password=password)
    create('dupC', admin=True)
    create('dupD', admin=True, optional=True)
    diag('dup-set-password-d', 'dupD', ADMIN + 'update', {'localId': '$binding:dupD.localId', 'password': '$binding:dupD.password'}, 'dup-n3', owner=True, required=('localId',), open='code')
    password_sign_in('dup-n3-signin', 'dupC', 'dup-n3', password='dupD.password')

    # ---- client email-link and reset routes (AUTH-ACTION items 5 and 11, client route) -----
    enable('emaillink')
    create('elDisabled')
    create('elKnown')
    add('disable-eldisabled', 'elDisabled', ADMIN + 'update', {'localId': '$binding:elDisabled.localId', 'disableUser': True}, owner=True, required=('localId',))
    read('disable-eldisabled', 'elDisabled')
    url = 'https://' + DOMAIN + '/edge'
    for label, who in (('disabled', emails['elDisabled']), ('known', emails['elKnown']), ('unknown', unknown_address)):
        diag('el-signin-' + label, None, CLIENT + 'sendOobCode', {'requestType': 'EMAIL_SIGNIN', 'email': who, 'continueUrl': url, 'canHandleCodeInApp': True}, 'el-client', readback=False, open='code')
    for label, who, target in (('known-ok', emails['elKnown'], url), ('known-untrusted', emails['elKnown'], 'https://example.invalid/edge'), ('known-relative', emails['elKnown'], '/edge'), ('unknown-untrusted', unknown_address, 'https://example.invalid/edge'), ('unknown-relative', unknown_address, '/edge')):
        diag('el-reset-' + label, None, CLIENT + 'sendOobCode', {'requestType': 'PASSWORD_RESET', 'email': who, 'continueUrl': target}, 'el-client', readback=False, open='code')

    # ---- MFA with the project switch enabled ------------------------------------------------
    enable('mfa')

    def totp_pre(role, offset, out, *, wrong=False):
        return [{'op': 'wrong-totp' if wrong else 'totp', 'role': role, 'offset': offset, 'out': out}]

    def mfa_user(role):
        create(role)
        verify(role)

    def sign_in_token(identifier, role, out, family, *, mark=False):
        diag(identifier, role, CLIENT + 'signInWithPassword', {'email': emails[role], 'password': '$binding:' + role + '.password', 'returnSecureToken': True}, family, required=('idToken',), binds={out: 'idToken'}, readback=False, mark=mark)

    def totp_enroll(role, family):
        sign_in_token(role + '-signin', role, role + '.freshId', family)
        diag(role + '-totp-start', role, MFA_V2 + 'mfaEnrollment:start', {'idToken': '$binding:' + role + '.freshId', 'totpEnrollmentInfo': {}}, family, required=('totpSessionInfo',), binds={role + '.session': 'totpSessionInfo.sessionInfo', role + '.secret': 'totpSessionInfo.sharedSecretKey'})
        diag(role + '-totp-finalize', role, MFA_V2 + 'mfaEnrollment:finalize', {'idToken': '$binding:' + role + '.freshId', 'totpVerificationInfo': {'sessionInfo': '$binding:' + role + '.session', 'verificationCode': '$binding:' + role + '.code0'}, 'displayName': 'auth-edges'}, family, required=('idToken',), binds={role + '.finalizedId': 'idToken'}, pre=totp_pre(role, 0, role + '.code0'))

    def pending(identifier, role, family, name, *, wait=None, mark=False):
        diag(identifier, role, CLIENT + 'signInWithPassword', {'email': emails[role], 'password': '$binding:' + role + '.password', 'returnSecureToken': True}, family, required=('mfaPendingCredential',), binds={role + '.' + name: 'mfaPendingCredential', role + '.enrollment': 'mfaInfo.0.mfaEnrollmentId'}, readback=False, wait=wait, mark=mark)

    def totp_sign_in(identifier, role, family, name, code, *, wait=None, pre=(), mark=False):
        diag(identifier, role, MFA_V2 + 'mfaSignIn:finalize', {'mfaPendingCredential': '$binding:' + role + '.' + name, 'mfaEnrollmentId': '$binding:' + role + '.enrollment', 'totpVerificationInfo': {'verificationCode': '$binding:' + role + '.' + code}}, family, readback=False, open='code', wait=wait, pre=pre, mark=mark, since=wait['after'] if wait else None)

    # item 2 setup: four pending credentials issued back to back, probed at 296..302 seconds
    mfa_user('mfaW')
    totp_enroll('mfaW', 'mfa-window')
    window = (296, 298, 300, 302)
    for i in range(4):
        pending(f'w-pending-{i}', 'mfaW', 'mfa-window', f'pending{i}', mark=True)
    # item 3 setup: one sign-in whose token ages 345 seconds before the aged phone requests
    mfa_user('mfaP')
    sign_in_token('p-signin', 'mfaP', 'mfaP.freshId', 'mfa-phone', mark=True)
    for i, number in enumerate(TEST_PHONES[:2], start=1):
        diag(f'p-start-{i}', 'mfaP', MFA_V2 + 'mfaEnrollment:start', {'idToken': '$binding:mfaP.freshId', 'phoneEnrollmentInfo': {'phoneNumber': number}}, 'mfa-phone', required=('phoneSessionInfo.sessionInfo',), binds={f'mfaP.phoneSession{i}': 'phoneSessionInfo.sessionInfo'}, open='code')
    diag('p-finalize-fresh', 'mfaP', MFA_V2 + 'mfaEnrollment:finalize', {'idToken': '$binding:mfaP.freshId', 'phoneVerificationInfo': {'sessionInfo': '$binding:mfaP.phoneSession1', 'code': TEST_PHONE_CODE}, 'displayName': 'edges-phone'}, 'mfa-phone', required=('idToken',), open='code')
    # items 1 and 6: enrollment completion reuse, then wrong codes until the quota answers
    mfa_user('mfaA')
    totp_enroll('mfaA', 'mfa-reuse')
    diag('a-totp-reuse', 'mfaA', MFA_V2 + 'mfaEnrollment:finalize', {'idToken': '$binding:mfaA.finalizedId', 'totpVerificationInfo': {'sessionInfo': '$binding:mfaA.session', 'verificationCode': '$binding:mfaA.code1'}, 'displayName': 'auth-edges'}, 'mfa-reuse', required=('idToken',), open='code', pre=totp_pre('mfaA', 1, 'mfaA.code1'))
    pending('a-pending-1', 'mfaA', 'mfa-quota', 'pending1')
    for k in range(1, 9):
        totp_sign_in(f'a-wrong-{k}', 'mfaA', 'mfa-quota', 'pending1', f'wrong{k}', pre=totp_pre('mfaA', 7 + k, f'mfaA.wrong{k}', wrong=True), mark=(k == 8))
    pending('a-pending-2', 'mfaA', 'mfa-quota', 'pending2')
    totp_sign_in('a-correct-after', 'mfaA', 'mfa-quota', 'pending2', 'correct0', pre=totp_pre('mfaA', 3, 'mfaA.correct0'))
    for label, seconds, step in (('60', 60, 4), ('180', 180, 2)):
        pending('a-pending-' + label, 'mfaA', 'mfa-quota', 'pending' + label, wait={'after': 'a-wrong-8', 'seconds': seconds - 2})
        totp_sign_in('a-wrong-' + label, 'mfaA', 'mfa-quota', 'pending1', 'wrong' + label, wait={'after': 'a-wrong-8', 'seconds': seconds}, pre=totp_pre('mfaA', 20, 'mfaA.wrong' + label, wrong=True))
        totp_sign_in('a-correct-' + label, 'mfaA', 'mfa-quota', 'pending' + label, 'correct' + label, wait={'after': 'a-wrong-8', 'seconds': seconds + 1}, pre=totp_pre('mfaA', step, 'mfaA.correct' + label))
    # item 2 probes, each at its own age counted from its own pending response
    for i, seconds in enumerate(window):
        totp_sign_in(f'w-probe-{i}', 'mfaW', 'mfa-window', f'pending{i}', f'wrong{i}', wait={'after': f'w-pending-{i}', 'seconds': seconds}, pre=totp_pre('mfaW', 8 + i, f'mfaW.wrong{i}', wrong=True))
    # item 3 aged requests: a start and a finalize on the 345-second-old token
    diag('p-start-aged', 'mfaP', MFA_V2 + 'mfaEnrollment:start', {'idToken': '$binding:mfaP.freshId', 'phoneEnrollmentInfo': {'phoneNumber': TEST_PHONES[2]}}, 'mfa-phone', required=('phoneSessionInfo.sessionInfo',), open='code', wait={'after': 'p-signin', 'seconds': 345})
    diag('p-finalize-aged', 'mfaP', MFA_V2 + 'mfaEnrollment:finalize', {'idToken': '$binding:mfaP.freshId', 'phoneVerificationInfo': {'sessionInfo': '$binding:mfaP.phoneSession2', 'code': TEST_PHONE_CODE}, 'displayName': 'edges-phone-aged'}, 'mfa-phone', required=('idToken',), open='code', wait={'after': 'p-signin', 'seconds': 347})
    # item 8: one Admin enrollment carrying both phoneInfo and totpInfo
    mfa_user('mfaB')
    diag('b-admin-both', 'mfaB', ADMIN + 'update', {'localId': '$binding:mfaB.localId', 'mfa': {'enrollments': [{'phoneInfo': TEST_PHONES[2], 'totpInfo': {}, 'displayName': 'edges-both'}]}}, 'mfa-both', owner=True, required=('localId',), open='code')

    # ---- project mfa mask and error precedence, then the below-scalar mask ----------------
    def probe(identifier, mask, body):
        add(identifier, None, CONFIG + '?updateMask=' + mask, body, kind='probe', owner=True, family='mask', method='PATCH', open='any')
        add(identifier + '-observe', None, CONFIG, None, kind='probe', owner=True, family='mask', method='GET', open='any')

    providers = MFA_ENABLED['providerConfigs'][0]
    probe('mask-state', 'mfa.state', {'mfa': {'state': 'ENABLED'}})
    probe('mask-interval-string', 'mfa', {'mfa': {**MFA_ENABLED, 'providerConfigs': [{**providers, 'totpProviderConfig': {'adjacentIntervals': '5'}}]}})
    probe('mask-interval-number', 'mfa', {'mfa': MFA_ENABLED})
    probe('mask-state-numeric', 'mfa', {'mfa': {**MFA_ENABLED, 'state': 2}})
    probe('mask-precedence', 'mfa.state,mobileLinksConfig.domain', {'mfa': {'state': 'NOT_A_STATE'}, 'mobileLinksConfig': {'domain': 'CUSTOM_DOMAIN'}})
    probe('mask-below-scalar', 'notification.defaultLocale.a', {'notification': {'defaultLocale': '$binding:config.defaultLocale'}})

    # ---- custom-token claim edges (AUTH-CREDENTIAL items 9, 10, 14), signing is optional -----
    tokens = [('control', 'cred-claims', {}), *[(f'iat{k}', 'cred-iat', {'iatOffset': k}) for k in (299, 300, 301, 302)]]
    tokens += [(name, 'cred-claims', {'claims': {name: value}}) for name, value in (('email', 'edges@example.invalid'), ('email_verified', True), ('identities', {'edges': ['x']}), ('phone_number', TEST_PHONES[0]), ('sign_in_provider', 'custom'))]
    tokens += [('life3601', 'cred-lifetime', {'lifetime': 3601}), ('lifeneg', 'cred-lifetime', {'iatOffset': 30, 'lifetime': -10})]
    tokens += [(f'size{n}', 'cred-size', {'padBytes': n}) for n in (1500, 4000, 8000)]
    for label, family, spec in tokens:
        add('sign-' + label, 'cred', SIGN_JWT, {'payload': '$binding:claims.' + label}, kind='sign', owner=True, family=family, required=('signedJwt',), binds={'token.' + label: 'signedJwt'}, mark=True, pre=[{'op': 'claims', 'label': label, 'spec': spec, 'out': 'claims.' + label}])
        body = {'token': '$binding:token.' + label, 'returnSecureToken': True}
        if label == 'control':
            add('cred-control', 'cred', CLIENT + 'signInWithCustomToken', body, kind='diagnostic', family=family, required=('idToken',), binds={'cred.idToken': 'idToken'}, open='code', premint=True, since='sign-control')
            read('cred-control', 'cred', family)
        else:
            add('cred-' + label, 'cred', CLIENT + 'signInWithCustomToken', body, kind='diagnostic', family=family, open='code', since='sign-' + label)

    # ---- malformed escapes in form fields the refresh route does not read -----------------
    create('sess')
    for label, suffix in (('control', ''), ('unread-zz', '&extra=%zz'), ('unread-trailing', '&extra=%'), ('unread-short', '&extra=%2'), ('unread-utf8', '&extra=%C3%28'), ('key-zz', '&%zz=1')):
        add('st-' + label, 'sess', TOKEN, {'grant_type': 'refresh_token', 'refresh_token': '$binding:sess.refreshToken', 'rawSuffix': suffix}, kind='diagnostic', family='securetoken-escape', required=('id_token', 'user_id'), open='code')

    # ---- recovery: accounts by journaled UID first, then each toggle in reverse order ------
    lookup_body = {'email': addresses}
    recovery = []
    for identifier in ('recover-discover', 'recover-absence'):
        recovery.append(dict(id=identifier, path=ADMIN + 'lookup', method='POST', body=lookup_body, owner=True, kind='recovery', routeClass='admin'))
    recovery.insert(1, dict(id='recover-discover-uid', path=ADMIN + 'lookup', method='POST', body={'localId': ['$binding:cred.premint']}, owner=True, kind='recovery', routeClass='admin'))
    for role in ROLES:
        recovery.insert(-1, dict(id='recover-delete-' + role, path=ADMIN + 'delete', method='POST', body={'localId': '$binding:' + role + '.localId'}, owner=True, kind='delete', routeClass='admin'))
    for role in ROLES:
        recovery.insert(-1, dict(id='recover-uid-absence-' + role, path=ADMIN + 'lookup', method='POST', body={'localId': ['$binding:' + role + '.localId']}, owner=True, kind='recovery', routeClass='admin'))
    for toggle in RESTORE_ORDER:
        spec = TOGGLES[toggle]
        recovery.append(dict(id=f'recover-{toggle}-restore', path=CONFIG + '?updateMask=' + spec['mask'], method='PATCH', body=spec['restore'], owner=True, kind='config', toggle=toggle))
        for i in range(READBACK_SLOTS):
            recovery.append(dict(id=f'recover-{toggle}-readback-{i}', path=CONFIG, method='GET', body=None, owner=True, kind='config', toggle=toggle))
    return dict(contract=CONTRACT, project=PROJECT, nonce=nonce, ownedAccounts=accounts, aliases=aliases, addresses=addresses, unknownAddress=unknown_address, stages=rows, recovery=recovery, budget=dict(observationRequests=len(rows), recoveryRequests=len(recovery), totalRequests=len(rows) + len(recovery), wallSeconds=1200, recoverySeconds=630, configRestoreSeconds=450, requestsPerSecond=4, planningCeilingUsd=0.10), productionExecutable=False)


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


def required_ok(row, body):
    for key in row['required']:
        value = body.get(key) if '.' not in key else get_path(body, key)
        if key == 'users':
            if not isinstance(value, list):
                return False
        elif key == 'totpSessionInfo':
            if not isinstance(value, dict) or any(not isinstance(value.get(k), str) or not value[k] for k in ('sessionInfo', 'sharedSecretKey', 'hashingAlgorithm')) or type(value.get('periodSec')) is not int or type(value.get('verificationCodeLength')) is not int:
                return False
            try:
                totp_parameters(value)
            except (ValueError, TypeError):
                return False
        elif not isinstance(value, str) or not value:
            return False
    return True


def totp_parameters(info):
    return TotpParameters(info['periodSec'], info['verificationCodeLength'], {'SHA1': 'HMAC_SHA1', 'HMAC_SHA1': 'HMAC_SHA1'}.get(info['hashingAlgorithm'], ''))


def judge(row, status, body):
    """Observation is not compatibility: unfamiliar answers require owned read-back."""
    unknown = {**_indeterminate('unknown edge answer; owned read-back required'), 'readBackRequired': True}
    if type(status) is not int or not isinstance(body, dict):
        return unknown
    if row['kind'] == 'preflight' and absent_response(status, body):
        return {'classification': 'OBSERVED', 'outcome': 'accepted', 'readBackRequired': False}
    error = body.get('error')
    openness = row.get('open', False)
    if status == 400 and isinstance(error, dict):
        if openness == 'any':
            return {'classification': 'OBSERVED', 'outcome': 'refused', 'readBackRequired': True}
        message = error.get('message')
        if isinstance(message, str):
            code = message.split(' : ', 1)[0]
            if code in row['refusals'] or (openness == 'code' and CODE.fullmatch(code)):
                return {'classification': 'OBSERVED', 'outcome': 'refused', 'readBackRequired': True}
        return unknown
    if status != 200 or ('error' in body and not (row.get('path', '').endswith('batchCreate') and isinstance(body['error'], list))):
        return unknown
    if not required_ok(row, body):
        return unknown
    return {'classification': 'OBSERVED', 'outcome': 'accepted', 'readBackRequired': True}


class StageRun(_Run):
    """Use the action collector's phase budgets and cleanup with an exact slot guard."""

    def __init__(self, plan, output, send, sleep, clock):
        budget = plan['budget']
        super().__init__('', PROJECT, plan['nonce'], send, budget['observationRequests'], budget['recoveryRequests'], budget['wallSeconds'], budget['recoverySeconds'], clock, 4, sleep)
        self.plan, self.output = plan, output
        self.journal = output / 'ownership.jsonl'
        self.guard = Guard(plan['stages'], self.secrets)
        self.recovery_guard = Guard(plan['recovery'], self.secrets)
        self.current = None
        self.attempted = set()
        self.toggles = {}
        self.marks = {}
        self.totp = {}
        self.confirmed = set()
        self.record = lambda event: Adapter.record(self, event)

    def wait_until(self, anchor, seconds):
        """Sleep to `seconds` after a recorded mark; the late amount is returned, never hidden."""
        if anchor not in self.marks:
            raise BindingError('unbound wait anchor: ' + anchor)
        target = self.marks[anchor] + seconds
        while self.clock() < target:
            self.check_deadline()
            self.sleep(max(0.0, min(5.0, target - self.clock())))
        return self.clock() - target

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
        if self.recovering and row['kind'] != 'config' and self.clock() - self.recovery_started >= self.plan['budget']['recoverySeconds'] - self.plan['budget']['configRestoreSeconds']:
            raise CollectorError('account recovery deadline; config reserve retained')
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


def owned_roles(plan, email):
    return [r for r, a in plan['ownedAccounts'].items() if a['email'] == email or email in plan['aliases'].get(r, [])]


def recover(run, plan):
    """Delete only journal-confirmed UIDs, then restore every attempted toggle."""
    rows, failures, uid_proofs = [], 0, []
    unknown = run.attempted - run.owned.keys()
    if unknown:
        run.record({'kind': 'recovery-required', 'reason': 'unconfirmed-create', 'accounts': sorted(unknown)})
    remaining, proven = len(plan['ownedAccounts']), False
    deleted = set()
    discovery = {}
    discovered_uids = None
    restored = {}
    try:
        for row in plan['recovery']:
            if row['kind'] == 'config':
                break
            role = row['id'].removeprefix('recover-delete-').removeprefix('recover-uid-absence-')
            uid = run.secrets.get(role + '.localId')
            if row['kind'] == 'delete' or row['id'].startswith('recover-uid-absence-'):
                if uid is None:
                    rows.append({'id': row['id'], 'skipped': 'no immutable create UID'})
                    continue
                if row['kind'] == 'delete' and discovered_uids is not None and uid not in discovered_uids:
                    rows.append({'id': row['id'], 'skipped': 'absent at discovery'})
                    continue
                if row['kind'] == 'delete' and uid in deleted:
                    rows.append({'id': row['id'], 'skipped': 'alias UID already attempted'})
                    continue
            record = {'id': row['id']}
            try:
                if row['kind'] == 'delete':
                    deleted.add(uid)
                status, body = run.request(row['path'], row['body'], True)
                record['status'] = status if type(status) is int else None
                if row['kind'] == 'delete':
                    if type(status) is not int or status != 200 or not isinstance(body, dict) or 'error' in body:
                        raise ValueError('delete answer unknown')
                    record['deleted'] = True
                elif row['id'].startswith('recover-uid-absence-'):
                    valid = absent_response(status, body)
                    uid_proofs.append(valid)
                    if not valid:
                        raise ValueError('UID absence unproven')
                    record['uidAbsent'] = True
                else:
                    if type(status) is not int or status != 200 or not isinstance(body, dict) or 'error' in body or 'nextPageToken' in body or not isinstance(body.get('users'), list) or body.get('kind', 'identitytoolkit#GetAccountInfoResponse') != 'identitytoolkit#GetAccountInfoResponse':
                        raise ValueError('address lookup invalid')
                    seen = set()
                    for user in body['users']:
                        if not isinstance(user, dict):
                            raise ValueError('address identity invalid')
                        email, found_uid = user.get('email'), user.get('localId')
                        names = owned_roles(plan, email) if email is not None else [r for r, a in plan['ownedAccounts'].items() if a.get('uid') == found_uid]
                        if not names or not isinstance(found_uid, str) or not found_uid or found_uid in seen or any(ord(c) < 32 or ord(c) == 127 for c in found_uid):
                            raise ValueError('address identity invalid')
                        seen.add(found_uid)
                        known = {run.secrets.get(n + '.localId') for n in names} - {None}
                        if found_uid not in known:
                            if len(known) == len(names):
                                raise ValueError('address UID conflicts with creation')
                            # Discovery is read-only evidence; it never grants deletion authority.
                            run.record({'kind': 'recovery-required', 'reason': 'unconfirmed-address', 'accounts': names})
                    if row['id'] in ('recover-discover', 'recover-discover-uid'):
                        discovery[row['id']] = seen
                        if len(discovery) == 2:
                            discovered_uids = discovery['recover-discover'] | discovery['recover-discover-uid']
                    record['presentAddresses'] = len(body['users'])
                    if row['id'] == 'recover-absence':
                        remaining, proven = len(body['users']), True
            except (Exception, KeyboardInterrupt) as error:
                record['failure'] = type(error).__name__
                if row['kind'] == 'delete':
                    failures += 1
            rows.append(record)
    finally:
        # AUTH-ACTION restores after account cleanup even if cleanup failed.
        for toggle in RESTORE_ORDER:
            for row in (r for r in plan['recovery'] if r['kind'] == 'config' and r['toggle'] == toggle):
                if row['method'] == 'PATCH' and not run.toggles.get(toggle):
                    rows.append({'id': row['id'], 'skipped': 'config-not-attempted'})
                    continue
                if row['method'] == 'GET' and (restored.get(toggle) or not run.toggles.get(toggle)):
                    break
                record = {'id': row['id']}
                try:
                    status, body = run.request(row['path'], row['body'], True)
                    record['status'] = status if type(status) is int else None
                    if type(status) is not int or status != 200 or not isinstance(body, dict) or 'error' in body:
                        raise ValueError('config restore answer unknown')
                    if row['method'] == 'GET':
                        restored[toggle] = toggle_restored(toggle, body)
                        record['restored'] = restored[toggle]
                        if not restored[toggle]:
                            if row['id'].endswith(f'readback-{READBACK_SLOTS - 1}'):
                                raise ValueError('config restore did not read back')
                            run.sleep(2)
                except (Exception, KeyboardInterrupt) as error:
                    record['failure'] = type(error).__name__
                    # A lost PATCH reply still requires its own GET read-back.
                    if row['method'] == 'GET':
                        rows.append(record)
                        break
                rows.append(record)
            if run.toggles.get(toggle) and not restored.get(toggle):
                run.record({'kind': 'recovery-required', 'reason': 'config-restore-unconfirmed', 'toggle': toggle})
    all_restored = all(restored.get(t) for t in RESTORE_ORDER if run.toggles.get(t))
    complete = proven and remaining == 0 and not unknown and all(uid_proofs) and all_restored and not any('failure' in r for r in rows)
    return rows, complete, remaining, failures, proven


def secret_values(run):
    return [v for k, v in run.secrets.items() if not k.endswith(SECRET_SUFFIXES) and k not in PLAIN_VALUES]


def error_code(body):
    message = body.get('error', {}).get('message') if isinstance(body.get('error'), dict) else None
    code = CODE.match(message) if isinstance(message, str) else None
    return code.group() if code else ''


def scrub(text):
    """A bounded, number-masked copy of an error sentence for config probes only."""
    return re.sub(r'\d{6,}', '<n>', text)[:240]


def project_users(row, body, run, plan):
    users = []
    for u in body['users']:
        if not isinstance(u, dict):
            continue
        enrollments = [{'phone': 'phoneInfo' in e, 'totp': 'totpInfo' in e} for e in (u['mfaInfo'] if isinstance(u.get('mfaInfo'), list) else []) if isinstance(e, dict)]
        role = next((r for r, a in plan['ownedAccounts'].items() if run.secrets.get(r + '.localId') == u.get('localId')), None)
        stamps = {k: u.get(k) for k in ('passwordUpdatedAt', 'validSince') if isinstance(u.get(k), (int, float, str)) and not isinstance(u.get(k), bool)}
        previous = run.previous.get(role, {})
        user = {
            'uidMatches': row.get('account') is not None and u.get('localId') == run.secrets.get(row['account'] + '.localId'),
            'uidRole': role,
            'emailRoles': owned_roles(plan, u.get('email')) if u.get('email') is not None else [],
            'disabled': u.get('disabled', u.get('disableUser', False)) if type(u.get('disabled', u.get('disableUser', False))) is bool else None,
            'providers': sorted(p['providerId'] for p in (u['providerUserInfo'] if isinstance(u.get('providerUserInfo'), list) else []) if isinstance(p, dict) and p.get('providerId') in ('password', 'phone')),
            'emailVerified': u.get('emailVerified') if type(u.get('emailVerified')) is bool else None,
            'passwordHashPresent': bool(u.get('passwordHash')),
            'providerCount': len(u['providerUserInfo']) if isinstance(u.get('providerUserInfo'), list) else None,
            'mfaCount': len(u['mfaInfo']) if isinstance(u.get('mfaInfo'), list) else None,
            'mfaEntries': enrollments,
            'passwordUpdatedAtChanged': (stamps.get('passwordUpdatedAt') != previous.get('passwordUpdatedAt')) if 'passwordUpdatedAt' in previous and 'passwordUpdatedAt' in stamps else None,
            'validSinceChanged': (stamps.get('validSince') != previous.get('validSince')) if 'validSince' in previous and 'validSince' in stamps else None,
        }
        if role is not None:
            run.previous[role] = stamps
        users.append(user)
    return users


def project_config(body):
    state = config_state(body)
    notification = body.get('notification') if isinstance(body.get('notification'), dict) else {}
    locale = notification.get('defaultLocale')
    return {**{k: v for k, v in state.items() if v is None or isinstance(v, (bool, int, str))}, 'notificationDigest': hashlib.sha256(json.dumps(notification, sort_keys=True).encode()).hexdigest()[:16], 'defaultLocalePresent': isinstance(locale, str)}


def check_baseline(body):
    state = config_state(body)
    if state['mfaState'] in ('ENABLED', 'MANDATORY') or state['mfaProviderEnabled']:
        raise ValueError('recorded MFA baseline differs')
    if state['passwordRequired'] is not True or state['emailEnabled'] is not True or DOMAIN not in body.get('authorizedDomains', []) or state['allowDuplicateEmails'] not in (None, False):
        raise ValueError('recorded project baseline differs')
    phone = (body.get('signIn') or {}).get('phoneNumber') or {}
    numbers = phone.get('testPhoneNumbers') if isinstance(phone, dict) else None
    if phone.get('enabled') is not True or not isinstance(numbers, dict) or any(numbers.get(n) != TEST_PHONE_CODE for n in TEST_PHONES):
        raise ValueError('recorded test phone numbers differ')


def execute_pre(run, row, plan):
    """Compute run-time minted values (codes, claims) right before their request."""
    for op in row['pre']:
        if op['op'] in ('totp', 'wrong-totp'):
            secret, parameters = run.secrets.get(op['role'] + '.secret'), run.totp.get(op['role'])
            if secret is None or parameters is None:
                raise BindingError('unbound TOTP secret')
            now = int(time.time())
            code = totp_code(secret, now + op['offset'] * parameters.period_seconds, parameters)
            if op['op'] == 'wrong-totp':
                valid = {totp_code(secret, now + k * parameters.period_seconds, parameters) for k in range(-7, 8)}
                offset = op['offset']
                while code in valid:
                    offset += 1
                    code = totp_code(secret, now + offset * parameters.period_seconds, parameters)
            run.secrets[op['out']] = code
        elif op['op'] == 'claims':
            spec = op['spec']
            iat = int(time.time()) + spec.get('iatOffset', 0)
            claims = {'iss': SIGNER, 'sub': SIGNER, 'aud': AUDIENCE, 'iat': iat, 'exp': iat + spec.get('lifetime', 3600), 'uid': plan['ownedAccounts']['cred']['uid']}
            if 'claims' in spec:
                claims['claims'] = spec['claims']
            if 'padBytes' in spec:
                claims['claims'] = {'pad': 'x' * spec['padBytes']}
            run.secrets[op['out']] = json.dumps(claims, sort_keys=True, separators=(',', ':'))
            run.requested[op['label']] = claims


def response_uid(body):
    """The account a sign-in answer names: `localId`, else the `user_id` of its ID token."""
    if isinstance(body.get('localId'), str) and body['localId']:
        return body['localId']
    claims = decode_claims(body.get('idToken')) if isinstance(body.get('idToken'), str) else None
    uid = claims.get('user_id') if isinstance(claims, dict) else None
    return uid if isinstance(uid, str) and uid else None


def decode_claims(token):
    try:
        return json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=' * 3))
    except (IndexError, ValueError, AttributeError):
        return None


def collect(*, nonce, output, send, sleep=time.sleep, clock=time.monotonic, recovery_journal=None, production=False):
    """Execute a stage through a coordinator-supplied, already admitted transport.

    The callable receives only a frozen request descriptor and its resolved body. This entry performs no credential discovery and supplies no remote transport.
    """
    plan = manifest(nonce)
    if plan['budget']['totalRequests'] >= 400:
        raise ValueError('edge request budget exceeds packet')
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    run = StageRun(plan, output, send, sleep, clock)
    run.previous, run.requested = {}, {}
    for role, account in plan['ownedAccounts'].items():
        if account['email'] is not None:
            run.secrets[role + '.email'] = account['email']
        run.secrets[role + '.password'] = 'Aa9!' + secrets.token_urlsafe(24)
    for name in ('newPassword1', 'newPassword2'):
        run.secrets['dup.' + name] = 'Cc7!' + secrets.token_urlsafe(24)
    run.secrets['cred.premint'] = plan['ownedAccounts']['cred']['uid']
    if recovery_journal is not None:
        for line in Path(recovery_journal).read_text().splitlines():
            event = json.loads(line)
            role = event.get('role')
            known_role = role in plan['ownedAccounts'] and event.get('email') == plan['ownedAccounts'][role]['email']
            if event.get('kind') == 'account-attempt':
                if not known_role or event.get('preflightAbsent') is not True:
                    raise ValueError('recovery journal outside frozen namespace')
                run.attempted.add(role)
            elif event.get('kind') == 'account-refused':
                if not known_role or role not in run.attempted:
                    raise ValueError('recovery journal lacks creation responsibility')
                run.attempted.discard(role)
            elif event.get('kind') == 'account-created':
                uid = event.get('uid')
                if not known_role or role not in run.attempted or not isinstance(uid, str) or not uid or any(ord(c) < 32 or ord(c) == 127 for c in uid):
                    raise ValueError('recovery journal lacks creation responsibility')
                if any(a['localId'] == uid for a in run.owned.values()) or role in run.owned:
                    raise ValueError('recovery journal identity conflicts')
                if plan['ownedAccounts'][role].get('uid') not in (None, uid):
                    raise ValueError('recovery journal identity conflicts')
                run.secrets[role + '.localId'] = uid
                run.owned[role] = {'localId': uid, 'email': event['email']}
            elif event.get('kind') == 'config-attempt':
                if event.get('nonce') != nonce or event.get('restore') is not True or event.get('toggle') not in TOGGLES:
                    raise ValueError('recovery config journal mismatch')
                run.toggles[event['toggle']] = True
        # A subsequent recovery can use this journal without losing responsibility.
        for role in run.attempted:
            run.record({'kind': 'account-attempt', 'role': role, 'email': plan['ownedAccounts'][role]['email'], 'uid': plan['ownedAccounts'][role].get('uid'), 'preflightAbsent': True})
        for role, account in run.owned.items():
            run.record({'kind': 'account-created', 'role': role, 'email': account['email'], 'uid': account['localId']})
        for toggle in run.toggles:
            run.record({'kind': 'config-attempt', 'nonce': nonce, 'restore': True, 'toggle': toggle})
    stages, stopped = [], None
    applied = {}
    pending_stop = None
    try:
        for row in ([] if recovery_journal is not None else plan['stages']):
            run.current = row
            kind = row['kind']
            skipped = None
            if kind == 'config' and row['phase'] == 'readback' and applied.get(row['toggle']):
                skipped = 'config-already-confirmed'
            elif row['id'] == 'mask-below-scalar' and 'config.defaultLocale' not in run.secrets:
                skipped = 'dependency-unavailable'
            elif kind == 'readback' and (row['account'] + '.localId' not in run.secrets or (plan['ownedAccounts'][row['account']].get('uid') and row['account'] not in run.confirmed)):
                skipped = 'dependency-unavailable'
            if skipped is not None:
                run.guard.index += 1
                stages.append({'id': row['id'], 'kind': kind, 'family': row['family'], 'classification': 'OBSERVED' if skipped == 'config-already-confirmed' else 'INDETERMINATE', 'skipped': skipped})
                continue
            if kind == 'config' and row['phase'] == 'enable':
                run.toggles[row['toggle']] = True
                run.record({'kind': 'config-attempt', 'nonce': nonce, 'restore': True, 'toggle': row['toggle']})
            late = None
            try:
                execute_pre(run, row, plan)
                run.resolve(row['body'])
                if row['wait']:
                    late = run.wait_until(row['wait']['after'], row['wait']['seconds'])
            except BindingError:
                if kind not in ('diagnostic', 'sign') and row['id'] != 'mask-below-scalar':
                    raise
                run.guard.index += 1
                stages.append({k: row[k] for k in ('id', 'kind', 'family')} | {'classification': 'INDETERMINATE', 'status': None, 'skipped': 'dependency-unavailable'})
                continue
            if row['premint'] or kind == 'create':
                run.attempted.add(row['account'])
                email = plan['ownedAccounts'][row['account']]['email']
                preminted = plan['ownedAccounts'][row['account']].get('uid')
                run.record({'kind': 'account-attempt', 'role': row['account'], 'email': email, 'uid': preminted, 'preflightAbsent': True})
                if preminted is not None:
                    # The UID is ours by construction, so responsibility precedes the request.
                    run.secrets[row['account'] + '.localId'] = preminted
                    run.owned[row['account']] = {'localId': preminted, 'email': email}
                    run.record({'kind': 'account-created', 'role': row['account'], 'email': email, 'uid': preminted})
            started = run.clock()
            try:
                status, body = run.request(row['path'], row['body'], row['owner'])
            except Exception as error:
                # A lost acknowledgement keeps its paired owned read-back; a row with no pair stops at once.
                if not (row['paired'] or (kind == 'probe' and row['method'] == 'PATCH')):
                    raise
                status, body = None, {}
                pending_stop = type(error).__name__
            anchor = row['wait']['after'] if row['wait'] else row['since']
            age = None if anchor not in run.marks else {'atSend': round(started - run.marks[anchor], 1), 'atResponse': round(run.clock() - run.marks[anchor], 1)}
            if row['mark'] or row['wait']:
                run.marks[row['id']] = run.clock()
            if kind == 'config':
                if type(status) is not int or status != 200 or not isinstance(body, dict) or 'error' in body:
                    raise ValueError('configuration answer unknown')
                projection = {'id': row['id'], 'kind': 'config', 'family': '', 'status': status, 'classification': 'OBSERVED'}
                if row['phase'] == 'baseline':
                    check_baseline(body)
                    locale = (body.get('notification') or {}).get('defaultLocale')
                    if isinstance(locale, str) and locale and not any(ord(c) < 32 for c in locale):
                        run.secrets['config.defaultLocale'] = locale
                    projection.update(project_config(body), baselineConfirmed=True)
                elif row['phase'] == 'readback':
                    ok = toggle_applied(row['toggle'], body)
                    applied[row['toggle']] = ok
                    if not ok:
                        if row['id'].endswith(f'readback-{READBACK_SLOTS - 1}'):
                            raise ValueError('toggle did not read back')
                        run.sleep(2)
                    projection.update(project_config(body), toggle=row['toggle'], applied=ok)
                stages.append(projection)
                run.record({'kind': 'response', 'observation': projection})
                continue
            # Responsibility is journaled before anything about the answer can stop the stage.
            if row['premint'] and status == 200:
                run.confirmed.add(row['account'])
            if kind == 'create' and type(status) is int and status == 200 and isinstance(body, dict) and isinstance(body.get('localId'), str) and body['localId']:
                run.confirmed.add(row['account'])
                role, uid = row['account'], body['localId']
                if any(a['localId'] == uid for r, a in run.owned.items() if r != role) or any(ord(c) < 32 or ord(c) == 127 for c in uid):
                    raise ValueError('creation identity conflicts')
                run.secrets[role + '.localId'] = uid
                run.owned[role] = {'localId': uid, 'email': plan['ownedAccounts'][role]['email']}
                run.record({'kind': 'account-created', 'role': role, 'email': plan['ownedAccounts'][role]['email'], 'uid': uid})
            verdict = judge(row, status, body)
            projection = {k: row[k] for k in ('id', 'kind', 'family')}
            projection.update(status=status if type(status) is int else None, classification=verdict['classification'])
            if late is not None:
                projection['lateSeconds'] = round(late, 1)
            if age is not None:
                projection['age'] = age
            if isinstance(body, dict):
                code = error_code(body)
                if re.fullmatch('[A-Z][A-Z0-9_]{0,63}', code):
                    projection['errorCode'] = code
                if kind == 'probe':
                    error = body.get('error') if isinstance(body.get('error'), dict) else None
                    if error is not None:
                        projection['errorStatus'] = error.get('status') if isinstance(error.get('status'), str) else None
                        projection['errorMessage'] = scrub(error['message']) if isinstance(error.get('message'), str) else None
                    elif status == 200 and row['method'] == 'GET':
                        projection['config'] = project_config(body)
                # Only declared fields are projected: arbitrary keys and prose are not logs.
                projection['fields'] = publishable({k: body[k] for k in ('idToken', 'refreshToken', 'oobCode', 'mfaPendingCredential', 'id_token') if k in body})
                if 'signedJwt' in body:
                    projection['signedJwt'] = {'present': isinstance(body['signedJwt'], str) and bool(body['signedJwt'])}
                uid = response_uid(body)
                if uid is not None:
                    projection['localIdRole'] = next((r for r, a in plan['ownedAccounts'].items() if run.secrets.get(r + '.localId') == uid), 'foreign')
                if 'users' in body and isinstance(body['users'], list):
                    projection['userCount'] = len(body['users'])
                    projection['users'] = project_users(row, body, run, plan)
                if row['id'].endswith('totp-start') and status == 200 and verdict['classification'] == 'OBSERVED':
                    projection['totpParameters'] = {k: body['totpSessionInfo'][k] for k in ('periodSec', 'verificationCodeLength', 'hashingAlgorithm')}
            # The values this very answer will bind count as secrets before they are bound.
            own = [get_path(body, field) for name, field in row['binds'].items() if isinstance(body, dict) and not name.endswith(SECRET_SUFFIXES)]
            assert_no_secret(projection, [*secret_values(run), *[v for v in own if isinstance(v, str)]])
            stages.append(projection)
            run.record({'kind': 'response', 'observation': projection})
            if row['kind'] == 'preflight' and not absent_response(status, body):
                raise ValueError('owned namespace not absent')
            if kind == 'sign':
                if status != 200 or verdict['classification'] != 'OBSERVED' or decode_claims(body.get('signedJwt')) != run.requested.get(row['id'].removeprefix('sign-')):
                    projection['signingUnavailable'] = True
                    continue
            if row['premint'] and status == 200 and isinstance(body, dict) and response_uid(body) != plan['ownedAccounts'][row['account']]['uid']:
                raise ValueError('custom-token account is not the preminted UID')
            if kind == 'create' and verdict['classification'] == 'OBSERVED' and status == 400 and row['account'] not in run.owned:
                # A typed refusal proves the account was not created; nothing is left to delete.
                run.attempted.discard(row['account'])
                run.record({'kind': 'account-refused', 'role': row['account'], 'email': plan['ownedAccounts'][row['account']]['email']})
            if kind in ('setup', 'create') and verdict['classification'] != 'OBSERVED':
                raise ValueError('setup answer unknown')
            if kind in ('setup', 'create') and status != 200 and not row['optional']:
                raise ValueError('setup refused')
            if kind == 'readback':
                users = body.get('users') if isinstance(body, dict) else None
                if type(status) is not int or status != 200 or not isinstance(users, list) or len(users) != 1 or not isinstance(users[0], dict) or users[0].get('localId') != run.secrets[row['account'] + '.localId']:
                    raise ValueError('owned read-back incomplete')
                role = row['account']
                allowed_emails = {plan['ownedAccounts'][role]['email'], *plan['aliases'].get(role, [])}
                if users[0].get('email') not in allowed_emails:
                    raise ValueError('owned email outside frozen namespace')
            if isinstance(body, dict) and status == 200 and verdict['classification'] == 'OBSERVED':
                for name, field in row['binds'].items():
                    value = get_path(body, field)
                    if not isinstance(value, str) or not value:
                        if kind == 'diagnostic':
                            break
                        raise ValueError('response binding unavailable')
                    run.secrets[name] = value
                if row['id'].endswith('totp-start'):
                    run.totp[row['account']] = totp_parameters(body['totpSessionInfo'])
            if (kind == 'readback' or row['id'].endswith('-observe')) and pending_stop is not None:
                raise ValueError('diagnostic failed; read-back retained')
            if type(status) is not int or status in (401, 403, 429) or status >= 500:
                if row['paired'] or (kind == 'probe' and row['method'] == 'PATCH'):
                    pending_stop = 'transport-or-quota-stop'
                else:
                    raise ValueError('transport or quota stop')
    except (Exception, KeyboardInterrupt) as error:
        stopped = type(error).__name__
    finally:
        run.begin_recovery()
        recovery, complete, remaining, failures, proven = recover(run, plan)
    receipt = dict(contract=plan['contract'], manifestDigest=digest(plan), productionExecuted=production, side='production' if production else 'injected', recordingComplete=recovery_journal is None and stopped is None and len(stages) == len(plan['stages']), stopReason=stopped, stages=stages, recovery=recovery, cleanupComplete=complete, remainingAccounts=remaining, deleteFailures=failures, absenceProven=proven, requests=run.requests, recoveryRequests=run.recovery_requests, requestBudget=plan['budget'], deliveredMessages=0)
    receipt['classification'] = 'RECORDED' if receipt['recordingComplete'] and complete and all(r['classification'] == 'OBSERVED' for r in stages) else 'INDETERMINATE'
    assert_no_secret(receipt, secret_values(run))
    run.record({'kind': 'terminal', 'recordingComplete': receipt['recordingComplete'], 'cleanupComplete': complete, 'classification': receipt['classification']})
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    return receipt


def local_send(origin):
    """Use the bounded, no-proxy/no-redirect loopback transport; signing is a local stand-in."""
    origin = _loopback_origin(origin)

    def send(row, body):
        if row['kind'] == 'sign':
            payload = base64.urlsafe_b64encode(body['payload'].encode()).rstrip(b'=').decode()
            return 200, {'keyId': 'local', 'signedJwt': 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.' + payload + '.'}
        headers = {'content-type': 'application/json'}
        if row['owner']:
            headers['authorization'] = 'Bearer owner'
        path = row['path'] + ('' if row['owner'] else ('&' if '?' in row['path'] else '?') + 'key=fake')
        method = row.get('method', 'POST')
        if row['path'] == TOKEN:
            data = urllib.parse.urlencode({k: v for k, v in body.items() if k != 'rawSuffix'}) + body.get('rawSuffix', '')
            headers['content-type'] = 'application/x-www-form-urlencoded'
            return _local_request(method, origin + path, headers, data.encode())
        return _local_request(method, origin + path, headers, None if body is None else json.dumps(body, allow_nan=False).encode())
    return send


def _local_request(method, url, headers, payload):
    request = urllib.request.Request(url, data=payload, method=method, headers=headers)
    try:
        try:
            answer = http_opener().open(request, timeout=20)
        except urllib.error.HTTPError as error:
            answer = error
        with answer:
            raw, failure = _read_bounded_response(answer, method)
            if failure is not None or 300 <= answer.status < 400:
                raise CollectorError('incomplete or redirected local response')
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise CollectorError('object response required')
            return answer.status, value
    except (ValueError, OSError, urllib.error.URLError) as error:
        raise CollectorError('local transport failed: ' + type(error).__name__) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nonce', required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--origin')
    parser.add_argument('--production', action='store_true')
    parser.add_argument('--recover', type=Path, help='Replay only recovery from an ownership journal')
    args = parser.parse_args()
    if args.origin is None and not args.production:
        print(json.dumps(manifest(args.nonce), indent=2))
        return 0
    if args.output is None:
        parser.error('--output is required for a local rehearsal')
    if args.production:
        if args.origin is not None:
            parser.error('--production excludes --origin')
        from transport import production_send
        sender = production_send()
    else:
        sender = local_send(args.origin)

    def interrupted(_signum, _frame):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        raise KeyboardInterrupt('cleanup requested')

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    result = collect(nonce=args.nonce, output=args.output, send=sender, recovery_journal=args.recover, production=args.production)
    print(json.dumps({k: result[k] for k in ('recordingComplete', 'cleanupComplete', 'classification', 'requests', 'recoveryRequests')}))
    return 0 if (result['recordingComplete'] or args.recover is not None) and result['cleanupComplete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
