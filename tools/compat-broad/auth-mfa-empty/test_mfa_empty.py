"""Offline tests for the AUTH-MFA-EMPTY stage. No test builds the production transport."""
from __future__ import annotations

import copy
import json
import os

import pytest

import mfa_empty as m

NONCE = '0123456789abcdef0123456789abcdef'
BASE = {'name': 'projects/123456789012/config', 'signIn': {'email': {'enabled': True}}, 'notification': {'defaultLocale': 'en'}}


class World:
    """A fake project config. `variant_effect` maps the stored mfa and the body to the new mfa or an error."""

    def __init__(self, mfa=None, variant_effect=None, answers=None):
        self.config = copy.deepcopy(BASE)
        if mfa is not None:
            self.config['mfa'] = mfa
        self.variant_effect = variant_effect or (lambda stored, body: (400, {'error': {'code': 400, 'message': 'INVALID_CONFIG : state required', 'status': 'INVALID_ARGUMENT'}}))
        self.answers = answers or {}
        self.sent = []

    def __call__(self, row, body):
        self.sent.append((row['id'], row['method'], copy.deepcopy(body)))
        assert m.shape_ok(row, body), row['id']
        if row['id'] in self.answers:
            return self.answers[row['id']](self, row, body)
        if row['method'] == 'GET':
            return 200, copy.deepcopy(self.config)
        if row['id'].endswith('-variant'):
            status, out = self.variant_effect(self.config.get('mfa'), body)
            if status == 200:
                self.config['mfa'] = out
                return 200, copy.deepcopy(self.config)
            return status, out
        self.config['mfa'] = copy.deepcopy(body['mfa'])
        return 200, copy.deepcopy(self.config)


def run(tmp_path, world):
    return m.collect(nonce=NONCE, output=tmp_path / 'rec', send=world, sleep=lambda _s: None)


def test_manifest_is_frozen_small_and_mask_mfa_only():
    plan = m.manifest(NONCE)
    assert plan['maxRequests'] == len(plan['rows']) == m.MAX_REQUESTS == 29
    assert plan['digest'] == m.manifest(NONCE)['digest']
    for row in plan['rows']:
        assert m.shape_ok(row, row['body'])
        assert row['path'].startswith(m.CONFIG)
    assert all((body.get('mfa') or {}).get('state') is None for _, body in m.VARIANTS)
    with pytest.raises(ValueError):
        m.manifest('nothex')


def test_clean_run_records_every_variant_and_restores_the_baseline(tmp_path):
    world = World()
    receipt = run(tmp_path, world)
    assert receipt['recordingComplete'] and receipt['cleanupComplete'] and receipt['configEqualsBaseline']
    assert receipt['requests'] == 1 + 6 * 4 + 1 + 1
    assert world.config.get('mfa') == {'state': 'DISABLED'}
    variants = [r for r in receipt['records'] if r['id'].endswith('-variant')]
    assert [r['error']['message'] for r in variants] == ['INVALID_CONFIG : state required'] * 6
    assert json.loads((tmp_path / 'rec' / 'receipt.json').read_text())['records'] == receipt['records']


def test_a_variant_that_disables_mfa_is_recorded_with_its_read_back(tmp_path):
    world = World(variant_effect=lambda stored, body: (200, {'state': 'DISABLED'}))
    receipt = run(tmp_path, world)
    after = [r for r in receipt['records'] if r['id'] == 'empty-object-variant-readback'][0]
    assert after['mfa'] == {'state': 'DISABLED'} and receipt['cleanupComplete']


def test_baseline_with_stored_providers_refuses_every_write(tmp_path):
    world = World(mfa={'state': 'DISABLED', 'providerConfigs': [{'state': 'ENABLED', 'totpProviderConfig': {'adjacentIntervals': 5}}]})
    receipt = run(tmp_path, world)
    assert receipt['stopReason'] == 'baseline-not-confirmed'
    assert [s[1] for s in world.sent] == ['GET']


@pytest.mark.parametrize('status', [None, 199, 302, 500, 503])
def test_unknown_variant_answer_stops_restores_and_stays_open_for_a2(tmp_path, status):
    world = World(answers={'state-null-variant': lambda w, r, b: (status, None)})
    receipt = run(tmp_path, world)
    assert receipt['stopReason'] == 'state-null-unknown' and not receipt['recordingComplete']
    assert 'state-null-variant' in receipt['unknowns'] and receipt['a2Required']
    ids = [s[0] for s in world.sent]
    assert 'providers-without-state-enable' not in ids and 'restore' in ids


