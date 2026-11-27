// Official Vitest lifecycle integration for fireemu Test Worlds.
import { createTestWorld } from './testing.mjs';

const VALID_RESET_MODES = new Set(['state', 'restart', 'none']);

function resolveHooks(explicitHooks) {
  if (explicitHooks) return explicitHooks;
  const g = globalThis;
  if (typeof g.beforeAll === 'function' && typeof g.beforeEach === 'function' && typeof g.afterAll === 'function') {
    return { beforeAll: g.beforeAll, beforeEach: g.beforeEach, afterAll: g.afterAll };
  }
  throw Error(
    'fireemu/vitest requires Vitest lifecycle hooks (enable `test.globals: true` or pass `{ beforeAll, beforeEach, afterAll }` as the second argument)',
  );
}

/**
 * Registers `beforeAll`, `beforeEach`, and `afterAll` hooks to manage a shared `TestWorld`
 * for a Vitest suite. Defaults to fast in-memory state rewind (`resetMode: 'state'`) before
 * each test after the first.
 */
export function useTestWorld(options = {}, hooks) {
  const { resetMode = 'state', startupTimeoutMs, ...worldOptions } = options;
  if (!VALID_RESET_MODES.has(resetMode)) {
    throw TypeError('resetMode must be "state", "restart", or "none"');
  }
  const lifecycle = resolveHooks(hooks);
  let instance;
  let needsReset = false;

  lifecycle.beforeAll(async () => {
    instance = await createTestWorld({ ...worldOptions, ...(startupTimeoutMs !== undefined ? { startupTimeoutMs } : {}) });
    needsReset = false;
  }, startupTimeoutMs ?? 60_000);

  if (resetMode !== 'none') {
    lifecycle.beforeEach(async context => {
      if (context?.task?.concurrent) {
        throw Error('fireemu/vitest reset requires sequential tests; use test.sequential or give each concurrent test its own world');
      }
      if (!instance) return;
      if (!needsReset) {
        needsReset = true;
        return;
      }
      if (resetMode === 'state') {
        await instance.resetState();
      } else {
        await instance.reset({ mode: 'restart' });
      }
    }, Math.max(startupTimeoutMs ?? 60_000, worldOptions.requestTimeoutMs ?? 80_000));
  }

  lifecycle.afterAll(async () => {
    const active = instance;
    instance = undefined;
    needsReset = false;
    if (active) await active.dispose();
  });

  const requireWorld = () => {
    if (!instance) throw Error('fireemu TestWorld is not initialized yet (access it inside a test or hook)');
    return instance;
  };

  return Object.freeze({
    get world() { return requireWorld(); },
    resetState: () => requireWorld().resetState(),
    reset: resetOptions => requireWorld().reset(resetOptions),
    checkpoint: name => requireWorld().checkpoint(name),
    restore: name => requireWorld().restore(name),
    deleteCheckpoint: name => requireWorld().deleteCheckpoint(name),
  });
}
