import type { AwaitIdleOptions, CheckpointOptions, ResetOptions, TestWorld, TestWorldOptions } from './testing.mjs';
export type { AwaitIdleOptions, CheckpointOptions, ResetOptions, TestWorld, TestWorldOptions } from './testing.mjs';

export type VitestResetMode = 'state' | 'restart' | 'none';

export interface VitestTestWorldOptions extends TestWorldOptions {
  /**
   * How to isolate tests within the suite:
   * - `'state'` (default): rewind in-memory state to the startup baseline before each test.
   * - `'restart'`: restart the daemon generation before each test.
   * - `'none'`: do not automatically reset between tests.
   */
  readonly resetMode?: VitestResetMode;
  /** When true (and `afterEach` is available), print recent Functions dead letters and logs on test failure. */
  readonly dumpDiagnosticsOnFailure?: boolean;
}

export interface VitestLifecycleHooks {
  readonly beforeAll: (fn: () => Promise<void> | void, timeout?: number) => void;
  readonly beforeEach: (fn: (context?: { readonly task?: { readonly concurrent?: boolean } }) => Promise<void> | void, timeout?: number) => void;
  readonly afterEach?: (
    fn: (context?: { readonly task?: { readonly name?: string; readonly result?: { readonly state?: string } } }) => Promise<void> | void,
    timeout?: number,
  ) => void;
  readonly afterAll: (fn: () => Promise<void> | void, timeout?: number) => void;
}

export interface VitestTestWorldHandle {
  readonly world: TestWorld;
  readonly awaitIdle: (options?: Pick<AwaitIdleOptions, 'scope' | 'timeoutSeconds'>) => Promise<{
    readonly idle: boolean;
    readonly scope?: 'all' | 'runnable';
    readonly [key: string]: unknown;
  }>;
  readonly resetState: () => Promise<TestWorld>;
  readonly reset: (options?: ResetOptions) => Promise<TestWorld>;
  readonly checkpoint: (name?: string, options?: CheckpointOptions) => Promise<string>;
  readonly restore: (name: string) => Promise<TestWorld>;
  readonly deleteCheckpoint: (name: string) => Promise<void>;
}

export function useTestWorld(
  options?: VitestTestWorldOptions,
  hooks?: VitestLifecycleHooks,
): VitestTestWorldHandle;
