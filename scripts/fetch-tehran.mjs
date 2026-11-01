// Snapshot of every shopping mall, passage (پاساژ) and bazaar in Tehran from OpenStreetMap, with the
// real shops mapped inside each one. Writes data/tehran.json, which the server loads at startup, so the
// app has real data even when Overpass is unreachable from inside Iran.
//
//   npm run data            (re-run any time to refresh from OpenStreetMap)

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { osmCategory } from '../public/shared/catalog.js';
import { areaOf } from '../public/shared/frame.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'tehran.json');
const BBOX = '35.56,51.08,35.84,51.66'; // Tehran city + Chitgar / Iran Mall in the west, Tehranpars in the east
const MIRRORS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// A department_store / commercial building only counts when its name says it's a mall or passage
// (this drops supermarket chains such as Shahrvand and Etka, and single shops tagged by mistake).
const MALL_NAME = /پاساژ|مجتمع|مرکز خرید|مرکز تجاری|بازار|بازارچه|سرای|سرا |تیمچه|مال\b|مال$|سنتر|پلازا|mall|center|centre|plaza|bazaar|passage/i;
// Passages are often mapped as a single shop or a plain building named "پاساژ …" (e.g. بازار علاالدین).
const MALL_PREFIX = '^(پاساژ|پاساز|بازار|بازارچه|مجتمع تجاری|مرکز خرید|مرکز تجاری|سرای|تیمچه)';
const NOT_MALL = /میوه|تره ?بار|ضایعات|اداری$|پارکینگ|بیمارستان|هایپر|هایپراستار|شهروند|اتکا|رفاه|افق کوروش|جانبو/i;

