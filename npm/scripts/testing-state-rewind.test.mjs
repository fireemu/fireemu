import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { createTestWorld } from '../fireemu/testing.mjs';
import { useTestWorld } from '../fireemu/vitest.mjs';
import { createFireemuFixtures } from '../fireemu/playwright.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const binaryPath = process.env.FIREEMU_TEST_BINARY ?? join(repoRoot, 'target', 'debug', 'fireemu');
const hasBinary = existsSync(binaryPath);

test('vitest integration validates options and runs lifecycle hooks with state rewind', async () => {
  assert.throws(() => useTestWorld({ resetMode: 'invalid' }, { beforeAll() {}, beforeEach() {}, afterAll() {} }), TypeError);

  if (!hasBinary) return;
  const hooks = { beforeAll: [], beforeEach: [], afterAll: [] };
  const handle = useTestWorld(
    { binaryPath, services: ['firestore', 'pubsub'], resetMode: 'state' },
    {
      beforeAll(fn) { hooks.beforeAll.push(fn); },
      beforeEach(fn) { hooks.beforeEach.push(fn); },
      afterAll(fn) { hooks.afterAll.push(fn); },
    },
  );
  assert.throws(() => handle.world, /not initialized/);
  for (const fn of hooks.beforeAll) await fn();
  try {
    assert.equal(handle.world.generation, 1);
    await assert.rejects(hooks.beforeEach[0]({ task: { concurrent: true } }), /requires sequential tests/);
    const baseClock = (await handle.world.clock.get()).clock.clock;
    for (const fn of hooks.beforeEach) await fn();
    await handle.world.clock.advance(60_000);
    assert.notEqual((await handle.world.clock.get()).clock.clock, baseClock);

    // Second beforeEach triggers state rewind without restarting the daemon.
    for (const fn of hooks.beforeEach) await fn();
    assert.equal(handle.world.generation, 1);
    assert.equal((await handle.world.clock.get()).clock.clock, baseClock);
  } finally {
    for (const fn of hooks.afterAll) await fn();
  }
});

test('playwright fixture factory manages worker-scoped world and test-scoped state rewind', async () => {
  assert.throws(() => createFireemuFixtures({ resetMode: 'bad' }), TypeError);
  if (!hasBinary) return;

  const fixtures = createFireemuFixtures({ binaryPath, services: ['firestore'], resetMode: 'state' });
  const [workerFn, meta] = fixtures.fireemuWorld;
  assert.equal(meta.scope, 'worker');

  let disposedWorld;
  await workerFn({}, async world => {
    disposedWorld = world;
    let baseClock;
    await fixtures.fireemu({ fireemuWorld: world }, async w => {
      assert.equal(w.generation, 1);
      baseClock = (await w.clock.get()).clock.clock;
      await w.clock.advance(30_000);
    });
    await fixtures.fireemu({ fireemuWorld: world }, async w => {
      assert.equal(w.generation, 1);
      assert.equal((await w.clock.get()).clock.clock, baseClock);
    });
  });
  assert.throws(() => disposedWorld.endpoints, /disposed/);
});

test('world.resetState, checkpoints, appcheck endpoint, and Symbol.asyncDispose work end-to-end', async () => {
  if (!hasBinary) return;

  const world = await createTestWorld({
    binaryPath,
    services: ['firestore', 'pubsub', 'appcheck'],
  });
  try {
    assert.equal(world.generation, 1);
    assert.ok(world.endpoints.appcheck?.port > 0, 'endpoints.appcheck should be exposed');
    assert.equal(typeof world[Symbol.asyncDispose], 'function');

    const baseClock = (await world.clock.get()).clock.clock;
    await world.clock.advance(10_000);
    const cp1 = await world.checkpoint();
    assert.match(cp1, /^cp-\d+-[0-9a-f]{8}$/);
    assert.throws(() => world.snapshots.create('__fireemu_baseline__'), TypeError);
    assert.throws(() => world.snapshots.delete('__fireemu_baseline__'), TypeError);
    await assert.rejects(world.checkpoint('..'), TypeError);
    assert.throws(() => world.snapshots.create('.'), TypeError);
    const listed = await world.snapshots.list();
    assert.ok(!listed.snapshots.some(s => s.name === '__fireemu_baseline__'));
    const cp1Clock = (await world.clock.get()).clock.clock;

    await world.clock.advance(20_000);
    assert.notEqual((await world.clock.get()).clock.clock, cp1Clock);

    // Restore named checkpoint
    await world.restore(cp1);
    assert.equal(world.generation, 1);
    assert.equal((await world.clock.get()).clock.clock, cp1Clock);

    // Delete checkpoint and reset back to startup baseline
    await world.deleteCheckpoint(cp1);
    await world.reset({ mode: 'state' });
    assert.equal(world.generation, 1);
    assert.equal((await world.clock.get()).clock.clock, baseClock);

    // Measure 10 consecutive in-memory state resets
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) {
      await world.resetState();
    }
    const avgMs = (performance.now() - t0) / 10;
    assert.equal(world.generation, 1);
    assert.ok(avgMs < 500, `expected fast in-memory state rewind, got avg ${avgMs.toFixed(2)}ms`);

    assert.throws(() => world.reset({ mode: 'bogus' }), TypeError);
  } finally {
    await world[Symbol.asyncDispose]();
  }
  assert.throws(() => world.endpoints, /disposed/);
});

