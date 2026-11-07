'use strict';
/* Mobile-first views (phones and small tablets). Loaded before app.js; nothing here runs until app.js calls it. */
const mq = matchMedia('(max-width: 900px)');
const isMobile = () => mq.matches;
const SUBVIEWS = ['templates', 'connection', 'settings']; // reached from the "More" tab
const TABS = [
  ['planner', 'Schedule', 'calendar'], ['messages', 'Messages', 'chat'], ['__new', 'New', 'plus'],
  ['contacts', 'Contacts', 'users'], ['more', 'More', 'menu'],
];

function renderTabbar() {
  const cur = SUBVIEWS.includes(state.view) ? 'more' : state.view;
  const waiting = state.messages.filter((m) => m.status === 'pending').length;
  $('tabbar').innerHTML = TABS.map(([id, label, icon]) => id === '__new'
    ? `<button type="button" class="tab fab" data-new="1" aria-label="Schedule a new message"><span class="circle">${ic('plus')}</span></button>`
    : `<a href="#${id}" class="tab ${cur === id ? 'on' : ''}" ${cur === id ? 'aria-current="page"' : ''}>
         <span class="ico">${ic(icon)}${id === 'messages' && waiting ? `<span class="badge" aria-label="${waiting} scheduled">${waiting}</span>` : ''}</span><span>${label}</span></a>`).join('');
}

function dayLabel(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long' });
}
/** Compact relative time for tight spaces: "in 23h", "5m ago", "in 3d". */
function relShort(d) {
  const ms = d - Date.now(), a = Math.abs(ms), n = (v, u) => (ms > 0 ? `in ${v}${u}` : `${v}${u} ago`);
  if (a < 60_000) return 'now';
  if (a < 3_600_000) return n(Math.round(a / 60_000), 'm');
  if (a < 86_400_000) return n(Math.round(a / 3_600_000), 'h');
  return n(Math.round(a / 86_400_000), 'd');
}
const shortDate = (d) => d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });

/** One message as a big, tappable card. */
function msgCard(m, { when = null, ghost = false, showDate = false } = {}) {
  const d = when || new Date(m.sendAt), name = dispName(m);
  const sel = state.selected.has(m.id) && !ghost;
  return `<button type="button" class="mcard ${m.status} ${ghost ? 'ghost' : ''} ${sel ? 'selected' : ''}" data-act="ev" data-id="${m.id}"
      aria-label="${esc(name)}, ${esc(statusLabel(m.status))}, ${esc(shortDate(d))} ${esc(timeLabel({ date: d, windowMin: m.windowMin }))}. ${esc(msgPreview(m))}">
    <span class="mtime"><b>${hm(d)}</b><small>${m.windowMin ? '→ ' + hm(new Date(d.getTime() + m.windowMin * 60_000)) : showDate ? shortDate(d) : ghost ? 'repeats' : relShort(d)}</small>${m.windowMin && showDate ? `<small>${shortDate(d)}</small>` : ''}</span>
    ${avatar(name)}
    <span class="mbody">
      <span class="mname"><span class="nm">${esc(name)}</span>${m.repeat !== 'none' ? ic('repeat') : ''}${m.attachment ? ic('clip') : ''}</span>
      <span class="mtext">${esc(msgPreview(m)) || '<i>(no text)</i>'}</span>
      <span class="mmeta"><span class="tag ${m.status}">${statusLabel(m.status)}</span>${m.windowMin ? '<span class="tag">window</span>' : ''}${m.error ? `<span class="merr">${esc(m.error)}</span>` : ''}</span>
    </span>
  </button>`;
}

