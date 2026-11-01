// Where Tehran buys what: clusters of shops of the same kind (a راسته), found in OpenStreetMap. Most shops in
// Tehran are on shopping streets, not inside malls, and each trade gathers in its own street: phones on
// Jomhouri, lighting on Lalehzar, car parts on Mellat, furniture in Yaftabad. Writes data/hotspots.json.
//
//   npm run hotspots      (needs data/tehran.json and data/metro.json for naming)

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, categoryOfKind, OSM_SHOP_VALUES } from '../public/shared/catalog.js';
import { norm } from '../public/shared/text.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'hotspots.json');
const BBOX = '35.56,51.08,35.84,51.66';
const MIRRORS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const RADIUS = 350; // metres around a cluster's busiest shop
const MIN_SHOPS = 6;
const PER_CATEGORY = 5;

// The names Tehranis use for these streets and bazaars. A cluster takes the first name whose circle holds
// its centre (and whose categories include its own, when given); otherwise it's named after a bazaar it's
// in, its most common street, or the nearest metro station.
const NAMES = [
  { name: 'جمهوری و حافظ (علاءالدین و چارسو)', lat: 35.6950, lng: 51.4110, r: 450 },
  { name: 'خیابان ملت و امیرکبیر', lat: 35.6866, lng: 51.4258, r: 350, cats: ['auto'] },
  { name: 'لاله‌زار', lat: 35.6935, lng: 51.4228, r: 700, cats: ['lighting', 'tools', 'appliance'] },
  { name: 'سعدی و منوچهری', lat: 35.6960, lng: 51.4255, r: 300, cats: ['shoes', 'fashion', 'jewelry', 'home'] },
  { name: 'امین حضور', lat: 35.6841, lng: 51.4367, r: 450 },
  { name: 'بازار بزرگ تهران', lat: 35.6760, lng: 51.4212, r: 650 },
  { name: 'خیابان انقلاب، روبه‌روی دانشگاه تهران', lat: 35.7003, lng: 51.3945, r: 550 },
  { name: 'یافت‌آباد', lat: 35.6622, lng: 51.3481, r: 700 },
  { name: 'منیریه', lat: 35.6800, lng: 51.4015, r: 450 },
  { name: 'حسن‌آباد و خیابان امام خمینی', lat: 35.6858, lng: 51.4110, r: 450 },
  { name: 'ولیعصر، نزدیک مجتمع پایتخت', lat: 35.7060, lng: 51.4052, r: 450, cats: ['computer'] },
  { name: 'تجریش', lat: 35.8050, lng: 51.4310, r: 700 },
];

async function overpass(query) {
  for (const url of MIRRORS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST', body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(240_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'passajh/0.3 (hotspots snapshot)' },
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

const round = (n) => Math.round(n * 1e5) / 1e5;
const dist = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 90400);
const load = async (f) => JSON.parse(await readFile(path.join(ROOT, 'data', f), 'utf8'));

const malls = (await load('tehran.json')).malls;
const stations = (await load('metro.json').catch(() => ({ stations: [] }))).stations;

console.log('Shops by kind…');
const data = await overpass(`[out:json][timeout:220];
nwr["shop"~"^(${OSM_SHOP_VALUES.join('|')})$"](${BBOX});
out tags center;`);

const byCat = new Map();
for (const el of data.elements) {
  const t = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  const cat = categoryOfKind(t.shop);
  if (lat == null || cat === 'other') continue;
  if (!byCat.has(cat)) byCat.set(cat, []);
  byCat.get(cat).push({ lat, lng, name: (t['name:fa'] || t.name || '').trim(), street: (t['addr:street'] || '').trim() });
}

// "خیابان لاله زار شمالی نبش …" → "خیابان لاله زار شمالی"; long free-text addresses aren't street names.
function streetName(s) {
  const m = s.replace(/^تهران[،,\s]*/, '').match(/^(?:(خیابان|خ\.?|بلوار|میدان|بزرگراه)\s+)?(.*)$/);
  const name = m[2].split(/[،,\-/(]/)[0].trim();
  if (name.length < 3 || name.length > 24 || /\d|پلاک|طبقه|کوچه|نبش|بین|street/i.test(name)) return null;
  return `${!m[1] || m[1].startsWith('خ') ? 'خیابان' : m[1]} ${name}`;
}

function nameOf(c, cat) {
  const known = NAMES.find((n) => dist(n, c) <= n.r && (!n.cats || n.cats.includes(cat)));
  if (known) return known.name;
  // A bazaar named after this trade ("بازار مبل …", "سرای خشکبار …").
  const words = CATEGORIES[cat].keywords.map(norm);
  const bazaar = malls.filter((m) => /^(بازار|سرای|تیمچه)/.test(m.name) && dist(m, c) < 300 && words.some((w) => norm(m.name).includes(w)))
    .sort((a, b) => dist(a, c) - dist(b, c))[0];
  if (bazaar) return bazaar.name;
  const streets = {};
  for (const s of c.shops) { const n = streetName(s.street); if (n) streets[n] = (streets[n] || 0) + 1; }
  const top = Object.entries(streets).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 3) return top[0];
  const st = stations.map((s) => [dist(s, c), s]).sort((a, b) => a[0] - b[0])[0];
  return st && st[0] < 1200 ? `نزدیک مترو ${st[1].name}` : null;
}

const hotspots = [];
for (const [cat, shops] of byCat) {
  let left = shops;
  for (let k = 0; k < PER_CATEGORY && left.length >= MIN_SHOPS; k++) {
    // The shop with the most same-kind neighbours is the heart of the cluster.
    let best = null;
    for (const p of left) {
      const n = left.reduce((a, q) => a + (dist(p, q) <= RADIUS ? 1 : 0), 0);
      if (!best || n > best.n) best = { p, n };
    }
    if (best.n < MIN_SHOPS) break;
    const members = left.filter((q) => dist(best.p, q) <= RADIUS);
    left = left.filter((q) => dist(best.p, q) > RADIUS);
    const c = {
      lat: members.reduce((a, q) => a + q.lat, 0) / members.length,
      lng: members.reduce((a, q) => a + q.lng, 0) / members.length,
      shops: members,
    };
    const name = nameOf(c, cat);
    if (!name) continue;
    hotspots.push({
      id: `${cat}-${k + 1}`, category: cat, name, lat: round(c.lat), lng: round(c.lng), count: members.length,
      // Real shop names from the cluster, so people can recognise the place.
      examples: [...new Set(members.map((q) => q.name).filter((n) => n && n.length <= 40))].slice(0, 6),
    });
  }
}
// Neighbouring clusters with the same name are one place (the Grand Bazaar's clothing lanes, say).
const merged = [];
for (const h of hotspots) {
  const same = merged.find((m) => m.category === h.category && m.name === h.name);
  if (!same) { merged.push(h); continue; }
  same.lat = round((same.lat * same.count + h.lat * h.count) / (same.count + h.count));
  same.lng = round((same.lng * same.count + h.lng * h.count) / (same.count + h.count));
  same.count += h.count;
  same.examples = [...new Set([...same.examples, ...h.examples])].slice(0, 6);
}
merged.sort((a, b) => b.count - a.count);

await writeFile(OUT, JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', updated: new Date().toISOString(), shops: data.elements.length, hotspots: merged }));
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${merged.length} hotspots from ${data.elements.length} shops.`);
for (const h of merged) console.log(`  ${h.category.padEnd(10)} ${String(h.count).padStart(3)}  ${h.name}`);
