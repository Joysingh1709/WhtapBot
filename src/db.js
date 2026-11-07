import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'whtapbot.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient       TEXT    NOT NULL,           -- digits (international) or a full jid
    text            TEXT    NOT NULL,
    send_at         INTEGER NOT NULL,           -- epoch ms (UTC)
    status          TEXT    NOT NULL DEFAULT 'pending',
                                                -- pending | sending | sent | failed | cancelled | missed
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,           -- epoch ms; scheduler ignores row until then
    error           TEXT,
    created_at      INTEGER NOT NULL,
    sent_at         INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_due ON messages (status, next_attempt_at);

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contacts (
    recipient TEXT PRIMARY KEY,                 -- same format as messages.recipient
    name TEXT,
    updated_at INTEGER NOT NULL
  );
`);

// Lightweight migrations for databases created by earlier versions.
const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
if (!cols.includes('name')) db.exec('ALTER TABLE messages ADD COLUMN name TEXT');
if (!cols.includes('repeat_rule')) db.exec(`ALTER TABLE messages ADD COLUMN repeat_rule TEXT NOT NULL DEFAULT 'none'`);

// A crash mid-send leaves rows in 'sending'. We can't know if WhatsApp got it,
// so flag them for a human instead of risking a duplicate.
db.prepare(
  `UPDATE messages SET status='failed', error='Server stopped mid-send; check WhatsApp to see if it was delivered.'
   WHERE status='sending'`
).run();

export const REPEAT_RULES = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];

/** First occurrence of a repeat rule strictly after `now`, stepping from `ts` (server local time). */
export function nextOccurrence(ts, rule, now = Date.now()) {
  const d = new Date(ts);
  do {
    if (rule === 'daily') d.setDate(d.getDate() + 1);
    else if (rule === 'weekly') d.setDate(d.getDate() + 7);
    else if (rule === 'weekdays') {
      do d.setDate(d.getDate() + 1);
      while (d.getDay() === 0 || d.getDay() === 6);
    } else if (rule === 'monthly') {
      const day = d.getDate();
      d.setMonth(d.getMonth() + 1);
      if (d.getDate() !== day) d.setDate(0); // 31st → last day of shorter month
    } else throw new Error(`bad repeat rule ${rule}`);
  } while (d.getTime() <= now);
  return d.getTime();
}

const q = {
  insert: db.prepare(
    `INSERT INTO messages (recipient, name, text, send_at, repeat_rule, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  list: db.prepare(`SELECT * FROM messages ORDER BY send_at DESC, id DESC LIMIT 1000`),
  get: db.prepare(`SELECT * FROM messages WHERE id = ?`),
  due: db.prepare(
    `SELECT * FROM messages WHERE status='pending' AND next_attempt_at <= ? ORDER BY send_at ASC LIMIT 20`
  ),
  claim: db.prepare(`UPDATE messages SET status='sending' WHERE id=? AND status='pending'`),
  markSent: db.prepare(`UPDATE messages SET status='sent', sent_at=?, error=NULL WHERE id=?`),
  markStatus: db.prepare(`UPDATE messages SET status=?, error=? WHERE id=?`),
  retryLater: db.prepare(
    `UPDATE messages SET status='pending', attempts=attempts+1, next_attempt_at=?, error=? WHERE id=?`
  ),
  failNow: db.prepare(`UPDATE messages SET status='failed', attempts=attempts+1, error=? WHERE id=?`),
  cancel: db.prepare(`UPDATE messages SET status='cancelled' WHERE id=? AND status='pending'`),
  remove: db.prepare(`DELETE FROM messages WHERE id=? AND status NOT IN ('pending','sending')`),
  update: db.prepare(
    `UPDATE messages SET recipient=?, name=?, text=?, send_at=?, repeat_rule=?, next_attempt_at=?
     WHERE id=? AND status='pending'`
  ),
  resend: db.prepare(
    `UPDATE messages SET status='pending', attempts=0, error=NULL, send_at=?, next_attempt_at=?
     WHERE id=? AND status IN ('pending','failed','missed')`
  ),
};

const qc = {
  upsert: db.prepare(
    `INSERT INTO contacts (recipient, name, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(recipient) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''), name), updated_at=excluded.updated_at`
  ),
  list: db.prepare(`SELECT * FROM contacts ORDER BY COALESCE(NULLIF(name,''), recipient) COLLATE NOCASE`),
  remove: db.prepare(`DELETE FROM contacts WHERE recipient=?`),
};
const qt = {
  insert: db.prepare(`INSERT INTO templates (title, text, created_at) VALUES (?, ?, ?)`),
  list: db.prepare(`SELECT * FROM templates ORDER BY id DESC`),
  remove: db.prepare(`DELETE FROM templates WHERE id=?`),
};

export const messages = {
  create({ recipient, name = null, text, sendAt, repeat = 'none' }) {
    const { lastInsertRowid } = q.insert.run(recipient, name, text, sendAt, repeat, sendAt, Date.now());
    contacts.save(recipient, name);
    return q.get.get(lastInsertRowid);
  },
  list: () => q.list.all(),
  get: (id) => q.get.get(id),
  due: (now) => q.due.all(now),
  claim: (id) => q.claim.run(id).changes === 1,
  markSent: (id) => q.markSent.run(Date.now(), id),
  markMissed: (id, error) => q.markStatus.run('missed', error, id),
  retryLater: (id, at, error) => q.retryLater.run(at, error, id),
  failNow: (id, error) => q.failNow.run(error, id),
  cancel: (id) => q.cancel.run(id).changes === 1,
  remove: (id) => q.remove.run(id).changes === 1,
  update(id, { recipient, name, text, sendAt, repeat }) {
    const changed = q.update.run(recipient, name, text, sendAt, repeat, sendAt, id).changes === 1;
    if (changed) contacts.save(recipient, name);
    return changed;
  },
  /** Send now. A recurring message keeps its schedule; a one-off copy is sent instead. */
  sendNow(id) {
    const m = q.get.get(id);
    if (!m || !['pending', 'failed', 'missed'].includes(m.status)) return null;
    const now = Date.now();
    if (m.repeat_rule !== 'none') {
      return messages.create({ recipient: m.recipient, name: m.name, text: m.text, sendAt: now });
    }
    q.resend.run(now, now, id);
    return q.get.get(id);
  },
  /** Called once a recurring message has run its course; queues the next occurrence. */
  scheduleNext(m) {
    if (!m.repeat_rule || m.repeat_rule === 'none') return;
    const at = nextOccurrence(m.send_at, m.repeat_rule);
    messages.create({ recipient: m.recipient, name: m.name, text: m.text, sendAt: at, repeat: m.repeat_rule });
  },
};

export const contacts = {
  save: (recipient, name) => qc.upsert.run(recipient, name || '', Date.now()),
  list: () => qc.list.all(),
  remove: (recipient) => qc.remove.run(recipient).changes === 1,
};

export const templates = {
  create: ({ title, text }) => qt.insert.run(title, text, Date.now()).lastInsertRowid,
  list: () => qt.list.all(),
  remove: (id) => qt.remove.run(id).changes === 1,
};
