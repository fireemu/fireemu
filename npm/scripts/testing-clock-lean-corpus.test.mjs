import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { advanceBody, isoDuration, toBody } from '../fireemu/testing-clock.mjs';

const source = new URL('./fixtures/lean-npm-clock-duration.corpus', import.meta.url);

function inputValue([shape, value]) {
  switch (shape) {
    case 'scalar': return value;
    case 'object': return Object.fromEntries(value);
    case 'array': return [];
    default: throw new Error(`Unknown clock input shape: ${shape}`);
  }
}

test('npm clock bodies agree with the Lean corpus', () => {
  const [header, ...lines] = readFileSync(source, 'utf8').trimEnd().split('\n');
  assert.equal(header, '# npm clock helper reference cases');
  const counts = { iso: 0, advance: 0, anchor: 0 };
  const keys = new Set();
  for (const line of lines) {
    const [tag, axes, args, [status, expected], identity] = JSON.parse(line);
    const key = [tag, ...axes].join('/');
    assert.ok(!keys.has(key), key);
    keys.add(key);
    counts[tag] += 1;
    let run;
    let original;
    switch (tag) {
      case 'iso':
        run = () => isoDuration(inputValue(args[0]));
        break;
      case 'advance':
        original = inputValue(args[0]);
        run = () => advanceBody(original, args[1]);
        break;
      case 'anchor':
        run = () => toBody(args[0], args[1] === null ? args[2] : { ...args[2], duration: inputValue(args[1]) });
        break;
      default: throw new Error(`Unknown clock case: ${key}`);
    }
    if (status === 'error') {
      assert.throws(run, { name: 'TypeError', message: expected }, key);
    } else {
      assert.equal(status, 'ok', key);
      const actual = run();
      assert.deepEqual(actual, expected, key);
      if (identity) assert.equal(actual, original, key);
    }
  }
  assert.deepEqual(counts, { iso: 192, advance: 672, anchor: 224 });
});
