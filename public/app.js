'use strict';
/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ROW = 56; // px per hour in week/day view
const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const toLocalInput = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const VIEWER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

/** 'YYYY-MM-DDTHH:mm' as the clock reads in `tz` at instant `date`. */
function fmtInTz(date, tz) {
  const o = {};
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date)) o[p.type] = p.value;
  return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`;
}

const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  template: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>',
  repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24">${ICONS[n]}</svg>`;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof Blob) ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me) { location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('Signed out.'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  document.querySelector('.toast')?.remove();
  const t = Object.assign(document.createElement('div'), { className: 'toast' + (bad ? ' bad' : ''), textContent: msg });
  t.setAttribute('role', bad ? 'alert' : 'status');
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

/* ---------- state ---------- */
const state = {
  view: 'planner', calView: 'month', cursor: new Date(),
  messages: [], occ: [], contacts: [], templates: [], groups: [], settings: null, wa: { status: 'starting' },
  search: '', filter: 'all', sig: '', scroll: null,
  selectMode: false, selected: new Set(),
  mView: 'agenda', selDay: null, cSearch: '', // mobile
};
const NAV = [
  ['planner', 'Message Planner', 'calendar'], ['templates', 'Templates', 'template'],
  ['contacts', 'Contacts & Groups', 'users'], ['connection', 'WhatsApp Connection', 'phone'], ['settings', 'Settings', 'settings'],
];
const FILTERS = [['all', 'All'], ['scheduled', 'Scheduled'], ['sent', 'Sent'], ['failed', 'Failed'], ['cancelled', 'Cancelled']];

const isGroup = (r) => r.endsWith('@g.us');
const phoneOf = (r) => '+' + r.split('@')[0];
const dispName = (m) => m.name || (isGroup(m.recipient) ? 'Group chat' : phoneOf(m.recipient));
const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#22c55e', '#ef4444'];
const colorFor = (s) => COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initial = (s) => (String(s).replace(/^\+/, '')[0] || '?').toUpperCase();
const avatar = (name) => `<span class="avatar" style="background:${colorFor(name)}">${esc(initial(name))}</span>`;
const statusLabel = (s) => ({ pending: 'Scheduled', sending: 'Sending', sent: 'Sent', failed: 'Failed', cancelled: 'Cancelled', missed: 'Missed' }[s] || s);
const KIND_LABEL = { image: 'Photo', video: 'Video', audio: 'Audio', voice: 'Voice note', document: 'Document' };
const RPT_LABEL = { daily: 'every day', weekdays: 'every weekday', weekly: 'every week', monthly: 'every month', yearly: 'every year' };
const msgPreview = (m) => m.text || (m.attachment ? '📎 ' + (KIND_LABEL[m.attachment.kind] || 'File') + ': ' + m.attachment.name : '');

function rel(date) {
  const ms = date - Date.now(), abs = Math.abs(ms);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return 'now';
  if (abs < 3_600_000) return rtf.format(Math.round(ms / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(ms / 3_600_000), 'hour');
  return rtf.format(Math.round(ms / 86_400_000), 'day');
}

/* ---------- calendar data ---------- */
function eventsBetween(from, to) {
  const out = [];
  for (const m of state.messages) {
    if (m.status === 'cancelled') continue;
    const t = new Date(m.sendAt);
    if (t >= from && t < to) out.push({ ...m, date: t });
  }
  const byId = new Map(state.messages.map((m) => [m.id, m]));
  for (const o of state.occ) {
    const m = byId.get(o.id), t = new Date(o.sendAt);
    if (m && t >= from && t < to) out.push({ ...m, date: t, ghost: true });
  }
  return out.sort((a, b) => a.date - b.date);
}

function calRange() {
  const c = startOfDay(state.cursor);
  const view = isMobile() ? 'month' : state.calView;
  if (view === 'day') return [c, addDays(c, 1)];
  if (view === 'week') { const s = addDays(c, -c.getDay()); return [s, addDays(s, 7)]; }
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const days = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
  return [start, addDays(start, Math.ceil((first.getDay() + days) / 7) * 7)];
}

async function loadOcc() {
  if (state.view !== 'planner') return;
  const [s, e] = isMobile() && state.mView === 'agenda' ? [startOfDay(new Date()), addDays(startOfDay(new Date()), 60)] : calRange();
  try { state.occ = await api(`/occurrences?from=${encodeURIComponent(s.toISOString())}&to=${encodeURIComponent(e.toISOString())}`); } catch { /* keep old */ }
}

function calTitle() {
  const c = state.cursor, [s, e] = calRange(), last = addDays(e, -1);
  if (state.calView === 'month') return [`${MONTHS[c.getMonth()]} ${c.getFullYear()}`, 'this month'];
  if (state.calView === 'day') return [`${DAYS[c.getDay()]}, ${c.getDate()} ${MONTHS[c.getMonth()]} ${c.getFullYear()}`, 'today'];
  const same = s.getMonth() === last.getMonth();
  return [`${MONTHS[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${same ? '' : MONTHS[last.getMonth()].slice(0, 3) + ' '}${last.getDate()}, ${last.getFullYear()}`, 'this week'];
}

const timeLabel = (e) => (e.windowMin ? `${hm(e.date)}–${hm(new Date(e.date.getTime() + e.windowMin * 60_000))}` : hm(e.date));
const draggable = (e) => e.status === 'pending' && !e.ghost;

const evHtml = (e, style = '') => `
  <div role="button" tabindex="0" class="ev ${e.status} ${e.ghost ? 'ghost' : ''} ${state.selected.has(e.id) && !e.ghost ? 'selected' : ''}" data-act="ev" data-id="${e.id}" ${draggable(e) ? 'data-drag="1"' : ''} style="${style}"
       title="${esc(dispName(e) + ' — ' + msgPreview(e) + (e.tz !== VIEWER_TZ ? ' (' + e.tz + ')' : ''))}">
    <span class="t">${timeLabel(e)}</span>${e.repeat !== 'none' ? ic('repeat') : ''}${e.attachment ? ic('clip') : ''}<span class="x">${esc(dispName(e) === e.name ? e.name + ': ' + msgPreview(e) : msgPreview(e))}</span>
  </div>`;

function monthView(start, end) {
  const evs = eventsBetween(start, end), byDay = {};
  evs.forEach((e) => (byDay[dayKey(e.date)] ??= []).push(e));
  const today = new Date();
  let cells = '';
  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const list = byDay[dayKey(d)] ?? [];
    cells += `<div role="button" tabindex="0" aria-label="${esc(d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))}, ${list.length} message${list.length === 1 ? '' : 's'}. Press to add a message." class="cell ${d.getMonth() !== state.cursor.getMonth() ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''}" data-act="cell" data-date="${d.getTime()}">
      <span class="dnum">${d.getDate()}</span>
      ${list.slice(0, 3).map((e) => evHtml(e)).join('')}
      ${list.length > 3 ? `<span class="more" data-act="more" data-date="${d.getTime()}">+${list.length - 3} more</span>` : ''}
    </div>`;
  }
  return `<div class="dows">${DAYS.map((d) => `<div class="dow">${d.slice(0, 3).toUpperCase()}</div>`).join('')}</div><div class="month">${cells}</div>`;
}

function layoutColumn(list) {
  const out = []; let cluster = [], end = -1;
  const flush = () => {
    const lanes = [];
    cluster.forEach((e) => { let l = lanes.findIndex((x) => x <= e.top); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = e.top + e.h; e.lane = l; });
    cluster.forEach((e) => (e.lanes = lanes.length)); out.push(...cluster); cluster = [];
  };
  list.forEach((e) => { if (cluster.length && e.top >= end) flush(); cluster.push(e); end = Math.max(end, e.top + e.h); });
  if (cluster.length) flush();
  return out;
}

function timeGrid(start, end) {
  const days = [];
  for (let d = new Date(start); d < end; d = addDays(d, 1)) days.push(new Date(d));
  const evs = eventsBetween(start, end), today = new Date();
  const cols = `56px repeat(${days.length}, minmax(0,1fr))`;
  const head = `<div class="tg-head" style="grid-template-columns:${cols}"><div style="border:0"></div>${days.map((d) =>
    `<div class="${sameDay(d, today) ? 'today' : ''}">${DAYS[d.getDay()].slice(0, 3).toUpperCase()}<span class="n">${d.getDate()}</span></div>`).join('')}</div>`;
  const colHtml = days.map((d) => {
    const list = evs.filter((e) => sameDay(e.date, d)).map((e) => ({ ...e, top: (e.date.getHours() + e.date.getMinutes() / 60) * ROW, h: Math.max(40, (e.windowMin / 60) * ROW) }));
    const now = sameDay(d, today) ? `<div class="nowline" style="top:${(today.getHours() + today.getMinutes() / 60) * ROW}px"></div>` : '';
    return `<div class="tcol ${sameDay(d, today) ? 'today' : ''}" data-act="slot" data-date="${d.getTime()}">${now}${layoutColumn(list).map((e) =>
      evHtml(e, `top:${e.top}px;height:${e.h}px;left:calc(${(e.lane / e.lanes) * 100}% + 2px);width:calc(${100 / e.lanes}% - 4px)`)).join('')}</div>`;
  }).join('');
  const hours = Array.from({ length: 24 }, (_, h) => `<div>${h === 0 ? '' : p2(h) + ':00'}</div>`).join('');
  return `<div class="tg-wrap" id="tgWrap">${head}<div class="tg" style="grid-template-columns:${cols}"><div class="hours">${hours}</div>${colHtml}</div></div>`;
}

function bulkBar() {
  const n = state.selected.size;
  return `<div class="bulkbar"><b>${n} selected</b>
    <button class="btn danger" data-act="bulkCancel" ${n ? '' : 'disabled'}>Cancel / remove</button>
    <span class="row" style="flex:0 0 auto;gap:4px"><input id="shiftN" class="field" type="number" value="1" style="width:64px">
      <select id="shiftU" class="field" style="width:auto"><option value="days">days</option><option value="hours">hours</option><option value="minutes">minutes</option></select>
      <button class="btn" data-act="bulkShift" ${n ? '' : 'disabled'}>Shift</button></span>
    <span class="row" style="flex:0 0 auto;gap:4px"><input id="setTime" class="field" type="datetime-local" style="width:auto">
      <button class="btn" data-act="bulkSet" ${n ? '' : 'disabled'}>Move all to</button></span>
    <span class="spacer"></span>
    <button class="btn" data-act="selClear">Clear</button><button class="btn primary" data-act="selectToggle">Done</button></div>`;
}

function plannerView() {
  const [start, end] = calRange(), [title, unit] = calTitle();
  const count = state.messages.filter((m) => m.status !== 'cancelled' && new Date(m.sendAt) >= start && new Date(m.sendAt) < end).length;
  const body = state.calView === 'month' ? monthView(start, end) : timeGrid(start, end);
  return `<div class="cal ${state.selectMode ? 'selecting' : ''}">
    <div class="toolbar">
      <button class="iconbtn" data-act="prev" aria-label="Previous">${ic('left')}</button>
      <button class="iconbtn" data-act="next" aria-label="Next">${ic('right')}</button>
      <button class="btn" data-act="today">Today</button>
      <div class="ttl"><b>${title}</b><small>${count} send${count === 1 ? '' : 's'} ${unit}</small></div>
      <span class="spacer"></span>
      <button class="btn ${state.selectMode ? 'primary' : ''}" data-act="selectToggle">${ic('check')} Select</button>
      <button class="btn soft" data-act="new">${ic('plus')} New message</button>
      <div class="seg">${['month', 'week', 'day'].map((v) => `<button class="${state.calView === v ? 'on' : ''}" data-act="calview" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
    </div>${body}${state.selectMode ? bulkBar() : ''}</div>`;
}

/* ---------- other pages ---------- */
function templatesView() {
  return `<div class="page">
    <div class="card"><h2>New template</h2>
      <input id="tTitle" class="field" placeholder="Title, e.g. Good morning" maxlength="80">
      <textarea id="tText" class="field" style="margin-top:8px" placeholder="Message text. Use {name} for the contact's first name."></textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-act="addTpl">Save template</button><span class="err" id="tErr"></span></div></div>
    ${state.templates.length ? `<div class="grid2">${state.templates.map((t) => `
      <div class="card tpl" style="margin:0"><b>${esc(t.title)}</b><div class="body">${esc(t.text)}</div>
        <div class="row"><button class="btn soft" data-act="useTpl" data-id="${t.id}">Use</button><button class="btn danger" data-act="delTpl" data-id="${t.id}">Delete</button></div></div>`).join('')}</div>`
      : '<div class="empty">No templates yet. Save the messages you send often.</div>'}</div>`;
}

function contactListsHtml() {
  const q = state.cSearch.trim().toLowerCase(), digits = q.replace(/\D/g, '');
  const hit = (name, id) => !q || (name || '').toLowerCase().includes(q) || (digits && id.includes(digits));
  const main = (name, sub, r, n) => `<button type="button" class="crow-main" data-act="msgTo" data-r="${esc(r)}" data-n="${esc(n)}" aria-label="Message ${esc(name)}">${avatar(name)}
      <span class="grow"><b>${esc(name)}</b><small>${esc(sub)}</small></span><span class="msgbtn">${ic('plus')}<span class="lbl">Message</span></span></button>`;
  const person = (c) => {
    const named = !!c.name, name = named ? c.name : phoneOf(c.recipient);
    return `<div class="crow">${main(name, named ? phoneOf(c.recipient) : 'WhatsApp contact', c.recipient, c.name)}
      <button class="iconbtn" data-act="delContact" data-r="${esc(c.recipient)}" aria-label="Remove ${esc(name)} from contacts">${ic('x')}</button></div>`;
  };
  const group = (g) => {
    const name = (g.name || '').trim() || 'Unnamed group';
    return `<div class="crow">${main(name, 'Group', g.id, g.name)}</div>`;
  };
  const people = state.contacts.filter((c) => !isGroup(c.recipient) && hit(c.name, c.recipient));
  const groups = state.groups.filter((g) => hit(g.name, g.id));
  return `<div class="card"><h2>Contacts</h2>${people.length ? people.map(person).join('')
      : `<div class="empty">${q ? 'No contacts match.' : 'Contacts are saved automatically when you schedule a message.'}</div>`}</div>
    <div class="card"><h2>WhatsApp groups</h2>${state.wa.status !== 'open' ? '<div class="empty">Connect WhatsApp to see your groups.</div>'
      : groups.length ? groups.map(group).join('') : `<div class="empty">${q ? 'No groups match.' : 'No groups found.'}</div>`}</div>`;
}

function contactsView() {
  return `<div class="page"><div class="msearch">${ic('search')}<input id="cSearch" type="search" placeholder="Search contacts and groups" value="${esc(state.cSearch)}" autocomplete="off" aria-label="Search contacts and groups"></div>
    <div id="cLists">${contactListsHtml()}</div></div>`;
}

function connectionView() {
  const wa = state.wa;
  const info = wa.status === 'open' ? `<p><b>Connected</b> as +${esc(wa.me)}.</p><p class="muted">Scheduled messages send from this account while the server is running.</p>
      <button class="btn danger" data-act="logout">Disconnect WhatsApp</button>`
    : wa.status === 'qr' ? `<div class="qr"><img src="${wa.qr}" alt="QR code"><p class="muted">On your phone: WhatsApp → Settings → Linked devices → Link a device, then scan this code.</p></div>`
    : '<p class="muted">Connecting to WhatsApp… a QR code will appear here if you need to link your phone.</p>';
  const account = state.me ? `<div class="card"><h2>Account</h2><p class="muted">Signed in as ${esc(state.me)}.</p><button class="btn" data-act="signout">Sign out</button></div>` : '';
  return `<div class="page"><div class="card"><h2>WhatsApp connection</h2>${info}</div>${account}</div>`;
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (state.view === 'settings') renderView(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Installed!'); if (state.view === 'settings') renderView(); });

function settingsView() {
  const s = state.settings;
  if (!s) return '<div class="page"><div class="empty">Loading…</div></div>';
  const a = s.alerts, b = s.backup;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<div class="page">
    <div class="card"><h2>🔔 Alerts</h2>
      <p class="muted">Get a push notification when WhatsApp disconnects, a scheduled message fails, or the server restarts. Alerts never include message text.</p>
      <label class="check"><input type="checkbox" id="aEnabled" ${a.enabled ? 'checked' : ''}> Alerts on</label>
      <label for="aTopic">ntfy topic <span class="muted">(install the free ntfy app, subscribe to this topic)</span></label>
      <div class="row" style="flex-wrap:nowrap"><input id="aTopic" class="field" value="${esc(a.ntfyTopic)}" placeholder="e.g. whtapbot-7f3a9c21d4e8b6a0" autocomplete="off" style="flex:1">
        <button class="btn" data-act="genTopic">Generate</button></div>
      <p class="hint">Anyone who knows the topic name can read the alerts, so keep it random and private.</p>
      <label class="check"><input type="checkbox" id="aWa" ${a.alertWhatsApp ? 'checked' : ''}> Also message me on WhatsApp (needs a connection, so it can't report outages)</label>
      <label for="aHb">Heartbeat URL <span class="muted">(detects the whole server going down – e.g. a free healthchecks.io check)</span></label>
      <input id="aHb" class="field" value="${esc(a.heartbeatUrl)}" placeholder="https://hc-ping.com/your-uuid" autocomplete="off">
      <p class="hint">The server pings this every minute. If the pings stop, that service alerts you. Create the check with a 5-minute period, 5-minute grace, and give it an ntfy notification to the same topic.</p>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-act="saveAlerts">Save</button><button class="btn" data-act="testAlert">Send test alert</button><span class="err" id="aErr"></span></div>
    </div>

    <div class="card"><h2>💾 Backups</h2>
      ${b.enabled ? `<p class="muted">An encrypted backup of the queue, your WhatsApp login and pending attachments is made every night at ${esc(b.atUtc)} UTC; the last ${b.keep} are kept. The VM's copies live on the VM, so also pull them to another machine (see README: <code>deploy/pull-backups.sh</code>).</p>`
        : '<p class="err">Backups are off: the server has no BACKUP_PASSPHRASE set.</p>'}
      <div class="row"><button class="btn primary" data-act="backupNow" ${b.enabled ? '' : 'disabled'}>Back up now</button><span class="err" id="bErr"></span></div>
      ${b.list.length ? b.list.map((x) => `<div class="crow"><div class="grow"><b>${esc(x.name)}</b><small>${new Date(x.createdAt).toLocaleString()} · ${fmtSize(x.size)}</small></div>
        <a class="btn" href="/api/backups/${encodeURIComponent(x.name)}/download" download>Download</a></div>`).join('') : '<p class="muted">No backups yet.</p>'}
    </div>

    <div class="card"><h2>📱 Install as an app</h2>
      ${standalone ? '<p class="muted">You\'re using the installed app.</p>'
        : installPrompt ? '<p class="muted">Add WhtapBot to your home screen for a full-screen app.</p><button class="btn primary" data-act="installApp">Install</button>'
        : '<p class="muted">On Android Chrome: menu ⋮ → <b>Install app</b> (or Add to Home screen). On iPhone Safari: Share → <b>Add to Home Screen</b>. On desktop Chrome/Edge: the install icon in the address bar.</p>'}
    </div>
    <div class="card"><h2>🌍 Timezones</h2><p class="muted">Each message has its own timezone, so a daily 9:00 stays at 9:00 even when clocks change. New messages default to this device's timezone (${esc(VIEWER_TZ)}); the server default is ${esc(s.defaultTz)}.</p></div>
  </div>`;
}

/* ---------- sidebar + chrome ---------- */
function renderChrome() {
  const mobile = isMobile();
  const pending = state.messages.filter((m) => m.status === 'pending').length;
  $('nav').innerHTML = NAV.map(([id, label, icon]) => `<a href="#${id}" class="nav ${state.view === id ? 'active' : ''}">${ic(icon)}${label}${id === 'planner' && pending ? `<span class="count">${pending}</span>` : ''}</a>`).join('');
  $('filters').innerHTML = FILTERS.map(([id, l]) => `<button class="fchip ${state.filter === id ? 'on' : ''}" data-filter="${id}">${l}</button>`).join('');
  const TITLES = { planner: mobile ? 'Schedule' : 'Message Planner', messages: 'Messages', more: 'More', contacts: 'Contacts & Groups', templates: 'Templates', connection: 'WhatsApp Connection', settings: 'Settings' };
  $('viewTitle').textContent = TITLES[state.view] || '';
  $('menuBtn').hidden = !(mobile && SUBVIEWS.includes(state.view)); // back arrow on sub-pages

  const wa = state.wa;
  $('connPill').className = 'pill ' + (wa.status === 'open' ? 'open' : '');
  $('connText').textContent = wa.status === 'open' ? (mobile ? 'Connected' : 'WhatsApp connected') : wa.status === 'qr' ? 'Scan QR' : (mobile ? 'Offline' : 'WhatsApp connecting…');
  $('connPill').setAttribute('aria-label', 'WhatsApp status: ' + $('connText').textContent + '. Open connection settings.');
  $('meName').textContent = wa.status === 'open' ? `+${wa.me}` : 'Not connected';
  $('meNum').textContent = wa.status === 'open' ? 'Sending enabled' : 'Link WhatsApp to start';
  $('meAvatar').style.background = wa.status === 'open' ? 'var(--green)' : 'var(--gray)';
  $('meAvatar').textContent = wa.status === 'open' ? '✓' : '?';
  if (mobile) renderTabbar();
}

function renderSideList() {
  if (isMobile()) return; // phones use the Messages tab instead of the sidebar
  const q = state.search.trim();
  const { upcoming, rest } = filteredMessages();
  const list = [...upcoming, ...rest];
  $('sideList').innerHTML = list.length ? list.map((m) => {
    const d = new Date(m.sendAt), name = dispName(m);
    return `<div role="button" tabindex="0" class="sitem ${m.status} ${state.selected.has(m.id) ? 'selected' : ''}" data-act="ev" data-id="${m.id}">${avatar(name)}
      <div class="sbody"><div class="sname">${esc(name)}${m.repeat !== 'none' ? ic('repeat') : ''}${m.attachment ? ic('clip') : ''}</div><div class="stext">${esc(msgPreview(m))}</div>
      <div class="smeta"><b>${rel(d)}</b><span>${timeLabel({ date: d, windowMin: m.windowMin })} · ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}</span><span class="tag ${m.status}">${statusLabel(m.status)}</span></div></div></div>`;
  }).join('') : `<div class="empty">${q || state.filter !== 'all' ? 'No messages match.' : 'Nothing scheduled yet.<br>Click “New message” to start.'}</div>`;
}

function renderView() {
  const view = $('view');
  const keep = $('tgWrap')?.scrollTop;
  const views = { planner: isMobile() ? mobilePlanner : plannerView, messages: messagesView, more: moreView, templates: templatesView, contacts: contactsView, connection: connectionView, settings: settingsView };
  view.innerHTML = (views[state.view] || plannerView)();
  const wrap = $('tgWrap');
  if (wrap) wrap.scrollTop = keep ?? state.scroll ?? 8 * ROW - 20; // first paint: show ~8am
}

function renderAll() { renderChrome(); renderSideList(); renderView(); }

/* ---------- data loading ---------- */
const TYPING = '#view input, #view textarea, #view select';
async function poll(force = false) {
  try {
    const [{ whatsapp }, messages] = await Promise.all([api('/status'), api('/messages')]);
    state.messages = messages;
    await loadOcc();
    const sig = JSON.stringify([whatsapp.status, whatsapp.me, whatsapp.qr?.length, messages, state.occ, [...state.selected]]);
    const wasOpen = state.wa.status === 'open';
    state.wa = whatsapp;
    if (whatsapp.status === 'open' && !wasOpen) loadGroups();
    if (sig !== state.sig || force) {
      state.sig = sig;
      if (!document.activeElement?.matches?.(TYPING) && !drag.s?.active) renderAll();
      else { renderChrome(); renderSideList(); }
    }
  } catch { /* server restarting: try again next tick */ }
}
const loadContacts = async () => (state.contacts = await api('/contacts'));
const loadTemplates = async () => (state.templates = await api('/templates'));
const loadSettings = async () => (state.settings = await api('/settings'));
async function loadGroups() { try { state.groups = await api('/groups'); if (state.view === 'contacts') renderView(); } catch { /* optional */ } }
async function refresh() { await loadOcc(); renderAll(); }

/* ---------- message modal ---------- */
const modal = $('modal');
let editing = null;           // message being edited, or null for new
let att = null;               // { upload, file, isNew } – attachment state for the open form
let saved = false;

const tzList = (() => {
  let l = [];
  try { l = Intl.supportedValuesOf('timeZone'); } catch { l = ['UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London']; }
  return [...new Set([VIEWER_TZ, 'UTC', ...l])];
})();
$('tz').innerHTML = tzList.map((z) => `<option value="${esc(z)}">${esc(z)}${z === VIEWER_TZ ? ' (this device)' : ''}</option>`).join('');

// A saved timezone may be spelled differently from this browser's list (e.g. Asia/Kolkata vs Asia/Calcutta): make sure it is selectable.
function ensureTz(z) { if (z && ![...$('tz').options].some((o) => o.value === z)) $('tz').add(new Option(z, z)); }
function setWhen(date) { $('when').value = fmtInTz(date, $('tz').value || VIEWER_TZ); updateHint(); } // wall time in the chosen zone

function renderChips() {
  const tz = $('tz').value || VIEWER_TZ, nowWall = fmtInTz(new Date(), tz), today = nowWall.slice(0, 10), nowMin = +nowWall.slice(11, 13) * 60 + +nowWall.slice(14, 16);
  $('chips').innerHTML = `<button type="button" class="chip" data-in="10">in 10 min</button><button type="button" class="chip" data-in="60">in 1 hour</button>
    <span class="hint" style="margin:0 2px 0 8px">Today morning:</span>` +
    [8, 9, 10, 11].map((h) => `<button type="button" class="chip" data-h="${h}" ${h * 60 <= nowMin ? 'disabled' : ''}>${h} AM</button>`).join('') +
    `<input type="hidden" id="chipToday" value="${today}">`;
}

function updateHint() {
  const w = +$('window').value, v = $('when').value;
  if (!w || !v) { $('windowHint').textContent = ''; return; }
  const [h, m] = v.slice(11).split(':').map(Number), s = h * 60 + m, e = s + w, f = (x) => `${p2(Math.floor(x / 60) % 24)}:${p2(x % 60)}`;
  $('windowHint').textContent = `Will send at a random moment between ${f(s)} and ${f(e)}.`;
}

function updateEndRow() {
  const on = $('repeat').value !== 'none';
  $('endRow').hidden = !on;
  $('endDateBox').hidden = !on || $('endType').value !== 'date';
  $('endCountBox').hidden = !on || $('endType').value !== 'count';
}

function fillPicker() {
  const people = state.contacts.filter((c) => !isGroup(c.recipient));
  $('pick').innerHTML = '<option value="">— Select —</option>' +
    (people.length ? `<optgroup label="Contacts">${people.map((c) => `<option value="${esc(c.recipient)}" data-n="${esc(c.name)}">${esc(c.name || phoneOf(c.recipient))} (${esc(phoneOf(c.recipient))})</option>`).join('')}</optgroup>` : '') +
    (state.groups.length ? `<optgroup label="Groups">${state.groups.map((g) => `<option value="${esc(g.id)}" data-n="${esc(g.name)}">${esc(g.name)}</option>`).join('')}</optgroup>` : '');
  $('tpl').innerHTML = '<option value="">Insert template…</option>' + state.templates.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
}

function defaultTime(day) {
  const now = new Date();
  if (!day || sameDay(day, now)) { const d = new Date(now.getTime() + 15 * 60_000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return d; }
  return at(day, 9);
}

function renderAttach() {
  const u = att?.upload;
  const canEdit = !$('mFields').disabled;
  $('attachInfo').innerHTML = att?.busy ? '<span class="hint">Uploading…</span>'
    : u ? `<span class="chipfile">${u.kind === 'image' ? `<img src="/api/uploads/${u.id}" alt="">` : ic('clip')}<span class="nm">${esc(u.name)}</span><span class="hint">${esc(KIND_LABEL[u.kind] || 'File')} · ${fmtSize(u.size)}</span>
        ${canEdit ? '<button type="button" class="iconbtn" id="attachRemove" aria-label="Remove attachment">' + ic('x') + '</button>' : ''}</span>` : '';
  $('attachBtn').textContent = u ? '📎 Replace file' : '📎 Attach photo, video, PDF or voice note';
  $('attachBtn').hidden = !canEdit;
  $('voiceRow').hidden = !(att?.file && u && ['audio', 'voice'].includes(u.kind));
  $('voice').checked = u?.kind === 'voice';
  $('attachWarn').textContent = att?.warnings?.join(' ') || '';
}

async function uploadFile(file, voice = false) {
  att = { ...(att || {}), file, busy: true, warnings: [], isNew: true };
  renderAttach();
  try {
    const r = await fetch(`/api/uploads${voice ? '?voice=1' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), 'X-Mime': file.type || 'application/octet-stream' },
      body: file,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    const old = att.upload;
    att = { upload: data, file, isNew: true, warnings: data.warnings };
    if (old?.id && old.id !== data.id) api('/uploads/' + old.id, { method: 'DELETE' }).catch(() => {});
    if (!$('text').value && data.kind === 'document') { /* caption stays optional */ }
  } catch (err) {
    att = editing?.attachment ? { upload: editing.attachment, isNew: false } : null;
    $('mErr').textContent = err.message;
  }
  renderAttach();
}

