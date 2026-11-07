'use strict';
/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const toLocalInput = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };

const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  template: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>',
  repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24">${ICONS[n]}</svg>`;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  document.querySelector('.toast')?.remove();
  const t = Object.assign(document.createElement('div'), { className: 'toast' + (bad ? ' bad' : ''), textContent: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

/* ---------- state ---------- */
const state = {
  view: 'planner', calView: 'month', cursor: new Date(),
  messages: [], contacts: [], templates: [], groups: [], wa: { status: 'starting' },
  search: '', filter: 'all', sig: '', scroll: null,
};
const NAV = [
  ['planner', 'Message Planner', 'calendar'], ['templates', 'Templates', 'template'],
  ['contacts', 'Contacts & Groups', 'users'], ['connection', 'WhatsApp Connection', 'phone'],
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

function rel(date) {
  const ms = date - Date.now(), abs = Math.abs(ms);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return 'now';
  if (abs < 3_600_000) return rtf.format(Math.round(ms / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(ms / 3_600_000), 'hour');
  return rtf.format(Math.round(ms / 86_400_000), 'day');
}

/* ---------- recurring projections (calendar ghosts) ---------- */
function stepOnce(d, rule) {
  if (rule === 'daily') d.setDate(d.getDate() + 1);
  else if (rule === 'weekly') d.setDate(d.getDate() + 7);
  else if (rule === 'weekdays') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
  else if (rule === 'monthly') { const day = d.getDate(); d.setMonth(d.getMonth() + 1); if (d.getDate() !== day) d.setDate(0); }
}
function eventsBetween(from, to) {
  const out = [];
  for (const m of state.messages) {
    if (m.status === 'cancelled') continue;
    const t = new Date(m.sendAt);
    if (t >= from && t < to) out.push({ ...m, date: t });
    if (m.status === 'pending' && m.repeat !== 'none') {
      const d = new Date(t);
      for (let i = 0; i < 400; i++) {
        stepOnce(d, m.repeat);
        if (d >= to) break;
        if (d >= from) out.push({ ...m, date: new Date(d), ghost: true });
      }
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

/* ---------- calendar ---------- */
function calRange() {
  const c = startOfDay(state.cursor);
  if (state.calView === 'day') return [c, addDays(c, 1)];
  if (state.calView === 'week') { const s = addDays(c, -c.getDay()); return [s, addDays(s, 7)]; }
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const days = new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate();
  return [start, addDays(start, Math.ceil((first.getDay() + days) / 7) * 7)];
}

function calTitle() {
  const c = state.cursor, [s, e] = calRange(), last = addDays(e, -1);
  if (state.calView === 'month') return [`${MONTHS[c.getMonth()]} ${c.getFullYear()}`, 'this month'];
  if (state.calView === 'day') return [`${DAYS[c.getDay()]}, ${c.getDate()} ${MONTHS[c.getMonth()]} ${c.getFullYear()}`, 'today'];
  const same = s.getMonth() === last.getMonth();
  return [`${MONTHS[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${same ? '' : MONTHS[last.getMonth()].slice(0, 3) + ' '}${last.getDate()}, ${last.getFullYear()}`, 'this week'];
}

const evHtml = (e, style = '') => `
  <div class="ev ${e.status} ${e.ghost ? 'ghost' : ''}" data-act="ev" data-id="${e.id}" style="${style}"
       title="${esc(dispName(e) + ' — ' + e.text)}">
    <span class="t">${hm(e.date)}</span>${e.repeat !== 'none' ? ic('repeat') : ''}<span class="x">${esc(dispName(e) === e.name ? e.name + ': ' + e.text : e.text)}</span>
  </div>`;

function monthView(start, end) {
  const evs = eventsBetween(start, end), byDay = {};
  evs.forEach((e) => (byDay[dayKey(e.date)] ??= []).push(e));
  const today = new Date();
  let cells = '';
  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const list = byDay[dayKey(d)] ?? [];
    cells += `<div class="cell ${d.getMonth() !== state.cursor.getMonth() ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''}" data-act="cell" data-date="${d.getTime()}">
      <span class="dnum">${d.getDate()}</span>
      ${list.slice(0, 3).map((e) => evHtml(e)).join('')}
      ${list.length > 3 ? `<span class="more" data-act="more" data-date="${d.getTime()}">+${list.length - 3} more</span>` : ''}
    </div>`;
  }
  return `<div class="dows">${DAYS.map((d) => `<div class="dow">${d.slice(0, 3).toUpperCase()}</div>`).join('')}</div><div class="month">${cells}</div>`;
}

function layoutColumn(list) {
  const H = 40, out = []; let cluster = [], end = -1;
  const flush = () => {
    const lanes = [];
    cluster.forEach((e) => { let l = lanes.findIndex((x) => x <= e.top); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = e.top + H; e.lane = l; });
    cluster.forEach((e) => (e.lanes = lanes.length)); out.push(...cluster); cluster = [];
  };
  list.forEach((e) => { if (cluster.length && e.top >= end) flush(); cluster.push(e); end = Math.max(end, e.top + H); });
  if (cluster.length) flush();
  return out;
}

function timeGrid(start, end) {
  const ROW = 56, days = [];
  for (let d = new Date(start); d < end; d = addDays(d, 1)) days.push(new Date(d));
  const evs = eventsBetween(start, end), today = new Date();
  const cols = `56px repeat(${days.length}, minmax(0,1fr))`;
  const head = `<div class="tg-head" style="grid-template-columns:${cols}"><div style="border:0"></div>${days.map((d) =>
    `<div class="${sameDay(d, today) ? 'today' : ''}">${DAYS[d.getDay()].slice(0, 3).toUpperCase()}<span class="n">${d.getDate()}</span></div>`).join('')}</div>`;
  const colHtml = days.map((d) => {
    const list = evs.filter((e) => sameDay(e.date, d)).map((e) => ({ ...e, top: (e.date.getHours() + e.date.getMinutes() / 60) * ROW }));
    const now = sameDay(d, today) ? `<div class="nowline" style="top:${(today.getHours() + today.getMinutes() / 60) * ROW}px"></div>` : '';
    return `<div class="tcol ${sameDay(d, today) ? 'today' : ''}" data-act="slot" data-date="${d.getTime()}">${now}${layoutColumn(list).map((e) =>
      evHtml(e, `top:${e.top}px;left:calc(${(e.lane / e.lanes) * 100}% + 2px);width:calc(${100 / e.lanes}% - 4px)`)).join('')}</div>`;
  }).join('');
  const hours = Array.from({ length: 24 }, (_, h) => `<div>${h === 0 ? '' : p2(h) + ':00'}</div>`).join('');
  return `<div class="tg-wrap" id="tgWrap">${head}<div class="tg" style="grid-template-columns:${cols}"><div class="hours">${hours}</div>${colHtml}</div></div>`;
}

function plannerView() {
  const [start, end] = calRange(), [title, unit] = calTitle();
  const count = state.messages.filter((m) => !['cancelled'].includes(m.status) && new Date(m.sendAt) >= start && new Date(m.sendAt) < end).length;
  const body = state.calView === 'month' ? monthView(start, end) : timeGrid(start, end);
  return `<div class="cal">
    <div class="toolbar">
      <button class="iconbtn" data-act="prev" aria-label="Previous">${ic('left')}</button>
      <button class="iconbtn" data-act="next" aria-label="Next">${ic('right')}</button>
      <button class="btn" data-act="today">Today</button>
      <div class="ttl"><b>${title}</b><small>${count} send${count === 1 ? '' : 's'} ${unit}</small></div>
      <span class="spacer"></span>
      <button class="btn soft" data-act="new">${ic('plus')} New message</button>
      <div class="seg">${['month', 'week', 'day'].map((v) => `<button class="${state.calView === v ? 'on' : ''}" data-act="calview" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
    </div>${body}</div>`;
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

function contactsView() {
  const row = (name, sub, recipient) => `<div class="crow">${avatar(name)}<div class="grow"><b>${esc(name)}</b><small>${esc(sub)}</small></div>
    <button class="btn soft" data-act="msgTo" data-r="${esc(recipient)}" data-n="${esc(name)}">${ic('plus')} Message</button></div>`;
  const people = state.contacts.filter((c) => !isGroup(c.recipient));
  return `<div class="page">
    <div class="card"><h2>Contacts</h2>${people.length ? people.map((c) => `<div class="crow">${avatar(c.name || phoneOf(c.recipient))}
      <div class="grow"><b>${esc(c.name || phoneOf(c.recipient))}</b><small>${esc(phoneOf(c.recipient))}</small></div>
      <button class="btn soft" data-act="msgTo" data-r="${esc(c.recipient)}" data-n="${esc(c.name)}">${ic('plus')} Message</button>
      <button class="iconbtn" data-act="delContact" data-r="${esc(c.recipient)}" aria-label="Remove">${ic('x')}</button></div>`).join('')
      : '<div class="empty">Contacts are saved automatically when you schedule a message.</div>'}</div>
    <div class="card"><h2>WhatsApp groups</h2>${state.wa.status !== 'open' ? '<div class="empty">Connect WhatsApp to see your groups.</div>'
      : state.groups.length ? state.groups.map((g) => row(g.name, 'Group', g.id)).join('') : '<div class="empty">No groups found.</div>'}</div></div>`;
}

function connectionView() {
  const wa = state.wa;
  const info = wa.status === 'open' ? `<p><b>Connected</b> as +${esc(wa.me)}.</p><p class="muted">Scheduled messages send from this account while the server is running.</p>
      <button class="btn danger" data-act="logout">Disconnect WhatsApp</button>`
    : wa.status === 'qr' ? `<div class="qr"><img src="${wa.qr}" alt="QR code"><p class="muted">On your phone: WhatsApp → Settings → Linked devices → Link a device, then scan this code.</p></div>`
    : '<p class="muted">Connecting to WhatsApp… a QR code will appear here if you need to link your phone.</p>';
  return `<div class="page"><div class="card"><h2>WhatsApp connection</h2>${info}</div>
    <div class="card"><h2>Keeping it running</h2><p class="muted">Messages only send while this server is running. Deploy it to an always-on host (see the README) to send with your laptop closed.</p></div></div>`;
}

/* ---------- sidebar + chrome ---------- */
function renderChrome() {
  const pending = state.messages.filter((m) => m.status === 'pending').length;
  $('nav').innerHTML = NAV.map(([id, label, icon]) => `<a href="#${id}" class="nav ${state.view === id ? 'active' : ''}">${ic(icon)}${label}${id === 'planner' && pending ? `<span class="count">${pending}</span>` : ''}</a>`).join('');
  $('filters').innerHTML = FILTERS.map(([id, l]) => `<button class="fchip ${state.filter === id ? 'on' : ''}" data-filter="${id}">${l}</button>`).join('');
  $('viewTitle').textContent = NAV.find((n) => n[0] === state.view)[1];

  const wa = state.wa;
  $('connPill').className = 'pill ' + (wa.status === 'open' ? 'open' : '');
  $('connText').textContent = wa.status === 'open' ? 'WhatsApp connected' : wa.status === 'qr' ? 'Scan QR to link' : 'WhatsApp connecting…';
  $('meName').textContent = wa.status === 'open' ? `+${wa.me}` : 'Not connected';
  $('meNum').textContent = wa.status === 'open' ? 'Sending enabled' : 'Link WhatsApp to start';
  $('meAvatar').style.background = wa.status === 'open' ? 'var(--green)' : 'var(--gray)';
  $('meAvatar').textContent = wa.status === 'open' ? '✓' : '?';
}

function renderSideList() {
  const q = state.search.trim().toLowerCase();
  const match = (m) => {
    const f = state.filter;
    if (f === 'scheduled' && !['pending', 'sending'].includes(m.status)) return false;
    if (f === 'sent' && m.status !== 'sent') return false;
    if (f === 'failed' && !['failed', 'missed'].includes(m.status)) return false;
    if (f === 'cancelled' && m.status !== 'cancelled') return false;
    return !q || [m.name, m.recipient, m.text].some((v) => (v || '').toLowerCase().includes(q));
  };
  const upcoming = state.messages.filter((m) => ['pending', 'sending'].includes(m.status) && match(m)).sort((a, b) => new Date(a.sendAt) - new Date(b.sendAt));
  const rest = state.messages.filter((m) => !['pending', 'sending'].includes(m.status) && match(m));
  const list = [...upcoming, ...rest];
  $('sideList').innerHTML = list.length ? list.map((m) => {
    const d = new Date(m.sendAt), name = dispName(m);
    return `<div class="sitem ${m.status}" data-act="ev" data-id="${m.id}">${avatar(name)}
      <div class="sbody"><div class="sname">${esc(name)}${m.repeat !== 'none' ? ic('repeat') : ''}</div><div class="stext">${esc(m.text)}</div>
      <div class="smeta"><b>${rel(d)}</b><span>${hm(d)} · ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}</span><span class="tag ${m.status}">${statusLabel(m.status)}</span></div></div></div>`;
  }).join('') : `<div class="empty">${q || state.filter !== 'all' ? 'No messages match.' : 'Nothing scheduled yet.<br>Click “New message” to start.'}</div>`;
}

function renderView() {
  const view = $('view');
  const keep = $('tgWrap')?.scrollTop;
  view.innerHTML = { planner: plannerView, templates: templatesView, contacts: contactsView, connection: connectionView }[state.view]();
  const wrap = $('tgWrap');
  if (wrap) wrap.scrollTop = keep ?? state.scroll ?? 8 * 56 - 20; // first paint: show ~8am
}

function renderAll() { renderChrome(); renderSideList(); renderView(); }

/* ---------- data loading ---------- */
async function poll(force = false) {
  try {
    const [{ whatsapp }, messages] = await Promise.all([api('/status'), api('/messages')]);
    const sig = JSON.stringify([whatsapp.status, whatsapp.me, whatsapp.qr?.length, messages]);
    const wasOpen = state.wa.status === 'open';
    state.wa = whatsapp; state.messages = messages;
    if (whatsapp.status === 'open' && !wasOpen) loadGroups();
    if (sig !== state.sig || force) {
      state.sig = sig;
      if (!document.activeElement?.matches?.('#view input, #view textarea')) renderAll(); // don't clobber typing
      else { renderChrome(); renderSideList(); }
    }
  } catch { /* server restarting: try again next tick */ }
}
const loadContacts = async () => (state.contacts = await api('/contacts'));
const loadTemplates = async () => (state.templates = await api('/templates'));
async function loadGroups() { try { state.groups = await api('/groups'); if (state.view === 'contacts') renderView(); } catch { /* optional */ } }

/* ---------- message modal ---------- */
const modal = $('modal');
let editing = null; // message object being edited, or null for new

function setWhen(d) { $('when').value = toLocalInput(d); }

function renderChips() {
  const now = new Date();
  $('chips').innerHTML = `<button type="button" class="chip" data-in="10">in 10 min</button><button type="button" class="chip" data-in="60">in 1 hour</button>
    <span class="hint" style="margin:0 2px 0 8px">Today morning:</span>` +
    [8, 9, 10, 11].map((h) => `<button type="button" class="chip" data-h="${h}" ${at(now, h) <= now ? 'disabled' : ''}>${h} AM</button>`).join('');
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

async function openModal({ message = null, prefill = {} } = {}) {
  editing = message;
  await Promise.all([loadContacts(), loadTemplates()]).catch(() => {});
  fillPicker();
  loadGroups().then(fillPicker);
  const m = message ?? {};
  const open = !message || m.status === 'pending';
  $('mTitle').textContent = !message ? 'New message' : open ? 'Edit message' : 'Message details';
  $('to').value = m.recipient ? (isGroup(m.recipient) ? m.recipient : m.recipient) : prefill.recipient ?? '';
  $('cname').value = m.name ?? prefill.name ?? '';
  $('text').value = m.text ?? prefill.text ?? '';
  $('repeat').value = m.repeat ?? 'none';
  setWhen(message ? new Date(m.sendAt) : prefill.when ?? defaultTime());
  $('pick').value = ''; $('mErr').textContent = '';
  $('count').textContent = $('text').value.length;
  $('mFields').disabled = !open;
  $('chips').hidden = !open;
  renderChips();

  const info = [];
  if (message && !open) {
    info.push(`<span class="tag ${m.status}">${statusLabel(m.status)}</span>`);
    if (m.sentAt) info.push(`Sent ${new Date(m.sentAt).toLocaleString()}`);
  }
  if (message && m.repeat !== 'none' && open) info.push(`${ic('repeat')} Repeats ${$('repeat').selectedOptions[0].text.toLowerCase()}`);
  $('mStatus').innerHTML = (info.length ? `<div class="row hint" style="margin:12px 0 0">${info.join(' ')}</div>` : '') +
    (m.error ? `<div class="err" style="margin-top:8px">${esc(m.error)}</div>` : '');

  const btn = (act, label, cls = '') => `<button type="button" class="btn ${cls}" data-m="${act}">${label}</button>`;
  $('mFoot').innerHTML = !message ? `<span class="spacer"></span>${btn('cancel', 'Close')}${btn('save', 'Schedule', 'primary')}`
    : open ? `${btn('delete', 'Cancel message', 'danger')}${btn('dup', 'Duplicate')}<span class="spacer"></span>${btn('now', 'Send now')}${btn('save', 'Save changes', 'primary')}`
    : `${btn('delete', 'Remove', 'danger')}${btn('dup', 'Duplicate')}<span class="spacer"></span>${['failed', 'missed'].includes(m.status) ? btn('now', 'Retry now', 'primary') : ''}${btn('cancel', 'Close')}`;
  if (!modal.open) modal.showModal();
}

function payload() {
  const when = new Date($('when').value);
  return { recipient: $('to').value, name: $('cname').value, text: $('text').value, repeat: $('repeat').value, sendAt: isNaN(when) ? '' : when.toISOString() };
}

async function modalAction(act) {
  $('mErr').textContent = '';
  try {
    if (act === 'cancel') return modal.close();
    if (act === 'save') {
      editing ? await api('/messages/' + editing.id, { method: 'PATCH', body: payload() }) : await api('/messages', { method: 'POST', body: payload() });
      toast(editing ? 'Changes saved' : 'Message scheduled');
    } else if (act === 'now') {
      if (!editing) return;
      if (editing.status === 'pending') await api('/messages/' + editing.id, { method: 'PATCH', body: { ...payload(), sendAt: new Date(Date.now() + 60_000).toISOString() } }).catch(() => {});
      await api(`/messages/${editing.id}/send-now`, { method: 'POST' });
      toast(state.wa.status === 'open' ? 'Sending…' : 'Queued; it will send once WhatsApp is connected');
    } else if (act === 'delete') {
      if (editing.status === 'pending' && !confirm('Cancel this scheduled message?')) return;
      await api('/messages/' + editing.id, { method: 'DELETE' });
      toast(editing.status === 'pending' ? 'Message cancelled' : 'Removed');
    } else if (act === 'dup') {
      const m = editing; modal.close();
      return openModal({ prefill: { recipient: m.recipient, name: m.name, text: m.text, when: defaultTime() } });
    }
    modal.close(); poll(true); loadContacts();
  } catch (err) { $('mErr').textContent = err.message; }
}

$('mFoot').onclick = (e) => { const a = e.target.closest('[data-m]')?.dataset.m; if (a) modalAction(a); };
$('mform').onsubmit = (e) => { e.preventDefault(); if (!$('mFields').disabled) modalAction('save'); };
$('mClose').onclick = () => modal.close();
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); }); // backdrop click
$('text').oninput = () => ($('count').textContent = $('text').value.length);
$('insName').onclick = () => { const t = $('text'); t.setRangeText('{name}', t.selectionStart, t.selectionEnd, 'end'); t.focus(); $('text').oninput(); };
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
  if (b.dataset.in) setWhen(new Date(Date.now() + b.dataset.in * 60_000));
  if (b.dataset.h) setWhen(at(new Date(), +b.dataset.h));
};

/* ---------- global interactions ---------- */
function shift(dir) {
  const c = new Date(state.cursor);
  if (state.calView === 'month') c.setMonth(c.getMonth() + dir, 1);
  else c.setDate(c.getDate() + dir * (state.calView === 'week' ? 7 : 1));
  state.cursor = c; state.scroll = null; renderView();
}

function newAt(day, hour) {
  const when = hour == null ? defaultTime(day) : at(day, Math.floor(hour), (hour % 1) * 60);
  if (when < new Date(Date.now() - 60_000)) return toast('Pick a time in the future', true);
  openModal({ prefill: { when } });
}

$('view').addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const { act } = el.dataset, id = Number(el.dataset.id);
  try {
    switch (act) {
      case 'prev': return shift(-1);
      case 'next': return shift(1);
      case 'today': state.cursor = new Date(); state.scroll = null; return renderView();
      case 'calview': state.calView = el.dataset.v; state.scroll = null; return renderView();
      case 'new': return openModal();
      case 'ev': return openModal({ message: state.messages.find((m) => m.id === id) });
      case 'more': e.stopPropagation(); state.cursor = new Date(+el.dataset.date); state.calView = 'day'; return renderView();
      case 'cell': return newAt(new Date(+el.dataset.date));
      case 'slot': {
        const y = e.clientY - el.getBoundingClientRect().top;
        return newAt(new Date(+el.dataset.date), Math.floor((y / 56) * 2) / 2);
      }
      case 'addTpl': {
        await api('/templates', { method: 'POST', body: { title: $('tTitle').value, text: $('tText').value } });
        await loadTemplates(); return renderView();
      }
      case 'useTpl': return openModal({ prefill: { text: state.templates.find((t) => t.id === id).text } });
      case 'delTpl': await api('/templates/' + id, { method: 'DELETE' }); await loadTemplates(); return renderView();
      case 'msgTo': return openModal({ prefill: { recipient: el.dataset.r, name: el.dataset.n } });
      case 'delContact': await api('/contacts/' + encodeURIComponent(el.dataset.r), { method: 'DELETE' }); await loadContacts(); return renderView();
      case 'logout': if (confirm('Disconnect WhatsApp? Pending messages stay queued but will not send until you link again.')) { await api('/logout', { method: 'POST' }); poll(true); } return;
    }
  } catch (err) { const t = $('tErr'); if (t && act === 'addTpl') t.textContent = err.message; else toast(err.message, true); }
});
$('view').addEventListener('scroll', (e) => { if (e.target.id === 'tgWrap') state.scroll = e.target.scrollTop; }, true);

$('sideList').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act="ev"]');
  if (el) { document.body.classList.remove('nav-open'); openModal({ message: state.messages.find((m) => m.id === +el.dataset.id) }); }
});
$('search').oninput = (e) => { state.search = e.target.value; renderSideList(); };
$('filters').onclick = (e) => { const f = e.target.dataset.filter; if (f) { state.filter = f; renderChrome(); renderSideList(); } };
$('connPill').onclick = () => (location.hash = '#connection');

function route() {
  const v = location.hash.slice(1);
  state.view = NAV.some((n) => n[0] === v) ? v : 'planner';
  document.body.classList.remove('nav-open');
  if (state.view === 'templates') loadTemplates().then(renderAll);
  else if (state.view === 'contacts') { loadContacts().then(renderAll); loadGroups(); }
  else renderAll();
}
window.addEventListener('hashchange', route);
$('menuBtn').innerHTML = ic('menu'); $('closeNav').innerHTML = ic('x'); $('mClose').innerHTML = ic('x'); $('searchIcon').innerHTML = ic('search');
$('menuBtn').onclick = () => document.body.classList.add('nav-open');
$('closeNav').onclick = () => document.body.classList.remove('nav-open');

route();
poll(true);
setInterval(poll, 3000);
setInterval(() => { if (!modal.open) { renderChrome(); renderSideList(); if (state.view === 'planner') renderView(); } }, 30_000); // refresh relative times / now-line
