import { messages, uploads } from './db.js';
import { wa, sendOut, SendError } from './whatsapp.js';
import { alertMessageProblem } from './alerts.js';
import { MAX_ATTEMPTS, MAX_LATE_MINUTES } from './config.js';

const TICK_MS = 5000;
// Wait before retry #1, #2, #3. Short first retry: a dropped connection usually recovers in seconds.
const RETRY_BACKOFF_MS = [5_000, 20_000, 60_000];
let running = false;

// {name} in the text becomes the contact's first name (or nothing if no name was saved).
const personalize = (text, name) =>
  text.replace(/\{name\}/gi, (name || '').trim().split(/\s+/)[0] || '').replace(/ +([,.!?])/g, '$1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Small random gap between sends so a burst doesn't look robotic to WhatsApp.
const humanGap = () => sleep(2000 + Math.random() * 4000);

async function tick() {
  if (running || wa.status !== 'open') return; // keep messages queued until connected
  running = true;
  try {
    let first = true;
    for (const msg of messages.due(Date.now())) {
      if (!messages.claim(msg.id)) continue;

      const lateMs = Date.now() - msg.next_attempt_at;
      if (MAX_LATE_MINUTES > 0 && lateMs > MAX_LATE_MINUTES * 60_000) {
        messages.markMissed(msg.id, `Overdue by ${Math.round(lateMs / 60_000)} min (server was off or disconnected), so it was not sent.`);
        messages.scheduleNext(msg);
        alertMessageProblem(msg, 'missed', 'server was off or disconnected at send time');
        continue;
      }

      if (!first) await humanGap();
      first = false;

      try {
        const media = msg.upload_id
          ? { path: uploads.pathOf(uploads.get(msg.upload_id) ?? { filename: '__missing__' }), mime: msg.up_mime, kind: msg.up_kind, name: msg.up_name }
          : null;
        await sendOut(msg.recipient, { text: personalize(msg.text, msg.name), media });
        messages.markSent(msg.id);
        messages.scheduleNext(msg);
        console.log(`[scheduler] sent #${msg.id} to ${msg.recipient}`);
      } catch (err) {
        const e = err instanceof SendError ? err : new SendError(err.message);
        if (e.notConnected) {
          messages.retryLater(msg.id, Date.now() + 10_000, e.message);
          break;
        }
        if (e.permanent || msg.attempts + 1 >= MAX_ATTEMPTS) {
          messages.failNow(msg.id, e.message);
          messages.scheduleNext(msg);
          console.log(`[scheduler] failed #${msg.id}: ${e.message}`);
          alertMessageProblem(msg, 'failed', e.message);
        } else {
          const wait = RETRY_BACKOFF_MS[Math.min(msg.attempts, RETRY_BACKOFF_MS.length - 1)];
          console.log(`[scheduler] #${msg.id} attempt ${msg.attempts + 1} failed (${e.message}); retrying in ${wait / 1000}s`);
          messages.retryLater(msg.id, Date.now() + wait, e.message);
        }
      }
    }
  } catch (err) {
    console.error('[scheduler] tick error', err);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  setInterval(tick, TICK_MS);
  tick();
}
