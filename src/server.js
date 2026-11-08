import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORT, HOST, MCP_TOKEN, AUTH_ENABLED, PUBLIC_URL, DISABLE_WHATSAPP, DEFAULT_TZ, UPLOAD_MAX_MB, BACKUP_AT_UTC, BACKUP_KEEP } from './config.js';
import { messages, contacts, templates, uploads, settings, REPEAT_RULES } from './db.js';
import { wa, connect, logout, normalizeRecipient, listGroups } from './whatsapp.js';
import { startScheduler } from './scheduler.js';
import { startAlerts, notify, alertConfig } from './alerts.js';
import { createBackup, listBackups, startBackupSchedule, backupsEnabled, BACKUP_DIR } from './backup.js';
import { registerUpload } from './media.js';
import { shiftInstant, nextOccurrence } from './time.js';
import { toApi, parseMessage, iso } from './messageApi.js';
import { mcpRoute } from './mcp.js';
import { authRouter, requireSignIn } from './auth.js';

const app = express();
app.use(express.json({ limit: '100kb' }));

app.set('trust proxy', 1); // the reverse proxy (same machine) terminates HTTPS and sets X-Forwarded-For
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// MCP endpoint: does its own bearer/OAuth check, so it sits before the cookie sign-in gate.
app.all('/mcp', mcpRoute);
// Google sign-in, OAuth endpoints for MCP connectors, then the gate that protects everything below.
app.use(authRouter);
app.use(requireSignIn);

app.get('/api/status', (_req, res) => {
  res.json({ whatsapp: wa, serverTime: iso(Date.now()), defaultTz: DEFAULT_TZ });
});

app.get('/api/messages', (_req, res) => res.json(messages.list().map(toApi)));

/** Future occurrences of recurring messages inside [from, to) – drawn as dashed ghosts on the calendar. */
app.get('/api/occurrences', (req, res) => {
  const from = Date.parse(req.query.from), to = Date.parse(req.query.to);
  if (Number.isNaN(from) || Number.isNaN(to) || to - from > 400 * 86400_000) return res.status(400).json({ error: 'Bad range.' });
  const out = [];
  for (const m of messages.pendingRecurring()) {
    const tz = m.tz || DEFAULT_TZ;
    let t = m.send_at, left = m.repeat_left;
    for (let i = 0; i < 800 && out.length < 3000; i++) {
      if (left != null && left <= 0) break;
      t = nextOccurrence(t, m.repeat_rule, tz, m.anchor_day, t);
      if (m.repeat_until != null && t > m.repeat_until) break;
      if (t >= to) break;
      if (t >= from) out.push({ id: m.id, sendAt: iso(t) });
      if (left != null) left -= 1;
    }
  }
  res.json(out);
});

app.post('/api/messages', (req, res) => {
  const { error, value } = parseMessage(req.body);
  if (error) return res.status(400).json({ error });
  res.status(201).json(toApi(messages.create(value)));
});

// Edit a message that hasn't been sent yet.
app.patch('/api/messages/:id', (req, res) => {
  const id = Number(req.params.id);
  const { error, value } = parseMessage(req.body);
  if (error) return res.status(400).json({ error });
  if (!messages.update(id, value)) return res.status(409).json({ error: 'Only scheduled messages can be edited.' });
  res.json(toApi(messages.get(id)));
});

