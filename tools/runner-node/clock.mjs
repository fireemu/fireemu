// Opt-in application time. Native event-loop and lifecycle deadlines stay real.
import timers from 'node:timers';
import promises from 'node:timers/promises';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

const NativeDate = Date;
const dateConstructor = Object.getOwnPropertyDescriptor(NativeDate.prototype, 'constructor');
const nativeImmediate = timers.setImmediate;
const native = {
  setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  setInterval: timers.setInterval, clearInterval: timers.clearInterval,
};
const nativePromises = { setTimeout: promises.setTimeout, setInterval: promises.setInterval };
const nanosPerMilli = 1_000_000n;
const dateLimit = 8_640_000_000_000_000n;
const maxDrain = 10_000;

function nanos(value, name) {
  if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`invalid clock ${name}`);
  }
  return BigInt(value);
}

function milliseconds(instant) {
  const value = instant >= 0n ? instant / nanosPerMilli : (instant - nanosPerMilli + 1n) / nanosPerMilli;
  if (value < -dateLimit || value > dateLimit) throw new RangeError('clock outside JavaScript Date range');
  return Number(value);
}

function delay(value) {
  const number = Number(value ?? 1);
  return !Number.isFinite(number) || number < 1 || number > 2_147_483_647 ? 1 : Math.trunc(number);
}

function abortError(reason) {
  const error = new Error('The operation was aborted', {cause:reason});
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function options(value) {
  if (value === null || typeof value !== 'object') throw new TypeError('timer options must be an object');
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) throw new TypeError('invalid AbortSignal');
  if (value.ref !== undefined && typeof value.ref !== 'boolean') throw new TypeError('timer ref must be boolean');
  return value;
}

