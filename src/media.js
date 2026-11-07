import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { uploads } from './db.js';

export const WHATSAPP_MEDIA_LIMIT_MB = 16; // images/video/audio above this are rejected by WhatsApp; documents allow far more

export function detectKind(mime, name = '') {
  const m = String(mime).toLowerCase();
  if (m.startsWith('image/') && !m.includes('svg')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (/\.(jpe?g|png|webp)$/i.test(name)) return 'image';
  if (/\.(mp4|mov|3gp)$/i.test(name)) return 'video';
  if (/\.(mp3|m4a|aac|wav|ogg|opus|amr)$/i.test(name)) return 'audio';
  return 'document';
}

/** Convert any audio to OGG/Opus so WhatsApp shows it as a real voice note. Resolves false if ffmpeg is unavailable. */
export function convertToVoice(src, dest) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-y', '-i', src, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000', '-f', 'ogg', dest], { stdio: 'ignore' });
    const timer = setTimeout(() => p.kill('SIGKILL'), 60_000);
    p.on('error', () => { clearTimeout(timer); resolve(false); });
    p.on('close', (code) => { clearTimeout(timer); resolve(code === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0); });
  });
}

const safeExt = (name) => (path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8) || '.bin');

/** Register a file that has been written to `tmpPath`. Moves it into the uploads dir and returns the DB row + warnings. */
export async function registerUpload(tmpPath, { name, mime, voice }) {
  const id = crypto.randomUUID();
  let kind = detectKind(mime, name), finalMime = mime || 'application/octet-stream', finalName = name || 'file';
  let filename = `${id}${safeExt(finalName)}`;
  const warnings = [];
  let placed = false; // true once the final file is already in the uploads dir

  if (voice && kind === 'audio') {
    const dest = path.join(uploads.dir, `${id}.ogg`);
    if (await convertToVoice(tmpPath, dest)) {
      fs.rmSync(tmpPath, { force: true });
      placed = true; filename = `${id}.ogg`; kind = 'voice'; finalMime = 'audio/ogg; codecs=opus';
      finalName = finalName.replace(/\.[^.]+$/, '') + '.ogg';
    } else {
      warnings.push('Could not convert to a voice note (ffmpeg unavailable); it will be sent as an audio file instead.');
    }
  }
  if (!placed) fs.renameSync(tmpPath, path.join(uploads.dir, filename));

  const size = fs.statSync(path.join(uploads.dir, filename)).size;
  if (kind !== 'document' && size > WHATSAPP_MEDIA_LIMIT_MB * 1024 * 1024) {
    warnings.push(`WhatsApp limits ${kind}s to about ${WHATSAPP_MEDIA_LIMIT_MB} MB. Send it as a document instead, or compress it.`);
  }
  uploads.create({ id, filename, name: finalName, mime: finalMime, kind, size });
  return { upload: uploads.get(id), warnings };
}
