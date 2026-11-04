// Generates the placeholder PWA icons (public/icons/*.png) with no dependencies: a dark tile
// with an amber disc and a microphone. To use your own artwork, replace the PNG files with the
// same names and sizes; nothing else needs to change. Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const BG = [15, 17, 21];
const AMBER = [245, 165, 36];
const INK = [28, 20, 8];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Coordinates are in units of the disc radius, centred on the disc.
const inCapsule = (x, y, r, y0, y1) => {
  const cy = Math.min(Math.max(y, y0), y1);
  return Math.hypot(x, y - cy) <= r;
};
const inMic = (x, y) =>
  inCapsule(x, y, 0.27, -0.32, 0.02) ||
  (y > 0.02 && y < 0.6 && Math.abs(Math.hypot(x, y - 0.02) - 0.5) < 0.06) ||
  (Math.abs(x) < 0.05 && y >= 0.5 && y <= 0.68) ||
  (Math.abs(x) < 0.26 && y >= 0.66 && y <= 0.76);

function icon(size, radiusFraction) {
  const R = size * radiusFraction;
  const c = size / 2;
  const S = 4; // supersampling per axis
  return png(size, (px, py) => {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const x = (px + (sx + 0.5) / S - c) / R;
      const y = (py + (sy + 0.5) / S - c) / R;
      const colour = Math.hypot(x, y) > 1 ? BG : inMic(x, y) ? INK : AMBER;
      r += colour[0]; g += colour[1]; b += colour[2];
    }
    const n = S * S;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

// "any" icons use most of the tile; the maskable one keeps everything inside the 80% safe zone.
writeFileSync(join(out, 'icon-192.png'), icon(192, 0.42));
writeFileSync(join(out, 'icon-512.png'), icon(512, 0.42));
writeFileSync(join(out, 'icon-maskable-512.png'), icon(512, 0.33));
writeFileSync(join(out, 'apple-touch-icon.png'), icon(180, 0.42));
