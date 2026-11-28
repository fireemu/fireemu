/// <reference lib="esnext.disposable" />

import type { Environment } from './control.mjs';
export type { Environment } from './control.mjs';

/** Codebase suffixes must match [A-Za-z0-9_-]+; this is checked at runtime. */
export type TestWorldService = 'auth' | 'firestore' | 'storage' | 'functions' | `functions:${string}` | 'pubsub' | 'database' | 'appcheck' | 'hosting';

/**
 * How Functions source trees and dependencies are prepared for a TestWorld:
 * - `'copy'`: copy Functions source and dependencies into the world snapshot for strict filesystem isolation (default for `createTestWorld`).
 * - `'symlink-deps'`: copy Functions source files into the snapshot, but symlink `node_modules`, `.venv`, and `venv` directories to avoid duplicating large dependency trees (default for `useTestWorld`).
 * - `'in-place'`: reference Functions source directories in place without copying.
 */
export type FunctionsSnapshotMode = 'copy' | 'symlink-deps' | 'in-place';

export interface TestWorldSdkConfig {
  readonly projectId: string;
  readonly apiKey: string;
  readonly storageBucket: string;
}

export interface EnvRestore {
  (): void;
  [Symbol.dispose](): void;
}

export interface TestWorldOptions {
  readonly binaryPath?: string;
  readonly tempRoot?: string;
  readonly cwd?: string;
  readonly firebaseJson?: string;
  readonly functionsSource?: string;
  readonly functionsSnapshotMode?: FunctionsSnapshotMode;
  readonly import?: string;
  readonly projectId?: string;
  readonly clockStart?: string;
  /** A path or extensible configuration object; backend validation remains authoritative. */
  readonly config?: string | Readonly<Record<string, unknown>>;
  readonly services?: readonly [TestWorldService, ...TestWorldService[]];
  readonly hub?: boolean;
  readonly ui?: boolean;
  readonly seed?: number;
  readonly startupTimeoutMs?: number;
  /** Time budget for the initial input snapshot and each generation copy. */
  readonly snapshotTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly nodePathExcludes?: readonly string[];
  readonly env?: Environment;
  readonly clock?: {
    readonly date?: 'real' | 'virtual';
    readonly timers?: 'real' | 'virtual';
    readonly tasks?: 'real' | 'virtual';
  };
}

export interface Endpoint {
  readonly host: string;
  readonly port: number;
  readonly url: string;
}

export interface TestWorldEndpoints {
  readonly control: Endpoint & { readonly origin: string; readonly apiBaseUrl: string };
  readonly firestore?: Endpoint;
  readonly auth?: Endpoint;
  readonly storage?: Endpoint;
  readonly functions?: Endpoint;
  readonly eventarc?: Endpoint;
  readonly tasks?: Endpoint;
  readonly pubsub?: Endpoint;
  readonly database?: Endpoint;
  readonly appcheck?: Endpoint;
  readonly hosting?: Endpoint;
  readonly hub?: Endpoint;
  readonly logging?: Endpoint;
}

export interface ClockState {
  clock: string;
  backwardsSets: number;
}

export interface ClockSession {
  session: string;
  edition: string;
  requireDemoPrefix: boolean;
  clock: ClockState;
}

/** Timer reports follow the bundled Node runner protocol, not arbitrary custom runners. */
export interface RunDueResult {
  codebases: Array<{
    codebase: string;
    timers: {
      executed: number;
      pending: number;
      due: number;
      instantNanos: string;
      elapsedNanos: string;
    };
  }>;
}

/** Calendar units for a clock move; every value an integer of one sign. */
interface CalendarUnitFields {
  readonly years?: number;
  readonly months?: number;
  readonly weeks?: number;
  readonly days?: number;
  readonly hours?: number;
  readonly minutes?: number;
  readonly seconds?: number;
}

export type CalendarUnits = {
  [Unit in keyof CalendarUnitFields]-?: Required<Pick<CalendarUnitFields, Unit>> & CalendarUnitFields;
}[keyof CalendarUnitFields];

export type ClockDuration =
  | number
  | string
  | { readonly seconds: number; readonly millis?: number }
  | { readonly millis: number; readonly seconds?: number }
  | CalendarUnits;

export type ClockAnchor = 'startOfDay' | 'endOfDay' | 'startOfMonth' | 'endOfMonth' | 'startOfNextMonth' | 'startOfYear' | 'endOfYear';

export interface ClockMoveOptions {
  /** IANA zone for ISO 8601 durations, calendar units and anchors. */
  readonly timeZone?: string;
  readonly allowBackwards?: boolean;
}

