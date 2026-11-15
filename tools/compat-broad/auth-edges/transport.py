"""Bounded AUTH-EDGES wire; the coordinator supplies credentials only in memory."""
from __future__ import annotations

import os
from urllib.parse import urlencode, urlsplit

import batch_adapter
from edges import ADMIN, CLIENT, CONFIG, PROJECT


def production_send():
    """Read the admitted owner token and idp browser key at launch, never from files."""
    token = os.environ['AUTH_EDGES_ACCESS_TOKEN']
    key = os.environ['AUTH_EDGES_BROWSER_API_KEY']
    if not token or not key or any(ord(c) < 33 or ord(c) == 127 for c in token + key):
        raise ValueError('runtime credentials required')
    rejected = False

    def send(row, body):
        nonlocal rejected
        if rejected:
            raise ValueError('credential rejection latched; separate recovery required')
        path = row['path']
        method = row.get('method', 'POST')
        parsed = urlsplit('https:/' + path)
        if parsed.hostname not in {'identitytoolkit.googleapis.com', 'securetoken.googleapis.com'} or parsed.port or parsed.username or parsed.password or parsed.fragment:
            raise ValueError('Auth host refused')
        owner = row['owner']
        form = path == '/securetoken.googleapis.com/v1/token'
        if path == CONFIG:
            valid = owner and method == 'GET' and body is None
        elif path == CONFIG + '?updateMask=signIn.email.passwordRequired':
            valid = owner and method == 'PATCH' and (body == {'signIn': {'email': {'passwordRequired': True}}} or body == {'signIn': {'email': {'passwordRequired': False}}}) and type(body['signIn']['email']['passwordRequired']) is bool
        else:
            public = {CLIENT + route for route in ('signUp', 'lookup', 'signInWithEmailLink', 'signInWithPassword', 'update')}
            public |= {'/identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:' + route for route in ('start', 'finalize')}
            admin = {ADMIN + route for route in ('lookup', 'update', 'sendOobCode', 'batchCreate', 'delete')}
            valid = method == 'POST' and isinstance(body, dict) and (path in admin if owner else path in public or form)
        if not valid:
            raise ValueError('Auth request shape refused')
        headers = {'Accept': 'application/json'}
        url = 'https:/' + path
        if owner:
            headers.update({'Authorization': 'Bearer ' + token, 'x-goog-user-project': PROJECT})
        else:
            url += '?' + urlencode({'key': key})
        if body is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
        try:
            result = batch_adapter.wire(url, method, urlencode(body) if form else body, headers, timeout=12, receipt=True)
        except Exception:
            # Worker exceptions may carry remote prose; expose only a fixed error.
            raise ValueError('bounded Auth exchange failed') from None
        http = result.get('http', {}) if isinstance(result, dict) else {}
        status = http.get('status')
        if status in (401, 403):
            rejected = True
        answer = result.get('body') if http.get('complete') is True and http.get('bodyKind') == 'json' else None
        return status if type(status) is int else None, answer if isinstance(answer, dict) else None
    return send
