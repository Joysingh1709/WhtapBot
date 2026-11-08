// Minimal MCP (Model Context Protocol) server over Streamable HTTP, so an AI assistant can schedule WhatsApp messages.
// Stateless JSON-RPC 2.0: every POST is answered with one JSON body; no sessions, no SSE stream.
import crypto from 'node:crypto';
import { MCP_TOKEN, DEFAULT_TZ, AUTH_ENABLED } from './config.js';
import { verifyAccessToken, wwwAuthenticate } from './auth.js';
import { messages, contacts, REPEAT_RULES } from './db.js';
import { wa, normalizeRecipient, listGroups } from './whatsapp.js';
import { toLocalString, isValidTz } from './time.js';
import { toApi, parseMessage } from './messageApi.js';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'whtapbot', title: 'WhtapBot – WhatsApp scheduler', version: '1.0.0' };
const INSTRUCTIONS = [
  'WhtapBot schedules WhatsApp messages that are sent from the user\'s own WhatsApp number, even while their devices are off.',
  'Messages go out as the user, to real people, so before calling schedule_message confirm the recipient, the exact text and the date/time with the user unless they already stated all three clearly.',
  'If you only have a name, call find_contact first and never guess a phone number. Phone numbers need the country code (e.g. 919876543210).',
  'Call whatsapp_status to learn the current server time and default timezone before turning phrases like "tomorrow 9am" into a send_at value.',
  'send_at is either an ISO timestamp with an offset (2026-11-10T09:00:00+05:30) or a plain local time (2026-11-10T09:00) read in the timezone argument.',
  'The text may contain {name}, replaced by the contact\'s first name when sent. Attachments are not supported through this interface.',
].join(' ');

/* ---------- helpers ---------- */
const WHEN_LOCAL = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;

class ToolError extends Error {}
const fail = (msg) => { throw new ToolError(msg); };

/** Phone number / group id, or a saved contact or group name. */
async function resolveRecipient(input) {
  const raw = String(input ?? '').trim();
  if (!raw) fail('recipient is required.');
  const direct = normalizeRecipient(raw);
  if (direct) return { recipient: direct, name: null };

  const q = raw.toLowerCase();
  const pool = [
    ...contacts.list().filter((c) => c.name).map((c) => ({ recipient: c.recipient, name: c.name, kind: 'contact' })),
    ...(await listGroups().catch(() => [])).map((g) => ({ recipient: g.id, name: g.name, kind: 'group' })),
  ];
  const exact = pool.filter((p) => p.name.toLowerCase() === q);
  const hits = exact.length ? exact : pool.filter((p) => p.name.toLowerCase().includes(q));
  if (hits.length === 1) return { recipient: hits[0].recipient, name: hits[0].kind === 'contact' ? hits[0].name : null };
  if (!hits.length) fail(`No saved contact or group matches "${raw}". Ask the user for the phone number with country code.`);
  fail(`"${raw}" matches several: ${hits.slice(0, 8).map((h) => `${h.name} (${h.recipient})`).join('; ')}. Ask which one, then pass its recipient id.`);
}

/** Maps tool arguments onto the body shape that parseMessage() understands. */
function whenToBody(sendAt, tz, body) {
  const s = String(sendAt).trim();
  if (s.toLowerCase() === 'now') body.sendAt = new Date().toISOString();
  else if (WHEN_LOCAL.test(s)) body.sendAtLocal = s.replace(' ', 'T');
  else body.sendAt = s;
}

const describe = (m) => {
  const tz = m.tz || DEFAULT_TZ;
  return {
    id: m.id,
    to: m.name ? `${m.name} (${m.recipient})` : m.recipient,
    text: m.text,
    sendsAt: `${toLocalString(m.send_at, tz).replace('T', ' ')} ${tz}`,
    sendAtUtc: new Date(m.send_at).toISOString(),
    repeat: m.repeat_rule,
    ...(m.repeat_until != null ? { repeatUntil: toLocalString(m.repeat_until, tz).slice(0, 10) } : {}),
    ...(m.repeat_left != null ? { sendsRemaining: m.repeat_left + 1 } : {}),
    ...(m.window_min ? { sendWindowMinutes: m.window_min } : {}),
    status: m.status,
    ...(m.error ? { error: m.error } : {}),
    ...(m.sent_at ? { sentAt: new Date(m.sent_at).toISOString() } : {}),
  };
};

