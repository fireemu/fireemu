import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceBody, isoDuration, toBody } from '../fireemu/testing-clock.mjs';

test('earlier advance forms keep their bodies', () => {
  assert.deepEqual(advanceBody(1500), { millis: 1500 });
  assert.deepEqual(advanceBody({ seconds: 60 }), { seconds: 60 });
  assert.deepEqual(advanceBody({ millis: 5, seconds: 1 }), { millis: 5, seconds: 1 });
  // Options do not change the earlier forms.
  assert.deepEqual(advanceBody({ seconds: 60 }, { timeZone: 'Asia/Tokyo' }), { seconds: 60 });
});

test('calendar units and strings become a duration', () => {
  assert.deepEqual(advanceBody({ months: 1 }), { duration: 'P1M' });
  assert.deepEqual(advanceBody({ minutes: 1 }), { duration: 'PT1M' });
  assert.deepEqual(advanceBody({ days: 1, seconds: 30 }), { duration: 'P1DT30S' });
  assert.deepEqual(advanceBody({ days: -3 }, { allowBackwards: true }), { duration: '-P3D', allowBackwards: true });
  assert.deepEqual(advanceBody('PT36H', { timeZone: 'Europe/Paris' }), { duration: 'PT36H', timeZone: 'Europe/Paris' });
  assert.equal(isoDuration({ years: 1, months: 2, weeks: 3, days: 4, hours: 5, minutes: 6, seconds: 7 }), 'P1Y2M3W4DT5H6M7S');
  assert.equal(isoDuration({ days: 0 }), 'PT0S');
});

test('malformed calendar units are refused before a request', () => {
  assert.throws(() => advanceBody({ days: 1, millis: 5 }), /millis cannot be combined/);
  assert.throws(() => advanceBody({ days: 1, hours: -1 }), /same sign/);
  assert.throws(() => advanceBody({ days: 1.5 }), /safe integers/);
  assert.throws(() => advanceBody({ days: 1, fortnights: 1 }), /unknown duration unit fortnights/);
  assert.throws(() => advanceBody({ days: 1 }, { timeZone: 9 }), /timeZone must be a string/);
  assert.throws(() => advanceBody({ days: 1 }, { allowBackwards: 'yes' }), /allowBackwards must be a boolean/);
});

test('anchors become a clock:set body', () => {
  assert.deepEqual(toBody('endOfMonth'), { to: 'endOfMonth' });
  assert.deepEqual(toBody('startOfMonth', { duration: { months: 1 }, timeZone: 'Asia/Tokyo' }), { to: 'startOfMonth', duration: 'P1M', timeZone: 'Asia/Tokyo' });
  assert.deepEqual(toBody('startOfYear', { allowBackwards: true }), { to: 'startOfYear', allowBackwards: true });
  assert.throws(() => toBody(1), /anchor must be a string/);
});