async function openModal({ message = null, prefill = {} } = {}) {
  editing = message; saved = false;
  await Promise.all([loadContacts(), loadTemplates()]).catch(() => {});
  fillPicker();
  loadGroups().then(fillPicker);
  const m = message ?? {};
  const open = !message || m.status === 'pending';
  $('mTitle').textContent = !message ? 'New message' : open ? 'Edit message' : 'Message details';
  $('quickBox').hidden = !!message; $('quick').value = ''; $('quickNotes').innerHTML = '';
  $('to').value = m.recipient ?? prefill.recipient ?? '';
  $('cname').value = m.name ?? prefill.name ?? '';
  $('text').value = m.text ?? prefill.text ?? '';
  ensureTz(m.tz); $('tz').value = m.tz ?? VIEWER_TZ;
  $('repeat').value = m.repeat ?? 'none';
  $('window').value = String(m.windowMin ?? 0);
  $('endType').value = m.repeatUntil ? 'date' : m.repeatTimes ? 'count' : 'never';
  $('endDate').value = m.repeatUntil ?? ''; $('endCount').value = m.repeatTimes ?? 5;
  if (message) $('when').value = m.localTime; else setWhen(prefill.when ?? defaultTime());
  $('pick').value = ''; $('mErr').textContent = '';
  $('count').textContent = $('text').value.length;
  $('mFields').disabled = !open;
  $('chips').hidden = !open;
  att = m.attachment ? { upload: m.attachment, isNew: false } : null;
  renderAttach(); renderChips(); updateEndRow(); updateHint();
  $('moreOpts').open = !!message && (m.tz !== VIEWER_TZ || m.windowMin > 0);
  $('quickBox').open = !isMobile();

  const info = [];
  if (message && !open) {
    info.push(`<span class="tag ${m.status}">${statusLabel(m.status)}</span>`);
    if (m.sentAt) info.push(`Sent ${new Date(m.sentAt).toLocaleString()}`);
  }
  if (message && open && m.windowMin) info.push(`Will actually send around <b>${new Date(m.fireAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b>`);
  if (message && m.repeat !== 'none' && open) info.push(`${ic('repeat')} Repeats ${RPT_LABEL[m.repeat]}${m.repeatTimes ? `, ${m.repeatTimes} left` : ''}${m.repeatUntil ? ` until ${m.repeatUntil}` : ''}`);
  $('mStatus').innerHTML = (info.length ? `<div class="row hint" style="margin:12px 0 0">${info.join(' · ')}</div>` : '') +
    (m.error ? `<div class="err" style="margin-top:8px">${esc(m.error)}</div>` : '');

  const btn = (act, label, cls = '') => `<button type="button" class="btn ${cls}" data-m="${act}">${label}</button>`;
  $('mFoot').innerHTML = !message ? `<span class="spacer"></span>${btn('cancel', 'Close')}${btn('save', 'Schedule', 'primary')}`
    : open ? `${btn('delete', 'Cancel send', 'danger')}${btn('dup', 'Duplicate')}<span class="spacer"></span>${btn('now', 'Send now')}${btn('save', 'Save changes', 'primary')}`
    : `${btn('delete', 'Remove', 'danger')}${btn('dup', 'Duplicate')}<span class="spacer"></span>${['failed', 'missed'].includes(m.status) ? btn('now', 'Retry now', 'primary') : ''}${btn('cancel', 'Close')}`;
  $('mFoot').classList.toggle('many', $('mFoot').querySelectorAll('.btn').length > 3); // edit mode has more buttons: stack them on phones
  if (!modal.open) modal.showModal();
}

