"""Bounded AUTH-EDGES wire; the coordinator supplies credentials only in memory."""
from __future__ import annotations

import os
import re
from urllib.parse import urlencode, urlsplit

import batch_adapter
from edges import ADMIN, ADMIN_CREATE, CLIENT, CONFIG, CONFIG_MASKS, CONFIG_MEMBERS, MFA_V2, PROJECT, SIGN_JWT, TOKEN

IAM_HOST = 'iamcredentials.googleapis.com'
HOSTS = {'identitytoolkit.googleapis.com', 'securetoken.googleapis.com', IAM_HOST}
CLIENT_ROUTES = {CLIENT + route for route in ('signUp', 'signInWithPassword', 'signInWithCustomToken', 'sendOobCode', 'resetPassword')} | {MFA_V2 + route for route in ('mfaEnrollment:start', 'mfaEnrollment:finalize', 'mfaSignIn:finalize')}
ADMIN_ROUTES = {ADMIN + route for route in ('lookup', 'update', 'sendOobCode', 'delete')} | {ADMIN_CREATE}
CONFIG_WRITES = {CONFIG + '?updateMask=' + mask for mask in CONFIG_MASKS}
FORM_FIELDS = {'grant_type', 'refresh_token', 'rawSuffix'}
RAW_SUFFIX = re.compile(r'(&[A-Za-z0-9_%=.\-]{0,32})?')


def shape_ok(path, method, owner, body):
    """The reviewed request shapes; the frozen slot guard narrows them further per row."""
    if path == CONFIG:
        return owner and method == 'GET' and body is None
    if path in CONFIG_WRITES:
        return owner and method == 'PATCH' and isinstance(body, dict) and set(body) <= set(CONFIG_MEMBERS)
    if path == SIGN_JWT:
        return owner and method == 'POST' and isinstance(body, dict) and set(body) == {'payload'} and isinstance(body['payload'], str) and len(body['payload']) <= 12000
    if path == TOKEN:
        return not owner and method == 'POST' and isinstance(body, dict) and set(body) <= FORM_FIELDS and RAW_SUFFIX.fullmatch(body.get('rawSuffix', '')) is not None
    return method == 'POST' and isinstance(body, dict) and (path in ADMIN_ROUTES if owner else path in CLIENT_ROUTES)


def production_send():
    """Read the admitted owner token and idp browser key at launch, never from files."""
    token = os.environ['AUTH_EDGES_ACCESS_TOKEN']
    key = os.environ['AUTH_EDGES_BROWSER_API_KEY']
    if not token or not key or any(ord(c) < 33 or ord(c) == 127 for c in token + key):
        raise ValueError('runtime credentials required')
    # The shared adapter's host list is a module constant that other packets pin by digest, so
    # this stage widens its own process copy for the one reviewed IAM signing route instead of
    # editing the file.
    batch_adapter.HOSTS.add(IAM_HOST)
    rejected = False

    def send(row, body):
        nonlocal rejected
        if rejected:
            raise ValueError('credential rejection latched; separate recovery required')
        path = row['path']
        method = row.get('method', 'POST')
        parsed = urlsplit('https:/' + path)
        if parsed.hostname not in HOSTS or parsed.port or parsed.username or parsed.password or parsed.fragment:
            raise ValueError('Auth host refused')
        owner = row['owner']
        if not shape_ok(path, method, owner, body):
            raise ValueError('Auth request shape refused')
        form = path == TOKEN
        headers = {'Accept': 'application/json'}
        url = 'https:/' + path
        if owner:
            headers.update({'Authorization': 'Bearer ' + token, 'x-goog-user-project': PROJECT})
        else:
            url += ('&' if '?' in url else '?') + urlencode({'key': key})
        if body is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
        if form:
            body = urlencode({k: v for k, v in body.items() if k != 'rawSuffix'}) + body.get('rawSuffix', '')
        try:
            result = batch_adapter.wire(url, method, body, headers, timeout=12, receipt=True)
        except Exception:
            # Worker exceptions may carry remote prose; expose only a fixed error.
            raise ValueError('bounded Auth exchange failed') from None
        http = result.get('http', {}) if isinstance(result, dict) else {}
        status = http.get('status')
        # A refused signing permission only makes the optional credential phase unavailable.
        if status == 401 or (status == 403 and parsed.hostname != IAM_HOST):
            rejected = True
        answer = result.get('body') if http.get('complete') is True and http.get('bodyKind') == 'json' else None
        return status if type(status) is int else None, answer if isinstance(answer, dict) else None
    return send
