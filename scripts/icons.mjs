// Renders the app icons (public/icon-*.png) with plain Node: a green shopping bag with a map pin
// on the dark map background. Run: node scripts/icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const SS = 4; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += pr; g += pg; b += pb;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r / SS / SS; raw[o + 1] = g / SS / SS; raw[o + 2] = b / SS / SS; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Design in a 0..1 square; everything important sits inside the central 60% (maskable safe zone).
function icon(u, v) {
  const bg = [11 + 10 * v, 17 + 12 * v, 24 + 16 * v];
  const inRR = (x0, y0, x1, y1, r) => {
    const cx = Math.min(Math.max(u, x0 + r), x1 - r), cy = Math.min(Math.max(v, y0 + r), y1 - r);
    return u >= x0 && u <= x1 && v >= y0 && v <= y1 && Math.hypot(u - cx, v - cy) <= r;
  };
  // Bag handle
  const hd = Math.hypot(u - 0.5, v - 0.4);
  if (v < 0.42 && hd > 0.1 && hd < 0.14) return [242, 245, 248];
  // Bag body
  if (inRR(0.27, 0.38, 0.73, 0.8, 0.06)) {
    // Map pin cut-out on the bag
    const pd = Math.hypot(u - 0.5, v - 0.55);
    const tip = v > 0.55 && v < 0.7 && Math.abs(u - 0.5) < (0.7 - v) * 0.55;
    if (pd < 0.035) return [47, 210, 122];
    if (pd < 0.085 || tip) return [11, 17, 24];
    return [47, 210, 122];
  }
  return bg;
}

for (const size of [180, 192, 512]) writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(size, icon));
console.log('icons written');