function payload() {
  return {
    recipient: $('to').value, name: $('cname').value, text: $('text').value, repeat: $('repeat').value, tz: $('tz').value,
    sendAtLocal: $('when').value, windowMin: +$('window').value, uploadId: att?.upload?.id ?? null,
    endType: $('endType').value, endDate: $('endDate').value, endCount: +$('endCount').value,
  };
}

async function modalAction(act) {
  $('mErr').textContent = '';
  try {
    if (act === 'cancel') return modal.close();
    if (att?.busy && ['save', 'now'].includes(act)) return ($('mErr').textContent = 'Wait for the upload to finish.');
    if (act === 'save') {
      editing ? await api('/messages/' + editing.id, { method: 'PATCH', body: payload() }) : await api('/messages', { method: 'POST', body: payload() });
      saved = true;
      toast(editing ? 'Changes saved' : 'Message scheduled');
    } else if (act === 'now') {
      if (!editing) return;
      if (editing.status === 'pending') await api('/messages/' + editing.id, { method: 'PATCH', body: { ...payload(), sendAtLocal: undefined, sendAt: new Date(Date.now() + 60_000).toISOString() } });
      await api(`/messages/${editing.id}/send-now`, { method: 'POST' });
      saved = true;
      toast(state.wa.status === 'open' ? 'Sending…' : 'Queued; it will send once WhatsApp is connected');
    } else if (act === 'delete') {
      if (editing.status === 'pending' && !confirm('Cancel this scheduled message?')) return;
      await api('/messages/' + editing.id, { method: 'DELETE' });
      saved = true;
      toast(editing.status === 'pending' ? 'Message cancelled' : 'Removed');
    } else if (act === 'dup') {
      const m = editing; saved = true; modal.close();
      return openModal({ prefill: { recipient: m.recipient, name: m.name, text: m.text, when: defaultTime() } });
    }
    modal.close(); poll(true); loadContacts();
  } catch (err) { $('mErr').textContent = err.message; }
}

