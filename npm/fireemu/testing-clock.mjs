// Request bodies for the clock moves of a test world: milliseconds, the daemon's own
// {seconds}/{millis} forms, ISO 8601 durations and calendar units, and anchors.

const calendarUnits = [['years', 'Y'], ['months', 'M'], ['weeks', 'W'], ['days', 'D']];
const clockUnits = [['hours', 'H'], ['minutes', 'M'], ['seconds', 'S']];
const calendarKeys = new Set(['years', 'months', 'weeks', 'days', 'hours', 'minutes']);
const unitKeys = new Set([...calendarKeys, 'seconds']);

/** `{ months: 1, days: 2 }` as `P1M2D`; every value an integer of one sign. */
export function isoDuration(units) {
  for (const key of Object.keys(units)) if (!unitKeys.has(key)) throw TypeError(`unknown duration unit ${key}; use years, months, weeks, days, hours, minutes or seconds`);
  const values = Object.values(units);
  for (const value of values) if (!Number.isSafeInteger(value)) throw TypeError('duration units must be safe integers');
  const negative = values.some(value => value < 0);
  if (negative && values.some(value => value > 0)) throw TypeError('duration units must all have the same sign');
  const part = list => list.map(([key, unit]) => (units[key] ? `${Math.abs(units[key])}${unit}` : '')).join('');
  const date = part(calendarUnits), time = part(clockUnits);
  if (!date && !time) return 'PT0S';
  return `${negative ? '-' : ''}P${date}${time ? `T${time}` : ''}`;
}

function moveOptions({ timeZone, allowBackwards } = {}) {
  if (timeZone !== undefined && typeof timeZone !== 'string') throw TypeError('timeZone must be a string');
  if (allowBackwards !== undefined && typeof allowBackwards !== 'boolean') throw TypeError('allowBackwards must be a boolean');
  return { ...(timeZone === undefined ? {} : { timeZone }), ...(allowBackwards === undefined ? {} : { allowBackwards }) };
}

function durationText(duration) {
  if (typeof duration === 'string') return duration;
  if (duration && typeof duration === 'object') return isoDuration(duration);
  throw TypeError('duration must be an ISO 8601 string or an object of calendar units');
}

/**
 * The `clock:advance` body. A number is milliseconds and `{seconds}` / `{millis}` objects go
 * through unchanged, as before; a string or an object with calendar units becomes `duration`.
 */
export function advanceBody(duration, options = {}) {
  if (typeof duration === 'number') return { millis: duration };
  const calendar = typeof duration === 'string' || (duration && typeof duration === 'object' && Object.keys(duration).some(key => calendarKeys.has(key)));
  if (!calendar) return duration;
  if (typeof duration === 'object' && 'millis' in duration) throw TypeError('millis cannot be combined with calendar units');
  return { duration: durationText(duration), ...moveOptions(options) };
}

/** The `clock:set` body for an anchor, optionally after a duration. */
export function toBody(anchor, { duration, ...options } = {}) {
  if (typeof anchor !== 'string') throw TypeError('the anchor must be a string such as endOfMonth');
  return { to: anchor, ...(duration === undefined ? {} : { duration: durationText(duration) }), ...moveOptions(options) };
}
