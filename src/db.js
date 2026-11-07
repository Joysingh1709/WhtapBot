import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR, DEFAULT_TZ } from './config.js';
import { nextOccurrence, pickFireTime, wallParts } from './time.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'whtapbot.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient       TEXT    NOT NULL,           -- digits (international) or a full jid
    text            TEXT    NOT NULL,           -- message body, or the caption when there's an attachment
    send_at         INTEGER NOT NULL,           -- epoch ms (UTC); start of the send window
    status          TEXT    NOT NULL DEFAULT 'pending',
                                                -- pending | sending | sent | failed | cancelled | missed
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,           -- epoch ms; the moment the scheduler will actually send
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
    recipient TEXT PRIMARY KEY,
    name TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS uploads (
    id         TEXT PRIMARY KEY,
    filename   TEXT NOT NULL,                   -- stored file name inside DATA_DIR/uploads
    name       TEXT NOT NULL,                   -- original name shown to the user
    mime       TEXT NOT NULL,
    kind       TEXT NOT NULL,                   -- image | video | audio | voice | document
    size       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// Lightweight migrations for databases created by earlier versions.
const have = new Set(db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name));
const addCol = (name, ddl) => { if (!have.has(name)) db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${ddl}`); };
addCol('name', 'TEXT');
addCol('repeat_rule', `TEXT NOT NULL DEFAULT 'none'`);
addCol('tz', 'TEXT');                  // IANA timezone the clock time is defined in (null → DEFAULT_TZ)
addCol('repeat_until', 'INTEGER');     // no occurrence is created after this instant
addCol('repeat_left', 'INTEGER');      // further occurrences to create after this one (null = unlimited)
addCol('anchor_day', 'INTEGER');       // day-of-month of the first occurrence (monthly/yearly)
addCol('window_min', 'INTEGER NOT NULL DEFAULT 0'); // send at a random moment within this many minutes after send_at
addCol('upload_id', 'TEXT');           // attachment

// A crash mid-send leaves rows in 'sending'. We can't know if WhatsApp got it,
// so flag them for a human instead of risking a duplicate.
db.prepare(
  `UPDATE messages SET status='failed', error='Server stopped mid-send; check WhatsApp to see if it was delivered.'
   WHERE status='sending'`
).run();

export const REPEAT_RULES = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

const SELECT_MSG = `SELECT m.*, u.name AS up_name, u.mime AS up_mime, u.kind AS up_kind, u.size AS up_size
                    FROM messages m LEFT JOIN uploads u ON u.id = m.upload_id`;
const q = {
  insert: db.prepare(
    `INSERT INTO messages (recipient, name, text, send_at, repeat_rule, tz, repeat_until, repeat_left, anchor_day,
                           window_min, upload_id, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  list: db.prepare(`${SELECT_MSG} ORDER BY m.send_at DESC, m.id DESC LIMIT 1000`),
  get: db.prepare(`${SELECT_MSG} WHERE m.id = ?`),
  pendingRecurring: db.prepare(`${SELECT_MSG} WHERE m.status='pending' AND m.repeat_rule != 'none'`),
  due: db.prepare(
    `${SELECT_MSG} WHERE m.status='pending' AND m.next_attempt_at <= ? ORDER BY m.next_attempt_at ASC LIMIT 20`
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
    `UPDATE messages SET recipient=?, name=?, text=?, send_at=?, repeat_rule=?, tz=?, repeat_until=?, repeat_left=?,
            anchor_day=?, window_min=?, upload_id=?, next_attempt_at=?
     WHERE id=? AND status='pending'`
  ),
  resend: db.prepare(
    `UPDATE messages SET status='pending', attempts=0, error=NULL, send_at=?, next_attempt_at=?
     WHERE id=? AND status IN ('pending','failed','missed')`
  ),
  uploadRefs: db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE upload_id = ?`),
  pendingUploads: db.prepare(`SELECT DISTINCT upload_id FROM messages WHERE upload_id IS NOT NULL AND status IN ('pending','sending')`),
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
const qs = {
  all: db.prepare(`SELECT key, value FROM settings`),
  set: db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
  del: db.prepare(`DELETE FROM settings WHERE key=?`),
};
const qu = {
  insert: db.prepare(`INSERT INTO uploads (id, filename, name, mime, kind, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  get: db.prepare(`SELECT * FROM uploads WHERE id=?`),
  remove: db.prepare(`DELETE FROM uploads WHERE id=?`),
  unreferenced: db.prepare(
    `SELECT * FROM uploads WHERE created_at < ? AND id NOT IN (SELECT upload_id FROM messages WHERE upload_id IS NOT NULL)`
  ),
};

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export const uploads = {
  dir: UPLOAD_DIR,
  create: (u) => qu.insert.run(u.id, u.filename, u.name, u.mime, u.kind, u.size, Date.now()),
  get: (id) => (id ? qu.get.get(id) : undefined),
  pathOf: (u) => path.join(UPLOAD_DIR, u.filename),
  /** Delete the file + row if no message references it any more. */
  releaseIfUnused(id) {
    if (!id || q.uploadRefs.get(id).n > 0) return;
    const u = qu.get.get(id);
    if (!u) return;
    fs.rmSync(path.join(UPLOAD_DIR, u.filename), { force: true });
    qu.remove.run(id);
  },
  /** Uploads that never got attached to a message (abandoned forms) are cleaned after a day. */
  cleanupOrphans(olderThanMs = 24 * 3600_000) {
    for (const u of qu.unreferenced.all(Date.now() - olderThanMs)) {
      fs.rmSync(path.join(UPLOAD_DIR, u.filename), { force: true });
      qu.remove.run(u.id);
    }
  },
  pendingIds: () => q.pendingUploads.all().map((r) => r.upload_id),
};

export const settings = {
  all() {
    const o = {};
    for (const r of qs.all.all()) o[r.key] = r.value;
    return o;
  },
  get: (key, fallback = '') => qs.all.all().find((r) => r.key === key)?.value ?? fallback,
  set: (key, value) => (value === '' || value == null ? qs.del.run(key) : qs.set.run(key, String(value))),
};

export const messages = {
  /**
   * fields: recipient, name, text, sendAt (epoch ms; start of window), repeat, tz, repeatUntil, repeatLeft,
   * anchorDay, windowMin, uploadId
   */
  create(f) {
    const tz = f.tz || DEFAULT_TZ;
    const anchor = f.anchorDay ?? wallParts(f.sendAt, tz).d;
    const { lastInsertRowid } = q.insert.run(
      f.recipient, f.name ?? null, f.text, f.sendAt, f.repeat ?? 'none', tz, f.repeatUntil ?? null,
      f.repeatLeft ?? null, anchor, f.windowMin ?? 0, f.uploadId ?? null,
      pickFireTime(f.sendAt, f.windowMin ?? 0), Date.now()
    );
    contacts.save(f.recipient, f.name);
    return q.get.get(lastInsertRowid);
  },
  list: () => q.list.all(),
  get: (id) => q.get.get(id),
  pendingRecurring: () => q.pendingRecurring.all(),
  due: (now) => q.due.all(now),
  claim: (id) => q.claim.run(id).changes === 1,
  markSent: (id) => q.markSent.run(Date.now(), id),
  markMissed: (id, error) => q.markStatus.run('missed', error, id),
  retryLater: (id, at, error) => q.retryLater.run(at, error, id),
  failNow: (id, error) => q.failNow.run(error, id),
  cancel: (id) => q.cancel.run(id).changes === 1,
  remove(id) {
    const m = q.get.get(id);
    const ok = q.remove.run(id).changes === 1;
    if (ok) uploads.releaseIfUnused(m?.upload_id);
    return ok;
  },
  update(id, f) {
    const old = q.get.get(id);
    const tz = f.tz || DEFAULT_TZ;
    const anchor = f.anchorDay ?? wallParts(f.sendAt, tz).d;
    const changed = q.update.run(
      f.recipient, f.name ?? null, f.text, f.sendAt, f.repeat ?? 'none', tz, f.repeatUntil ?? null,
      f.repeatLeft ?? null, anchor, f.windowMin ?? 0, f.uploadId ?? null, pickFireTime(f.sendAt, f.windowMin ?? 0), id
    ).changes === 1;
    if (changed) {
      contacts.save(f.recipient, f.name);
      if (old?.upload_id !== (f.uploadId ?? null)) uploads.releaseIfUnused(old?.upload_id);
    }
    return changed;
  },
  /** Send now. A recurring message keeps its schedule; a one-off copy is sent instead. */
  sendNow(id) {
    const m = q.get.get(id);
    if (!m || !['pending', 'failed', 'missed'].includes(m.status)) return null;
    const now = Date.now();
    if (m.repeat_rule !== 'none') {
      return messages.create({ recipient: m.recipient, name: m.name, text: m.text, sendAt: now, tz: m.tz, uploadId: m.upload_id });
    }
    q.resend.run(now, now, id);
    return q.get.get(id);
  },
  /** Called once a recurring message has run its course; queues the next occurrence (if the series isn't over). */
  scheduleNext(m) {
    if (!m.repeat_rule || m.repeat_rule === 'none') return;
    if (m.repeat_left != null && m.repeat_left <= 0) return;
    const tz = m.tz || DEFAULT_TZ;
    const at = nextOccurrence(m.send_at, m.repeat_rule, tz, m.anchor_day);
    if (m.repeat_until != null && at > m.repeat_until) return;
    messages.create({
      recipient: m.recipient, name: m.name, text: m.text, sendAt: at, repeat: m.repeat_rule, tz,
      repeatUntil: m.repeat_until, repeatLeft: m.repeat_left == null ? null : m.repeat_left - 1,
      anchorDay: m.anchor_day, windowMin: m.window_min, uploadId: m.upload_id,
    });
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
