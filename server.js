// Passajh server: static files, mall/store API, product requests and live notifications (SSE).
// Run with `node server.js`. Stores data in data/db.json, or in Neon Postgres when DATABASE_URL is set.

import http from 'node:http';
import { stat } from 'node:fs/promises';
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildMalls, buildMall, discoveredDef, MALL_DEFS } from './lib/seed.js';
import { openDb } from './lib/db.js';
import { CATEGORIES } from './public/shared/catalog.js';
import { tokens, matchScore, toLatinDigits } from './public/shared/text.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const LAYOUTS = path.join(ROOT, 'data', 'layouts');
// Vercel's filesystem is read-only except /tmp (which is per-instance and not persistent).
const DATA = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/passajh' : path.join(ROOT, 'data'));
const PORT = Number(process.env.PORT) || 4000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// ---------- data ----------

const db = await openDb({ dir: DATA });

const malls = [];
const mallById = new Map();
const storeById = new Map(); // id -> { store, mall, floor }
// Seed discount and product count per store, so seller edits can be re-applied from scratch.
const base = new Map();

function register(mall) {
  if (mallById.has(mall.id)) return;
  // A surveyed floor plan in data/layouts/<mallId>.json replaces the generated one.
  const file = path.join(LAYOUTS, `${mall.id}.json`);
  if (existsSync(file)) mall.floors = JSON.parse(readFileSync(file, 'utf8')).floors;
  malls.push(mall);
  mallById.set(mall.id, mall);
  for (const floor of mall.floors) {
    for (const store of floor.stores) {
      storeById.set(store.id, { store, mall, floor });
      base.set(store.id, { discount: store.discount, products: store.products.length });
    }
  }
}
for (const mall of buildMalls()) register(mall);

// Malls found on OpenStreetMap (by any instance) are kept in the db and rebuilt here.
let discoveredCount = 0;
async function syncDiscovered() {
  const defs = await db.discovered(discoveredCount);
  discoveredCount += defs.length;
  for (const def of defs) register(buildMall(def));
  return defs.length;
}
await syncDiscovered();

// Seller edits can be made on another server instance, so re-read them from the db every few seconds.
let syncedAt = 0;
async function syncOverrides() {
  if (Date.now() - syncedAt < 3000) return;
  syncedAt = Date.now();
  await syncDiscovered();
  const overrides = await db.overrides();
  for (const [id, b] of base) {
    const { store } = storeById.get(id);
    const o = overrides[id];
    store.discount = o && 'discount' in o ? o.discount : b.discount;
    store.products.length = b.products;
    if (o?.products) store.products.push(...o.products);
  }
}

// ---------- malls anywhere in Iran (OpenStreetMap) ----------

const OVERPASS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const IRAN = { s: 25, w: 44, n: 40, e: 63.5 };
const inIran = (lat, lng) => lat > IRAN.s && lat < IRAN.n && lng > IRAN.w && lng < IRAN.e;
const SEEDED = MALL_DEFS.map((d) => ({ ...d, re: new RegExp(d.osm, 'i') }));
const jobs = new Map(); // in-flight OpenStreetMap lookups, so concurrent callers share one

function once(key, fn) {
  if (!jobs.has(key)) {
    const job = fn();
    job.catch(() => {}).finally(() => jobs.delete(key));
    jobs.set(key, job);
  }
  return jobs.get(key);
}

