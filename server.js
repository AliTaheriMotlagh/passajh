// Passajh server: static files and the API behind "where in Tehran do I go to buy X?".
// Run with `node server.js`. Reads the OpenStreetMap snapshots in data/ (malls and the shops mapped inside
// them, shopping streets, metro stations, real floor plans) and stores what people add (shops, votes,
// floor plans) in data/db.json, or in Neon Postgres when DATABASE_URL is set.

import http from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mergeCurated, discoveredDef, floorsOf } from './lib/malls.js';
import { openDb } from './lib/db.js';
import { CATEGORIES, categoryOfKind } from './public/shared/catalog.js';
import { tokens, matchScore, norm, toLatinDigits } from './public/shared/text.js';
import { floorName, levelOf, FLOOR_ID } from './public/shared/floors.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
// Vercel's filesystem is read-only except /tmp (which is per-instance and not persistent).
const DATA = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/passajh' : path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT) || 4000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const load = (file) => JSON.parse(readFileSync(path.join(ROOT, 'data', file), 'utf8'));
const SNAPSHOT = load('tehran.json');
const OSM_PLANS = load('plans-osm.json').plans;
const STATIONS = load('metro.json').stations;
const HOTSPOTS = load('hotspots.json');

const db = await openDb({ dir: DATA });

// ---------- geometry ----------

const IRAN = { s: 25, w: 44, n: 40, e: 63.5 };
const inIran = (lat, lng) => lat > IRAN.s && lat < IRAN.n && lng > IRAN.w && lng < IRAN.e;
const [bs, bw, bn, be] = SNAPSHOT.bbox.split(',').map(Number);
const inSnapshot = (lat, lng) => lat > bs && lat < bn && lng > bw && lng < be;