modal.addEventListener('close', () => {
  // Discard an upload that never made it onto a message.
  if (!saved && att?.isNew && att.upload?.id) api('/uploads/' + att.upload.id, { method: 'DELETE' }).catch(() => {});
  att = null;
});
$('mFoot').onclick = (e) => { const a = e.target.closest('[data-m]')?.dataset.m; if (a) modalAction(a); };
$('mform').onsubmit = (e) => { e.preventDefault(); if (document.activeElement === $('quick')) return quickFill(); if (!$('mFields').disabled) modalAction('save'); };
$('mClose').onclick = () => modal.close();
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); }); // backdrop click
$('text').oninput = () => ($('count').textContent = $('text').value.length);
$('insName').onclick = () => { const t = $('text'); t.setRangeText('{name}', t.selectionStart, t.selectionEnd, 'end'); t.focus(); $('text').oninput(); };
$('bdayBtn').onclick = () => {
  $('repeat').value = 'yearly'; $('endType').value = 'never'; updateEndRow();
  if (!$('text').value.trim()) { $('text').value = 'Happy birthday {name}! 🎂 Wishing you a wonderful year ahead.'; $('text').oninput(); }
  if (!$('mErr').textContent) $('mErr').textContent = '';
  toast('Yearly repeat on — set the date of the birthday in "Send at".');
};
$('pick').onchange = () => { const o = $('pick').selectedOptions[0]; if (o.value) { $('to').value = o.value; $('cname').value = o.dataset.n || ''; } };
$('to').onchange = () => {
  const c = state.contacts.find((x) => x.recipient === $('to').value.replace(/\D/g, ''));
  if (c?.name && !$('cname').value) $('cname').value = c.name;
};
$('tpl').onchange = () => { const t = state.templates.find((x) => x.id == $('tpl').value); if (t) { $('text').value = t.text; $('text').oninput(); } $('tpl').value = ''; };
$('saveTpl').onclick = async () => {
  const text = $('text').value.trim();
  if (!text) return ($('mErr').textContent = 'Write a message first.');
  const title = prompt('Template name?', text.slice(0, 30));
  if (!title) return;
  try { await api('/templates', { method: 'POST', body: { title, text } }); await loadTemplates(); fillPicker(); toast('Template saved'); } catch (err) { $('mErr').textContent = err.message; }
};
$('chips').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const tz = $('tz').value || VIEWER_TZ;
  if (b.dataset.in) setWhen(new Date(Date.now() + b.dataset.in * 60_000));
  if (b.dataset.h) { $('when').value = `${fmtInTz(new Date(), tz).slice(0, 10)}T${p2(b.dataset.h)}:00`; updateHint(); }
};
$('tz').onchange = () => { renderChips(); updateHint(); };
$('when').oninput = updateHint; $('window').onchange = updateHint;
$('repeat').onchange = updateEndRow; $('endType').onchange = updateEndRow;

