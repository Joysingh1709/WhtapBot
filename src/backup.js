import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { DATA_DIR, BACKUP_PASSPHRASE, BACKUP_AT_UTC, BACKUP_KEEP } from './config.js';
import { db, uploads } from './db.js';
import { notify } from './alerts.js';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAGIC = Buffer.from('WBK1');
const UPLOAD_BUDGET = 20 * 1024 * 1024; // attachments of still-pending messages are included up to this total

export const backupsEnabled = () => BACKUP_PASSPHRASE.length >= 12;

function walk(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else if (e.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

function encrypt(plain, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, body, c.getAuthTag()]);
}

function decrypt(buf, passphrase) {
  if (buf.length < 4 + 16 + 12 + 16 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not a WhtapBot backup file');
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(buf.length - 16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(32, buf.length - 16)), d.final()]);
  } catch {
    throw new Error('Wrong passphrase, or the file is corrupted');
  }
}

/** Snapshot of the queue (SQLite), the WhatsApp login, and attachments of pending messages – encrypted. */
export function createBackup({ passphrase = BACKUP_PASSPHRASE, dataDir = DATA_DIR } = {}) {
  if (passphrase.length < 12) throw new Error('BACKUP_PASSPHRASE (12+ characters) is not set');
  const files = [];
  const snap = path.join(BACKUP_DIR, '.snapshot.db');
  fs.rmSync(snap, { force: true });
  db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); // consistent copy even while the app is writing
  files.push({ name: 'whtapbot.db', data: fs.readFileSync(snap) });
  fs.rmSync(snap, { force: true });

  const authDir = path.join(dataDir, 'auth');
  for (const rel of walk(authDir)) files.push({ name: path.join('auth', rel), data: fs.readFileSync(path.join(authDir, rel)) });

  let used = 0;
  const skipped = [];
  for (const id of uploads.pendingIds()) {
    const u = uploads.get(id);
    if (!u) continue;
    const p = uploads.pathOf(u);
    const size = fs.existsSync(p) ? fs.statSync(p).size : 0;
    if (!size || used + size > UPLOAD_BUDGET) { skipped.push(u.name); continue; }
    used += size;
    files.push({ name: path.join('uploads', u.filename), data: fs.readFileSync(p) });
  }

  const payload = JSON.stringify({
    manifest: { version: 1, createdAt: new Date().toISOString(), skippedUploads: skipped },
    files: files.map((f) => ({ name: f.name, data: f.data.toString('base64') })),
  });
  const out = encrypt(zlib.gzipSync(payload), passphrase);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const file = path.join(BACKUP_DIR, `whtapbot-${stamp}.wbk`);
  fs.writeFileSync(file + '.tmp', out);
  fs.renameSync(file + '.tmp', file);
  prune();
  return { name: path.basename(file), size: out.length, skippedUploads: skipped };
}

export function listBackups() {
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^whtapbot-\d{8}-\d{6}\.wbk$/.test(f))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function prune() {
  for (const b of listBackups().slice(BACKUP_KEEP)) fs.rmSync(path.join(BACKUP_DIR, b.name), { force: true });
}

/** Decrypt a backup file into `targetDir` (db, auth/, uploads/). Used by src/restore.js. */
export function restoreBackup(file, passphrase, targetDir) {
  const { manifest, files } = JSON.parse(zlib.gunzipSync(decrypt(fs.readFileSync(file), passphrase)).toString());
  for (const f of files) {
    const dest = path.resolve(targetDir, f.name);
    if (!dest.startsWith(path.resolve(targetDir) + path.sep)) throw new Error('Unsafe path in backup: ' + f.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(f.data, 'base64'));
  }
  return { manifest, fileCount: files.length };
}

export function startBackupSchedule() {
  if (!backupsEnabled()) {
    console.log('[backup] disabled: set BACKUP_PASSPHRASE (12+ chars) to enable nightly encrypted backups');
    return;
  }
  const [hh, mm] = BACKUP_AT_UTC.split(':').map(Number);
  const run = async () => {
    try {
      const now = new Date();
      const slot = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm);
      const last = listBackups()[0];
      const lastAt = last ? Date.parse(last.createdAt) : 0;
      // Due when today's slot has passed and we haven't backed up since it, or when there is no backup at all.
      if ((Date.now() >= slot && lastAt < slot) || !last) {
        const r = createBackup();
        console.log(`[backup] created ${r.name} (${Math.round(r.size / 1024)} KB)`);
      }
    } catch (err) {
      console.error('[backup] failed:', err.message);
      notify('Backup failed', err.message, { priority: 4, tags: ['warning'], dedupeKey: 'backup-failed', minIntervalMs: 6 * 3600_000 });
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, 5 * 60_000);
}