function haversine(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

// Metro stations within walking distance of a point, nearest first.
function stationsNear(p, n = 2, max = 1500) {
  return STATIONS.map((s) => ({ name: s.name, lines: s.lines, m: Math.round(haversine(p, s) / 10) * 10 }))
    .filter((s) => s.m <= max).sort((a, b) => a.m - b.m).slice(0, n);
}

const hotspots = HOTSPOTS.hotspots.map((h) => ({ ...h, metro: stationsNear(h, 1)[0] ?? null }));

// ---------- malls and shops ----------

const malls = new Map(); // id -> mall
const shopIndex = new Map(); // shop id -> mall id
const defs = new Map(); // mall id -> the snapshot/discovered definition, for the editor
let version = 1; // bumped on every change, so clients can revalidate the boot data cheaply

// Real floor plans: drawn in the editor (db) win over OpenStreetMap indoor mapping (data/plans-osm.json).
const editorPlans = new Map();
const planFor = (def) => editorPlans.get(def.id) ?? OSM_PLANS[def.id]?.plan ?? OSM_PLANS[def.osmId]?.plan ?? null;

// A shop mapped in OpenStreetMap inside the mall's outline. The category is re-derived from the raw tag.
function osmShop(mallId, s) {
  return {
    id: `${mallId}-${s.osm}`, name: s.name, brand: s.brand || null,
    category: s.kind ? categoryOfKind(s.kind) : 'other', floor: s.floor || null,
    phone: s.phone || null, hours: s.hours || null, website: s.website || null, instagram: s.instagram || null,
    keywords: null, source: 'osm',
  };
}

function addMall(def) {
  if (malls.has(def.id)) return;
  defs.set(def.id, def);
  const mall = {
    id: def.id, name: def.name, nameEn: def.nameEn || null, kind: def.kind ?? 'mall',
    lat: def.lat, lng: def.lng, rings: def.rings ?? [], hood: def.neighbourhood ?? null,
    street: def.street ?? null, address: def.address ?? null, description: def.description ?? null,
    hours: def.hours ?? null, openingHours: def.openingHours ?? null, phone: def.phone ?? null,
    website: def.website ?? null, instagram: def.instagram ?? null, wheelchair: def.wheelchair ?? null,
    levels: def.levels ?? null, curated: !!def.curated, discovered: !!def.discovered,
    food: !!def.food, cinema: !!def.cinema,
    metro: stationsNear(def),
    base: (def.stores ?? []).filter((s) => s.name).map((s) => osmShop(def.id, s)),
    shops: [], tags: {}, reports: {},
  };
  setPlan(mall, planFor(def));
  malls.set(mall.id, mall);
  refresh(mall);
}

function setPlan(mall, plan) {
  mall.plan = plan?.floors?.some((f) => f.units?.length) ? plan : null;
  mall.floors = floorsOf(defs.get(mall.id), mall.plan);
}

// ---------- contributions ----------

const edits = new Map(); // mall id -> Map(shop id -> { mallId, data, tokenHash, at })
const votes = new Map(); // target ("shop:<id>" | "mall:<id>") -> Map(key -> { kind, value, at })
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
// Public id for a device, so the private id (which authorizes votes) never leaks.
const publicId = (userId) => sha(`passajh:${userId}`).slice(0, 16);

// The mall's shops: the mapped ones with their owners' edits, plus the ones people added.
function refresh(mall) {
  const own = edits.get(mall.id) ?? new Map();
  const shops = mall.base.map((b) => (own.has(b.id) ? merge(b, own.get(b.id)) : b));
  for (const [id, e] of own) if (!mall.base.some((b) => b.id === id)) shops.push(merge({ id, source: 'user' }, e));
  mall.shops = shops.filter((s) => !s.removed);
  for (const s of mall.shops) {
    shopIndex.set(s.id, mall.id);
    const v = tally(`shop:${s.id}`);
    s.here = v.here ?? 0;
    s.gone = v.gone ?? 0;
  }

  const t = tally(`mall:${mall.id}`, true);
  mall.tags = Object.fromEntries(Object.entries(t).filter(([k]) => k.startsWith('tag:')).map(([k, n]) => [k.slice(4), n]));
  mall.reports = { closed: t.closed ?? 0, hours: t.hoursTop ?? null, friday: { open: t['fri:open'] ?? 0, closed: t['fri:closed'] ?? 0 } };
}

function merge(base, e) {
  const d = e.data;
  return {
    ...base, ...d, id: base.id, source: e.tokenHash ? 'owner' : base.source,
    at: new Date(e.at).toISOString(),
  };
}

// Counts of the live votes on a target: { here, gone } for a shop; { 'tag:mobile', closed, 'fri:open', hoursTop }
// for a mall.
function tally(target, mall = false) {
  const out = {};
  const hours = {};
  for (const v of votes.get(target)?.values() ?? []) {
    if (v.value == null || v.value === false) continue;
    if (v.kind === 'hours') {
      const key = `${v.value.open} تا ${v.value.close}`;
      if (v.value.open) hours[key] = (hours[key] || 0) + 1;
      if (v.value.friday) out[`fri:${v.value.friday}`] = (out[`fri:${v.value.friday}`] || 0) + 1;
    } else {
      out[v.kind] = (out[v.kind] || 0) + 1;
    }
  }
  if (mall) {
    const top = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
    if (top) out.hoursTop = { text: top[0], count: top[1] };
  }
  return out;
}

// Contributions can be made on another server instance, so re-read changes from the db every few seconds.
let syncedAt = 0, seenAt = 0, discoveredCount = 0, plansAt = 0;
async function sync(force = false) {
  if (!force && Date.now() - syncedAt < 3000) return;
  syncedAt = Date.now();
  const { edits: e, votes: v } = await db.changes(seenAt);
  const touched = new Set();
  for (const x of e) {
    if (!edits.has(x.mallId)) edits.set(x.mallId, new Map());
    if (edits.get(x.mallId).get(x.shopId)?.at === x.at) continue;
    edits.get(x.mallId).set(x.shopId, x);
    touched.add(x.mallId);
    seenAt = Math.max(seenAt, x.at);
  }
  for (const x of v) {
    if (!votes.has(x.target)) votes.set(x.target, new Map());
    if (votes.get(x.target).get(x.key)?.at === x.at) continue;
    votes.get(x.target).set(x.key, x);
    const [type, id] = [x.target.slice(0, 4), x.target.slice(5)];
    touched.add(type === 'mall' ? id : shopIndex.get(id));
    seenAt = Math.max(seenAt, x.at);
  }
  for (const def of await db.discovered(discoveredCount)) {
    discoveredCount++;
    if (!inSnapshot(def.lat, def.lng)) { addMall(def); version++; }
  }
  for (const { mallId, plan, at } of await db.plans(plansAt)) {
    plansAt = Math.max(plansAt, at);
    editorPlans.set(mallId, plan);
    const m = malls.get(mallId);
    if (m) { setPlan(m, plan); version++; }
  }
  for (const id of touched) if (malls.has(id)) refresh(malls.get(id));
  if (touched.size) version++;
}

// Tehran from the snapshot, the curated big malls, and malls elsewhere in Iran with a real floor plan.
for (const { mallId, plan, at } of await db.plans(0)) { editorPlans.set(mallId, plan); plansAt = Math.max(plansAt, at); }
for (const def of mergeCurated(SNAPSHOT.malls)) addMall(def);
for (const { mall } of Object.values(OSM_PLANS)) if (!malls.has(mall.id) && !inSnapshot(mall.lat, mall.lng)) addMall(mall);
await sync(true);
for (const m of malls.values()) refresh(m);

// ---------- what the client sees ----------

// The mall's shops by category (a shop most visitors say is gone doesn't count).
function categoriesOf(m) {
  const c = {};
  for (const s of m.shops) if (s.gone < 2 || s.here >= s.gone) c[s.category] = (c[s.category] || 0) + 1;
  return c;
}

function summary(m) {
  const reported = !m.hours && m.reports.hours?.count >= 1;
  return {
    id: m.id, name: m.name, nameEn: m.nameEn, kind: m.kind, lat: m.lat, lng: m.lng, hood: m.hood,
    hours: m.hours ?? (reported ? m.reports.hours.text : null), hoursBy: m.hours ? 'osm' : reported ? 'users' : null,
    shops: m.shops.length, cats: categoriesOf(m), tags: Object.keys(m.tags).length ? m.tags : undefined, metro: m.metro[0] ?? null,
    curated: m.curated || undefined, plan: !!m.plan || undefined, phone: !!m.phone || undefined,
    closed: m.reports.closed >= 2 || undefined, discovered: m.discovered || undefined,
    fri: m.reports.friday.closed > m.reports.friday.open ? 'closed' : m.reports.friday.open ? 'open' : undefined,
  };
}

function shopOut(s) {
  const { removed, by, ...rest } = s;
  return rest;
}

function details(m) {
  return {
    ...summary(m),
    rings: m.rings, street: m.street, address: m.address, description: m.description,
    phone: m.phone, website: m.website, instagram: m.instagram, openingHours: m.openingHours,
    wheelchair: m.wheelchair, levels: m.levels, food: m.food, cinema: m.cinema,
    floors: m.floors.map((id) => ({ id, name: floorName(id) })),
    metroAll: m.metro, reports: m.reports,
    shops: m.shops.map(shopOut),
    plan: m.plan && { source: m.plan.source ?? 'osm', updated: m.plan.updated ?? null, floors: m.plan.floors },
    streets: hotspots.filter((h) => haversine(h, m) < 450).map(({ id, name, category, count }) => ({ id, name, category, count })),
  };
}

// The data the app needs to start, cached by the browser for offline use.
let bootCache = null;
function boot() {
  if (bootCache?.version === version) return bootCache;
  const list = [...malls.values()].filter((m) => !m.discovered).map(summary);
  const shops = list.reduce((a, m) => a + m.shops, 0);
  const body = JSON.stringify({
    version, malls: list, hotspots,
    stats: {
      malls: list.length, shops, withShops: list.filter((m) => m.shops).length, streetShops: HOTSPOTS.shops,
      stations: STATIONS.length, updated: SNAPSHOT.updated,
    },
  });
  bootCache = { version, etag: `"b${version}-${sha(body).slice(0, 10)}"`, gz: gzipSync(body), body };
  return bootCache;
}

// Shops whose name, brand or "what we sell" matches the query, across every mall.
function searchShops(q, limit = 40) {
  const qt = tokens(q);
  if (!qt.length) return [];
  const out = [];
  for (const m of malls.values()) {
    for (const s of m.shops) {
      // A match on the name ranks above one on "what we sell".
      const score = Math.max(matchScore(qt, `${s.name} ${s.brand ?? ''}`), matchScore(qt, s.keywords ?? '') * 0.95);
      if (score >= 0.95) out.push({ score, shop: { id: s.id, name: s.name, category: s.category, floor: s.floor, mallId: m.id, mallName: m.name, lat: m.lat, lng: m.lng } });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.shop);
}

// ---------- malls anywhere in Iran (OpenStreetMap) ----------

const OVERPASS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  'https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
];
const jobs = new Map(); // in-flight OpenStreetMap lookups, so concurrent callers share one

function once(key, fn) {
  if (!jobs.has(key)) {
    const job = fn();
    job.catch(() => {}).finally(() => jobs.delete(key));
    jobs.set(key, job);
  }
  return jobs.get(key);
}

// Overpass is often unreachable from inside Iran, so the server asks on the browser's behalf.
async function overpass(q) {
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST', body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'passajh/0.3' },
      });
      if (res.ok) return await res.json();
    } catch { /* try the next mirror */ }
  }
  throw Object.assign(new Error('OpenStreetMap در دسترس نیست، کمی بعد دوباره تلاش کنید'), { status: 503 });
}