async function overpass(query) {
  for (const url of MIRRORS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST', body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(240_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'passajh/0.3 (data snapshot)' },
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

// Outer rings as [lat, lng], thinned to at most `max` points each.
function rings(el, max = 80) {
  const ways = el.type === 'way' ? [el.geometry]
    : (el.members || []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry);
  return ways.filter((g) => g?.length >= 4).slice(0, 4).map((g) => {
    const step = Math.ceil(g.length / max);
    const pts = g.filter((_, i) => i % step === 0 || i === g.length - 1);
    return pts.map((q) => [round(q.lat), round(q.lon)]);
  });
}

function centroid(rs) {
  const pts = rs.flat();
  return { lat: pts.reduce((a, p) => a + p[0], 0) / pts.length, lng: pts.reduce((a, p) => a + p[1], 0) / pts.length };
}

function inRings(lat, lng, rs) {
  let inside = false;
  for (const ring of rs) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i], [yj, xj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function dist(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

// "Sa-Th 10:00-22:00; Fr 16:00-22:00" → "۱۰:۰۰ تا ۲۲:۰۰" (the first time range; good enough for open/closed).
function hoursOf(oh) {
  if (!oh) return null;
  if (/24\/7/.test(oh)) return '00:00 تا 24:00';
  const m = oh.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]} تا ${m[3].padStart(2, '0')}:${m[4]}` : null;
}

// OSM "level" → our floor id. Ground is 0; negative levels are basements (not parking unless tagged so).
function floorOf(level) {
  if (level == null || level === '') return null;
  const n = Number(String(level).split(/[;,]/)[0]);
  if (!Number.isFinite(n)) return null;
  const l = Math.round(n);
  return l === 0 ? 'G' : l < 0 ? `B${-l}` : String(l);
}

const contact = (t, k) => t[`contact:${k}`] || t[k] || null;

console.log('1/3 malls, passages and bazaars…');
const mallData = await overpass(`[out:json][timeout:200];
(
  nwr["shop"="mall"]["name"](${BBOX});
  nwr["shop"="department_store"]["name"](${BBOX});
  nwr["amenity"="marketplace"]["name"](${BBOX});
  way["building"~"^(retail|commercial)$"]["name"](${BBOX});
  relation["building"~"^(retail|commercial)$"]["name"](${BBOX});
  nwr["shop"]["name"~"${MALL_PREFIX}"](${BBOX});
  way["building"]["name"~"${MALL_PREFIX}"](${BBOX});
);
out geom;`);

const malls = [];
for (const el of mallData.elements) {
  const t = el.tags || {};
  const name = (t['name:fa'] || t.name || '').trim();
  if (!name || NOT_MALL.test(name)) continue;
  if (!['mall', 'department_store', undefined].includes(t.shop) && !new RegExp(MALL_PREFIX).test(name)) continue;
  if (t.shop !== 'mall' && !MALL_NAME.test(`${name} ${t['name:en'] || ''}`)) continue;
  const rs = el.type === 'node' ? [] : rings(el);
  const c = rs.length ? centroid(rs) : { lat: el.lat ?? el.center?.lat, lng: el.lon ?? el.center?.lon };
  if (c.lat == null) continue;
  const levels = Number(t['building:levels'] || t.levels);
  malls.push({
    id: `osm-${el.type[0]}${el.id}`, name: name.slice(0, 80), nameEn: (t['name:en'] || '').slice(0, 80),
    lat: round(c.lat), lng: round(c.lng), rings: rs, area: rs.length ? areaOf(rs) : null,
    levels: Number.isFinite(levels) && levels > 0 ? Math.min(levels, 12) : null,
    minLevel: Number(t['building:min_level']) || null,
    hours: hoursOf(t.opening_hours), openingHours: t.opening_hours || null,
    phone: contact(t, 'phone'), website: contact(t, 'website'), instagram: contact(t, 'instagram'),
    street: t['addr:street'] || null, housenumber: t['addr:housenumber'] || null,
    wheelchair: t.wheelchair || null, kind: t.shop === 'mall' ? 'mall' : t.amenity === 'marketplace' ? 'bazaar' : 'passage',
    stores: [],
  });
}

// The same mall is often mapped twice (a node and its building). Keep the outline, drop the duplicate.
const norm = (s) => s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\s‌]/g, '').replace(/^(پاساژ|مجتمع(تجاری)?|مرکزخرید|مرکزتجاری)/, '');
malls.sort((a, b) => b.rings.length - a.rings.length || (b.area ?? 0) - (a.area ?? 0));
const kept = [];
for (const m of malls) {
  const dup = kept.find((k) => (norm(k.name) === norm(m.name) && dist(k, m) < 250)
    || (k.rings.length && !m.rings.length && inRings(m.lat, m.lng, k.rings) && norm(k.name).includes(norm(m.name).slice(0, 4))));
  if (dup) {
    for (const f of ['nameEn', 'hours', 'openingHours', 'phone', 'website', 'instagram', 'street', 'levels']) dup[f] ??= m[f] || null;
    continue;
  }
  // A large outline inside another mall's outline is part of it (wings, food courts).
  if (m.rings.length && kept.some((k) => k.rings.length && k.area > m.area * 3 && inRings(m.lat, m.lng, k.rings))) continue;
  kept.push(m);
}
console.log(`   ${malls.length} found, ${kept.length} after merging duplicates`);

console.log('2/3 shops inside the malls…');
const shopData = await overpass(`[out:json][timeout:200];
(
  way["shop"="mall"](${BBOX}); relation["shop"="mall"](${BBOX});
  way["shop"="department_store"](${BBOX}); way["amenity"="marketplace"](${BBOX});
  way["building"~"^(retail|commercial)$"]["name"](${BBOX});
)->.m;
.m map_to_area->.a;
(
  nwr(area.a)["shop"]["name"];
  nwr(area.a)["amenity"~"^(cafe|restaurant|fast_food|ice_cream|cinema|bank|atm|pharmacy)$"]["name"];
  nwr(area.a)["craft"]["name"];
);
out tags center;`);

const withOutline = kept.filter((m) => m.rings.length);
let placed = 0;
for (const el of shopData.elements) {
  const t = el.tags || {};
  if (t.shop === 'mall' || t.shop === 'department_store' || t.amenity === 'marketplace') continue;
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if (lat == null) continue;
  // The smallest outline containing the shop (a passage inside a bigger complex wins).
  const host = withOutline.filter((m) => inRings(lat, lng, m.rings)).sort((a, b) => a.area - b.area)[0];
  if (!host) continue;
  const name = (t['name:fa'] || t.name || '').trim().slice(0, 60);
  if (!name || host.stores.some((s) => s.name === name)) continue;
  host.stores.push({
    osm: `${el.type[0]}${el.id}`, name, nameEn: t['name:en'] || null, brand: t.brand || null,
    category: osmCategory(t), kind: t.shop || t.amenity || t.craft,
    floor: floorOf(t.level ?? t['level:ref'] ?? t['addr:floor']),
    hours: hoursOf(t.opening_hours), phone: contact(t, 'phone'), website: contact(t, 'website'), instagram: contact(t, 'instagram'),
    lat: round(lat), lng: round(lng),
  });
  placed++;
}
console.log(`   ${placed} shops placed in ${kept.filter((m) => m.stores.length).length} malls`);

console.log('3/3 neighbourhood names…');
const placeData = await overpass(`[out:json][timeout:120];
nwr["place"~"^(neighbourhood|quarter|locality)$"]["name"](${BBOX});
out tags center;`).catch((e) => {
  console.warn(`   skipped: ${e.message}`);
  return { elements: [] };
});
// Numbered municipal areas ("ناحیه ۴") mean nothing to shoppers; real neighbourhood names win over localities.
const places = placeData.elements
  .filter((e) => !/^(ناحیه|منطقه)\s|مجتمع|بازار|پاساژ|ساختمان/.test(e.tags.name))
  .map((e) => ({ name: e.tags['name:fa'] || e.tags.name, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, penalty: e.tags.place === 'neighbourhood' ? 0 : 600 }));
for (const m of kept) {
  let best = null;
  for (const p of places) {
    const d = dist(m, p) + p.penalty;
    if (d < 2500 && (!best || d < best.d)) best = { d, name: p.name };
  }
  m.neighbourhood = best?.name ?? null;
}

kept.sort((a, b) => a.id.localeCompare(b.id));
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({
  source: 'OpenStreetMap contributors (ODbL)', bbox: BBOX, updated: new Date().toISOString(), malls: kept,
}));
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${kept.length} malls, ${placed} shops.`);