/** Same ordering/filters the desktop sidebar uses. */
function filteredMessages() {
  const q = state.search.trim().toLowerCase();
  const match = (m) => {
    const f = state.filter;
    if (f === 'scheduled' && !['pending', 'sending'].includes(m.status)) return false;
    if (f === 'sent' && m.status !== 'sent') return false;
    if (f === 'failed' && !['failed', 'missed'].includes(m.status)) return false;
    if (f === 'cancelled' && m.status !== 'cancelled') return false;
    return !q || [m.name, m.recipient, m.text, m.attachment?.name].some((v) => (v || '').toLowerCase().includes(q));
  };
  const upcoming = state.messages.filter((m) => ['pending', 'sending'].includes(m.status) && match(m)).sort((a, b) => new Date(a.sendAt) - new Date(b.sendAt));
  const rest = state.messages.filter((m) => !['pending', 'sending'].includes(m.status) && match(m));
  return { upcoming, rest };
}

const emptyState = (icon, title, text, cta = '') => `<div class="mempty"><div class="big">${icon}</div><b>${title}</b><p>${text}</p>${cta}</div>`;

/* ---------- Schedule tab ---------- */
function agendaHtml() {
  const from = startOfDay(new Date()), to = addDays(from, 60);
  const attention = state.messages.filter((m) => ['failed', 'missed'].includes(m.status) && Date.now() - new Date(m.sendAt) >= 0 && Date.now() - new Date(m.sendAt) < 7 * 86_400_000)
    .sort((a, b) => new Date(b.sendAt) - new Date(a.sendAt));
  const evs = eventsBetween(from, to);
  const days = new Map();
  evs.forEach((e) => { const k = dayKey(e.date); if (!days.has(k)) days.set(k, { d: e.date, list: [] }); days.get(k).list.push(e); });

  let html = '';
  if (attention.length) html += `<div class="dayhead warn"><span>Needs attention</span><span>${attention.length}</span></div>${attention.map((m) => msgCard(m, { showDate: true })).join('')}`;
  for (const { d, list } of days.values()) {
    html += `<div class="dayhead"><span>${dayLabel(d)}</span><span>${shortDate(d)} · ${list.length}</span></div>${list.map((e) => msgCard(e, { when: e.date, ghost: e.ghost })).join('')}`;
  }
  if (!html) html = emptyState('🗓️', 'Nothing scheduled', 'Schedule a WhatsApp message and it will send automatically – even when your phone is off.',
    '<button class="btn primary big" data-act="new">Schedule a message</button>');
  return `<div class="agenda">${html}</div>`;
}

function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }

function monthHtml() {
  const [start, end] = calRange(), c = state.cursor, today = new Date();
  const evs = eventsBetween(start, end), byDay = {};
  evs.forEach((e) => (byDay[dayKey(e.date)] ??= []).push(e));
  if (!state.selDay || !sameMonth(state.selDay, c)) state.selDay = sameMonth(today, c) ? new Date(today) : new Date(c.getFullYear(), c.getMonth(), 1);
  const sel = state.selDay;
  const DOT = { pending: 'p', sending: 'p', sent: 's', failed: 'f', missed: 'm' };

  let cells = '';
  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const list = byDay[dayKey(d)] ?? [];
    const kinds = [...new Set(list.map((e) => DOT[e.status] || 'm'))].slice(0, 3);
    cells += `<button type="button" class="mday ${!sameMonth(d, c) ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''} ${sameDay(d, sel) ? 'sel' : ''}" data-act="mday" data-date="${d.getTime()}"
      aria-pressed="${sameDay(d, sel)}" aria-label="${esc(d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))}, ${list.length} message${list.length === 1 ? '' : 's'}">
      <span class="n">${d.getDate()}</span><span class="dots">${kinds.map((k) => `<i class="dot ${k}"></i>`).join('')}</span></button>`;
  }
  const dayEvs = eventsBetween(startOfDay(sel), addDays(startOfDay(sel), 1));
  return `<div class="mmonth">
    <div class="mnav"><button class="iconbtn big" data-act="prev" aria-label="Previous month">${ic('left')}</button>
      <b>${MONTHS[c.getMonth()]} ${c.getFullYear()}</b>
      <button class="iconbtn big" data-act="next" aria-label="Next month">${ic('right')}</button>
      <button class="btn" data-act="mtoday">Today</button></div>
    <div class="mdows" aria-hidden="true">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="mgrid">${cells}</div>
    <div class="dayhead"><span>${dayLabel(sel)}, ${shortDate(sel)}</span><button class="btn soft" data-act="cell" data-date="${startOfDay(sel).getTime()}">${ic('plus')} Add</button></div>
    ${dayEvs.length ? dayEvs.map((e) => msgCard(e, { when: e.date, ghost: e.ghost })).join('') : '<p class="muted center">No messages this day.</p>'}
  </div>`;
}