export interface TestWorldClock {
  readonly get: () => Promise<ClockSession>;
  readonly set: (instant: string, options?: { readonly allowBackwards?: boolean }) => Promise<ClockState>;
  /**
   * A number is milliseconds; `{ seconds }` / `{ millis }` move by exact time as before. An ISO 8601
   * string (`'P1M'`, `'PT36H'`, `'-P3D'`) or calendar units (`{ months: 1 }`) move in a time zone:
   * `options.timeZone`, else `scheduler.defaultTimeZone`, else UTC. A move earlier needs `allowBackwards`.
   * The exact-time number, `{ seconds }` and `{ millis }` forms reject calendar move options.
   */
  readonly advance: (duration: ClockDuration, options?: ClockMoveOptions) => Promise<ClockState>;
  /** `clock:set` to an anchor, after `options.duration` if given; earlier needs `allowBackwards`. */
  readonly to: (anchor: ClockAnchor, options?: ClockMoveOptions & { readonly duration?: string | CalendarUnits }) => Promise<ClockState>;
  readonly advanceTo: (instant: string) => Promise<ClockState>;
  /** The runtime requires an integer budget from 1 through 10000. */
  readonly runDue: (budget?: number) => Promise<RunDueResult>;
  /**
   * Advance the clock, run due virtual timers and wait for idle, in that order. The exact-time
   * number, `{ seconds }` and `{ millis }` forms reject calendar move options. The wait never
   * delays a later clock call. Rejects when the move fails or the wait times out.
   */
  readonly advanceAndSettle: (
    duration: ClockDuration,
    options?: AwaitIdleOptions & ClockMoveOptions & { readonly failOnFunctionError?: boolean },
  ) => Promise<AdvanceAndSettleResult>;
}

/** Cost of one input snapshot or generation copy. */
export interface CopyStats {
  /** Regular files owned by the copy, including generated configuration. */
  readonly files: number;
  readonly directories: number;
  readonly symlinks: number;
  readonly bytes: number;
  /** `clone` when copy-on-write was used for every file, `mixed` for some, `copy` for none. */
  readonly method: 'copy' | 'clone' | 'mixed';
  readonly elapsedMs: number;
}

export interface TestWorldSnapshotStats {
  /** The one-time snapshot of caller inputs. `functions` is `skipped` when no selected service loads Functions. */
  readonly initial: CopyStats & { readonly functions: 'included' | 'skipped' };
  /** One entry per started generation, in order. */
  readonly generations: readonly (CopyStats & { readonly generation: number })[];
}

export interface AwaitIdleOptions {
  /** `runnable` (the default) excludes future task schedules and retry backoff; `all` waits for every outstanding task. */
  readonly scope?: 'all' | 'runnable';
  /** Daemon-side wait budget, 0 through 600 (default 20). */
  readonly timeoutSeconds?: number;
  /** Run due virtual timers after the move. Defaults to true only when Functions runs with `timers: 'virtual'`; the daemon refuses `runDue` otherwise. */
  readonly runTimers?: boolean;
}

export interface AdvanceAndSettleResult {
  readonly clock: ClockState;
  /** The last `runDue` report, or `undefined` when `runTimers` is false. */
  readonly timers: RunDueResult | undefined;
  /** The `awaitIdle` response; the shape follows the daemon's control API. */
  readonly idle: { readonly idle: boolean; readonly scope?: 'all' | 'runnable'; readonly [key: string]: unknown };
}

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: Environment;
  readonly stdio?: 'pipe' | 'inherit';
  readonly signal?: AbortSignal;
}

export interface RunResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export interface TestWorldHostingSite {
  /** The site ID from firebase.json, its resolved target, or the world's project ID. */
  readonly site: string;
  readonly url: string;
}

export interface ResetOptions {
  /**
   * `'restart'` (the default) retires the daemon process and starts a fresh generation with full
   * process/file/connection isolation. `'state'` rewinds in-memory service state (and virtual
   * clock) to the startup baseline snapshot without restarting the daemon.
   */
  readonly mode?: 'restart' | 'state';
}

export interface SnapshotSummary {
  readonly name: string;
  readonly clock?: string;
  readonly retainedBytes?: number;
  readonly [key: string]: unknown;
}

export interface SnapshotsListResponse {
  readonly session?: string;
  readonly snapshots: readonly SnapshotSummary[];
  readonly retainedBytes?: number;
  readonly [key: string]: unknown;
}

export interface MissingIndexEntry {
  readonly project: string;
  readonly database: string;
  readonly index: Readonly<Record<string, unknown>>;
  readonly refusal?: string;
  readonly [key: string]: unknown;
}

