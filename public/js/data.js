// The app's data: every mall (summaries), the shopping streets and counts, loaded once from /api/boot and
// kept on the device, so the app opens instantly and still works offline or on a bad connection.
// Mall details are fetched when opened and the last few are kept for offline use too.

import { api, store, persist } from './ui.js';
import { geo, distance, distTo } from './geo.js';
import { tokens, matchScore } from '/shared/text.js';

export const data = { malls: [], hotspots: [], stats: {}, byId: new Map(), version: 0 };

export const uid = store('uid', null) ?? crypto.randomUUID();
persist('uid', uid);

function use(boot) {
  Object.assign(data, boot);
  data.byId = new Map(boot.malls.map((m) => [m.id, m]));
}

// Show the cached copy right away, then revalidate (a 304 costs a few bytes).
export async function loadBoot(onUpdate) {
  const cached = store('boot', null);
  if (cached?.malls) use(cached);
  const refresh = (async () => {
    const res = await fetch('/api/boot', { headers: cached?.etag ? { 'If-None-Match': cached.etag } : {} });
    if (res.status === 304) return false;
    if (!res.ok) throw new Error('boot');
    const boot = await res.json();
    use(boot);
    persist('boot', { ...boot, etag: res.headers.get('ETag') });
    return true;
  })();
  if (cached?.malls) {
    refresh.then((changed) => changed && onUpdate?.()).catch(() => {});
    return;
  }
  await refresh;
}

const details = new Map();
const RECENT = 15;

export async function loadMall(id, { fresh = false } = {}) {
  if (!fresh && details.has(id)) return details.get(id);
  try {
    const m = await api(`/malls/${encodeURIComponent(id)}`);
    keep(m);
    return m;
  } catch (e) {
    const saved = store(`mall.${id}`, null);
    if (saved) return saved;
    throw e;
  }
}

// After a contribution the server answers with the updated mall.
export function keep(m) {
  details.set(m.id, m);
  if (data.byId.has(m.id)) Object.assign(data.byId.get(m.id), { shops: m.shops.length, cats: m.cats, tags: m.tags, hours: m.hours, hoursBy: m.hoursBy, fri: m.fri, closed: m.closed });
  persist(`mall.${m.id}`, m);
  const recent = [m.id, ...store('recent', []).filter((x) => x !== m.id)];
  for (const old of recent.slice(RECENT)) persist(`mall.${old}`, null);
  persist('recent', recent.slice(0, RECENT));
}

// ---------- queries ----------

export function sortByDistance(list) {
  if (!geo.best) return list;
  return list.map((x) => [distance(geo.best, x), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
}

export const nearestMalls = (n = 6) => (geo.best ? sortByDistance(data.malls.filter((m) => !m.closed)).slice(0, n) : []);

// Malls with shops of a category (mapped or added by people), or that visitors say sell it.
export const mallsWith = (category) => data.malls.filter((m) => (m.cats?.[category] || m.tags?.[category]) && !m.closed);
export const streetsOf = (category) => data.hotspots.filter((h) => h.category === category);

export function mallsNamed(q, limit = 20) {
  const qt = tokens(q);
  if (!qt.length) return [];
  return data.malls
    .map((m) => ({ m, s: matchScore(qt, `${m.name} ${m.nameEn ?? ''} ${m.hood ?? ''}`) }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => (distTo(a.m) ?? 0) - (distTo(b.m) ?? 0))
    .slice(0, limit)
    .map((x) => x.m);
}

// ---------- my things on this device ----------

export const saved = {
  all: () => store('saved', []),
  has: (id) => store('saved', []).includes(id),
  toggle(id) {
    const list = store('saved', []);
    const on = !list.includes(id);
    persist('saved', on ? [id, ...list] : list.filter((x) => x !== id));
    return on;
  },
};

// My votes, so buttons show what I already said.
export const myVotes = {
  get: (key) => store('votes', {})[key],
  set(key, value) {
    const v = store('votes', {});
    if (value == null) delete v[key];
    else v[key] = value;
    persist('votes', v);
  },
};

// Shops I registered as their owner: { shopId: { token, mallId, name } }.
export const myShops = {
  all: () => store('myshops', {}),
  add(shop, mallId, token) {
    const all = store('myshops', {});
    all[shop.id] = { token: token ?? all[shop.id]?.token, mallId, name: shop.name };
    persist('myshops', all);
  },
  remove(id) {
    const all = store('myshops', {});
    delete all[id];
    persist('myshops', all);
  },
};

export const contributions = {
  count: () => store('contrib', 0),
  add: () => persist('contrib', store('contrib', 0) + 1),
};
