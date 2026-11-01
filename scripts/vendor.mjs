// Copies the font and the map library into public/, so the app never depends on Google Fonts or a CDN:
// both are slow or filtered from inside Iran. The files are committed; re-run only to upgrade them.
//
//   npm run vendor

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const FILES = {
  'fonts/vazirmatn-33.0.3.woff2': 'https://cdn.jsdelivr.net/npm/vazirmatn@33.0.3/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2',
  'vendor/maplibre-gl-4.7.1.js': 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'vendor/maplibre-gl-4.7.1.css': 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'vendor/rtl-text-0.2.3.js': 'https://cdn.jsdelivr.net/npm/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js',
};

for (const [file, url] of Object.entries(FILES)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const out = path.join(ROOT, file);
  await mkdir(path.dirname(out), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  console.log(`${file}  ${Math.round(buf.length / 1024)} KB`);
}