// Several messages at once: cancel / delete / shift / set a new time (used by multi-select and drag & drop).
app.post('/api/messages/bulk', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))].slice(0, 500) : [];
  const action = req.body?.action;
  if (!ids.length) return res.status(400).json({ error: 'Nothing selected.' });
  if (!['cancel', 'delete', 'shift', 'setTime'].includes(action)) return res.status(400).json({ error: 'Unknown action.' });

  let newTime = null, shift = null;
  if (action === 'setTime') {
    newTime = Date.parse(req.body?.sendAt);
    if (Number.isNaN(newTime)) return res.status(400).json({ error: 'Invalid time.' });
  }
  if (action === 'shift') {
    const amount = Math.round(Number(req.body?.amount)), unit = req.body?.unit;
    if (!Number.isFinite(amount) || !amount || !['minutes', 'hours', 'days'].includes(unit)) return res.status(400).json({ error: 'Invalid shift.' });
    shift = { amount, unit };
  }

  let done = 0, skipped = 0;
  for (const id of ids) {
    const m = messages.get(id);
    if (!m) { skipped++; continue; }
    if (action === 'cancel') { messages.cancel(id) ? done++ : skipped++; continue; }
    if (action === 'delete') { (messages.cancel(id) || messages.remove(id)) ? done++ : skipped++; continue; }
    if (m.status !== 'pending') { skipped++; continue; }
    const tz = m.tz || DEFAULT_TZ;
    const sendAt = action === 'setTime' ? newTime : shiftInstant(m.send_at, tz, shift.amount, shift.unit);
    if (sendAt + m.window_min * 60_000 < Date.now() - 60_000) { skipped++; continue; }
    const ok = messages.update(id, {
      recipient: m.recipient, name: m.name, text: m.text, sendAt, repeat: m.repeat_rule, tz, windowMin: m.window_min,
      uploadId: m.upload_id, repeatUntil: m.repeat_until, repeatLeft: m.repeat_left, anchorDay: null, // re-derive from the new date
    });
    ok ? done++ : skipped++;
  }
  res.json({ done, skipped });
});

// Send immediately (also retries a failed/missed message).
app.post('/api/messages/:id/send-now', (req, res) => {
  const m = messages.sendNow(Number(req.params.id));
  if (!m) return res.status(409).json({ error: 'This message cannot be sent now.' });
  res.json(toApi(m));
});

// Pending → cancelled. Anything already finished → removed from history.
app.delete('/api/messages/:id', (req, res) => {
  const id = Number(req.params.id);
  if (messages.cancel(id) || messages.remove(id)) return res.json({ ok: true });
  res.status(409).json({ error: 'Message not found or currently sending.' });
});

/* ---------- attachments ---------- */
// Raw upload: body is the file bytes (Content-Type: application/octet-stream); metadata travels in headers.
app.post('/api/uploads', (req, res) => {
  const max = UPLOAD_MAX_MB * 1024 * 1024;
  const name = decodeURIComponent(String(req.headers['x-filename'] || 'file')).slice(0, 200);
  const mime = String(req.headers['x-mime'] || 'application/octet-stream').slice(0, 120);
  if (Number(req.headers['content-length']) > max) return res.status(413).json({ error: `File is larger than ${UPLOAD_MAX_MB} MB.` });

  const tmp = path.join(uploads.dir, `tmp-${crypto.randomUUID()}`);
  const out = fs.createWriteStream(tmp);
  let size = 0, aborted = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > max && !aborted) {
      aborted = true;
      req.unpipe(out); out.destroy(); fs.rmSync(tmp, { force: true });
      res.status(413).json({ error: `File is larger than ${UPLOAD_MAX_MB} MB.` });
    }
  });
  req.on('error', () => { out.destroy(); fs.rmSync(tmp, { force: true }); });
  req.pipe(out);
  out.on('finish', async () => {
    if (aborted) return;
    if (!size) { fs.rmSync(tmp, { force: true }); return res.status(400).json({ error: 'Empty file.' }); }
    try {
      const { upload, warnings } = await registerUpload(tmp, { name, mime, voice: req.query.voice === '1' });
      res.status(201).json({ id: upload.id, name: upload.name, mime: upload.mime, kind: upload.kind, size: upload.size, warnings });
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
  });
});

