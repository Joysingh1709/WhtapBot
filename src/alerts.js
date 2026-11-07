import { settings } from './db.js';
import { wa, waEvents, sendSelf } from './whatsapp.js';

const DEFAULT_NTFY = 'https://ntfy.sh';
const DISCONNECT_GRACE_MS = 3 * 60_000; // brief reconnects are normal; only alert on a real outage
const RELINK_GRACE_MS = 30_000;

export function alertConfig() {
  const s = settings.all();
  return {
    enabled: s.alertsEnabled !== '0',
    ntfyTopic: s.ntfyTopic || '',
    ntfyServer: s.ntfyServer || DEFAULT_NTFY,
    alertWhatsApp: s.alertWhatsApp === '1',
    heartbeatUrl: s.heartbeatUrl || '',
  };
}

const lastSent = new Map();

/**
 * Push a notification through every configured channel (ntfy topic and/or a WhatsApp message to yourself).
 * Never includes message text. `dedupeKey` + `minIntervalMs` stop repeat floods. Returns what was delivered.
 */
export async function notify(title, body, { priority = 3, tags = [], dedupeKey = null, minIntervalMs = 0, force = false } = {}) {
  const cfg = alertConfig();
  const result = { ntfy: false, whatsapp: false, errors: [] };
  if (!cfg.enabled && !force) return result;
  if (dedupeKey && Date.now() - (lastSent.get(dedupeKey) ?? 0) < minIntervalMs) return result;
  if (dedupeKey) lastSent.set(dedupeKey, Date.now());

  if (cfg.ntfyTopic) {
    try {
      const res = await fetch(cfg.ntfyServer, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: cfg.ntfyTopic, title, message: body, priority, tags }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
      result.ntfy = true;
    } catch (err) {
      result.errors.push('ntfy: ' + err.message);
    }
  }
  if (cfg.alertWhatsApp) {
    try {
      await sendSelf(`🔔 WhtapBot: ${title}\n${body}`);
      result.whatsapp = true;
    } catch (err) {
      result.errors.push('whatsapp: ' + err.message);
    }
  }
  if (result.errors.length) console.log('[alerts]', result.errors.join('; '));
  return result;
}

const who = (m) => (m.name ? m.name : '+' + String(m.recipient).split('@')[0]);

/** A scheduled message failed for good, or was skipped because the server was down. */
export function alertMessageProblem(msg, kind, error) {
  const title = kind === 'missed' ? 'Scheduled message missed' : 'Scheduled message failed';
  return notify(title, `#${msg.id} to ${who(msg)}: ${error}`, { priority: 4, tags: ['warning'] });
}

export function startAlerts() {
  // 1. Startup (also tells you the VM rebooted).
  setTimeout(() => notify('WhtapBot started', 'The server just (re)started.', { tags: ['white_check_mark'], priority: 2 }), 20_000);

  // 2. WhatsApp connection watchdog.
  let downSince = null, alertedDown = false, alertedRelink = false;
  const check = () => {
    if (wa.status === 'open') {
      if (alertedDown || alertedRelink) {
        notify('WhatsApp reconnected', 'Scheduled messages will send again.', { tags: ['white_check_mark'] });
      }
      downSince = null; alertedDown = alertedRelink = false;
      return;
    }
    downSince ??= Date.now();
    const downFor = Date.now() - downSince;
    if (wa.status === 'qr' && downFor > RELINK_GRACE_MS && !alertedRelink) {
      alertedRelink = true;
      notify('WhatsApp needs re-linking', 'WhatsApp was logged out. Open the app and scan the QR code.', { priority: 5, tags: ['rotating_light'] });
    } else if (downFor > DISCONNECT_GRACE_MS && !alertedDown && wa.status !== 'qr') {
      alertedDown = true;
      notify('WhatsApp disconnected', `Not connected for ${Math.round(downFor / 60_000)} min. Scheduled messages are waiting.`, { priority: 4, tags: ['warning'] });
    }
  };
  setInterval(check, 15_000);
  waEvents.on('status', check);

  // 3. Heartbeat for an external dead-man's-switch (e.g. healthchecks.io) – the only way to learn the VM itself died.
  setInterval(async () => {
    const { heartbeatUrl } = alertConfig();
    if (!heartbeatUrl) return;
    try {
      await fetch(heartbeatUrl, { signal: AbortSignal.timeout(8000) });
    } catch (err) {
      console.log('[alerts] heartbeat failed:', err.message);
    }
  }, 60_000);
}
