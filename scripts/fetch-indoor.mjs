// Real indoor floor plans from OpenStreetMap for every mall in Iran that has them mapped (shops drawn as
// indoor=room/area with a level, plus lifts, escalators, stairs, entrances and toilets). Writes
// data/plans-osm.json, which the server turns into floor maps. Plans drawn in the editor take precedence.
//
//   npm run indoor            (re-run any time to pick up new indoor mapping)

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { osmCategory } from '../public/shared/catalog.js';
import { areaOf } from '../public/shared/frame.js';
import { fidOf } from '../public/shared/floors.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'plans-osm.json');
const MIRRORS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const MIN_UNITS = 4; // fewer mapped rooms than this isn't a floor plan yet

async function overpass(query) {
  for (const url of MIRRORS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST', body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(400_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'passajh/0.3 (indoor import)' },
        });
        if (res.ok) return await res.json();
        console.warn(`  ${url} → ${res.status}`);
      } catch (e) {
        console.warn(`  ${url} → ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  throw new Error('No Overpass mirror answered');
}

const IRAN = 'area["ISO3166-1"="IR"][admin_level=2]->.ir;';
const MALLS = '(way["shop"="mall"](area.ir); relation["shop"="mall"](area.ir); way["building"]["name"~"^(پاساژ|مجتمع تجاری|مرکز خرید|مرکز تجاری|بازار)"](area.ir);)->.m;';
const round = (n) => Math.round(n * 1e6) / 1e6;

function ringsOf(el) {
  const ways = el.type === 'way' ? [el.geometry]
    : (el.members || []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry);
  return ways.filter((g) => g?.length >= 4).map((g) => g.map((q) => [round(q.lat), round(q.lon)]));
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

const centerOf = (el) => {
  if (el.lat != null) return { lat: el.lat, lng: el.lon };
  const g = el.geometry ?? el.members?.flatMap((m) => m.geometry ?? []) ?? [];
  if (!g.length) return null;
  return { lat: g.reduce((a, q) => a + q.lat, 0) / g.length, lng: g.reduce((a, q) => a + q.lon, 0) / g.length };
};

// "0", "0;1", "-1;0", "0-2", plus repeat_on → floor ids.
function floorsOf(t) {
  const out = new Set();
  for (const v of [t.level, t.repeat_on, t['level:ref']].filter(Boolean)) {
    for (const part of String(v).split(';')) {
      const m = part.trim().match(/^(-?\d+(?:\.\d+)?)(?:-(-?\d+(?:\.\d+)?))?$/);
      if (!m) continue;
      const a = Math.round(Number(m[1])), b = m[2] != null ? Math.round(Number(m[2])) : a;
      for (let l = Math.min(a, b); l <= Math.max(a, b); l++) out.add(fidOf(l));
    }
  }
  return [...out];
}

const POINT = { toilets: 'wc', atm: 'atm', place_of_worship: 'prayer', information: 'info', food_court: 'foodcourt', first_aid: 'firstaid' };

console.log('1/2 malls in Iran…');
const mallData = await overpass(`[out:json][timeout:300];${IRAN}${MALLS}.m out geom;`);
const malls = mallData.elements.map((el) => {
  const t = el.tags || {};
  const rings = ringsOf(el);
  if (!rings.length) return null;
  const pts = rings.flat();
  return {
    id: `osm-${el.type[0]}${el.id}`, name: (t['name:fa'] || t.name || '').trim().slice(0, 80), nameEn: t['name:en'] || '',
    lat: round(pts.reduce((a, p) => a + p[0], 0) / pts.length), lng: round(pts.reduce((a, p) => a + p[1], 0) / pts.length),
    rings, area: areaOf(rings), levels: Number(t['building:levels']) || null, kind: 'mall', stores: [],
    hours: null, phone: t.phone || t['contact:phone'] || null, address: t['addr:city'] || null,
  };
}).filter((m) => m?.name);
console.log(`   ${malls.length} malls with an outline`);

console.log('2/2 indoor mapping inside them…');
const indoor = await overpass(`[out:json][timeout:400];${IRAN}${MALLS}
.m map_to_area->.a;
(
  nwr(area.a)["indoor"~"^(room|area|corridor)$"];
  nwr(area.a)["highway"="elevator"];
  nwr(area.a)["conveying"];
  nwr(area.a)["highway"="steps"]["level"];
  node(area.a)["entrance"];
  nwr(area.a)["amenity"~"^(toilets|atm|place_of_worship|food_court|first_aid)$"]["level"];
);
out geom;`);

const plans = new Map(); // mall id → { mall, floors: Map(fid → floor) }
const floorOf = (mall, fid) => {
  if (!plans.has(mall.id)) plans.set(mall.id, { mall, floors: new Map() });
  const fl = plans.get(mall.id).floors;
  if (!fl.has(fid)) fl.set(fid, { id: fid, units: [], areas: [], points: [] });
  return fl.get(fid);
};

for (const el of indoor.elements) {
  const t = el.tags || {};
  const c = centerOf(el);
  if (!c) continue;
  // The smallest outline containing it (a passage inside a bigger complex wins).
  const mall = malls.filter((m) => inRings(c.lat, c.lng, m.rings)).sort((a, b) => a.area - b.area)[0];
  if (!mall) continue;
  const fids = floorsOf(t);
  const point = (type, extra = {}) => { for (const f of fids.length ? fids : ['G']) floorOf(mall, f).points.push({ type, lat: round(c.lat), lng: round(c.lng), ...extra }); };

  if (t.entrance) { point('entrance'); continue; }
  if (t.highway === 'elevator' || t.room === 'elevator') { point('elevator'); continue; }
  if (t.conveying && el.geometry?.length >= 2 && fids.length >= 2) {
    // An escalator way spanning two levels: "up" at its lower end, "down" at its upper end.
    const [lo, hi] = [fids[0], fids[fids.length - 1]];
    const a = el.geometry[0], b = el.geometry[el.geometry.length - 1];
    const up = t.conveying !== 'backward';
    floorOf(mall, lo).points.push({ type: 'escalator', dir: 'up', lat: round((up ? a : b).lat), lng: round((up ? a : b).lon) });
    floorOf(mall, hi).points.push({ type: 'escalator', dir: 'down', lat: round((up ? b : a).lat), lng: round((up ? b : a).lon) });
    continue;
  }
  if (t.highway === 'steps' || t.room === 'stairs') { point('stairs'); continue; }
  if (POINT[t.amenity] || t.room === 'toilets' || t.room === 'toilet') { point(POINT[t.amenity] ?? 'wc'); continue; }

  const rings = ringsOf(el);
  if (!rings.length || t.indoor === 'corridor') continue;
  const named = t['name:fa'] || t.name || t.brand;
  const shopLike = t.shop || t.room === 'shop' || t.room === 'retail' || t.amenity || named;
  for (const fid of fids.length ? fids : ['G']) {
    const floor = floorOf(mall, fid);
    if (t.indoor === 'area' && !shopLike) continue; // open floor space: walkable
    if (t.indoor === 'room' && !shopLike) { floor.areas.push({ kind: 'service', ring: rings[0] }); continue; }
    floor.units.push({
      uid: `o${el.type[0]}${el.id}${fids.length > 1 ? `-${fid}` : ''}`, ring: rings[0],
      name: named ? String(named).trim().slice(0, 60) : null,
      category: named || t.shop || t.amenity ? osmCategory(t) : null,
      phone: t.phone || t['contact:phone'] || null, website: t.website || t['contact:website'] || null,
      instagram: t['contact:instagram'] || t.instagram || null,
      hours: t.opening_hours?.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)?.slice(1).map((x) => x.padStart(5, '0')).join(' تا ') ?? null,
    });
  }
}

const out = {};
for (const [id, { mall, floors }] of plans) {
  const list = [...floors.values()].filter((f) => f.units.length);
  const units = list.reduce((a, f) => a + f.units.length, 0);
  if (units < MIN_UNITS) continue;
  out[id] = { mall, plan: { source: 'osm', updated: new Date().toISOString(), floors: [...floors.values()].filter((f) => f.units.length || f.points.length) } };
  console.log(`   ${mall.name}: ${units} units on ${list.map((f) => f.id).join(', ')}`);
}
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', updated: new Date().toISOString(), plans: out }));
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${Object.keys(out).length} malls with real floor plans.`);
