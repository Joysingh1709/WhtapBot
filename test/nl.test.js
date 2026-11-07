import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { parseNL } = createRequire(import.meta.url)('../public/nl.js');

const now = new Date(2026, 10, 7, 10, 0); // Sat 7 Nov 2026, 10:00 local
const contacts = [{ recipient: '919876543210', name: 'Mom' }, { recipient: '14155550100', name: 'Alex Johnson' }];
const ymd = (d) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const p = (s) => parseNL(s, { now, contacts });

test('the headline example', () => {
  const r = p('wish Mom happy birthday every Nov 12 at 9am');
  assert.equal(r.repeat, 'yearly');
  assert.equal(ymd(r.when), '2026-11-12 09:00');
  assert.equal(r.name, 'Mom');
  assert.equal(r.recipient, '919876543210');
  assert.equal(r.text, 'Happy birthday {name}!');
});

test('yearly date already passed this year rolls to next year', () => {
  assert.equal(ymd(p('wish Mom happy birthday every Oct 3 at 8am').when), '2027-10-03 08:00');
});

test('birthday on a date implies yearly', () => {
  const r = p('wish Alex happy birthday on Dec 5 at 7:30am');
  assert.equal(r.repeat, 'yearly');
  assert.equal(ymd(r.when), '2026-12-05 07:30');
  assert.equal(r.name, 'Alex Johnson');
});

test('tomorrow + time + quoted text', () => {
  const r = p('message Mom tomorrow at 6pm "I will be late"');
  assert.equal(ymd(r.when), '2026-11-08 18:00');
  assert.equal(r.text, 'I will be late');
  assert.equal(r.name, 'Mom');
});

test('every weekday with a send window', () => {
  const r = p('remind Mom to take her medicine every weekday between 9 and 11am');
  assert.equal(r.repeat, 'weekdays');
  assert.equal(r.windowMin, 120);
  assert.equal(ymd(r.when), '2026-11-09 09:00'); // Saturday → Monday? weekday series starts at next 9:00 → tomorrow is Sunday
});

test('every Monday', () => {
  const r = p('send Mom good morning every monday at 8am');
  assert.equal(r.repeat, 'weekly');
  assert.equal(ymd(r.when), '2026-11-09 08:00');
  assert.equal(r.text, 'Good morning');
});

test('relative times', () => {
  assert.equal(ymd(p('tell Mom hi in 30 minutes').when), '2026-11-07 10:30');
  assert.equal(ymd(p('say hello to Mom in 2 hours').when), '2026-11-07 12:00');
  assert.equal(ymd(p('text Mom hi in 3 days at 5pm').when), '2026-11-10 17:00');
});

test('end conditions', () => {
  const a = p('send Mom good morning every day at 8am for 5 times');
  assert.deepEqual([a.endType, a.endCount], ['count', 5]);
  const b = p('send Mom good morning every day at 8am until Dec 31');
  assert.deepEqual([b.endType, b.endDate], ['date', '2026-12-31']);
  const c = p('send Mom good morning every week at 8am for 3 weeks');
  assert.deepEqual([c.endType, c.endCount], ['count', 3]);
});

test('explicit phone number', () => {
  const r = p('text +91 94066 53713 happy diwali tomorrow at 9am');
  assert.equal(r.recipient, '919406653713');
  assert.equal(ymd(r.when), '2026-11-08 09:00');
});

test('monthly on a day of the month', () => {
  const r = p('remind Mom to pay rent every 1st at 9am');
  assert.equal(r.repeat, 'monthly');
  assert.equal(ymd(r.when), '2026-12-01 09:00');
});

test('unknown contact keeps the typed name and leaves the number empty', () => {
  const r = p('wish Bob happy anniversary on Mar 3 at 10am');
  assert.equal(r.name, 'Bob');
  assert.equal(r.recipient, '');
});

test('time phrase is stripped from the message even with a send window', () => {
  const r = p('wish Mom happy birthday every Nov 12 at 9am between 9 and 11am');
  assert.equal(r.text, 'Happy birthday {name}!');
  assert.equal(r.windowMin, 120);
  assert.equal(ymd(r.when), '2026-11-12 09:00');
});

test('"good morning" is message text, not a time', () => {
  const r = p('send Mom good morning tomorrow at 7am');
  assert.equal(r.text, 'Good morning');
  assert.equal(ymd(r.when), '2026-11-08 07:00');
});
