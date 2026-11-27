import type { ResetOptions, TestWorld, TestWorldOptions } from './testing.mjs';
export type { ResetOptions, TestWorld, TestWorldOptions } from './testing.mjs';

export type VitestResetMode = 'state' | 'restart' | 'none';

export interface VitestTestWorldOptions extends TestWorldOptions {
  /**
   * How to isolate tests within the suite:
   * - `'state'` (default): rewind in-memory state to the startup baseline before each test.
   * - `'restart'`: restart the daemon generation before each test.
   * - `'none'`: do not automatically reset between tests.
   */
  readonly resetMode?: VitestResetMode;
}

export interface VitestLifecycleHooks {
  readonly beforeAll: (fn: () => Promise<void> | void, timeout?: number) => void;
  readonly beforeEach: (fn: () => Promise<void> | void, timeout?: number) => void;
  readonly afterAll: (fn: () => Promise<void> | void, timeout?: number) => void;
}

export interface VitestTestWorldHandle {
  readonly world: TestWorld;
  readonly resetState: () => Promise<TestWorld>;
  readonly reset: (options?: ResetOptions) => Promise<TestWorld>;
  readonly checkpoint: (name?: string) => Promise<string>;
  readonly restore: (name: string) => Promise<TestWorld>;
  readonly deleteCheckpoint: (name: string) => Promise<void>;
}

export function useTestWorld(
  options?: VitestTestWorldOptions,
  hooks?: VitestLifecycleHooks,
): VitestTestWorldHandle;
