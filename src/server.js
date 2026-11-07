import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORT, HOST, APP_PASSWORD } from './config.js';
import { messages, contacts, templates, REPEAT_RULES } from './db.js';
import { wa, connect, logout, normalizeRecipient, listGroups } from './whatsapp.js';
import { startScheduler } from './scheduler.js';

const app = express();
app.use(express.json({ limit: '100kb' }));

if (APP_PASSWORD) {
  const expected = Buffer.from(APP_PASSWORD);
  app.use((req, res, next) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme === 'Basic' && token) {
      const given = Buffer.from(Buffer.from(token, 'base64').toString().split(':').slice(1).join(':'));
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="WhtapBot"').status(401).send('Authentication required');
  });
}

const toApi = (m) => ({
  id: m.id,
  recipient: m.recipient,
  name: m.name,
  repeat: m.repeat_rule,
  text: m.text,
  sendAt: new Date(m.send_at).toISOString(),
  status: m.status,
  attempts: m.attempts,
  error: m.error,
  sentAt: m.sent_at ? new Date(m.sent_at).toISOString() : null,
});

app.get('/api/status', (_req, res) => {
  res.json({ whatsapp: wa, serverTime: new Date().toISOString() });
});

app.get('/api/messages', (_req, res) => {
  res.json(messages.list().map(toApi));
});

// Validates and normalises a message body. Returns { error } or { value }.
function parseMessage(body, { allowPast = false } = {}) {
  const recipient = normalizeRecipient(body?.recipient);
  const text = String(body?.text ?? '').trim();
  const name = String(body?.name ?? '').trim().slice(0, 80) || null;
  const repeat = body?.repeat ?? 'none';
  const sendAt = Date.parse(body?.sendAt);

  if (!recipient) return { error: 'Enter a phone number with country code, e.g. 14155550100.' };
  if (!text) return { error: 'Message is empty.' };
  if (text.length > 4000) return { error: 'Message is too long (max 4000 characters).' };
  if (!REPEAT_RULES.includes(repeat)) return { error: 'Invalid repeat option.' };
  if (Number.isNaN(sendAt)) return { error: 'Invalid send time.' };
  if (!allowPast && sendAt < Date.now() - 60_000) return { error: 'Send time is in the past.' };
  return { value: { recipient, name, text, sendAt, repeat } };
}

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

app.post('/api/logout', async (_req, res) => {
  await logout();
  res.json({ ok: true });
});

app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../public')));

app.listen(PORT, HOST, () => {
  console.log(`WhtapBot running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});

connect().catch((err) => console.error('[whatsapp] failed to start', err));
startScheduler();