// attachments
$('attachBtn').onclick = () => $('file').click();
$('file').onchange = () => { const f = $('file').files[0]; $('file').value = ''; if (f) uploadFile(f, false); };
$('voice').onchange = () => { if (att?.file) uploadFile(att.file, $('voice').checked); };
$('attachInfo').onclick = (e) => {
  if (!e.target.closest('#attachRemove')) return;
  const old = att?.upload;
  if (att?.isNew && old?.id) api('/uploads/' + old.id, { method: 'DELETE' }).catch(() => {});
  att = null; renderAttach();
};

// natural-language quick add
function quickFill() {
  const text = $('quick').value.trim();
  if (!text) return;
  const r = parseNL(text, { now: new Date(), contacts: state.contacts });
  if (r.recipient) $('to').value = r.recipient;
  if (r.name) $('cname').value = r.name;
  if (r.text) { $('text').value = r.text; $('text').oninput(); }
  if (r.when) { $('tz').value = VIEWER_TZ; $('when').value = toLocalInput(r.when); }
  $('repeat').value = r.repeat; $('endType').value = r.endType;
  if (r.endCount) $('endCount').value = r.endCount;
  if (r.endDate) $('endDate').value = r.endDate;
  $('window').value = [0, 15, 30, 60, 120, 180, 240].includes(r.windowMin) ? String(r.windowMin) : (r.windowMin ? '240' : '0');
  updateEndRow(); updateHint(); renderChips();
  if (r.windowMin) $('moreOpts').open = true;
  const missing = [!r.recipient && 'a phone number', !r.text && 'the message', !r.when && 'a time'].filter(Boolean);
  $('quickNotes').innerHTML = (r.notes.length ? r.notes.map((n) => `<span class="note">${esc(n)}</span>`).join('') : '') +
    (missing.length ? `<span class="note warn">Still needed: ${missing.join(', ')}</span>` : '<span class="note ok">Looks good – check and press Schedule</span>');
  if (!r.recipient) $('to').focus();
}
$('quickGo').onclick = quickFill;