function haversine(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

// Overpass is often unreachable from inside Iran, so the server asks on the browser's behalf.
async function overpass(q) {
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST', body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'passajh/0.2' },
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
  const ty = Math.floor(lat * 10), tx = Math.floor(lng * 10);
  return once(`tiles:${ty}:${tx}`, async () => {
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push(`${ty + dy}:${tx + dx}`);
    if (!(await db.missingTiles(tiles)).length) return syncDiscovered();
    const bbox = `${(ty - 1) / 10},${(tx - 1) / 10},${(ty + 2) / 10},${(tx + 2) / 10}`;
    const data = await overpass(`[out:json][timeout:25];(
      nwr["shop"="mall"]["name"](${bbox});
      nwr["amenity"="marketplace"]["name"]["building"](${bbox});
    );out geom;`);
    const defs = [];
    for (const el of data.elements || []) {
      const t = el.tags || {};
      const name = (t['name:fa'] || t.name || '').trim().slice(0, 80);
      if (!name) continue;
      const { rings, lat: clat, lng: clng } = shape(el);
      if (!inIran(clat, clng)) continue;
      // Skip the hand-made Tehran malls; they already have curated data.
      if (SEEDED.some((d) => d.re.test(name) && haversine(d, { lat: clat, lng: clng }) < 3000)) continue;
      defs.push(discoveredDef({
        id: `osm-${el.type[0]}${el.id}`, name, nameEn: t['name:en'], lat: clat, lng: clng, rings,
        levels: t['building:levels'], city: t['addr:city'],
      }));
    }
    await db.addDiscovered(defs, tiles);
    return syncDiscovered();
  });
}

// Real building outline of a curated mall, matched by name near its approximate center.
async function footprintOf(mall) {
  const cached = await db.footprint(mall.id);
  if (cached) return cached;
  return once(`fp:${mall.id}`, async () => {
    const names = (mall.osm || `${mall.name}|${mall.nameEn}`).replace(/"/g, '');
    const around = `around:2500,${mall.lat},${mall.lng}`;
    const data = await overpass(`[out:json][timeout:25];(
      nwr(${around})["shop"="mall"]["name"~"${names}",i];
      nwr(${around})["shop"="mall"]["name:en"~"${names}",i];
      nwr(${around})["name"~"${names}",i]["building"~"retail|commercial|yes"];
      nwr(${around})["amenity"="marketplace"]["name"~"${names}",i];
    );out geom 8;`);
    let best = null;
    for (const el of data.elements || []) {
      const sh = shape(el);
      if (sh.lat == null) continue;
      const d = haversine(sh, mall) + (sh.rings.length ? 0 : 200);
      if (d < 8000 && (!best || d < best.d)) best = { d, ...sh };
    }
    const fp = best ? { lat: best.lat, lng: best.lng, rings: best.rings } : { none: true };
    await db.setFootprint(mall.id, fp);
    return fp;
  });
}

function storeHaystack(store) {
  const cat = CATEGORIES[store.category];
  return `${store.name} ${cat.label} ${cat.keywords.join(' ')}`;
}

function storeSummary({ store, mall, floor }) {
  return {
    id: store.id, name: store.name, category: store.category, phone: store.phone,
    discount: store.discount, rating: store.rating,
    floorId: floor.id, floorName: floor.name, mallId: mall.id, mallName: mall.name,
  };
}

function mallSummary(m) {
  let stores = 0, discounts = 0, products = 0;
  const categories = {};
  for (const f of m.floors) {
    for (const s of f.stores) {
      stores++;
      products += s.products.length;
      if (s.discount) discounts++;
      categories[s.category] = (categories[s.category] || 0) + 1;
    }
  }
  return {
    id: m.id, name: m.name, nameEn: m.nameEn, lat: m.lat, lng: m.lng, osm: m.osm,
    rings: m.rings, discovered: !!m.discovered,
    address: m.address, description: m.description, hours: m.hours,
    floors: m.floors.map((f) => ({ id: f.id, name: f.name, type: f.type })),
    stores, discounts, products, categories,
  };
}

// Search products across stores. Returns best matches first.
function searchProducts(q, { mallId, limit = 40, threshold = 1 } = {}) {
  const qt = tokens(q);
  if (!qt.length) return [];
  const out = [];
  for (const ref of storeById.values()) {
    if (mallId && ref.mall.id !== mallId) continue;
    const storeScore = matchScore(qt, storeHaystack(ref.store));
    for (const p of ref.store.products) {
      const score = Math.max(matchScore(qt, `${p.name} ${p.tags}`), storeScore * 0.9);
      if (score >= threshold) out.push({ score, product: p, store: storeSummary(ref) });
    }
  }
  out.sort((a, b) => b.score - a.score || a.product.price - b.product.price);
  return out.slice(0, limit);
}

// Stores that should be notified about a request: those holding a matching product
// (or whose category matches the query).
function matchStores(q, mallIds) {
  const qt = tokens(q);
  const result = new Map();
  for (const ref of storeById.values()) {
    if (mallIds && !mallIds.has(ref.mall.id)) continue;
    let best = matchScore(qt, storeHaystack(ref.store)) >= 1 ? 0.9 : 0;
    const products = [];
    for (const p of ref.store.products) {
      const s = matchScore(qt, `${p.name} ${p.tags}`);
      if (s >= 0.5) products.push(p.id);
      best = Math.max(best, s);
    }
    if (best >= 0.5) result.set(ref.store.id, { storeId: ref.store.id, score: best, products });
  }
  return [...result.values()].sort((a, b) => b.score - a.score).slice(0, 60);
}

// ---------- live events (SSE) ----------
// Events are rows in the db ("user:<id>" | "store:<id>" | "all" channels). Each stream polls for new
// rows, so an event published on one serverless instance reaches clients connected to another.
// On Vercel a stream ends before the function time limit; EventSource reconnects with Last-Event-ID.

const STREAM_MS = process.env.VERCEL ? 50_000 : Infinity;

async function stream(req, res, channels) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  let open = true;
  res.on('close', () => { open = false; });
  let last = Number(req.headers['last-event-id']) || await db.lastEventId();
  const end = Date.now() + STREAM_MS;
  let pingAt = Date.now() + 25000;
  while (open && Date.now() < end) {
    for (const e of await db.events(channels, last)) {
      res.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      last = e.id;
    }
    if (Date.now() > pingAt) {
      res.write(': ping\n\n');
      pingAt = Date.now() + 25000;
    }
    await sleep(db.pollMs);
  }
  res.end();
}

// ---------- http helpers ----------

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
  'X-Frame-Options': 'SAMEORIGIN',
};

