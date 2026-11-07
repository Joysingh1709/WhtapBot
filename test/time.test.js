import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocal, toLocalString, nextOccurrence, shiftInstant, endOfDay, pickFireTime, isValidTz } from '../src/time.js';

test('wall time round-trips in several zones', () => {
  for (const tz of ['Asia/Kolkata', 'America/New_York', 'Europe/London', 'Pacific/Auckland', 'UTC']) {
    const t = parseLocal('2026-11-12T09:30', tz);
    assert.equal(toLocalString(t, tz), '2026-11-12T09:30', tz);
  }
  assert.equal(new Date(parseLocal('2026-11-12T09:00', 'Asia/Kolkata')).toISOString(), '2026-11-12T03:30:00.000Z');
});

test('daily 9:00 stays 9:00 across the US DST change (the old drift bug)', () => {
  const tz = 'America/New_York';
  const start = parseLocal('2026-10-31T09:00', tz); // EDT (UTC-4)
  const next = nextOccurrence(start, 'daily', tz, null, start);
  assert.equal(toLocalString(next, tz), '2026-11-01T09:00'); // after fall-back, EST (UTC-5)
  assert.equal(new Date(next).toISOString(), '2026-11-01T14:00:00.000Z');
});

test('monthly on the 31st does not drift to the 30th', () => {
  let t = parseLocal('2026-01-31T09:00', 'UTC');
  const seen = [];
  for (let i = 0; i < 4; i++) { t = nextOccurrence(t, 'monthly', 'UTC', 31, t); seen.push(toLocalString(t, 'UTC').slice(0, 10)); }
  assert.deepEqual(seen, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('yearly Feb 29 returns to the 29th in leap years', () => {
  let t = parseLocal('2028-02-29T09:00', 'UTC');
  const seen = [];
  for (let i = 0; i < 4; i++) { t = nextOccurrence(t, 'yearly', 'UTC', 29, t); seen.push(toLocalString(t, 'UTC').slice(0, 10)); }
  assert.deepEqual(seen, ['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
});

test('weekdays skips the weekend; weekly keeps the weekday', () => {
  const fri = parseLocal('2026-11-06T09:00', 'UTC'); // Friday
  assert.equal(toLocalString(nextOccurrence(fri, 'weekdays', 'UTC', null, fri), 'UTC'), '2026-11-09T09:00');
  assert.equal(toLocalString(nextOccurrence(fri, 'weekly', 'UTC', null, fri), 'UTC'), '2026-11-13T09:00');
});

test('a server that was offline catches up to the next FUTURE occurrence', () => {
  const start = parseLocal('2026-01-01T09:00', 'UTC');
  const now = parseLocal('2026-03-10T12:00', 'UTC');
  assert.equal(toLocalString(nextOccurrence(start, 'daily', 'UTC', null, now), 'UTC'), '2026-03-11T09:00');
});

test('shiftInstant by days keeps the clock time across DST', () => {
  const tz = 'America/New_York';
  const t = parseLocal('2026-10-31T09:00', tz);
  assert.equal(toLocalString(shiftInstant(t, tz, 2, 'days'), tz), '2026-11-02T09:00');
  assert.equal(shiftInstant(t, tz, 90, 'minutes') - t, 90 * 60_000);
});

test('endOfDay, pickFireTime, isValidTz', () => {
  assert.equal(toLocalString(endOfDay('2026-12-31', 'Asia/Kolkata'), 'Asia/Kolkata'), '2026-12-31T23:59');
  for (let i = 0; i < 200; i++) {
    const f = pickFireTime(1000, 120);
    assert.ok(f >= 1000 && f < 1000 + 120 * 60_000);
  }
  assert.equal(pickFireTime(1000, 0), 1000);
  assert.ok(isValidTz('Asia/Kolkata'));
  assert.ok(!isValidTz('Mars/Base'));
});
