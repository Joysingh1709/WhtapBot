import path from 'node:path';
import fs from 'node:fs';

export const PORT = Number(process.env.PORT || 3000);
// Local default is loopback only. The Dockerfile sets HOST=0.0.0.0.
export const HOST = process.env.HOST || '127.0.0.1';
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
// If set, the UI and API require HTTP basic auth (user: anything, password: this value).
export const APP_PASSWORD = process.env.APP_PASSWORD || '';
// Messages that are overdue by more than this are marked "missed" instead of sent
// (e.g. the server was off). 0 disables the check and sends everything late.
export const MAX_LATE_MINUTES = Number(process.env.MAX_LATE_MINUTES ?? 120);
export const MAX_ATTEMPTS = 4;

fs.mkdirSync(DATA_DIR, { recursive: true });