function mobilePlanner() {
  const mv = state.mView;
  const head = `<div class="mhead">
      <div class="seg" role="tablist" aria-label="View">${[['agenda', 'Upcoming'], ['month', 'Month']].map(([v, l]) =>
        `<button role="tab" aria-selected="${mv === v}" class="${mv === v ? 'on' : ''}" data-act="mview" data-v="${v}">${l}</button>`).join('')}</div>
      <button class="btn ${state.selectMode ? 'primary' : ''}" data-act="selectToggle" aria-pressed="${state.selectMode}">${ic('check')} Select</button></div>`;
  return `<div class="mplan ${state.selectMode ? 'selecting' : ''}">${head}${mv === 'month' ? monthHtml() : agendaHtml()}${state.selectMode ? bulkBar() : ''}</div>`;
}

/* ---------- Messages tab ---------- */
function messageListHtml() {
  const { upcoming, rest } = filteredMessages();
  if (!upcoming.length && !rest.length) {
    return state.search || state.filter !== 'all'
      ? emptyState('🔎', 'No matches', 'Try a different search or filter.')
      : emptyState('💬', 'No messages yet', 'Tap the + button to schedule your first one.');
  }
  return (upcoming.length ? `<div class="dayhead"><span>Scheduled</span><span>${upcoming.length}</span></div>${upcoming.map((m) => msgCard(m, { showDate: true })).join('')}` : '') +
    (rest.length ? `<div class="dayhead"><span>History</span><span>${rest.length}</span></div>${rest.map((m) => msgCard(m, { showDate: true })).join('')}` : '');
}

function messagesView() {
  return `<div class="mpage">
    <div class="msearch">${ic('search')}<input id="mSearch" type="search" inputmode="search" enterkeyhint="search" placeholder="Search messages" value="${esc(state.search)}" autocomplete="off" aria-label="Search messages"></div>
    <div class="chiprow" role="group" aria-label="Filter messages">${FILTERS.map(([id, l]) => `<button type="button" class="fchip ${state.filter === id ? 'on' : ''}" data-act="mfilter" data-f="${id}" aria-pressed="${state.filter === id}">${l}</button>`).join('')}</div>
    <div id="mList">${messageListHtml()}</div></div>`;
}

/* ---------- More tab ---------- */
function moreView() {
  const wa = state.wa, ok = wa.status === 'open';
  const row = (id, icon, title, sub, warn = false) => `<a class="mrow ${warn ? 'warn' : ''}" href="#${id}"><span class="ricon">${ic(icon)}</span>
    <span class="grow"><b>${title}</b><small>${sub}</small></span>${ic('right')}</a>`;
  return `<div class="mpage">
    <div class="mlist">
      ${row('connection', 'phone', 'WhatsApp connection', ok ? `Connected as +${esc(wa.me)}` : wa.status === 'qr' ? 'Scan the QR code to link' : 'Not connected – tap to check', !ok)}
      ${row('templates', 'template', 'Templates', state.templates.length ? `${state.templates.length} saved message${state.templates.length === 1 ? '' : 's'}` : 'Save messages you send often')}
      ${row('settings', 'settings', 'Settings', 'Alerts, backups, install the app')}
    </div>
    <p class="hint center">Messages are sent by your server, so they go out even when this phone is off.</p>
  </div>`;
}
