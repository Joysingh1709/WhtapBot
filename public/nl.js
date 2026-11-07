/* Natural-language quick add: "wish Mom happy birthday every Nov 12 at 9am" → form fields.
 * Pure rule-based parsing (no network, no AI). Works in the browser (window.parseNL) and in Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.parseNL = factory().parseNL;
})(typeof self !== 'undefined' ? self : this, function () {
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
  const monthIdx = (s) => MONTHS.indexOf(s.slice(0, 3).toLowerCase());
  const dayIdx = (s) => DAYS.indexOf(s.slice(0, 3).toLowerCase());
  const p2 = (n) => String(n).padStart(2, '0');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function to24(h, mi, ap) {
    h = +h; mi = +(mi || 0);
    if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
    return h > 23 || mi > 59 ? null : { h, mi };
  }

  function parseNL(input, { now = new Date(), contacts = [] } = {}) {
    const out = { text: '', name: '', recipient: '', repeat: 'none', endType: 'never', endCount: null, endDate: '', when: null, windowMin: 0, notes: [] };
    let rest = ' ' + String(input || '').trim() + ' ';
    const take = (re) => {
      const m = re.exec(rest);
      if (m) rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
      return m;
    };

    // 1. quoted message text
    const q = take(/["“]([^"”]+)["”]/);
    if (q) out.text = q[1].trim();

    // 2. an explicit phone number (+country code, or 10+ digits) – after removing ISO dates
    const iso = take(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    const ph = take(/\+\d[\d\s-]{6,}\d|\b\d[\d\s-]{8,}\d\b/);
    if (ph) out.recipient = ph[0].replace(/\D/g, '');

    // 3. send window: "between 9 and 11am"
    let time = null;
    const win = take(/\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:and|to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (win) {
      const ap2 = win[6] || win[3], ap1 = win[3] || win[6];
      const a = to24(win[1], win[2], ap1), b = to24(win[4], win[5], ap2);
      if (a && b) {
        time = a;
        let diff = b.h * 60 + b.mi - (a.h * 60 + a.mi);
        if (diff <= 0) diff += 12 * 60; // "between 9 and 11" with no am/pm
        out.windowMin = Math.min(diff, 720);
      }
    }

    // 4. repeat
    let anchor = {}; // explicit month/day/weekday attached to the repeat phrase
    let m;
    if ((m = take(new RegExp(`\\bevery\\s+${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i')))) { out.repeat = 'yearly'; anchor = { month: monthIdx(m[1]), day: +m[2] }; }
    else if ((m = take(new RegExp(`\\bevery\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\b`, 'i')))) { out.repeat = 'yearly'; anchor = { month: monthIdx(m[2]), day: +m[1] }; }
    else if ((m = take(/\bevery\s+(\d{1,2})(?:st|nd|rd|th)\b(?:\s+of\s+the\s+month)?/i))) { out.repeat = 'monthly'; anchor = { day: +m[1] }; }
    else if ((m = take(new RegExp(`\\bevery\\s+${DAY_RE}\\b`, 'i')))) { out.repeat = 'weekly'; anchor = { weekday: dayIdx(m[1]) }; }
    else if ((m = take(/\bevery\s+weekday\b|\bon\s+weekdays\b|\bweekdays\b/i))) out.repeat = 'weekdays';
    else if ((m = take(/\bevery\s+(day|week|month|year)\b|\b(daily|weekly|monthly|yearly|annually)\b/i))) {
      const w = (m[1] || m[2]).toLowerCase();
      out.repeat = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly', daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly', annually: 'yearly' }[w];
    }

    // 5. how long it repeats
    let endAmount = null;
    if ((m = take(/\b(?:for|x)\s+(\d+)\s+(times|days|weeks|months|years)\b/i))) endAmount = { n: +m[1], unit: m[2].toLowerCase() };
    else if ((m = take(/\b(\d+)\s+times\b/i))) out.endCount = +m[1];
    let until = null;
    if ((m = take(new RegExp(`\\b(?:until|till|through)\\s+${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'i')))) until = { month: monthIdx(m[1]), day: +m[2], year: m[3] ? +m[3] : null };
    else if ((m = take(new RegExp(`\\b(?:until|till|through)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?`, 'i')))) until = { month: monthIdx(m[2]), day: +m[1], year: m[3] ? +m[3] : null };

    // 6. date
    let date = null; // {y, m(0-11), d}
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const addD = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }; };
    let relative = null; // {minutes}
    if (iso) date = { y: +iso[1], m: +iso[2] - 1, d: +iso[3] };
    else if ((m = take(/\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i))) {
      const n = +m[1], u = m[2][0].toLowerCase();
      if (u === 'm') relative = n; else if (u === 'h') relative = n * 60; else date = addD(n * (u === 'w' ? 7 : 1));
    } else if (take(/\bday after tomorrow\b/i)) date = addD(2);
    else if (take(/\btomorrow\b|\btmrw\b/i)) date = addD(1);
    else if (take(/\btoday\b|\btonight\b/i)) date = addD(0);
    else if ((m = take(new RegExp(`\\b(?:on\\s+)?${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i')))) date = { month: monthIdx(m[1]), day: +m[2], year: m[3] ? +m[3] : null };
    else if ((m = take(new RegExp(`\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, 'i')))) date = { month: monthIdx(m[2]), day: +m[1], year: m[3] ? +m[3] : null };
    else if ((m = take(new RegExp(`\\b(?:next\\s+|on\\s+|this\\s+)?${DAY_RE}\\b`, 'i')))) date = { weekday: dayIdx(m[1]), next: /next/i.test(m[0]) };

    // 7. clock time (always strip the phrase from the text, even if a send window already set the time)
    let found = null;
    if ((m = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i))) found = to24(m[1], m[2], m[3]);
    else if ((m = take(/\bat\s+(\d{1,2}):(\d{2})\b/i))) found = to24(m[1], m[2], null);
    else if ((m = take(/\bat\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th))/i))) found = to24(m[1], 0, +m[1] >= 1 && +m[1] <= 6 ? 'pm' : null); // "at 5" → 5pm
    else if (take(/\bnoon\b/i)) found = { h: 12, mi: 0 };
    else if (take(/\bmidnight\b/i)) found = { h: 0, mi: 0 };
    else if (!/good morning/i.test(input) && take(/\b(?:in the |this )?morning\b/i)) found = { h: 9, mi: 0 };
    else if (!/good evening/i.test(input) && take(/\b(?:in the |this )?evening\b/i)) found = { h: 18, mi: 0 };
    time = time || found;

    // ---- resolve the first send time ----
    const mk = (d, t) => new Date(d.y, d.m, d.d, t.h, t.mi, 0, 0);
    const T = time || { h: 9, mi: 0 };
    const anchorMonth = anchor.month ?? date?.month, anchorDay = anchor.day ?? date?.day;
    let when = null;
    if (relative != null) when = new Date(now.getTime() + relative * 60_000);
    else if (anchor.weekday != null || date?.weekday != null) {
      const wd = anchor.weekday ?? date.weekday;
      let delta = (wd - now.getDay() + 7) % 7;
      let cand = mk(addD(delta), T);
      if (cand <= now || (date?.next && delta === 0)) cand = mk(addD(delta + 7), T);
      when = cand;
    } else if (anchorMonth != null && anchorDay != null) {
      const y = date?.year ?? now.getFullYear();
      let cand = new Date(y, anchorMonth, anchorDay, T.h, T.mi);
      if (cand <= now && !date?.year) cand = new Date(y + 1, anchorMonth, anchorDay, T.h, T.mi);
      when = cand;
    } else if (anchor.day != null && out.repeat === 'monthly') {
      let cand = new Date(now.getFullYear(), now.getMonth(), anchor.day, T.h, T.mi);
      if (cand <= now) cand = new Date(now.getFullYear(), now.getMonth() + 1, anchor.day, T.h, T.mi);
      when = cand;
    } else if (date && date.y != null) when = mk(date, T);
    else if (time) {
      let cand = mk(addD(0), time);
      if (cand <= now) cand = mk(addD(1), time);
      when = cand;
    }
    if (out.repeat === 'weekdays' && when) while (when.getDay() === 0 || when.getDay() === 6) when = new Date(when.getFullYear(), when.getMonth(), when.getDate() + 1, when.getHours(), when.getMinutes());
    out.when = when;

    // a birthday/anniversary on a specific day is yearly even without the word "every"
    if (out.repeat === 'none' && /\b(birthday|anniversary|bday)\b/i.test(input) && anchorMonth != null && date && date.month != null) out.repeat = 'yearly';

    // ---- repeat end ----
    if (out.repeat !== 'none') {
      if (endAmount) {
        const per = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[out.repeat];
        if (endAmount.unit === 'times' || endAmount.unit === per) { out.endType = 'count'; out.endCount = endAmount.n; }
        else if (when) {
          const d = new Date(when);
          if (endAmount.unit === 'days') d.setDate(d.getDate() + endAmount.n);
          if (endAmount.unit === 'weeks') d.setDate(d.getDate() + endAmount.n * 7);
          if (endAmount.unit === 'months') d.setMonth(d.getMonth() + endAmount.n);
          if (endAmount.unit === 'years') d.setFullYear(d.getFullYear() + endAmount.n);
          out.endType = 'date'; out.endDate = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
        }
      } else if (out.endCount) out.endType = 'count';
      else if (until) {
        let y = until.year ?? (when ? when.getFullYear() : now.getFullYear());
        let cand = new Date(y, until.month, until.day);
        if (!until.year && when && cand < when) cand = new Date(y + 1, until.month, until.day);
        out.endType = 'date'; out.endDate = `${cand.getFullYear()}-${p2(cand.getMonth() + 1)}-${p2(cand.getDate())}`;
      }
    } else out.endCount = null;

    // ---- who + what ----
    let r = rest.replace(/\s+/g, ' ').replace(/\b(?:please|pls|can you|could you)\b/gi, '').replace(/^\s*(?:and|at|on|in|the)\s+/i, '').trim();
    r = r.replace(/\s+(?:at|on|in|by|every|for|from|and)$/i, '').trim();
    const findContact = (s) => {
      const t = s.trim().toLowerCase();
      if (!t) return null;
      return contacts.find((c) => c.name && c.name.toLowerCase() === t)
        || contacts.find((c) => c.name && (c.name.toLowerCase().split(/\s+/)[0] === t || c.name.toLowerCase().startsWith(t)))
        || null;
    };
    let name = '', text = out.text;
    let mm;
    if ((mm = /^(?:wish|greet)\s+(.+?)\s+((?:a\s+)?(?:happy|merry|good|best|congratulations|congrats|lovely|wonderful).*)$/i.exec(r))) {
      name = mm[1]; if (!text) text = cap(mm[2].replace(/^a\s+/i, '').trim()) + ' {name}!';
    } else if ((mm = /^(?:wish)\s+((?:a\s+)?(?:happy|merry|good|best).+?)\s+to\s+(.+)$/i.exec(r))) {
      name = mm[2]; if (!text) text = cap(mm[1].replace(/^a\s+/i, '').trim()) + ' {name}!';
    } else if ((mm = /^(?:remind|ping)\s+(.+?)\s+(?:to|about|that|of)\s+(.+)$/i.exec(r))) {
      name = mm[1]; if (!text) text = 'Reminder: ' + mm[2];
    } else if ((mm = /^(?:say|send|text|message|msg)\s+(.+?)\s+to\s+(.+)$/i.exec(r)) && !out.text) {
      text = cap(mm[1]); name = mm[2];
    } else if ((mm = /^(?:tell|message|text|send|msg|whatsapp|dm|notify)\s+(.+)$/i.exec(r))) {
      const tail = mm[1];
      // longest saved contact name at the start, else the first word
      const hit = contacts.filter((c) => c.name && tail.toLowerCase().startsWith(c.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
      const first = hit ? hit.name : tail.split(/\s+/)[0];
      name = first;
      if (!text) text = tail.slice(first.length).replace(/^[\s:,-]+/, '').replace(/^(?:that|to)\s+/i, '');
    } else if (!text) text = r;
    name = name.replace(/^(?:my|to)\s+/i, '').replace(/[,:;.]+$/, '').trim();
    text = text.trim();
    if (text) text = cap(text);

    const c = findContact(name) || (name ? contacts.find((x) => x.name && x.name.toLowerCase().includes(name.toLowerCase())) : null);
    if (c) { out.name = c.name; if (!out.recipient) out.recipient = c.recipient; }
    else out.name = cap(name);
    out.text = text;

    // ---- human-readable summary ----
    const RPT = { daily: 'every day', weekdays: 'every weekday', weekly: 'every week', monthly: 'every month', yearly: 'every year' };
    if (out.name || out.recipient) out.notes.push('To: ' + (out.name || '+' + out.recipient) + (out.recipient && out.name ? '' : ''));
    if (out.when) out.notes.push(out.when.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: out.when.getFullYear() !== now.getFullYear() ? 'numeric' : undefined, hour: '2-digit', minute: '2-digit' }));
    if (out.repeat !== 'none') out.notes.push('Repeats ' + RPT[out.repeat]);
    if (out.endType === 'count') out.notes.push(`${out.endCount} times`);
    if (out.endType === 'date') out.notes.push('until ' + out.endDate);
    if (out.windowMin) out.notes.push(`within ${out.windowMin} min`);
    return out;
  }

  return { parseNL };
});
