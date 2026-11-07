// Timezone-aware date maths without dependencies. All "wall time" values are {y, m(1-12), d, h, mi, s}
// as a person would read them on a clock in the given IANA timezone.

const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTz(tz) {
  try {
    if (!tz || typeof tz !== 'string') return false;
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Clock reading in `tz` at instant `ts` (epoch ms). */
export function wallParts(ts, tz) {
  const o = {};
  for (const p of dtf(tz).formatToParts(new Date(ts))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}

const offsetAt = (ts, tz) => {
  const p = wallParts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
};

/** Instant (epoch ms) at which the clocks in `tz` read the given wall time. */
export function wallToEpoch({ y, m, d, h = 0, mi = 0, s = 0 }, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let t = guess - offsetAt(guess, tz);
  t = guess - offsetAt(t, tz); // second pass handles DST boundaries
  return t;
}

/** 'YYYY-MM-DDTHH:mm' as shown on a clock in `tz` (matches <input type="datetime-local">). */
export function toLocalString(ts, tz) {
  const w = wallParts(ts, tz);
  const p = (n) => String(n).padStart(2, '0');
  return `${w.y}-${p(w.m)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

/** Parse 'YYYY-MM-DDTHH:mm[:ss]' as a clock reading in `tz`. Returns epoch ms or NaN. */
export function parseLocal(str, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(str ?? ''));
  if (!m) return NaN;
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => (v === undefined ? 0 : +v));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return NaN;
  return wallToEpoch({ y, m: mo, d, h, mi, s }, tz);
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function stepWall(w, rule, anchorDay) {
  const base = new Date(Date.UTC(w.y, w.m - 1, w.d));
  if (rule === 'daily') base.setUTCDate(base.getUTCDate() + 1);
  else if (rule === 'weekly') base.setUTCDate(base.getUTCDate() + 7);
  else if (rule === 'weekdays') {
    do base.setUTCDate(base.getUTCDate() + 1);
    while (base.getUTCDay() === 0 || base.getUTCDay() === 6);
  } else if (rule === 'monthly' || rule === 'yearly') {
    let y = w.y, m = w.m;
    if (rule === 'monthly') { m += 1; if (m > 12) { m = 1; y += 1; } } else y += 1;
    const day = Math.min(anchorDay || w.d, daysInMonth(y, m)); // 31st → short month, Feb 29 → 28, snaps back later
    return { y, m, d: day, h: w.h, mi: w.mi, s: w.s };
  } else throw new Error(`bad repeat rule ${rule}`);
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate(), h: w.h, mi: w.mi, s: w.s };
}

/**
 * Next occurrence strictly after `now`, keeping the same clock time in `tz` (so 09:00 stays 09:00 across DST).
 * `anchorDay` is the day-of-month of the first occurrence, used so the 31st doesn't drift to the 30th forever.
 */
export function nextOccurrence(ts, rule, tz, anchorDay = null, now = Date.now()) {
  let w = wallParts(ts, tz), cur = ts;
  for (let i = 0; i < 20000; i++) {
    w = stepWall(w, rule, anchorDay);
    cur = wallToEpoch(w, tz);
    if (cur > now) return cur;
  }
  throw new Error('could not find next occurrence');
}

/** Move an instant by an amount; days keep the same clock time in `tz`. */
export function shiftInstant(ts, tz, amount, unit) {
  if (unit === 'minutes') return ts + amount * 60_000;
  if (unit === 'hours') return ts + amount * 3_600_000;
  if (unit === 'days') {
    const w = wallParts(ts, tz);
    const d = new Date(Date.UTC(w.y, w.m - 1, w.d + amount));
    return wallToEpoch({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: w.h, mi: w.mi, s: w.s }, tz);
  }
  throw new Error(`bad unit ${unit}`);
}

/** End of the given calendar day ('YYYY-MM-DD') in `tz`, as an instant. */
export function endOfDay(dateStr, tz) {
  return parseLocal(`${dateStr}T23:59:59`, tz);
}

/** Random instant within [start, start + windowMin minutes]. windowMin 0 → exactly start. */
export function pickFireTime(start, windowMin) {
  if (!windowMin) return start;
  return start + Math.floor(Math.random() * windowMin * 60_000);
}