// Outline rings ([lat, lng]) and center of an OSM element, thinned to at most ~120 points per ring.
function shape(el) {
  const ways = el.type === 'way' ? [el.geometry] : el.type === 'relation'
    ? (el.members || []).filter((x) => x.role !== 'inner' && x.geometry).map((x) => x.geometry) : [];
  const rings = ways.filter((g) => g?.length >= 3).slice(0, 4).map((g) => {
    const step = Math.ceil(g.length / 120);
    return g.filter((_, i) => i % step === 0).map((q) => [+q.lat.toFixed(6), +q.lon.toFixed(6)]);
  });
  const pts = rings.flat();
  const lat = pts.length ? pts.reduce((a, q) => a + q[0], 0) / pts.length : el.lat ?? el.center?.lat;
  const lng = pts.length ? pts.reduce((a, q) => a + q[1], 0) / pts.length : el.lon ?? el.center?.lon;
  return { rings, lat, lng };
}

// Register the shopping malls in the 3×3 block of 0.1° tiles (≈ 30 km) around a point.
// Each tile is fetched from OpenStreetMap once, ever; later calls read the db.
function discoverAround(lat, lng) {
  if (inSnapshot(lat, lng)) return Promise.resolve();
  const ty = Math.floor(lat * 10), tx = Math.floor(lng * 10);
  return once(`tiles:${ty}:${tx}`, async () => {
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push(`${ty + dy}:${tx + dx}`);
    if (!(await db.missingTiles(tiles)).length) return sync(true);
    const bbox = `${(ty - 1) / 10},${(tx - 1) / 10},${(ty + 2) / 10},${(tx + 2) / 10}`;
    const data = await overpass(`[out:json][timeout:25];(
      nwr["shop"="mall"]["name"](${bbox});
      nwr["amenity"="marketplace"]["name"]["building"](${bbox});
    );out geom;`);
    const found = [];
    for (const el of data.elements || []) {
      const t = el.tags || {};
      const name = (t['name:fa'] || t.name || '').trim().slice(0, 80);
      if (!name) continue;
      const { rings, lat: clat, lng: clng } = shape(el);
      if (!inIran(clat, clng) || inSnapshot(clat, clng)) continue;
      found.push(discoveredDef({
        id: `osm-${el.type[0]}${el.id}`, name, nameEn: t['name:en'], lat: clat, lng: clng, rings,
        levels: t['building:levels'], city: t['addr:city'], phone: t.phone || t['contact:phone'],
        hours: t.opening_hours?.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)?.slice(1).join(' تا '),
      }));
    }
    await db.addDiscovered(found, tiles);
    return sync(true);
  });
}