// Per-IP budget for writes (requests, offers, presence), so one client can't spam stores.
const hits = new Map();
function rateLimited(req, limit = 60) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > 60_000) { hits.set(ip, { start: now, n: 1 }); return false; }
  if (hits.size > 10_000) hits.clear();
  return ++h.n > limit;
}

function send(res, status, body) {
  res.writeHead(status, { ...SECURITY, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const isId = (s) => typeof s === 'string' && /^[\w-]{6,64}$/.test(s);
const isGroup = (s) => typeof s === 'string' && /^[A-Z0-9]{6}$/.test(s);
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
// Public id for a member of a friends group, so the private user id (which authorizes requests) never leaks.
const publicId = (userId) => createHash('sha256').update(`passajh:${userId}`).digest('hex').slice(0, 16);
const PRESENCE_MS = 2 * 60 * 1000;

// A point the user chose to share, rounded to about 100 m.
function roughPoint(p) {
  const lat = num(p?.lat, IRAN.s, IRAN.n), lng = num(p?.lng, IRAN.w, IRAN.e);
  return lat && lng ? { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 } : null;
}

function normalizePhone(p) {
  const d = toLatinDigits(p).replace(/[\s-]/g, '');
  const m = d.match(/^(?:\+98|0098|0)?(9\d{9})$/);
  return m ? `0${m[1]}` : null;
}

async function withOffers(list) {
  const offers = await db.offers(list.map((r) => r.id));
  return list.map((r) => ({ ...r, offers: offers.filter((o) => o.requestId === r.id) }));
}

// ---------- routes ----------

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const q = url.searchParams;
  const method = req.method;
  if (method === 'POST' && rateLimited(req, parts[0] === 'presence' ? 120 : 30)) {
    return send(res, 429, { error: 'درخواست‌ها زیاد است؛ یک دقیقه دیگر تلاش کنید' });
  }

  if (method === 'GET' && parts[0] === 'events') {
    const user = q.get('user');
    const store = q.get('store');
    const key = isId(user) ? `user:${user}` : storeById.has(store) ? `store:${store}` : null;
    if (!key) return send(res, 400, { error: 'کانال نامعتبر' });
    return stream(req, res, [key, 'all']);
  }

  await syncOverrides();

  if (method === 'GET' && parts[0] === 'malls' && parts.length === 1) {
    return send(res, 200, malls.map(mallSummary));
  }
  // Malls around a point anywhere in Iran, fetched from OpenStreetMap once per area.
  if (method === 'GET' && parts[0] === 'discover') {
    const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
    if (!inIran(lat, lng)) return send(res, 400, { error: 'این نقطه داخل ایران نیست' });
    let partial = false;
    await discoverAround(lat, lng).catch(() => { partial = true; });
    const near = malls.filter((m) => m.discovered && Math.abs(m.lat - lat) < 0.2 && Math.abs(m.lng - lng) < 0.2);
    return send(res, 200, { malls: near.map(mallSummary), partial });
  }
  if (method === 'GET' && parts[0] === 'footprint' && mallById.has(parts[1])) {
    const m = mallById.get(parts[1]);
    if (m.discovered) return send(res, 200, { lat: m.lat, lng: m.lng, rings: m.rings });
    return send(res, 200, await footprintOf(m));
  }
  // Friends group: members who turned on location sharing.
  if (parts[0] === 'presence' && method === 'POST') {
    const body = await readBody(req);
    if (!isId(body.userId) || !isGroup(body.group)) return send(res, 400, { error: 'گروه نامعتبر است' });
    if (body.sharing === false) {
      await db.setPresence(body.userId, body.group, null);
      return send(res, 200, { ok: true });
    }
    const lat = num(body.lat, IRAN.s, IRAN.n), lng = num(body.lng, IRAN.w, IRAN.e);
    const mall = mallById.get(body.mallId);
    const floor = mall?.floors.find((f) => f.id === body.floor);
    await db.setPresence(body.userId, body.group, {
      id: publicId(body.userId), name: clean(body.name, 30) || 'دوست', emoji: clean(body.emoji, 4) || '🙂',
      lat, lng, accuracy: num(body.accuracy, 0, 5000),
      mallId: mall?.id ?? null, mallName: mall?.name ?? null,
      floor: floor?.id ?? null, floorName: floor?.name ?? null,
      x: floor ? num(body.x, 0, floor.w) : null, y: floor ? num(body.y, 0, floor.h) : null,
    });
    return send(res, 200, { ok: true, id: publicId(body.userId) });
  }
  if (parts[0] === 'groups' && method === 'GET' && isGroup(parts[1])) {
    return send(res, 200, await db.groupPresence(parts[1], PRESENCE_MS));
  }
  if (method === 'GET' && parts[0] === 'malls' && parts.length === 2) {
    const m = mallById.get(parts[1]);
    return m ? send(res, 200, m) : send(res, 404, { error: 'پاساژ پیدا نشد' });
  }
  if (method === 'GET' && parts[0] === 'search') {
    const mallId = q.get('mall') || undefined;
    let results = searchProducts(q.get('q') || '', { mallId });
    if (!results.length) results = searchProducts(q.get('q') || '', { mallId, threshold: 0.5 });
    return send(res, 200, results);
  }

  if (parts[0] === 'stores' && parts[1]) {
    const ref = storeById.get(parts[1]);
    if (!ref) return send(res, 404, { error: 'فروشگاه پیدا نشد' });
    const sid = ref.store.id;

    if (method === 'GET' && parts.length === 2) {
      return send(res, 200, { ...ref.store, ...storeSummary(ref), mallLat: ref.mall.lat, mallLng: ref.mall.lng });
    }
    if (method === 'GET' && parts[2] === 'requests') {
      const list = await db.storeRequests(sid);
      const offers = await db.offers(list.map((r) => r.id));
      return send(res, 200, list.map(({ userId, matches, ...r }) => ({
        ...r,
        myProducts: matches.find((m) => m.storeId === sid).products
          .map((pid) => ref.store.products.find((p) => p.id === pid)).filter(Boolean),
        myOffers: offers.filter((o) => o.requestId === r.id && o.storeId === sid),
      })));
    }
    if (method === 'POST' && parts[2] === 'discount') {
      const body = await readBody(req);
      const percent = Math.round(Number(body.percent));
      ref.store.discount = percent > 0 && percent <= 90
        ? { percent, title: clean(body.title, 40) || 'تخفیف ویژه' }
        : null;
      await db.setDiscount(sid, ref.store.discount);
      await db.publish([{
        channel: 'all', event: 'discount',
        data: { mallId: ref.mall.id, storeId: sid, storeName: ref.store.name, discount: ref.store.discount },
      }]);
      return send(res, 200, ref.store);
    }
    if (method === 'POST' && parts[2] === 'products') {
      const body = await readBody(req);
      const name = clean(body.name, 60);
      const price = Math.round(Number(toLatinDigits(body.price).replace(/[^\d]/g, '')));
      if (!name || !(price > 0)) return send(res, 400, { error: 'نام و قیمت کالا لازم است' });
      const product = { id: `${sid}-x${Date.now().toString(36)}`, name, price, tags: clean(body.tags, 120), inStock: true };
      ref.store.products.push(product);
      await db.addProduct(sid, product);
      return send(res, 201, product);
    }
  }

  if (parts[0] === 'requests') {
    if (method === 'GET' && parts.length === 1) {
      const user = q.get('user');
      if (!isId(user)) return send(res, 400, { error: 'شناسه کاربر نامعتبر است' });
      return send(res, 200, await withOffers(await db.userRequests(user)));
    }
    if (method === 'POST' && parts.length === 1) {
      const body = await readBody(req);
      const query = clean(body.query, 100);
      const phone = normalizePhone(body.phone);
      const name = clean(body.name, 40);
      const mallId = body.mallId && mallById.has(body.mallId) ? body.mallId : null;
      // "Near me": the client sends the malls within the chosen radius (it knows their corrected positions).
      const nearIds = Array.isArray(body.mallIds) ? body.mallIds.filter((id) => mallById.has(id)).slice(0, 80) : null;
      const scope = mallId ? new Set([mallId]) : nearIds?.length ? new Set(nearIds) : null;
      if (!isId(body.userId)) return send(res, 400, { error: 'شناسه کاربر نامعتبر است' });
      if (query.length < 2) return send(res, 400, { error: 'نام کالا را وارد کنید' });
      if (!phone) return send(res, 400, { error: 'شماره موبایل معتبر نیست (مثلاً ۰۹۱۲۱۲۳۴۵۶۷)' });
      if (!name) return send(res, 400, { error: 'نام خود را وارد کنید' });
      if (body.consent !== true) return send(res, 400, { error: 'برای ارسال، اجازه اشتراک شماره لازم است' });

      const request = {
        id: randomUUID(), userId: body.userId, name, phone, query,
        details: clean(body.details, 300),
        budget: Math.round(Number(toLatinDigits(body.budget ?? '').replace(/[^\d]/g, ''))) || null,
        mallId, mallName: mallId ? mallById.get(mallId).name : nearIds?.length ? `${nearIds.length} پاساژ نزدیک` : null,
        location: body.shareLocation === true ? roughPoint(body.location) : null,
        status: 'open', createdAt: new Date().toISOString(),
        matches: matchStores(query, scope),
      };
      await db.addRequest(request);
      const { matches, userId, ...publicReq } = request;
      await db.publish(matches.map((m) => {
        const store = storeById.get(m.storeId).store;
        return {
          channel: `store:${m.storeId}`, event: 'request',
          data: {
            ...publicReq,
            myProducts: m.products.map((pid) => store.products.find((p) => p.id === pid)).filter(Boolean),
            myOffers: [],
          },
        };
      }));
      return send(res, 201, {
        ...request,
        offers: [],
        stores: matches.map((m) => storeSummary(storeById.get(m.storeId))),
      });
    }

    const r = await db.getRequest(parts[1]);
    if (!r) return send(res, 404, { error: 'درخواست پیدا نشد' });

    if (method === 'POST' && parts[2] === 'offers') {
      const body = await readBody(req);
      const ref = storeById.get(body.storeId);
      if (!ref || !r.matches.some((m) => m.storeId === ref.store.id)) {
        return send(res, 403, { error: 'این درخواست برای این فروشگاه نیست' });
      }
      if (r.status !== 'open') return send(res, 409, { error: 'این درخواست بسته شده است' });
      const offer = {
        id: randomUUID(), requestId: r.id, storeId: ref.store.id,
        price: Math.round(Number(toLatinDigits(body.price ?? '').replace(/[^\d]/g, ''))) || null,
        message: clean(body.message, 300),
        store: storeSummary(ref), createdAt: new Date().toISOString(),
      };
      await db.addOffer(offer);
      await db.publish([{ channel: `user:${r.userId}`, event: 'offer', data: { ...offer, query: r.query } }]);
      return send(res, 201, offer);
    }
    if (method === 'POST' && parts[2] === 'close') {
      const body = await readBody(req);
      if (body.userId !== r.userId) return send(res, 403, { error: 'اجازه ندارید' });
      await db.closeRequest(r.id);
      r.status = 'closed';
      await db.publish(r.matches.map((m) => ({ channel: `store:${m.storeId}`, event: 'closed', data: { id: r.id } })));
      return send(res, 200, (await withOffers([r]))[0]);
    }
  }

  send(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/seller') rel = '/seller.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { ...SECURITY, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
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
  const stores = storeById.size;
  console.log(`Passajh running → http://localhost:${PORT}  (${malls.length} malls, ${stores} stores)`);
  console.log(`Seller dashboard → http://localhost:${PORT}/seller`);
});