app.get('/api/uploads/:id', (req, res) => {
  const u = uploads.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found.' });
  const inline = ['image', 'video', 'audio', 'voice'].includes(u.kind);
  res.set({
    'Content-Type': u.mime.split(';')[0],
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(u.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  });
  res.sendFile(uploads.pathOf(u));
});

app.delete('/api/uploads/:id', (req, res) => {
  uploads.releaseIfUnused(req.params.id); // only removes it if no message uses it
  res.json({ ok: true });
});

/* ---------- contacts, groups, templates ---------- */
app.get('/api/contacts', (_req, res) => res.json(contacts.list()));
app.delete('/api/contacts/:recipient', (req, res) => {
  contacts.remove(req.params.recipient);
  res.json({ ok: true });
});

app.get('/api/groups', async (_req, res) => {
  try {
    res.json(await listGroups());
  } catch (err) {
    res.status(502).json({ error: 'Could not load groups: ' + err.message });
  }
});

app.get('/api/templates', (_req, res) => res.json(templates.list()));
app.post('/api/templates', (req, res) => {
  const title = String(req.body?.title ?? '').trim().slice(0, 80);
  const text = String(req.body?.text ?? '').trim();
  if (!title || !text) return res.status(400).json({ error: 'Title and text are required.' });
  templates.create({ title, text });
  res.status(201).json(templates.list());
});
app.delete('/api/templates/:id', (req, res) => {
  templates.remove(Number(req.params.id));
  res.json({ ok: true });
});

/* ---------- settings: alerts + backups ---------- */
const settingsView = () => ({
  alerts: alertConfig(),
  backup: { enabled: backupsEnabled(), atUtc: BACKUP_AT_UTC, keep: BACKUP_KEEP, list: listBackups() },
  defaultTz: DEFAULT_TZ,
});
app.get('/api/settings', (_req, res) => res.json(settingsView()));

app.put('/api/settings', (req, res) => {
  const b = req.body ?? {};
  const bad = (m) => res.status(400).json({ error: m });
  if ('ntfyTopic' in b) {
    const v = String(b.ntfyTopic).trim();
    if (v && !/^[A-Za-z0-9_-]{6,64}$/.test(v)) return bad('Topic must be 6–64 letters, digits, - or _.');
    settings.set('ntfyTopic', v);
  }
  if ('ntfyServer' in b) {
    const v = String(b.ntfyServer).trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\/[^\s/]+$/.test(v)) return bad('Server must look like https://ntfy.sh');
    settings.set('ntfyServer', v);
  }
  if ('heartbeatUrl' in b) {
    const v = String(b.heartbeatUrl).trim();
    if (v && !/^https:\/\/\S+$/.test(v)) return bad('Heartbeat URL must start with https://');
    settings.set('heartbeatUrl', v);
  }
  if ('alertsEnabled' in b) settings.set('alertsEnabled', b.alertsEnabled ? '1' : '0');
  if ('alertWhatsApp' in b) settings.set('alertWhatsApp', b.alertWhatsApp ? '1' : '0');
  res.json(settingsView());
});

app.post('/api/alerts/test', async (_req, res) => {
  const r = await notify('Test alert', 'If you can read this, alerts are working.', { force: true, tags: ['bell'] });
  if (!r.ntfy && !r.whatsapp) return res.status(502).json({ error: r.errors.join('; ') || 'No alert channel is configured.' });
  res.json(r);
});

app.get('/api/backups', (_req, res) => res.json({ enabled: backupsEnabled(), list: listBackups() }));
app.post('/api/backups', (_req, res) => {
  try {
    res.status(201).json(createBackup());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/backups/:name/download', (req, res) => {
  const list = listBackups();
  const name = req.params.name === 'latest' ? list[0]?.name : req.params.name;
  if (!name || !list.some((b) => b.name === name)) return res.status(404).json({ error: 'No such backup.' });
  res.download(path.join(BACKUP_DIR, name), name);
});

app.post('/api/logout', async (_req, res) => {
  await logout();
  res.json({ ok: true });
});

app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));

app.listen(PORT, HOST, () => {
  console.log(AUTH_ENABLED ? `Sign-in with Google is required (public address ${PUBLIC_URL}).` : 'WARNING: sign-in is OFF (no GOOGLE_CLIENT_ID). Only run like this on localhost.');
  if (MCP_TOKEN || AUTH_ENABLED) console.log('MCP endpoint enabled at /mcp');
  console.log(`WhtapBot running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});

if (!DISABLE_WHATSAPP) {
  connect().catch((err) => console.error('[whatsapp] failed to start', err));
  startScheduler();
  startAlerts();
}
startBackupSchedule();
setInterval(() => uploads.cleanupOrphans(), 3600_000);
