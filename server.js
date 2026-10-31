// Passajh server: static files, mall/store API, product requests and live notifications (SSE).
// Run with `node server.js`. Stores data in data/db.json, or in Neon Postgres when DATABASE_URL is set.

import http from 'node:http';
import { stat } from 'node:fs/promises';
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildMalls } from './lib/seed.js';
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

const malls = buildMalls();
for (const mall of malls) {
  // A surveyed floor plan in data/layouts/<mallId>.json replaces the generated one.
  const file = path.join(LAYOUTS, `${mall.id}.json`);
  if (existsSync(file)) mall.floors = JSON.parse(readFileSync(file, 'utf8')).floors;
}

const mallById = new Map(malls.map((m) => [m.id, m]));
const storeById = new Map(); // id -> { store, mall, floor }
for (const mall of malls) {
  for (const floor of mall.floors) {
    for (const store of floor.stores) storeById.set(store.id, { store, mall, floor });
  }
}
// Seed discount and product count per store, so seller edits can be re-applied from scratch.
const base = new Map();
for (const { store } of storeById.values()) base.set(store.id, { discount: store.discount, products: store.products.length });

// Seller edits can be made on another server instance, so re-read them from the db every few seconds.
let syncedAt = 0;
async function syncOverrides() {
  if (Date.now() - syncedAt < 3000) return;
  const overrides = await db.overrides();
  syncedAt = Date.now();
  for (const [id, b] of base) {
    const { store } = storeById.get(id);
    const o = overrides[id];
    store.discount = o && 'discount' in o ? o.discount : b.discount;
    store.products.length = b.products;
    if (o?.products) store.products.push(...o.products);
  }
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
function matchStores(q, mallId) {
  const qt = tokens(q);
  const result = new Map();
  for (const ref of storeById.values()) {
    if (mallId && ref.mall.id !== mallId) continue;
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

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
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
      return send(res, 200, { ...ref.store, ...storeSummary(ref) });
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
      if (!isId(body.userId)) return send(res, 400, { error: 'شناسه کاربر نامعتبر است' });
      if (query.length < 2) return send(res, 400, { error: 'نام کالا را وارد کنید' });
      if (!phone) return send(res, 400, { error: 'شماره موبایل معتبر نیست (مثلاً ۰۹۱۲۱۲۳۴۵۶۷)' });
      if (!name) return send(res, 400, { error: 'نام خود را وارد کنید' });
      if (body.consent !== true) return send(res, 400, { error: 'برای ارسال، اجازه اشتراک شماره لازم است' });

      const request = {
        id: randomUUID(), userId: body.userId, name, phone, query,
        details: clean(body.details, 300),
        budget: Math.round(Number(toLatinDigits(body.budget ?? '').replace(/[^\d]/g, ''))) || null,
        mallId, mallName: mallId ? mallById.get(mallId).name : null,
        status: 'open', createdAt: new Date().toISOString(),
        matches: matchStores(query, mallId),
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
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