export interface MissingIndexesResponse {
  readonly count: number;
  readonly missingIndexes: readonly MissingIndexEntry[];
  readonly indexesJson: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface CheckpointOptions {
  /** Allow capturing a snapshot while background Functions work is still in flight. */
  readonly allowNonQuiescent?: boolean;
}

export interface FunctionInvocationRecord {
  readonly eventId: string;
  readonly function: string;
  readonly attempt: number;
  readonly outcome: unknown;
}

export interface FunctionsHistoryResponse {
  readonly history: readonly FunctionInvocationRecord[];
  readonly deadLetters: readonly FunctionInvocationRecord[];
  readonly [key: string]: unknown;
}

export interface FunctionLogEntry {
  readonly codebase: string;
  readonly line: string;
  readonly invocationId?: string | null;
  readonly function?: string | null;
  readonly truncated?: boolean;
}

export interface FunctionsLogsResponse {
  readonly lines: readonly string[];
  readonly logs: readonly FunctionLogEntry[];
  readonly [key: string]: unknown;
}

export interface TestWorldFunctions {
  readonly invocations: () => Promise<FunctionsHistoryResponse>;
  readonly logs: () => Promise<FunctionsLogsResponse>;
}

export interface TestWorldSnapshots {
  readonly list: () => Promise<SnapshotsListResponse>;
  readonly create: (name: string, options?: CheckpointOptions) => Promise<Readonly<Record<string, unknown>>>;
  readonly restore: (name: string) => Promise<TestWorld>;
  readonly delete: (name: string) => Promise<Readonly<Record<string, unknown>>>;
}

export interface TestWorldFirestore {
  /**
   * Lists missing composite indexes recorded under the `strict` profile (both `refuse` and
   * `report` modes). Rejects with HTTP 409 `FAILED_PRECONDITION` under the `emulator` profile
   * or when Firestore is not selected.
   */
  readonly missingIndexes: () => Promise<MissingIndexesResponse>;
  readonly clearMissingIndexes: () => Promise<Readonly<Record<string, unknown>>>;
}

/** Frozen world; generation-scoped getters and operations may reject or throw after disposal. */
export interface TestWorld {
  readonly id: string;
  readonly projectId: string;
  readonly generation: number;
  readonly directory: string;
  readonly uiUrl: string | undefined;
  /** Primary Hosting site origin (without trailing slash) for this generation, or undefined when Hosting is not selected. */
  readonly hostingUrl: string | undefined;
  /** Sites in configuration order for this generation (origins without trailing slash). */
  readonly hostingSites: readonly TestWorldHostingSite[];
  readonly endpoints: TestWorldEndpoints;
  readonly environment: Environment;
  readonly sdkConfig: TestWorldSdkConfig;
  readonly injectEnv: (target?: Record<string, string | undefined>) => EnvRestore;
  readonly clock: TestWorldClock;
  readonly snapshots: TestWorldSnapshots;
  readonly firestore: TestWorldFirestore;
  readonly functions: TestWorldFunctions;
  /** Read retained Functions runner log lines and structured log entries. */
  readonly logs: () => Promise<FunctionsLogsResponse>;
  /**
   * Wait until background Functions and Tasks work reaches idle.
   * Defaults: `scope: 'all'` and `timeoutSeconds: 30` (matching `POST /v1/sessions/default:awaitIdle`).
   */
  readonly awaitIdle: (options?: { readonly scope?: 'all' | 'runnable'; readonly timeoutSeconds?: number }) => Promise<{
    readonly idle: boolean;
    readonly scope?: 'all' | 'runnable';
    readonly [key: string]: unknown;
  }>;
  readonly resources: () => Promise<Readonly<Record<string, unknown>>>;
  /** Capture a named in-memory checkpoint (auto-named when omitted) and return its name. */
  readonly checkpoint: (name?: string, options?: CheckpointOptions) => Promise<string>;
  /** Restore a previously captured checkpoint in memory without restarting the daemon. */
  readonly restore: (name: string) => Promise<TestWorld>;
  /** Delete a previously captured checkpoint to free session snapshot budget. */
  readonly deleteCheckpoint: (name: string) => Promise<void>;
  /** Rewind in-memory service state and virtual clock to the startup baseline snapshot. */
  readonly resetState: () => Promise<TestWorld>;
  readonly snapshotStats: TestWorldSnapshotStats;
  readonly control: (method: string, path: string, body?: unknown) => Promise<unknown>;
  readonly run: (command: string, args?: readonly string[], options?: RunOptions) => Promise<RunResult>;
  readonly reset: (options?: ResetOptions) => Promise<TestWorld>;
  readonly dispose: () => Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export function createTestWorld(options?: TestWorldOptions): Promise<TestWorld>;
export function withTestWorld<T>(options: TestWorldOptions, callback: (world: TestWorld) => T): Promise<Awaited<T>>;
