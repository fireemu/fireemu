import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deadlineWithLag, quietStallMs, waitUntil } from './load-independent-wait.mjs';

const source = new URL('./fixtures/lean-runner-wait-deadlines.corpus', import.meta.url);

async function waitObservation(stallMs, maxMs, steps) {
  const calls = [];
  let index = 0;
  let firstProgress = true;
  const failSentinel = 'scripted failure';
  let outcome;
  try {
    const value = await waitUntil({
      check: () => {
        calls.push('check');
        return steps[index][1] ? 'result' : false;
      },
      failFast: () => {
        calls.push('failFast');
        if (steps[index][2]) throw new Error(failSentinel);
      },
      progress: () => {
        calls.push('progress');
        if (firstProgress) {
          firstProgress = false;
          return 0;
        }
        return steps[index][3];
      },
      now: () => steps[index][0],
      sleep: async () => {
        calls.push('sleep');
        index += 1;
        assert.ok(index < steps.length, 'wait exceeded the supplied clock timeline');
      },
      stallMs,
      maxMs,
      pollMs: 1,
      label: 'trace',
    });
    assert.equal(value, 'result');
    outcome = 'ready';
  } catch (error) {
    if (error.message === failSentinel) outcome = 'failed';
    else if (error.message === `trace: no progress for ${stallMs} ms`) outcome = 'stalled';
    else if (error.message === `trace: still waiting after ${maxMs} ms`) outcome = 'hard';
    else throw error;
  }
  return [outcome, steps[index][0], calls];
}

test('runner deadline arithmetic and virtual poll traces agree with the Lean corpus', async () => {
  const [header, ...lines] = readFileSync(source, 'utf8').trimEnd().split('\n');
  assert.equal(header, '# load-independent wait reference cases');
  const counts = { quiet: 0, deadline: 0, poll: 0 };
  const keys = new Set();
  for (const line of lines) {
    const [tag, axes, args, expected] = JSON.parse(line);
    const key = [tag, ...axes].join('/');
    assert.ok(!keys.has(key), key);
    keys.add(key);
    counts[tag] += 1;
    switch (tag) {
      case 'quiet': {
        const [quiet, margin, hasMargin] = args;
        const run = () => hasMargin ? quietStallMs(quiet, margin) : quietStallMs(quiet);
        const [status, value] = expected;
        if (status === 'error') assert.throws(run, { message: value }, key);
        else {
          assert.equal(status, 'ok', key);
          assert.equal(BigInt(run()).toString(), value, key);
        }
        break;
      }
      case 'deadline': {
        const [base, lag, cap] = args;
        const actual = cap === null ? deadlineWithLag(base, lag) : deadlineWithLag(base, lag, cap);
        assert.deepEqual({ ...actual, limit: BigInt(actual.limit).toString() }, expected, key);
        break;
      }
      case 'poll':
        assert.deepEqual(await waitObservation(...args), expected, key);
        break;
      default: throw new Error(`Unknown runner wait case: ${key}`);
    }
  }
  assert.deepEqual(counts, { quiet: 88, deadline: 100, poll: 480 });
});