const getMessage = (id) => {
  const m = messages.get(Number(id));
  if (!m) fail(`No message with id ${id}.`);
  return m;
};

/* ---------- tools ---------- */
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const schemaWhen = str('When to send: "now", an ISO timestamp with offset (2026-11-10T09:00:00+05:30), or local time without offset (2026-11-10T09:00) interpreted in `timezone`.');
const schemaRepeat = { type: 'string', enum: REPEAT_RULES, description: 'Repeat rule. Default "none".' };
const schemaTz = str(`IANA timezone the clock time is read in, e.g. Asia/Kolkata. Default ${DEFAULT_TZ}.`);

const TOOLS = [
  {
    name: 'whatsapp_status',
    description: 'Current server time, default timezone, WhatsApp connection state and how many messages are queued. Call this first to know "now" and whether WhatsApp is linked.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'WhatsApp status', readOnlyHint: true },
    async run() {
      const pending = messages.list().filter((m) => m.status === 'pending').length;
      return { whatsapp: { status: wa.status, connected: wa.status === 'open', number: wa.me ?? null }, serverTimeUtc: new Date().toISOString(), defaultTimezone: DEFAULT_TZ, pendingMessages: pending };
    },
  },
  {
    name: 'find_contact',
    description: 'Look up saved contacts (people the user has messaged before) and WhatsApp groups by name. Returns recipient ids to pass to schedule_message. Leave query empty to list everything saved.',
    inputSchema: { type: 'object', properties: { query: str('Part of a name or number.') } },
    annotations: { title: 'Find contact or group', readOnlyHint: true },
    async run({ query = '' }) {
      const q = String(query).trim().toLowerCase();
      const all = [
        ...contacts.list().map((c) => ({ kind: 'contact', name: c.name || null, recipient: c.recipient })),
        ...(await listGroups().catch(() => [])).map((g) => ({ kind: 'group', name: g.name, recipient: g.id })),
      ];
      const hits = q ? all.filter((c) => (c.name ?? '').toLowerCase().includes(q) || c.recipient.includes(q.replace(/\D/g, '') || '\u0000')) : all;
      return { count: hits.length, results: hits.slice(0, 50), note: wa.status === 'open' ? undefined : 'WhatsApp is not connected, so groups are not included.' };
    },
  },
  {
    name: 'schedule_message',
    description: 'Schedule a WhatsApp text message from the user\'s own number, optionally repeating (daily, weekdays, weekly, monthly, yearly). Use "now" as send_at to send right away. Confirm recipient, text and time with the user first.',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: str('Phone number with country code (digits, e.g. 919876543210), a group id ending in @g.us, or the name of a saved contact/group.'),
        text: str('Message text, up to 4000 characters. {name} is replaced with the contact\'s first name.'),
        send_at: schemaWhen,
        timezone: schemaTz,
        contact_name: str('Name to store for this number; used for {name}. Optional.'),
        repeat: schemaRepeat,
        end_date: str('Last day a repeating message may be sent, YYYY-MM-DD.'),
        end_count: { type: 'integer', minimum: 1, maximum: 1000, description: 'Total number of sends for a repeating message (instead of end_date).' },
        window_minutes: { type: 'integer', minimum: 0, maximum: 720, description: 'Send at a random moment within this many minutes after send_at (looks less robotic). Default 0 = exactly on time.' },
      },
      required: ['recipient', 'text', 'send_at'],
    },
    annotations: { title: 'Schedule a WhatsApp message', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(a) {
      const who = await resolveRecipient(a.recipient);
      const tz = a.timezone || DEFAULT_TZ;
      if (!isValidTz(tz)) fail(`Unknown timezone "${tz}". Use an IANA name such as Asia/Kolkata.`);
      if (!a.send_at) fail('send_at is required.');
      const body = {
        recipient: who.recipient, name: a.contact_name || who.name, text: a.text, tz, repeat: a.repeat ?? 'none',
        windowMin: a.window_minutes ?? 0,
      };
      whenToBody(a.send_at, tz, body);
      if (a.end_date) { body.endType = 'date'; body.endDate = a.end_date; }
      else if (a.end_count) { body.endType = 'count'; body.endCount = a.end_count; }
      const { error, value } = parseMessage(body);
      if (error) fail(error);
      const m = messages.create(value);
      return {
        scheduled: describe(m),
        ...(wa.status === 'open' ? {} : { warning: 'WhatsApp is not connected right now. The message is queued and goes out once it reconnects (or is marked missed if more than 2 hours late).' }),
      };
    },
  },
  {
    name: 'list_scheduled_messages',
    description: 'List messages. By default shows pending (upcoming) ones, soonest first. Use status "all" or sent/failed/missed/cancelled for history.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'sent', 'failed', 'missed', 'cancelled', 'all'], description: 'Default "pending".' },
        query: str('Only messages whose recipient, name or text contains this.'),
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
      },
    },
    annotations: { title: 'List messages', readOnlyHint: true },
    async run({ status = 'pending', query = '', limit = 25 }) {
      const q = String(query).trim().toLowerCase();
      let rows = messages.list().filter((m) => (status === 'all' || m.status === status)
        && (!q || `${m.name ?? ''} ${m.recipient} ${m.text}`.toLowerCase().includes(q)));
      rows.sort((x, y) => (status === 'pending' ? x.send_at - y.send_at : y.send_at - x.send_at));
      const n = Math.min(Math.max(Number(limit) || 25, 1), 100);
      return { total: rows.length, shown: Math.min(n, rows.length), messages: rows.slice(0, n).map(describe) };
    },
  },
  {
    name: 'update_scheduled_message',
    description: 'Change a message that has not been sent yet (still pending). Only pass the fields to change; everything else is kept.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Message id from list_scheduled_messages.' },
        text: str('New message text.'),
        send_at: schemaWhen,
        timezone: schemaTz,
        recipient: str('New recipient (number, group id or saved name).'),
        repeat: schemaRepeat,
        end_date: str('Last day for a repeating message, YYYY-MM-DD.'),
        end_count: { type: 'integer', minimum: 1, maximum: 1000, description: 'Total number of sends.' },
        window_minutes: { type: 'integer', minimum: 0, maximum: 720 },
      },
      required: ['id'],
    },
    annotations: { title: 'Edit a scheduled message', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async run(a) {
      const m = getMessage(a.id);
      if (m.status !== 'pending') fail(`Message ${m.id} is ${m.status}; only pending messages can be edited.`);
      const tz = a.timezone || m.tz || DEFAULT_TZ;
      if (!isValidTz(tz)) fail(`Unknown timezone "${tz}".`);
      const who = a.recipient ? await resolveRecipient(a.recipient) : { recipient: m.recipient, name: m.name };
      const body = {
        recipient: who.recipient, name: who.name ?? m.name, text: a.text ?? m.text, tz, repeat: a.repeat ?? m.repeat_rule,
        windowMin: a.window_minutes ?? m.window_min, uploadId: m.upload_id,
      };
      if (a.send_at) whenToBody(a.send_at, tz, body);
      else body.sendAt = new Date(m.send_at).toISOString();
      const keepEnd = !a.end_date && !a.end_count && !a.repeat;
      if (a.end_date) { body.endType = 'date'; body.endDate = a.end_date; }
      else if (a.end_count) { body.endType = 'count'; body.endCount = a.end_count; }
      else if (keepEnd && m.repeat_until != null) { body.endType = 'date'; body.endDate = toLocalString(m.repeat_until, m.tz || DEFAULT_TZ).slice(0, 10); }
      else if (keepEnd && m.repeat_left != null) { body.endType = 'count'; body.endCount = m.repeat_left + 1; }
      const { error, value } = parseMessage(body);
      if (error) fail(error);
      if (a.send_at || a.timezone) value.anchorDay = null; // re-derive the day-of-month anchor from the new time
      if (!messages.update(m.id, value)) fail(`Message ${m.id} can no longer be edited (it may have just started sending).`);
      return { updated: describe(messages.get(m.id)) };
    },
  },
  {
    name: 'cancel_scheduled_message',
    description: 'Cancel a pending message so it never sends. For a repeating message this also ends the series. Already-sent messages cannot be unsent.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'Message id.' } }, required: ['id'] },
    annotations: { title: 'Cancel a scheduled message', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async run({ id }) {
      const m = getMessage(id);
      if (!messages.cancel(m.id)) fail(`Message ${m.id} is ${m.status}, so it cannot be cancelled.`);
      return { cancelled: describe(messages.get(m.id)), note: m.repeat_rule !== 'none' ? 'The repeating series has ended.' : undefined };
    },
  },
  {
    name: 'send_message_now',
    description: 'Send an existing pending, failed or missed message immediately instead of at its scheduled time. A repeating message keeps its schedule and a one-off copy is sent.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'Message id.' } }, required: ['id'] },
    annotations: { title: 'Send a message now', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async run({ id }) {
      const m = getMessage(id);
      const sent = messages.sendNow(m.id);
      if (!sent) fail(`Message ${m.id} is ${m.status}, so it cannot be sent now.`);
      return { queuedForImmediateSend: describe(sent), note: 'The scheduler picks it up within a few seconds; check list_scheduled_messages with status "sent" to confirm.' };
    },
  },
];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/* ---------- JSON-RPC ---------- */
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handleOne(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
  const isNotification = msg.id === undefined;
  const ok = (result) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping': return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, title: annotations.title, description, inputSchema, annotations })) });
    case 'tools/call': {
      const tool = BY_NAME.get(msg.params?.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const out = await tool.run(msg.params?.arguments ?? {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false });
      } catch (err) {
        if (!(err instanceof ToolError)) console.error('[mcp] tool error', tool.name, err);
        const text = err instanceof ToolError ? err.message : 'Internal error: ' + err.message;
        return ok({ content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      if (msg.method.startsWith('notifications/')) return null;
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const digest = (s) => crypto.createHash('sha256').update(s).digest();

export function mcpRoute(req, res) {
  if (!MCP_TOKEN && !AUTH_ENABLED) return res.status(404).json({ error: 'MCP is disabled. Set MCP_TOKEN (or enable sign-in) on the server to use it.' });
  // Accepts an OAuth access token (connectors) or, if configured, the static MCP_TOKEN (scripts, local clients).
  const [scheme, given = ''] = (req.headers.authorization ?? '').split(' ');
  const ok = scheme === 'Bearer' && given && ((MCP_TOKEN && crypto.timingSafeEqual(digest(given), digest(MCP_TOKEN))) || (AUTH_ENABLED && verifyAccessToken(given)));
  if (!ok) {
    if (AUTH_ENABLED) res.set('WWW-Authenticate', wwwAuthenticate);
    else res.set('WWW-Authenticate', 'Bearer realm="WhtapBot"');
    return res.status(401).json({ error: 'Invalid or missing bearer token.' });
  }
  if (req.method !== 'POST') return res.set('Allow', 'POST').status(405).json({ error: 'Use POST.' });

  const body = req.body;
  const run = Array.isArray(body)
    ? Promise.all(body.map(handleOne)).then((r) => r.filter(Boolean))
    : handleOne(body);
  run.then((out) => {
    if (out == null || (Array.isArray(out) && !out.length)) return res.status(202).end();
    res.json(out);
  }).catch((err) => {
    console.error('[mcp]', err);
    res.status(500).json(rpcError(null, -32603, 'Internal error'));
  });
}