for (const startRunning of [false, true]) {
  test(`state rewind restores the clock's captured running mode (${startRunning})`, { skip: !hasBinary }, async () => {
    const world = await createTestWorld({
      binaryPath,
      services: ['firestore'],
      config: { schemaVersion: 1, daemon: { clock: startRunning ? 'realtime' : 'frozen' } },
    });
    try {
      const running = async () => (await world.clock.get()).clock.running;
      assert.equal(await running(), startRunning);
      const checkpoint = await world.checkpoint();
      const changeMode = () => world.control('POST', `/v1/sessions/default/clock:${startRunning ? 'freeze' : 'resume'}`, {});
      await changeMode();
      assert.equal(await running(), !startRunning);
      await world.resetState();
      assert.equal(await running(), startRunning);
      await changeMode();
      await world.restore(checkpoint);
      assert.equal(await running(), startRunning);
    } finally {
      await world.dispose();
    }
  });
}

test('vitest injectEnv, clock, and sdkConfig helpers inject and cleanly restore process.env', { skip: !hasBinary }, async () => {
  assert.throws(() => useTestWorld({ injectEnv: 'yes' }, { beforeAll() {}, beforeEach() {}, afterAll() {} }), TypeError);

  const prevFirestore = process.env.FIRESTORE_EMULATOR_HOST;
  const sentinelKey = 'FIRESTORE_EMULATOR_HOST';
  process.env[sentinelKey] = '127.0.0.1:9999';
  const prevAuth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  const hooks = { beforeAll: [], beforeEach: [], afterAll: [] };
  const handle = useTestWorld(
    { binaryPath, services: ['firestore', 'auth'], resetMode: 'state', injectEnv: true, projectId: 'demo-inject-test' },
    {
      beforeAll(fn) { hooks.beforeAll.push(fn); },
      beforeEach(fn) { hooks.beforeEach.push(fn); },
      afterAll(fn) { hooks.afterAll.push(fn); },
    },
  );
  try {
    for (const fn of hooks.beforeAll) await fn();
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, handle.world.environment.FIRESTORE_EMULATOR_HOST);
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, handle.world.environment.FIREBASE_AUTH_EMULATOR_HOST);
    assert.equal(handle.sdkConfig.projectId, 'demo-inject-test');
    assert.equal(handle.sdkConfig.storageBucket, 'demo-inject-test.appspot.com');
    assert.equal(typeof handle.clock.advanceAndSettle, 'function');

    // Direct injectEnv on a custom target + idempotent restore + Symbol.dispose + unselected var cleared
    const customTarget = {
      FIRESTORE_EMULATOR_HOST: 'orig',
      PUBSUB_EMULATOR_HOST: 'stale-pubsub:8085',
    };
    const restore = handle.world.injectEnv(customTarget);
    assert.equal(customTarget.FIRESTORE_EMULATOR_HOST, handle.world.environment.FIRESTORE_EMULATOR_HOST);
    assert.equal('PUBSUB_EMULATOR_HOST' in customTarget, false);

    // Explicit restart reset refreshes all active injected targets (both process.env and customTarget)
    const oldFirestore = process.env.FIRESTORE_EMULATOR_HOST;
    await handle.reset({ mode: 'restart' });
    assert.equal(handle.world.generation, 2);
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, handle.world.environment.FIRESTORE_EMULATOR_HOST);
    assert.equal(customTarget.FIRESTORE_EMULATOR_HOST, handle.world.environment.FIRESTORE_EMULATOR_HOST);
    assert.notEqual(process.env.FIRESTORE_EMULATOR_HOST, oldFirestore);

    restore[Symbol.dispose]();
    restore();
    assert.equal(customTarget.FIRESTORE_EMULATOR_HOST, 'orig');
    assert.equal(customTarget.PUBSUB_EMULATOR_HOST, 'stale-pubsub:8085');
    assert.equal('FIREBASE_AUTH_EMULATOR_HOST' in customTarget, false);
  } finally {
    for (const fn of hooks.afterAll) await fn();
    assert.equal(process.env[sentinelKey], '127.0.0.1:9999');
    assert.equal('FIREBASE_AUTH_EMULATOR_HOST' in process.env, false);
    if (prevFirestore === undefined) delete process.env[sentinelKey];
    else process.env[sentinelKey] = prevFirestore;
    if (prevAuth !== undefined) process.env.FIREBASE_AUTH_EMULATOR_HOST = prevAuth;
  }
});