// ---------- http helpers ----------

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'X-Frame-Options': 'SAMEORIGIN',
};

// Per-IP budget for writes, so one client can't flood the map with fake shops or votes.
const hits = new Map();
function rateLimited(req, limit = 30) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > 60_000) { hits.set(ip, { start: now, n: 1 }); return false; }
  if (hits.size > 10_000) hits.clear();
  return ++h.n > limit;
}

const acceptsGzip = (req) => /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');

// JSON responses are gzipped when large: mobile data in Iran is slow and expensive.
function send(res, status, body) {
  let data = JSON.stringify(body);
  const headers = { ...SECURITY, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
  if (data.length > 2048 && acceptsGzip(res.req)) {
    data = gzipSync(data);
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(status, headers);
  res.end(data);
}

async function readBody(req, max = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isId = (s) => typeof s === 'string' && /^[\w-]{6,64}$/.test(s);
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const time = (t) => (/^([01]?\d|2[0-4]):[0-5]\d$/.test(toLatinDigits(t ?? '').trim()) ? toLatinDigits(t).trim().padStart(5, '0') : null);

// The editable fields of a shop, validated. Returns { error } or { shop }.
function shopFields(body) {
  const name = clean(body.name, 50);
  const category = CATEGORIES[body.category] ? body.category : null;
  const phone = clean(toLatinDigits(body.phone).replace(/[^\d+]/g, ''), 14);
  const floor = FLOOR_ID.test(body.floor ?? '') ? body.floor : null;
  const [open, close] = [time(body.open), time(body.close)];
  if (name.length < 2) return { error: 'نام مغازه را بنویسید' };
  if (!category) return { error: 'دسته مغازه را انتخاب کنید' };
  if (phone && !/^(\+98|0)\d{9,11}$/.test(phone)) return { error: 'شماره تلفن معتبر نیست (مثلاً ۰۲۱۳۳۱۱۲۲۳۳ یا ۰۹۱۲۱۲۳۴۵۶۷)' };
  return {
    shop: {
      name, category, floor, phone: phone || null,
      hours: open && close ? `${open} تا ${close}` : null,
      instagram: clean(body.instagram, 40).replace(/^@/, '').replace(/[^\w.]/g, '') || null,
      keywords: clean(body.keywords, 200) || null,
    },
  };
}

// ---------- floor plans from the editor ----------

// Saving a plan needs this key when it's set (EDITOR_KEY env var); without it anyone could redraw a mall.
const EDITOR_KEY = process.env.EDITOR_KEY || '';
const POINTS = new Set(['entrance', 'elevator', 'stairs', 'escalator', 'wc', 'prayer', 'atm', 'info', 'foodcourt', 'kids', 'firstaid', 'fireexit']);

// Keep only well-formed geometry near the mall, with bounded sizes.
function cleanPlan(body, mall) {
  if (!Array.isArray(body?.floors) || !body.floors.length || body.floors.length > 20) return null;
  const near = (lat, lng) => Math.abs(lat - mall.lat) < 0.03 && Math.abs(lng - mall.lng) < 0.03;
  const ring = (r) => (Array.isArray(r) && r.length >= 3 && r.length <= 400
    && r.every((p) => Array.isArray(p) && num(p[0], -90, 90) != null && num(p[1], -180, 180) != null && near(p[0], p[1]))
    ? r.map(([lat, lng]) => [Math.round(lat * 1e7) / 1e7, Math.round(lng * 1e7) / 1e7]) : null);
  const floors = [];
  for (const f of body.floors) {
    if (!FLOOR_ID.test(f?.id) || floors.some((x) => x.id === f.id)) return null;
    const units = (f.units ?? []).slice(0, 3000).map((u) => {
      const r = ring(u?.ring);
      if (!r || !/^[\w-]{1,40}$/.test(u.uid ?? '')) return null;
      const category = CATEGORIES[u.category] ? u.category : null;
      return {
        uid: u.uid, ring: r, name: clean(u.name, 60) || null, category,
        phone: clean(u.phone, 20) || null, hours: clean(u.hours, 30) || null,
      };
    }).filter(Boolean);
    const areas = (f.areas ?? []).slice(0, 500).map((a) => {
      const r = ring(a?.ring);
      return r && ['void', 'service', 'seating'].includes(a.kind) ? { kind: a.kind, ring: r } : null;
    }).filter(Boolean);
    const points = (f.points ?? []).slice(0, 1000).map((p) => (POINTS.has(p?.type) && num(p.lat, -90, 90) != null && num(p.lng, -180, 180) != null && near(p.lat, p.lng)
      ? { type: p.type, lat: p.lat, lng: p.lng, ...(p.type === 'escalator' ? { dir: p.dir === 'down' ? 'down' : 'up' } : {}) } : null)).filter(Boolean);
    floors.push({ id: f.id, name: clean(f.name, 30) || undefined, units, areas, points });
  }
  return { source: 'editor', updated: new Date().toISOString(), floors };
}

// ---------- routes ----------

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const q = url.searchParams;
  const method = req.method;
  if (method === 'POST' && rateLimited(req, parts[0] === 'plans' ? 10 : 30)) {
    return send(res, 429, { error: 'درخواست‌ها زیاد است؛ یک دقیقه دیگر تلاش کنید' });
  }
  await sync();

  // Everything the app needs to start: every mall, the shopping streets, and counts. Revalidated with an
  // ETag, so a returning visitor downloads it again only after something changed.
  if (method === 'GET' && parts[0] === 'boot') {
    const b = boot();
    const headers = { ...SECURITY, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', ETag: b.etag, Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === b.etag) { res.writeHead(304, headers); return res.end(); }
    if (acceptsGzip(req)) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    return res.end(acceptsGzip(req) ? b.gz : b.body);
  }
  if (method === 'GET' && parts[0] === 'malls' && parts.length === 1) {
    return send(res, 200, [...malls.values()].map(summary));
  }
  if (method === 'GET' && parts[0] === 'malls' && parts.length === 2) {
    const m = malls.get(parts[1]);
    return m ? send(res, 200, details(m)) : send(res, 404, { error: 'این مکان پیدا نشد' });
  }
  if (method === 'GET' && parts[0] === 'search') {
    return send(res, 200, { shops: searchShops(q.get('q') || '') });
  }
  // Malls around a point anywhere in Iran, fetched from OpenStreetMap once per area.
  if (method === 'GET' && parts[0] === 'discover') {
    const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
    if (!inIran(lat, lng)) return send(res, 400, { error: 'این نقطه داخل ایران نیست' });
    let partial = false;
    await discoverAround(lat, lng).catch(() => { partial = true; });
    const near = [...malls.values()].filter((m) => m.discovered && Math.abs(m.lat - lat) < 0.2 && Math.abs(m.lng - lng) < 0.2);
    return send(res, 200, { malls: near.map(summary), partial });
  }

  // Someone adds a shop they saw (or their own shop) to a mall.
  if (method === 'POST' && parts[0] === 'malls' && parts[2] === 'shops') {
    const m = malls.get(parts[1]);
    if (!m) return send(res, 404, { error: 'این مکان پیدا نشد' });
    const body = await readBody(req);
    if (!isId(body.userId)) return send(res, 400, { error: 'شناسه دستگاه نامعتبر است' });
    const { shop, error } = shopFields(body);
    if (error) return send(res, 400, { error });
    if (m.shops.some((s) => norm(s.name) === norm(shop.name))) return send(res, 409, { error: 'مغازه‌ای با این نام در این پاساژ ثبت شده است' });
    const owner = body.owner === true;
    const token = owner ? randomBytes(9).toString('base64url') : null;
    const id = `${m.id}-u${randomUUID().slice(0, 8)}`;
    await db.setEdit(id, m.id, { ...shop, seen: body.here === true, by: publicId(body.userId) }, token && sha(token));
    await sync(true);
    return send(res, 201, { shop: shopOut(m.shops.find((s) => s.id === id)), token });
  }

  // A shop's owner registers (claims) it or updates it. The first claim returns a management code; later
  // edits need it. There are no accounts, so an unclaimed shop can be claimed by whoever asks first.
  if (method === 'POST' && parts[0] === 'shops' && parts.length === 2) {
    const m = malls.get(shopIndex.get(parts[1]));
    const s = m?.shops.find((x) => x.id === parts[1]);
    if (!s) return send(res, 404, { error: 'مغازه پیدا نشد' });
    const body = await readBody(req);
    const prev = await db.getEdit(s.id);
    let token = null;
    if (prev?.tokenHash) {
      if (sha(clean(body.token, 40)) !== prev.tokenHash) return send(res, 403, { error: 'کد مدیریت مغازه درست نیست' });
    } else {
      token = randomBytes(9).toString('base64url');
    }
    // Only a registered owner can take their shop off the map; everyone else votes "gone".
    if (body.remove === true) {
      if (!prev?.tokenHash) return send(res, 403, { error: 'اول مغازه را به نام خودتان ثبت کنید' });
      await db.setEdit(s.id, m.id, { ...prev.data, removed: true }, prev.tokenHash);
      await sync(true);
      return send(res, 200, { removed: true });
    }
    const { shop, error } = shopFields(body);
    if (error) return send(res, 400, { error });
    if (m.shops.some((x) => x.id !== s.id && norm(x.name) === norm(shop.name))) return send(res, 409, { error: 'مغازه دیگری با این نام در این پاساژ هست' });
    await db.setEdit(s.id, m.id, { ...shop, hours: shop.hours ?? s.hours ?? null }, prev?.tokenHash ?? sha(token));
    await sync(true);
    return send(res, 200, { shop: shopOut(m.shops.find((x) => x.id === s.id)), token });
  }

  // "Still here" / "gone" on a shop.
  if (method === 'POST' && parts[0] === 'shops' && parts[2] === 'vote') {
    const mallId = shopIndex.get(parts[1]);
    const body = await readBody(req);
    if (!mallId || !isId(body.userId)) return send(res, 400, { error: 'درخواست نامعتبر' });
    const user = publicId(body.userId);
    for (const kind of ['here', 'gone']) {
      await db.setVote(`shop:${parts[1]}|${kind}|${user}`, `shop:${parts[1]}`, kind, user, body.vote === kind || null);
    }
    await sync(true);
    const s = malls.get(mallId).shops.find((x) => x.id === parts[1]);
    return send(res, 200, { here: s?.here ?? 0, gone: s?.gone ?? 0 });
  }

  // What a mall sells, its real opening hours, or that it has closed down.
  if (method === 'POST' && parts[0] === 'malls' && parts[2] === 'vote') {
    const m = malls.get(parts[1]);
    const body = await readBody(req);
    if (!m || !isId(body.userId)) return send(res, 400, { error: 'درخواست نامعتبر' });
    const user = publicId(body.userId);
    const target = `mall:${m.id}`;
    if (body.kind === 'tag' && CATEGORIES[body.category]) {
      await db.setVote(`${target}|tag:${body.category}|${user}`, target, `tag:${body.category}`, user, body.on !== false || null);
    } else if (body.kind === 'hours') {
      const [open, close] = [time(body.open), time(body.close)];
      const friday = ['open', 'closed'].includes(body.friday) ? body.friday : null;
      if (!(open && close) && !friday) return send(res, 400, { error: 'ساعت باز و بسته شدن را وارد کنید' });
      await db.setVote(`${target}|hours|${user}`, target, 'hours', user, { open, close, friday });
    } else if (body.kind === 'closed') {
      await db.setVote(`${target}|closed|${user}`, target, 'closed', user, body.on !== false || null);
    } else {
      return send(res, 400, { error: 'درخواست نامعتبر' });
    }
    await sync(true);
    return send(res, 200, details(m));
  }

  // Floor plan editor: the mall's outline, its current plan and the shops OpenStreetMap knows inside it.
  if (parts[0] === 'plans' && malls.has(parts[1])) {
    const m = malls.get(parts[1]);
    const def = defs.get(m.id);
    if (method === 'GET') {
      const plan = editorPlans.get(m.id) ?? OSM_PLANS[m.id]?.plan ?? OSM_PLANS[def?.osmId]?.plan ?? null;
      return send(res, 200, {
        mall: { id: m.id, name: m.name, lat: m.lat, lng: m.lng, rings: m.rings, floors: m.floors.map((id) => ({ id, name: floorName(id), level: levelOf(id) })) },
        plan, source: editorPlans.has(m.id) ? 'editor' : plan ? 'osm' : null,
        shops: (def?.stores ?? []).map(({ name, kind, floor, lat, lng }) => ({ name, category: kind ? categoryOfKind(kind) : 'other', floor, lat, lng })),
      });
    }
    if (method === 'POST') {
      if (EDITOR_KEY && req.headers['x-editor-key'] !== EDITOR_KEY) return send(res, 403, { error: 'کلید ویرایشگر درست نیست' });
      const plan = cleanPlan(await readBody(req, 2 * 1024 * 1024), m);
      if (!plan) return send(res, 400, { error: 'نقشه نامعتبر است' });
      await db.setPlan(m.id, plan);
      editorPlans.set(m.id, plan);
      setPlan(m, plan);
      version++;
      return send(res, 200, { ...summary(m), mapped: plan.floors.filter((f) => f.units.length).length });
    }
  }

  send(res, 404, { error: 'Not found' });
}

// Static files. Text files are gzipped once and kept in memory; /vendor and /fonts never change at a
// given path, so the browser may keep them for a year.
const gzCache = new Map();
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/seller') rel = '/seller.html';
  if (rel === '/editor') rel = '/editor.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const ext = path.extname(file);
    const immutable = /^\/(vendor|fonts)\//.test(rel);
    const headers = {
      ...SECURITY, 'Content-Type': MIME[ext] || 'application/octet-stream', Vary: 'Accept-Encoding',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Last-Modified': st.mtime.toUTCString(),
    };
    if (!immutable && req.headers['if-modified-since'] === headers['Last-Modified']) { res.writeHead(304, headers); return res.end(); }
    let body = gzCache.get(file);
    if (!body || body.mtime !== st.mtimeMs) {
      const raw = await readFile(file);
      body = { mtime: st.mtimeMs, raw, gz: /text|javascript|json|svg|manifest/.test(headers['Content-Type']) ? gzipSync(raw) : null };
      gzCache.set(file, body);
    }
    if (body.gz && acceptsGzip(req)) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      return res.end(body.gz);
    }
    res.writeHead(200, headers);
    res.end(body.raw);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'خطای سرور' });
  }
});

server.listen(PORT, () => {
  const shops = [...malls.values()].reduce((a, m) => a + m.shops.length, 0);
  console.log(`Passajh running → http://localhost:${PORT}  (${malls.size} malls, ${shops} shops, ${hotspots.length} shopping streets, ${STATIONS.length} metro stations)`);
  console.log(`Shop owners → http://localhost:${PORT}/seller · floor plan editor → http://localhost:${PORT}/editor`);
});
