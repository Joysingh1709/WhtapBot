import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DATA_DIR } from './config.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const AUTH_DIR = path.join(DATA_DIR, 'auth');

// status: starting | connecting | qr | open | closed
export const wa = { status: 'starting', qr: null, me: null };
/** Emits 'status' (new status string) whenever the connection state changes. */
export const waEvents = new EventEmitter();
function setStatus(status) {
  if (wa.status === status) return;
  wa.status = status;
  waEvents.emit('status', status);
}

let sock = null;
let reconnectTimer = null;

export class SendError extends Error {
  constructor(message, { permanent = false, notConnected = false } = {}) {
    super(message);
    this.permanent = permanent; // retrying will never help (bad number etc.)
    this.notConnected = notConnected; // don't count as an attempt
  }
}

export async function connect() {
  clearTimeout(reconnectTimer);
  setStatus('connecting');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}));

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false, // don't steal notifications from your phone
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      setStatus('qr');
      wa.qr = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
    }
    if (connection === 'open') {
      wa.qr = null;
      wa.me = sock.user?.id?.split(':')[0]?.split('@')[0] ?? null;
      setStatus('open');
      console.log(`[whatsapp] connected as ${wa.me}`);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      wa.qr = null;
      wa.me = null;
      setStatus('closed');
      if (code === DisconnectReason.loggedOut) {
        console.log('[whatsapp] logged out; clearing session, a new QR will appear');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        reconnectTimer = setTimeout(connect, 1000);
      } else {
        // 515 restartRequired is normal right after scanning the QR.
        const delay = code === DisconnectReason.restartRequired ? 500 : 3000;
        console.log(`[whatsapp] connection closed (code ${code}); reconnecting`);
        reconnectTimer = setTimeout(connect, delay);
      }
    }
  });
}

export async function logout() {
  try {
    await sock?.logout();
  } catch {
    // Not connected: just wipe the local session.
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 500);
  }
}

/** Turn "+1 (415) 555-0100" into digits, or pass through a full jid (e.g. a group). */
export function normalizeRecipient(input) {
  const raw = String(input ?? '').trim();
  if (/@(g\.us|s\.whatsapp\.net|c\.us)$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

async function resolveJid(recipient) {
  if (recipient.includes('@')) return recipient;
  const [res] = (await sock.onWhatsApp(recipient)) ?? [];
  if (!res?.exists) throw new SendError(`${recipient} is not on WhatsApp`, { permanent: true });
  return res.jid;
}

/**
 * Send a text and/or an attachment. `media` = { path, mime, kind, name } where kind is
 * image | video | audio | voice | document. Returns the WhatsApp message id.
 */
export async function sendOut(recipient, { text = '', media = null } = {}) {
  if (wa.status !== 'open' || !sock) {
    throw new SendError('WhatsApp is not connected', { notConnected: true });
  }
  const jid = await resolveJid(recipient);
  try {
    if (!media) return (await sock.sendMessage(jid, { text }))?.key?.id;

    if (!fs.existsSync(media.path)) throw new SendError('Attachment file is missing on the server', { permanent: true });
    const src = { url: media.path }; // streamed from disk, not loaded into memory
    let content;
    if (media.kind === 'image') content = { image: src, caption: text || undefined };
    else if (media.kind === 'video') content = { video: src, caption: text || undefined, mimetype: media.mime };
    else if (media.kind === 'voice') content = { audio: src, ptt: true, mimetype: 'audio/ogg; codecs=opus' };
    else if (media.kind === 'audio') content = { audio: src, ptt: false, mimetype: media.mime };
    else content = { document: src, fileName: media.name, mimetype: media.mime, caption: text || undefined };

    const sent = await sock.sendMessage(jid, content);
    // Audio can't carry a caption: send the text as a follow-up message.
    if (text && (media.kind === 'voice' || media.kind === 'audio')) await sock.sendMessage(jid, { text });
    return sent?.key?.id;
  } catch (err) {
    if (err instanceof SendError) throw err;
    throw new SendError(err.message || 'send failed');
  }
}

export const sendText = (recipient, text) => sendOut(recipient, { text });

/** Message yourself ("Message yourself" chat) – used for optional WhatsApp alerts. */
export async function sendSelf(text) {
  if (wa.status !== 'open' || !sock || !wa.me) throw new SendError('WhatsApp is not connected', { notConnected: true });
  return (await sock.sendMessage(`${wa.me}@s.whatsapp.net`, { text }))?.key?.id;
}

let groupCache = { at: 0, groups: [] };

/** Groups you're in (cached for 5 min to avoid hammering WhatsApp). */
export async function listGroups() {
  if (wa.status !== 'open' || !sock) return [];
  if (Date.now() - groupCache.at < 5 * 60_000) return groupCache.groups;
  const all = await sock.groupFetchAllParticipating();
  const groups = Object.values(all)
    .map((g) => ({ id: g.id, name: g.subject }))
    .sort((a, b) => a.name.localeCompare(b.name));
  groupCache = { at: Date.now(), groups };
  return groups;
}