export function createRuntimeClock({date = 'real', timers: timerPolicy = 'real', instantNanos = '0', elapsedNanos = '0', following: initiallyFollowing = false} = {}) {
  if (!['real','virtual'].includes(date) || !['real','virtual'].includes(timerPolicy) ||
      (timerPolicy === 'virtual' && date !== 'virtual')) throw new TypeError('invalid runtime clock policy');
  let instant = nanos(instantNanos, 'instant');
  let epochMillis = date === 'virtual' ? milliseconds(instant) : 0;
  let elapsed = nanos(elapsedNanos, 'elapsed');
  if (elapsed < 0n) throw new RangeError('negative timer elapsed time');
  let installed = false;
  // While the daemon clock follows real time, application time runs on between its updates:
  // the last update is the anchor and a monotonic reading counts the time since then.
  let following = initiallyFollowing === true;
  let anchor = process.hrtime.bigint();
  let lastShown = -Infinity;
  let autoHandle = null;
  let autoDrain = null;
  const live = () => following ? process.hrtime.bigint() - anchor : 0n;
  // The daemon's elapsed time at its last update (it only counts forward moves), and the most
  // this runner had already counted then: a freeze that arrives after the runner ran on past the
  // daemon's frozen instant must not take timer time back, so time stays at that floor until the
  // daemon catches up.
  let daemonElapsed = elapsed;
  let elapsedFloor = elapsed;
  const currentElapsed = () => {
    const counted = elapsed + live();
    return counted > elapsedFloor ? counted : elapsedFloor;
  };
  let sequence = 0;
  let draining = false;
  const queue = new Map();
  const handles = new Map();

  class Timer {
    constructor(callback, duration, args, repeat) {
      this.id = ++sequence;
      this.callback = callback;
      this.duration = BigInt(delay(duration)) * nanosPerMilli;
      this.args = args;
      this.repeat = repeat;
      this.referenced = true;
      this.cancelled = false;
      this.refresh();
    }
    refresh() {
      if (!this.cancelled) {
        this.deadline = currentElapsed() + this.duration;
        this.order = ++sequence;
        queue.set(this.id, this);
        handles.set(this.id, this);
        arm();
      }
      return this;
    }
    ref() { this.referenced = true; return this; }
    unref() { this.referenced = false; return this; }
    hasRef() { return this.referenced; }
    close() { cancel(this); return this; }
    [Symbol.toPrimitive]() { return this.id; }
    [Symbol.dispose]() { cancel(this); }
  }

  function schedule(callback, duration, args, repeat) {
    if (typeof callback !== 'function') throw new TypeError('timer callback must be a function');
    return new Timer(callback, duration, args, repeat);
  }

  function cancel(value) {
    if (value instanceof Timer) {
      value.cancelled = true;
      queue.delete(value.id);
      handles.delete(value.id);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      native.clearTimeout(value);
      return;
    }
    const handle = handles.get(Number(value));
    if (!handle) {
      native.clearTimeout(value);
      return;
    }
    handle.cancelled = true;
    queue.delete(handle.id);
    handles.delete(handle.id);
  }

  function cancelInterval(value) {
    if (value instanceof Timer) {
      value.cancelled = true;
      queue.delete(value.id);
      handles.delete(value.id);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      native.clearInterval(value);
      return;
    }
    const handle = handles.get(Number(value));
    if (!handle) {
      native.clearInterval(value);
      return;
    }
    handle.cancelled = true;
    queue.delete(handle.id);
    handles.delete(handle.id);
  }

  // Internal gRPC transport timers (BackoffTimeout, ResolvingCall deadlines, subchannel
  // keepalive/cleanup) live inside `@grpc/grpc-js`. Freezing them under a non-following
  // virtual clock deadlocks Admin SDK calls inside Functions triggers. Exempt only when
  // the immediate caller frame outside `clock.mjs` belongs to `@grpc/grpc-js`.
  function isTransportTimerCaller() {
    const stack = new Error().stack;
    if (typeof stack !== 'string') return false;
    const lines = stack.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const normalized = lines[i].replace(/\\/g, '/');
      if (normalized.includes('/runner-node/clock.mjs')) continue;
      return normalized.includes('node_modules/') && /@grpc[+/]grpc-js\//.test(normalized);
    }
    return false;
  }

  function promiseTimeout(duration, value, config = {}) {
    try { options(config); } catch (error) { return Promise.reject(error); }
    if (config.signal?.aborted) return Promise.reject(abortError(config.signal.reason));
    return new Promise((resolve, reject) => {
      const complete = () => {
        config.signal?.removeEventListener('abort', abort);
        resolve(value);
      };
      const handle = schedule(complete, duration, [], false);
      if (config.ref === false) handle.unref();
      const abort = () => {
        cancel(handle);
        config.signal.removeEventListener('abort', abort);
        reject(abortError(config.signal.reason));
      };
      config.signal?.addEventListener('abort', abort, {once:true});
    });
  }

  async function* promiseInterval(duration, value, config = {}) {
    options(config);
    if (config.signal?.aborted) throw abortError(config.signal.reason);
    let count = 0;
    let wake;
    let aborted = false;
    const handle = schedule(() => { count++; wake?.(); }, duration, [], true);
    if (config.ref === false) handle.unref();
    const abort = () => { aborted = true; cancel(handle); wake?.(); };
    config.signal?.addEventListener('abort', abort, {once:true});
    try {
      while (!aborted) {
        if (count === 0) await new Promise(resolve => {wake = resolve;});
        wake = undefined;
        if (aborted) break;
        count--;
        yield value;
      }
      throw abortError(config.signal.reason);
    } finally {
      cancel(handle);
      config.signal?.removeEventListener('abort', abort);
    }
  }

  function now() {
    // What was shown stays the floor until the daemon reaches it or rewinds the clock.
    if (!following) return Math.max(epochMillis, lastShown);
    const value = milliseconds(instant + live());
    lastShown = Math.max(lastShown, value);
    return lastShown;
  }

  // Under a following clock nobody moves the clock, so due timers run on their own.
  function arm() {
    if (autoHandle !== null) { native.clearTimeout(autoHandle); autoHandle = null; }
    if (!following || timerPolicy !== 'virtual' || !installed || queue.size === 0) return;
    let earliest;
    for (const handle of queue.values()) if (earliest === undefined || handle.deadline < earliest) earliest = handle.deadline;
    const wait = earliest - currentElapsed();
    const ms = wait <= 0n ? 0 : Number((wait + nanosPerMilli - 1n) / nanosPerMilli);
    autoHandle = native.setTimeout(() => {
      autoHandle = null;
      if (draining) return;
      autoDrain = api.runDue().catch(() => {}).finally(() => { autoDrain = null; arm(); });
    }, Math.min(ms, 2_147_483_647));
    autoHandle.unref?.();
  }

  const VirtualDate = new Proxy(NativeDate, {
    apply() { return new NativeDate(now()).toString(); },
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget);
    },
    get(target, key, receiver) {
      return key === 'now' ? now : Reflect.get(target, key, receiver);
    },
  });
  const virtual = {
    setTimeout: (callback, duration, ...args) =>
      isTransportTimerCaller()
        ? native.setTimeout(callback, duration, ...args)
        : schedule(callback, duration, args, false),
    setInterval: (callback, duration, ...args) =>
      isTransportTimerCaller()
        ? native.setInterval(callback, duration, ...args)
        : schedule(callback, duration, args, true),
    clearTimeout: cancel,
    clearInterval: cancelInterval,
  };
  Object.defineProperty(virtual.setTimeout, promisify.custom, {value:promiseTimeout});

  function status() {
    let due = 0;
    const current = currentElapsed();
    for (const handle of queue.values()) if (handle.deadline <= current) due++;
    return {pending:queue.size, due, instantNanos:(instant + live()).toString(), elapsedNanos:current.toString()};
  }

  const api = {
    install() {
      if (installed) return;
      installed = true;
      if (date === 'virtual') {
        globalThis.Date = VirtualDate;
        Object.defineProperty(NativeDate.prototype, 'constructor', {...dateConstructor, value:VirtualDate});
      }
      if (timerPolicy === 'virtual') {
        Object.assign(globalThis, virtual);
        Object.assign(timers, virtual);
        promises.setTimeout = promiseTimeout;
        promises.setInterval = promiseInterval;
        syncBuiltinESMExports();
      }
      arm();
    },
    restore() {
      if (!installed) return;
      installed = false;
      if (autoHandle !== null) { native.clearTimeout(autoHandle); autoHandle = null; }
      if (date === 'virtual') {
        globalThis.Date = NativeDate;
        Object.defineProperty(NativeDate.prototype, 'constructor', dateConstructor);
      }
      if (timerPolicy === 'virtual') {
        Object.assign(globalThis, native);
        Object.assign(timers, native);
        Object.assign(promises, nativePromises);
        syncBuiltinESMExports();
        queue.clear();
        handles.clear();
      }
    },
    update(value) {
      const next = nanos(value.instantNanos, 'instant');
      const nextMillis = date === 'virtual' ? milliseconds(next) : 0;
      const given = value.elapsedNanos !== undefined;
      const nextElapsed = given
        ? nanos(value.elapsedNanos, 'elapsed')
        : daemonElapsed + (next > instant ? next - instant : 0n);
      if (nextElapsed < daemonElapsed) throw new RangeError('timer elapsed time cannot rewind');
      // The daemon counts only forward moves as elapsed time, so the instant moving less than
      // the elapsed time is a rewind, which Date shows. Anything else (a tick, a freeze that
      // arrives late) never steps Date back: what was shown stays the floor. Without the elapsed
      // time, a move back by more than a second counts as a rewind.
      const rewound = given
        ? next - instant < nextElapsed - daemonElapsed
        : date === 'virtual' && nextMillis < lastShown - 1000;
      if (rewound) lastShown = -Infinity;
      elapsedFloor = currentElapsed();
      if (value.following !== undefined) following = value.following === true;
      instant = next;
      epochMillis = nextMillis;
      elapsed = nextElapsed;
      daemonElapsed = nextElapsed;
      anchor = process.hrtime.bigint();
      arm();
      return status();
    },
    async runDue(budget = 1000) {
      if (!Number.isSafeInteger(budget) || budget < 1 || budget > maxDrain) throw new RangeError('invalid timer drain budget');
      if (autoDrain && !draining) await autoDrain;
      if (draining) throw new Error('timer drain is already running');
      draining = true;
      let executed = 0;
      try {
        while (executed < budget) {
          let next;
          for (const handle of queue.values()) {
            if (handle.deadline <= currentElapsed() && (!next || handle.deadline < next.deadline ||
                (handle.deadline === next.deadline && handle.order < next.order))) next = handle;
          }
          if (!next) break;
          queue.delete(next.id);
          handles.delete(next.id);
          if (next.repeat) {
            next.deadline += next.duration;
            queue.set(next.id, next);
            handles.set(next.id, next);
          }
          executed++;
          Reflect.apply(next.callback, next, next.args);
          // Finish Promise and nextTick continuations, without waiting for the callback's
          // returned promise (which may depend on a future virtual timer).
          await new Promise(resolve => nativeImmediate(resolve));
        }
      } finally { draining = false; }
      return {executed,...status()};
    },
    status,
  };
  return api;
}
