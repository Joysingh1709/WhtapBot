import { DEFAULT_TZ } from './config.js';
import { uploads, REPEAT_RULES } from './db.js';
import { normalizeRecipient } from './whatsapp.js';
import { isValidTz, parseLocal, toLocalString, endOfDay } from './time.js';

export const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

export const toApi = (m) => {
  const tz = m.tz || DEFAULT_TZ;
  return {
    id: m.id,
    recipient: m.recipient,
    name: m.name,
    text: m.text,
    repeat: m.repeat_rule,
    tz,
    sendAt: iso(m.send_at),
    localTime: toLocalString(m.send_at, tz), // what the clock in `tz` reads – used to fill the edit form
    windowMin: m.window_min,
    fireAt: iso(m.next_attempt_at), // when it will actually go (inside the window)
    repeatUntil: m.repeat_until != null ? toLocalString(m.repeat_until, tz).slice(0, 10) : null,
    repeatTimes: m.repeat_left == null ? null : m.repeat_left + 1, // sends remaining including this one
    status: m.status,
    attempts: m.attempts,
    error: m.error,
    sentAt: iso(m.sent_at),
    attachment: m.upload_id && m.up_name ? { id: m.upload_id, name: m.up_name, mime: m.up_mime, kind: m.up_kind, size: m.up_size } : null,
  };
};

// Validates and normalises a message body. Returns { error } or { value }.
export function parseMessage(body) {
  const recipient = normalizeRecipient(body?.recipient);
  const text = String(body?.text ?? '').trim();
  const name = String(body?.name ?? '').trim().slice(0, 80) || null;
  const repeat = body?.repeat ?? 'none';
  const tz = body?.tz ? body.tz : DEFAULT_TZ;
  const windowMin = Math.round(Number(body?.windowMin ?? 0));
  const uploadId = body?.uploadId || null;

  if (!recipient) return { error: 'Enter a phone number with country code, e.g. 14155550100.' };
  if (!isValidTz(tz)) return { error: 'Unknown timezone.' };
  if (!text && !uploadId) return { error: 'Write a message or attach a file.' };
  if (text.length > 4000) return { error: 'Message is too long (max 4000 characters).' };
  if (!REPEAT_RULES.includes(repeat)) return { error: 'Invalid repeat option.' };
  if (!Number.isFinite(windowMin) || windowMin < 0 || windowMin > 720) return { error: 'Send window must be 0–720 minutes.' };
  if (uploadId && !uploads.get(uploadId)) return { error: 'Attachment not found. Please attach it again.' };

  const sendAt = body?.sendAtLocal ? parseLocal(body.sendAtLocal, tz) : Date.parse(body?.sendAt);
  if (Number.isNaN(sendAt)) return { error: 'Invalid send time.' };
  if (sendAt + windowMin * 60_000 < Date.now() - 60_000) return { error: 'Send time is in the past.' };

  let repeatUntil = null, repeatLeft = null;
  if (repeat !== 'none') {
    const endType = body?.endType ?? 'never';
    if (endType === 'date') {
      repeatUntil = /^\d{4}-\d{2}-\d{2}$/.test(body?.endDate ?? '') ? endOfDay(body.endDate, tz) : NaN;
      if (Number.isNaN(repeatUntil)) return { error: 'Pick a valid end date.' };
      if (repeatUntil < sendAt) return { error: 'The end date is before the first send.' };
    } else if (endType === 'count') {
      const n = Math.round(Number(body?.endCount));
      if (!Number.isFinite(n) || n < 1 || n > 1000) return { error: 'Number of sends must be between 1 and 1000.' };
      repeatLeft = n - 1;
    } else if (endType !== 'never') return { error: 'Invalid end option.' };
  }
  return { value: { recipient, name, text, sendAt, repeat, tz, windowMin, uploadId, repeatUntil, repeatLeft } };
}
