// Snapshot of Tehran's metro stations and the lines that stop at each, from OpenStreetMap. Writes
// data/metro.json, which the server uses to tell shoppers the nearest station to every mall. Traffic and
// parking make the metro the practical way to reach most passages in central Tehran.
//
//   npm run metro

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toLatinDigits } from '../public/shared/text.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'metro.json');
const BBOX = '35.45,50.95,35.9,51.75'; // Tehran metro, a little wider than the mall snapshot
const MIRRORS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// Tehran's numbered lines (the airport and suburban lines are left out).
const LINES = ['1', '2', '3', '4', '5', '6', '7'];

async function overpass(query) {
  for (const url of MIRRORS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST', body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(180_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'passajh/0.3 (metro snapshot)' },
        });
        if (res.ok) return await res.json();
        console.warn(`  ${url} → ${res.status}`);
      } catch (e) {
        console.warn(`  ${url} → ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  throw new Error('No Overpass mirror answered');
}

const round = (n) => Math.round(n * 1e5) / 1e5;
const norm = (s) => String(s ?? '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/^(ایستگاه|مترو)\s+/, '').replace(/[\s‌]/g, '');
const dist = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 90400);

const data = await overpass(`[out:json][timeout:150];
rel["route"="subway"](${BBOX})->.r;
.r out body;
node(r.r);
out tags center;
node["railway"="station"]["station"="subway"](${BBOX});
out tags center;`);

const nodes = new Map(data.elements.filter((e) => e.type === 'node').map((e) => [e.id, e]));
const stations = new Map(); // normalized name -> station

function stationOf(el) {
  const t = el.tags ?? {};
  const name = (t['name:fa'] || t.name || '').trim();
  if (!name || t.railway === 'construction' || t.construction) return null;
  const key = norm(name);
  if (!stations.has(key)) {
    stations.set(key, { name: name.replace(/^ایستگاه\s+(مترو\s+)?/, ''), nameEn: t['name:en'] || null, lat: round(el.lat), lng: round(el.lon), lines: new Set() });
  }
  return stations.get(key);
}

for (const el of data.elements) {
  if (el.type === 'node' && el.tags?.railway === 'station') stationOf(el);
}
// Lines: every stop of a route relation adds the line to the station with the same name, or the nearest one.
for (const rel of data.elements.filter((e) => e.type === 'relation')) {
  const ref = toLatinDigits(rel.tags.ref).trim();
  if (!LINES.includes(ref)) continue;
  for (const m of rel.members) {
    if (m.type !== 'node' || !/^stop|^platform|^$/.test(m.role)) continue;
    const n = nodes.get(m.ref);
    if (!n?.tags) continue;
    let st = stations.get(norm(n.tags['name:fa'] || n.tags.name));
    if (!st) st = [...stations.values()].map((s) => [dist(s, { lat: n.lat, lng: n.lon }), s]).sort((a, b) => a[0] - b[0]).find(([d]) => d < 250)?.[1];
    st?.lines.add(ref);
  }
}

const out = [...stations.values()]
  .filter((s) => s.lines.size)
  .map((s) => ({ ...s, lines: [...s.lines].sort() }))
  .sort((a, b) => a.name.localeCompare(b.name, 'fa'));
await writeFile(OUT, JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', updated: new Date().toISOString(), stations: out }));
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${out.length} stations on lines ${[...new Set(out.flatMap((s) => s.lines))].sort().join(', ')}.`);
