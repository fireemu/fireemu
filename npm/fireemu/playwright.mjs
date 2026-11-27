// Official Playwright Test fixture factory for fireemu Test Worlds.
import { createTestWorld } from './testing.mjs';

const VALID_RESET_MODES = new Set(['state', 'restart', 'none']);

/**
 * Returns a Playwright `test.extend(...)` fixture definition providing:
 * - `fireemuWorld` (worker-scoped): one isolated daemon per Playwright worker, disposed on worker exit.
 * - `fireemu` (test-scoped): the active `TestWorld`, automatically rewound before each test after the first.
 */
export function createFireemuFixtures(options = {}) {
  const { resetMode = 'state', ...worldOptions } = options;
  if (!VALID_RESET_MODES.has(resetMode)) {
    throw TypeError('resetMode must be "state", "restart", or "none"');
  }
  const workerState = new WeakMap();

  return {
    fireemuWorld: [
      async ({}, use) => {
        const world = await createTestWorld(worldOptions);
        workerState.set(world, { used: false });
        try {
          await use(world);
        } finally {
          workerState.delete(world);
          await world.dispose();
        }
      },
      { scope: 'worker' },
    ],
    fireemu: async ({ fireemuWorld }, use) => {
      const state = workerState.get(fireemuWorld);
      if (state && resetMode !== 'none') {
        if (!state.used) {
          state.used = true;
        } else if (resetMode === 'state') {
          await fireemuWorld.resetState();
        } else {
          await fireemuWorld.reset({ mode: 'restart' });
        }
      }
      await use(fireemuWorld);
    },
  };
}