/* ---------- calendar interactions ---------- */
function shift(dir) {
  const c = new Date(state.cursor);
  if (state.calView === 'month' || isMobile()) c.setMonth(c.getMonth() + dir, 1);
  else c.setDate(c.getDate() + dir * (state.calView === 'week' ? 7 : 1));
  state.cursor = c; state.scroll = null; refresh();
}

function newAt(day, hour) {
  const when = hour == null ? defaultTime(day) : at(day, Math.floor(hour), (hour % 1) * 60);
  if (when < new Date(Date.now() - 60_000)) return toast('Pick a time in the future', true);
  openModal({ prefill: { when } });
}

function toggleSelect(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  state.sig = ''; renderSideList(); renderView();
}

async function bulk(body, okMsg) {
  try {
    const r = await api('/messages/bulk', { method: 'POST', body: { ids: [...state.selected], ...body } });
    toast(`${okMsg}: ${r.done} message${r.done === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped)` : ''}`);
    if (body.action === 'cancel' || body.action === 'delete') state.selected.clear();
    await poll(true);
  } catch (err) { toast(err.message, true); }
}

/* ---------- drag & drop (mouse and touch via pointer events) ---------- */
const drag = { s: null, suppressUntil: 0 };

function startDrag(s) {
  s.active = true;
  const m = state.messages.find((x) => x.id === s.id);
  s.msg = m; s.orig = new Date(m.sendAt);
  s.ghost = Object.assign(document.createElement('div'), { className: 'drag-ghost' });
  s.ghost.innerHTML = `<b>${esc(dispName(m))}</b><span>${esc(msgPreview(m))}</span><em></em>`;
  document.body.append(s.ghost);
  s.el.classList.add('dragging');
  document.body.classList.add('dragging');
  if (navigator.vibrate) navigator.vibrate(15);
}

function dropTargetAt(s, x, y) {
  s.ghost.style.display = 'none';
  const el = document.elementFromPoint(x, y);
  s.ghost.style.display = '';
  const col = el?.closest('.tcol'), cell = el?.closest('.cell');
  if (col) {
    const rect = col.getBoundingClientRect();
    const mins = Math.max(0, Math.min(23 * 60 + 45, Math.round(((y - s.grabY - rect.top) / ROW) * 4) * 15)); // block's top edge lands where you drop
    return { el: col, time: at(new Date(+col.dataset.date), Math.floor(mins / 60), mins % 60) };
  }
  if (cell) return { el: cell, time: at(new Date(+cell.dataset.date), s.orig.getHours(), s.orig.getMinutes()) };
  return null;
}

function moveDrag(s, e) {
  s.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
  const t = dropTargetAt(s, e.clientX, e.clientY);
  document.querySelectorAll('.drop-target').forEach((n) => n !== t?.el && n.classList.remove('drop-target'));
  t?.el.classList.add('drop-target');
  s.target = t;
  s.ghost.querySelector('em').textContent = t ? t.time.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Drop on a day or time';
  const wrap = $('tgWrap'); // auto-scroll near the edges of the time grid
  if (wrap) { const r = wrap.getBoundingClientRect(); if (e.clientY < r.top + 50) wrap.scrollTop -= 14; else if (e.clientY > r.bottom - 50) wrap.scrollTop += 14; }
}

async function endDrag(s, commit) {
  s.ghost?.remove();
  s.el.classList.remove('dragging');
  document.body.classList.remove('dragging');
  document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
  drag.suppressUntil = Date.now() + 400; // swallow the click that follows a drop
  if (!commit || !s.target) return;
  const t = s.target.time;
  if (Math.abs(t - s.orig) < 60_000) return;
  if (t.getTime() + s.msg.windowMin * 60_000 < Date.now() - 60_000) return toast('Pick a time in the future', true);
  const group = state.selected.has(s.id) && state.selected.size > 1;
  const prev = new Set(state.selected);
  try {
    if (group) {
      await bulk({ action: 'shift', amount: Math.round((t - s.orig) / 60_000), unit: 'minutes' }, 'Moved');
    } else {
      state.selected = new Set([s.id]);
      await bulk({ action: 'setTime', sendAt: t.toISOString() }, 'Moved');
      state.selected = prev;
    }
  } catch { /* bulk() already toasted */ }
}

$('view').addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = e.target.closest('.ev[data-drag="1"]');
  if (!el || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const s = { id: +el.dataset.id, el, x: e.clientX, y: e.clientY, grabY: el.closest('.tcol') ? e.clientY - el.getBoundingClientRect().top : 0, active: false, touch: e.pointerType !== 'mouse', timer: null, target: null };
  if (s.touch) s.timer = setTimeout(() => drag.s === s && startDrag(s), 380); // long-press to pick up on touch screens
  drag.s = s;
});
window.addEventListener('pointermove', (e) => {
  const s = drag.s; if (!s) return;
  if (!s.active) {
    const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y);
    if (s.touch) { if (moved > 10) { clearTimeout(s.timer); drag.s = null; } } else if (moved > 6) startDrag(s);
  }
  if (s.active) moveDrag(s, e);
});
const finishDrag = (commit) => { const s = drag.s; if (!s) return; clearTimeout(s.timer); drag.s = null; if (s.active) endDrag(s, commit); };
window.addEventListener('pointerup', () => finishDrag(true));
window.addEventListener('pointercancel', () => finishDrag(false));
document.addEventListener('touchmove', (e) => { if (drag.s?.active) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { if (drag.s?.touch) e.preventDefault(); });
$('view').addEventListener('click', (e) => { if (Date.now() < drag.suppressUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag.s?.active) finishDrag(false); else if (e.key === 'Escape' && state.selectMode && !modal.open) { state.selectMode = false; state.selected.clear(); renderView(); } });

/* ---------- view click handling ---------- */
$('view').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act } = el.dataset, id = Number(el.dataset.id);
  try {
    switch (act) {
      case 'prev': return shift(-1);
      case 'next': return shift(1);
      case 'today': state.cursor = new Date(); state.scroll = null; return refresh();
      case 'calview': state.calView = el.dataset.v; state.scroll = null; return refresh();
      case 'new': return openModal();
      case 'mview': state.mView = el.dataset.v; state.scroll = null; $('view').scrollTop = 0; return refresh();
      case 'mday': { const d = new Date(+el.dataset.date); state.selDay = d; if (!sameMonth(d, state.cursor)) { state.cursor = new Date(d); return refresh(); } return renderView(); }
      case 'mtoday': state.cursor = new Date(); state.selDay = new Date(); return refresh();
      case 'mfilter': state.filter = el.dataset.f; return renderView();
      case 'selectToggle': state.selectMode = !state.selectMode; if (!state.selectMode) state.selected.clear(); state.sig = ''; renderSideList(); return renderView();
      case 'selClear': state.selected.clear(); state.sig = ''; renderSideList(); return renderView();
      case 'bulkCancel': if (confirm(`Cancel/remove ${state.selected.size} message(s)? Scheduled ones are cancelled; finished ones are removed from the list.`)) await bulk({ action: 'delete' }, 'Done'); return;
      case 'bulkShift': { const n = Math.round(+$('shiftN').value); if (!n) return toast('Enter a number to shift by', true); return bulk({ action: 'shift', amount: n, unit: $('shiftU').value }, 'Shifted'); }
      case 'bulkSet': { const d = new Date($('setTime').value); if (isNaN(d)) return toast('Pick a date and time first', true); return bulk({ action: 'setTime', sendAt: d.toISOString() }, 'Moved'); }
      case 'ev':
        if (e.metaKey || e.ctrlKey || e.shiftKey) { state.selectMode = true; return toggleSelect(id); }
        return state.selectMode ? toggleSelect(id) : openModal({ message: state.messages.find((m) => m.id === id) });
      case 'more': e.stopPropagation(); state.cursor = new Date(+el.dataset.date); state.calView = 'day'; return refresh();
      case 'cell': return newAt(new Date(+el.dataset.date));
      case 'slot': {
        const y = e.clientY - el.getBoundingClientRect().top;
        return newAt(new Date(+el.dataset.date), Math.floor((y / ROW) * 2) / 2);
      }
      case 'addTpl': {
        await api('/templates', { method: 'POST', body: { title: $('tTitle').value, text: $('tText').value } });
        await loadTemplates(); return renderView();
      }
      case 'useTpl': return openModal({ prefill: { text: state.templates.find((t) => t.id === id).text } });
      case 'delTpl': await api('/templates/' + id, { method: 'DELETE' }); await loadTemplates(); return renderView();
      case 'msgTo': return openModal({ prefill: { recipient: el.dataset.r, name: el.dataset.n } });
      case 'delContact': await api('/contacts/' + encodeURIComponent(el.dataset.r), { method: 'DELETE' }); await loadContacts(); return renderView();
      case 'signout': await fetch('/auth/logout', { method: 'POST' }); location.href = '/login'; return;
      case 'logout': if (confirm('Disconnect WhatsApp? Pending messages stay queued but will not send until you link again.')) { await api('/logout', { method: 'POST' }); poll(true); } return;
      case 'genTopic': { const b = crypto.getRandomValues(new Uint8Array(10)); $('aTopic').value = 'whtapbot-' + [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); return; }
      case 'saveAlerts': {
        $('aErr').textContent = '';
        state.settings = await api('/settings', { method: 'PUT', body: { alertsEnabled: $('aEnabled').checked, alertWhatsApp: $('aWa').checked, ntfyTopic: $('aTopic').value, heartbeatUrl: $('aHb').value } });
        toast('Alert settings saved'); return renderView();
      }
      case 'testAlert': {
        $('aErr').textContent = '';
        await api('/settings', { method: 'PUT', body: { alertsEnabled: $('aEnabled').checked, alertWhatsApp: $('aWa').checked, ntfyTopic: $('aTopic').value, heartbeatUrl: $('aHb').value } });
        const r = await api('/alerts/test', { method: 'POST' });
        return toast('Test sent via ' + [r.ntfy && 'ntfy', r.whatsapp && 'WhatsApp'].filter(Boolean).join(' + '));
      }
      case 'backupNow': { $('bErr').textContent = ''; const r = await api('/backups', { method: 'POST' }); toast('Backup created: ' + r.name); await loadSettings(); return renderView(); }
      case 'installApp': if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; renderView(); } return;
    }
  } catch (err) {
    const t = { addTpl: 'tErr', saveAlerts: 'aErr', testAlert: 'aErr', backupNow: 'bErr' }[act];
    if (t && $(t)) $(t).textContent = err.message; else toast(err.message, true);
  }
});
$('view').addEventListener('scroll', (e) => { if (e.target.id === 'tgWrap') state.scroll = e.target.scrollTop; }, true);

$('sideList').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act="ev"]');
  if (!el) return;
  const id = +el.dataset.id;
  if (state.selectMode) return toggleSelect(id);
  document.body.classList.remove('nav-open');
  openModal({ message: state.messages.find((m) => m.id === id) });
});
$('search').oninput = (e) => { state.search = e.target.value; renderSideList(); };
$('filters').onclick = (e) => { const f = e.target.dataset.filter; if (f) { state.filter = f; renderChrome(); renderSideList(); } };
$('connPill').onclick = () => (location.hash = '#connection');

function route() {
  const v = location.hash.slice(1);
  const valid = isMobile() ? ['planner', 'messages', 'contacts', 'more', 'templates', 'connection', 'settings'] : NAV.map((n) => n[0]);
  state.view = valid.includes(v) ? v : 'planner';
  document.body.classList.remove('nav-open');
  $('view').scrollTop = 0;
  if (state.view === 'templates' || state.view === 'more') loadTemplates().then(renderAll);
  else if (state.view === 'contacts') { loadContacts().then(renderAll); loadGroups(); }
  else if (state.view === 'settings') loadSettings().then(renderAll);
  else refresh();
}
window.addEventListener('hashchange', route);
$('tabbar').addEventListener('click', (e) => { if (e.target.closest('[data-new]')) openModal(); });
$('view').addEventListener('input', (e) => {
  if (e.target.id === 'mSearch') { state.search = e.target.value; $('mList').innerHTML = messageListHtml(); }
  if (e.target.id === 'cSearch') { state.cSearch = e.target.value; $('cLists').innerHTML = contactListsHtml(); }
});
// Enter/Space activate anything that acts like a button (calendar chips, cards) for keyboard and screen-reader users.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
});
mq.addEventListener('change', () => { route(); });
$('menuBtn').innerHTML = ic('left'); $('menuBtn').setAttribute('aria-label', 'Back'); $('closeNav').innerHTML = ic('x'); $('mClose').innerHTML = ic('x'); $('searchIcon').innerHTML = ic('search');
$('menuBtn').onclick = () => (location.hash = '#more');
$('closeNav').onclick = () => document.body.classList.remove('nav-open');

fetch('/auth/me').then((r) => (r.ok ? r.json() : null)).then((u) => { if (u?.email) { state.me = u.email; if (state.view === 'connection') renderView(); } }).catch(() => {});
route();
poll(true);
setInterval(poll, 3000);
setInterval(() => { if (!modal.open && !drag.s) { renderChrome(); renderSideList(); if (state.view === 'planner') renderView(); } }, 30_000); // refresh relative times / now-line

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
