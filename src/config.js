import path from 'node:path';
import fs from 'node:fs';

export const PORT = Number(process.env.PORT || 3000);
// Local default is loopback only. The Dockerfile sets HOST=0.0.0.0.
export const HOST = process.env.HOST || '127.0.0.1';
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
// Messages that are overdue by more than this are marked "missed" instead of sent
// (e.g. the server was off). 0 disables the check and sends everything late.
export const MAX_LATE_MINUTES = Number(process.env.MAX_LATE_MINUTES ?? 120);
export const MAX_ATTEMPTS = 4;

fs.mkdirSync(DATA_DIR, { recursive: true });

// Timezone used for messages that don't specify one (and for legacy rows).
export const DEFAULT_TZ = process.env.DEFAULT_TZ || 'UTC';
// Backups are AES-256-GCM encrypted with this passphrase. Keep a copy somewhere safe, NOT only on the server.
export const BACKUP_PASSPHRASE = process.env.BACKUP_PASSPHRASE || '';
export const BACKUP_AT_UTC = process.env.BACKUP_AT_UTC || '21:30'; // 21:30 UTC = 03:00 IST
export const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 14);
export const UPLOAD_MAX_MB = Number(process.env.UPLOAD_MAX_MB || 64);
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

// Optional static bearer token for POST /mcp (scripts, local clients). OAuth sign-in works without it.
// Use 24+ random characters. With neither this nor sign-in configured, /mcp is switched off.
export const MCP_TOKEN = process.env.MCP_TOKEN || '';

/* ---------- public access: Google sign-in + OAuth for MCP connectors ---------- */
// Public https address of this server, e.g. https://whtapbot.duckdns.org (no trailing slash).
export const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
// Comma-separated Google accounts allowed to sign in. Everyone else is turned away.
export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// Sign-in is enforced when GOOGLE_CLIENT_ID is set. Without it the app is open (fine on localhost only).
export const AUTH_ENABLED = Boolean(GOOGLE_CLIENT_ID);
export const SESSION_DAYS = 30;
// Overridable so tests can point at a fake Google.
export const GOOGLE_AUTH_URL = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
// Tests only: don't connect to WhatsApp or run the scheduler.
export const DISABLE_WHATSAPP = process.env.DISABLE_WHATSAPP === '1';

if (AUTH_ENABLED) {
  const problems = [];
  if (!/^https:\/\//.test(PUBLIC_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(PUBLIC_URL)) problems.push('PUBLIC_URL must be the https address of this server');
  if (!GOOGLE_CLIENT_SECRET) problems.push('GOOGLE_CLIENT_SECRET is missing');
  if (!ALLOWED_EMAILS.length) problems.push('ALLOWED_EMAILS is empty (nobody could sign in)');
  if (problems.length) { console.error('[auth] refusing to start: ' + problems.join('; ')); process.exit(1); }
}
