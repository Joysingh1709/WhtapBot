// Generates the PWA icons (pure Node, no dependencies): blue gradient with the double-check logo.
// Usage: node tools/make-icons.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// The logo's two check strokes in a 24-unit box (same as the in-app logo).
const STROKES = [[[2, 13], [6, 17], [14, 8]], [[10, 15], [12, 17], [22, 7]]];
const distSeg = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

function render(size, glyphScale) {
  const buf = Buffer.alloc(size * size * 4), SS = 3;
  const unit = size * glyphScale / 20; // glyph is 20 units wide
  const half = (2.6 * unit) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let cover = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      const pts = STROKES.map((s) => s.map(([gx, gy]) => [size / 2 + (gx - 12) * unit, size / 2 + (gy - 12) * unit]));
      if (pts.some((s) => distSeg(px, py, s[0], s[1]) <= half || distSeg(px, py, s[1], s[2]) <= half)) cover++;
    }
    const a = cover / (SS * SS), g = y / size;
    const bg = [74 + (59 - 74) * g, 163 + (130 - 163) * g, 255 + (246 - 255) * g]; // #4aa3ff → #3b82f6
    const i = (y * size + x) * 4;
    buf[i] = bg[0] + (255 - bg[0]) * a; buf[i + 1] = bg[1] + (255 - bg[1]) * a; buf[i + 2] = bg[2] + (255 - bg[2]) * a; buf[i + 3] = 255;
  }
  return png(size, buf);
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192, 0.62));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512, 0.62));
fs.writeFileSync(path.join(out, 'maskable-512.png'), render(512, 0.46)); // keeps the glyph inside the maskable safe zone
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, 0.62));
console.log('icons written to', out);