def test_a_send_exception_is_an_unknown_not_a_refusal(tmp_path):
    def boom(w, r, b):
        raise ValueError('bounded exchange failed')
    receipt = run(tmp_path, World(answers={'empty-object-variant': boom}))
    assert receipt['unknowns'] == ['empty-object-variant'] and receipt['stopReason'] == 'empty-object-unknown'


def test_enable_not_read_back_stops_and_restores(tmp_path):
    world = World(answers={'empty-object-enable-readback': lambda w, r, b: (200, copy.deepcopy(BASE))})
    receipt = run(tmp_path, world)
    assert receipt['stopReason'] == 'empty-object-enable-not-read-back'
    assert [s[0] for s in world.sent][-2:] == ['restore', 'final-readback-0']


def test_unknown_enable_still_restores(tmp_path):
    world = World(answers={'empty-object-enable': lambda w, r, b: (500, None)})
    receipt = run(tmp_path, world)
    assert receipt['stopReason'] == 'empty-object-enable-failed' and 'restore' in [s[0] for s in world.sent]


def test_credential_rejection_latches_and_sends_nothing_more(tmp_path):
    world = World(answers={'empty-object-variant': lambda w, r, b: (403, {'error': {'code': 403, 'message': 'denied', 'status': 'PERMISSION_DENIED'}})})
    receipt = run(tmp_path, world)
    assert receipt['latched'] and not receipt['cleanupComplete']
    assert world.sent[-1][0] == 'empty-object-variant'


def test_final_read_differing_from_baseline_is_not_a_clean_close(tmp_path):
    def drift(w, r, b):
        c = copy.deepcopy(w.config)
        c['notification'] = {'defaultLocale': 'fr'}
        return 200, c
    world = World(answers={f'final-readback-{i}': drift for i in range(3)})
    receipt = run(tmp_path, world)
    assert receipt['recordingComplete'] and not receipt['cleanupComplete']


def test_unread_final_slots_are_retried_then_left_open(tmp_path):
    world = World(answers={f'final-readback-{i}': (lambda w, r, b: (503, None)) for i in range(3)})
    receipt = run(tmp_path, world)
    assert [s[0] for s in world.sent][-3:] == ['final-readback-0', 'final-readback-1', 'final-readback-2']
    assert not receipt['cleanupComplete']


def test_output_is_never_overwritten(tmp_path):
    (tmp_path / 'rec').mkdir()
    with pytest.raises(FileExistsError):
        run(tmp_path, World())


def test_project_masks_long_numbers_and_keeps_only_mfa():
    rec = m.project(400, {'error': {'code': 400, 'message': 'project 123456789012 bad', 'status': 'INVALID_ARGUMENT'}})
    assert rec['error']['message'] == 'project <n> bad'
    ok = m.project(200, copy.deepcopy(BASE) | {'mfa': {'state': 'ENABLED'}})
    assert set(ok) == {'status', 'known', 'mfaPresent', 'mfa', 'digests'}
    assert '123456789012' not in json.dumps(ok)


def test_shape_guard_refuses_anything_outside_the_manifest():
    patch = {'method': 'PATCH', 'path': m.CONFIG + '?updateMask=mfa'}
    assert not m.shape_ok(patch, {'mfa': {'state': 'ENABLED'}})
    assert not m.shape_ok(patch, {'mfa': {}, 'signIn': {}})
    assert not m.shape_ok({'method': 'PATCH', 'path': m.CONFIG + '?updateMask=signIn'}, {'mfa': {}})
    assert not m.shape_ok({'method': 'DELETE', 'path': m.CONFIG}, None)
    assert not m.shape_ok({'method': 'GET', 'path': m.CONFIG + 'x'}, None)


def test_a2_closes_only_on_equal_digests():
    digests = m.config_digests(BASE)
    assert m.a2_evaluate(200, copy.deepcopy(BASE), digests, digests)['verdict'] == 'CLOSE-OK'
    assert m.a2_evaluate(200, copy.deepcopy(BASE) | {'mfa': {'state': 'DISABLED'}}, digests, digests)['verdict'] == 'CLOSE-OK'
    assert m.a2_evaluate(200, copy.deepcopy(BASE) | {'mfa': {'state': 'ENABLED'}}, digests, digests)['verdict'] == 'NEEDS-RECOVERY'
    assert m.a2_evaluate(None, None, digests, digests)['verdict'] == 'NEEDS-RECOVERY'
    assert m.a2_evaluate(404, {'error': {}}, digests, digests)['verdict'] == 'NEEDS-RECOVERY'
    other = dict(digests, whole='0' * 64)
    assert m.a2_evaluate(200, copy.deepcopy(BASE), digests, other)['verdict'] == 'NEEDS-RECOVERY'


