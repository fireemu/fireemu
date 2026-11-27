import type { TestWorld, TestWorldOptions } from './testing.mjs';
export type { TestWorld, TestWorldOptions } from './testing.mjs';

export type PlaywrightResetMode = 'state' | 'restart' | 'none';

export interface PlaywrightTestWorldOptions extends TestWorldOptions {
  /**
   * How to isolate tests sharing a Playwright worker's `fireemuWorld`:
   * - `'state'` (default): rewind in-memory state to the startup baseline before each test.
   * - `'restart'`: restart the daemon generation before each test.
   * - `'none'`: do not automatically reset between tests.
   */
  readonly resetMode?: PlaywrightResetMode;
}

export interface FireemuPlaywrightWorkerFixtures {
  readonly fireemuWorld: TestWorld;
}

export interface FireemuPlaywrightTestFixtures {
  readonly fireemu: TestWorld;
}

export interface FireemuPlaywrightFixtureDefinitions {
  readonly fireemuWorld: readonly [
    (fixtures: Readonly<Record<string, never>>, use: (value: TestWorld) => Promise<void>) => Promise<void>,
    { readonly scope: 'worker' },
  ];
  readonly fireemu: (
    fixtures: FireemuPlaywrightWorkerFixtures,
    use: (value: TestWorld) => Promise<void>,
  ) => Promise<void>;
}

export function createFireemuFixtures(
  options?: PlaywrightTestWorldOptions,
): FireemuPlaywrightFixtureDefinitions;