def test_a2_run_validates_inputs_before_any_request(tmp_path):
    sent = []
    pre = tmp_path / 'pre.json'
    pre.write_text(json.dumps({'digests': m.config_digests(BASE)}))
    rec = tmp_path / 'receipt.json'
    rec.write_text(json.dumps({'baselineDigests': None}))
    with pytest.raises(ValueError):
        m.a2_run(tmp_path / 'a2.json', pre, rec, lambda r, b: sent.append(r) or (200, BASE))
    assert sent == []
    rec.write_text(json.dumps({'baselineDigests': m.config_digests(BASE)}))
    assert m.a2_run(tmp_path / 'a2.json', pre, rec, lambda r, b: (200, copy.deepcopy(BASE))) == 0
    with pytest.raises(FileExistsError):
        m.a2_run(tmp_path / 'a2.json', pre, rec, lambda r, b: (200, BASE))


def test_main_without_production_only_prints_the_manifest(capsys):
    assert m.main(['--nonce', NONCE]) == 0
    assert json.loads(capsys.readouterr().out)['digest'] == m.manifest(NONCE)['digest']
    with pytest.raises(SystemExit):
        m.main(['--nonce', NONCE, '--output', '/nonexistent/x'])


def test_tests_run_without_credentials():
    """Guard run before anything else: the test environment carries no production credential."""
    assert 'AUTH_MFA_EMPTY_ACCESS_TOKEN' not in os.environ
    assert 'GOOGLE_APPLICATION_CREDENTIALS' not in os.environ
    with pytest.raises(KeyError):
        m.production_send()


@pytest.mark.parametrize('stored', [{'state': 'DISABLED'}, {'state': 'ENABLED'}, {'state': 'ENABLED', 'enabledProviders': ['PHONE_SMS']}])
def test_enable_read_back_must_show_the_whole_enabled_value(tmp_path, stored):
    world = World(answers={'empty-object-enable-readback': lambda w, r, b: (200, copy.deepcopy(BASE) | {'mfa': stored})})
    receipt = run(tmp_path, world)
    assert receipt['stopReason'] == 'empty-object-enable-not-read-back'


def test_production_transport_headers_shapes_and_latch(monkeypatch):
    """The real transport with the wire replaced: owner headers, JSON body, refusal of unlisted shapes, 403 latch."""
    import batch_adapter

    calls = []
    answers = iter([{'http': {'status': 200, 'complete': True, 'bodyKind': 'json'}, 'body': {'mfa': {'state': 'DISABLED'}}}, {'http': {'status': 403, 'complete': True, 'bodyKind': 'json'}, 'body': {'error': {}}}])

    def wire(url, method, body, headers, **kw):
        calls.append((url, method, body, headers, kw))
        return next(answers)
    monkeypatch.setattr(batch_adapter, 'wire', wire)
    monkeypatch.setenv('AUTH_MFA_EMPTY_ACCESS_TOKEN', 'tok')
    send = m.production_send()
    plan = {r['id']: r for r in m.manifest(NONCE)['rows']}
    assert send(plan['empty-object-variant'], {'mfa': {}}) == (200, {'mfa': {'state': 'DISABLED'}})
    url, method, body, headers, kw = calls[0]
    assert url == 'https://identitytoolkit.googleapis.com/admin/v2/projects/fireemu-oracle-idp/config?updateMask=mfa' and method == 'PATCH' and body == {'mfa': {}}
    assert headers['Authorization'] == 'Bearer tok' and headers['x-goog-user-project'] == 'fireemu-oracle-idp' and headers['Content-Type'] == 'application/json'
    assert kw == {'timeout': 12, 'receipt': True}
    with pytest.raises(ValueError):
        send(plan['empty-object-variant'], {'mfa': {'state': 'ENABLED'}})
    assert send(plan['config-baseline'], None)[0] == 403
    with pytest.raises(ValueError):
        send(plan['config-baseline'], None)
    assert len(calls) == 2
