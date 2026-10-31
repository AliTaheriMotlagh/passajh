// Shopping helpers: a shopping list with one route through every store it needs, the best mall
// for the list, favorites (stores and products, with price-drop tracking), price comparison
// across malls, and recently viewed stores.

import { $, $$, esc, fa, toman, cat, finalPrice, api, toast, openDrawer, openModal, closeModal, store, persist, vibrate } from './ui.js';
import { CATEGORIES } from '/shared/catalog.js';
import { tokens, matchScore } from '/shared/text.js';
import { geo, distance, fmtDist } from './geo.js';
import { state, go, floorOf } from './state.js';

const rid = () => Math.random().toString(36).slice(2, 10);

// ---------- matching inside the open mall ----------

// Cheapest in-stock product in this mall matching the text, or a store whose category matches.
export function matchInMall(text) {
  const qt = tokens(text);
  let best = null;
  for (const f of state.mall.floors) {
    for (const s of f.stores) {
      for (const p of s.products) {
        if (!p.inStock || matchScore(qt, `${p.name} ${p.tags}`) < 1) continue;
        const price = finalPrice(p, s);
        if (!best || !best.p || price < best.price) best = { s, p, price };
      }
      if (!best && matchScore(qt, `${s.name} ${CATEGORIES[s.category]?.label} ${CATEGORIES[s.category]?.keywords.join(' ')}`) >= 1) best = { s };
    }
  }
  return best;
}

// ---------- shopping list ----------

const getList = () => store('list', []);
const setList = (l) => { persist('list', l); renderListBadge(); };

export function renderListBadge() {
  const n = getList().filter((i) => !i.done).length;
  for (const b of $$('[data-count=list]')) { b.textContent = fa(n); b.classList.toggle('hidden', !n); }
}

export function openList() {
  const el = $('#list-panel');
  const items = getList();
  const inMall = !!state.mall;
  const matches = inMall ? new Map(items.filter((i) => !i.done).map((i) => [i.id, matchInMall(i.text)])) : new Map();
  const stops = new Set([...matches.values()].filter(Boolean).map((m) => m.s.id));
  openDrawer(el, `
    <h2>🛒 لیست خرید</h2>
    <div class="sub">${inMall ? `کالاهای لیست در ${esc(state.mall.name)} پیدا می‌شوند؛ با یک مسیر به همه سر بزنید.` : 'لیست را بنویسید؛ پاساژی که بیشترشان را دارد پیشنهاد می‌شود.'}</div>
    <form id="li-form" class="inline-form">
      <input class="field" name="t" maxlength="60" autocomplete="off" enterkeyhint="done" placeholder="چی لازم داری؟ مثلاً کفش ورزشی">
      <button class="btn primary" type="submit">افزودن</button>
    </form>
    <div class="list-items">
      ${items.length ? '' : '<div class="empty-state">🛍️<br>لیست خالی است</div>'}
      ${items.map((it) => {
        const m = matches.get(it.id);
        return `<div class="li ${it.done ? 'done' : ''}">
          <label class="li-check"><input type="checkbox" data-done="${it.id}" ${it.done ? 'checked' : ''}><span>${esc(it.text)}</span></label>
          ${m ? `<button class="li-where" data-store="${m.s.id}">${cat(m.s.category).icon} ${esc(m.s.name)} · ${esc(floorOf(m.s).name)}${m.p ? ` · ${toman(m.price)}` : ''}</button>`
            : inMall && !it.done ? '<span class="li-where none">در این پاساژ نیست</span>' : ''}
          <button class="icon-btn" data-del="${it.id}" aria-label="حذف">✕</button>
        </div>`;
      }).join('')}
    </div>
    ${inMall && stops.size ? `<button class="btn purple block" id="li-tour">🧭 یک مسیر برای همه (${fa(stops.size)} فروشگاه)</button>` : ''}
    ${items.some((i) => i.done) ? '<button class="btn small" id="li-clear" style="margin-top:10px">پاک کردن خریده‌شده‌ها</button>' : ''}
    ${!inMall && items.some((i) => !i.done) ? '<h3>🏆 بهترین پاساژ برای لیست شما</h3><div id="li-best"><div class="skeleton"></div><div class="skeleton"></div></div>' : ''}`);

  $('#li-form', el).onsubmit = (ev) => {
    ev.preventDefault();
    const t = ev.target.t.value.trim();
    if (!t) return;
    setList([...getList(), { id: rid(), text: t, done: false }]);
    openList();
    setTimeout(() => $('#li-form input', el)?.focus(), 30);
  };
  for (const c of $$('[data-done]', el)) {
    c.onchange = () => { setList(getList().map((i) => (i.id === c.dataset.done ? { ...i, done: c.checked } : i))); if (c.checked) vibrate(30); openList(); };
  }
  for (const b of $$('[data-del]', el)) b.onclick = () => { setList(getList().filter((i) => i.id !== b.dataset.del)); openList(); };
  for (const b of $$('[data-store]', el)) b.onclick = () => go(`#/mall/${state.mall.id}/${b.dataset.store}`);
  const clear = $('#li-clear', el);
  if (clear) clear.onclick = () => { setList(getList().filter((i) => !i.done)); openList(); };
  const tour = $('#li-tour', el);
  if (tour) tour.onclick = () => { el.classList.add('hidden'); startTour(matches); };
  if ($('#li-best', el)) bestMalls(items.filter((i) => !i.done)).then((html) => { const b = $('#li-best', el); if (b) b.innerHTML = html; });
}

// Which malls carry the most of the list (nearest first among equals).
async function bestMalls(items) {
  const hits = new Map(); // mallId -> Set(item ids)
  await Promise.all(items.slice(0, 10).map(async (it) => {
    const res = await api(`/search?q=${encodeURIComponent(it.text)}`).catch(() => []);
    for (const r of res) {
      if (r.score < 1) continue;
      if (!hits.has(r.store.mallId)) hits.set(r.store.mallId, new Set());
      hits.get(r.store.mallId).add(it.id);
    }
  }));
  const n = Math.min(items.length, 10);
  const d = (id) => { const m = state.city?.mall(id); return m && geo.best ? distance(geo.best, m) : Infinity; };
  const ranked = [...hits].sort((a, b) => b[1].size - a[1].size || d(a[0]) - d(b[0])).slice(0, 4);
  if (!ranked.length) return '<div class="sub">هیچ پاساژی این کالاها را ثبت نکرده. از «📣 درخواست کالا» استفاده کنید.</div>';
  return ranked.map(([id, set]) => {
    const m = state.city?.mall(id);
    return `<div class="result" onclick="location.hash='#/mall/${id}'">
      <div class="ico">🏬</div>
      <div class="main"><div class="title">${esc(m?.name ?? id)}</div>
        <div class="sub">${fa(set.size)} از ${fa(n)} کالای لیست${Number.isFinite(d(id)) ? ` · ${fmtDist(d(id))}` : ''}</div></div>
      <div class="meter"><i style="width:${Math.round((set.size / n) * 100)}%"></i></div>
    </div>`;
  }).join('');
}

// Visit every store the list needs in one walk: nearest-next, counting floor changes as distance.
function startTour(matches) {
  const byStore = new Map();
  for (const [itemId, m] of matches) {
    if (!m) continue;
    if (!byStore.has(m.s.id)) byStore.set(m.s.id, { store: m.s, items: [] });
    byStore.get(m.s.id).items.push(itemId);
  }
  const left = [...byStore.values()];
  const e = state.engine;
  let at = { level: e.floor.level, x: e.player.x, y: e.player.y };
  const stops = [];
  while (left.length) {
    const cost = (s) => Math.abs(floorOf(s.store).level - at.level) * 80 + Math.hypot(s.store.entry.x - at.x, s.store.entry.y - at.y);
    left.sort((a, b) => cost(a) - cost(b));
    const next = left.shift();
    stops.push(next);
    at = { level: floorOf(next.store).level, x: next.store.entry.x, y: next.store.entry.y };
  }
  state.tour = { stops, i: 0 };
  e.highlight = new Set(stops.map((s) => s.store.id));
  toast(`🧭 مسیر خرید: ${fa(stops.length)} فروشگاه. اولی: <b>${esc(stops[0].store.name)}</b>`, 'good');
  e.routeToStore(stops[0].store, false);
}

// Called when the player arrives somewhere; advances the shopping route.
export function onTourArrive(wp) {
  const t = state.tour;
  const stop = t?.stops[t.i];
  if (!stop || wp.store?.id !== stop.store.id) return false;
  const names = getList().filter((i) => stop.items.includes(i.id)).map((i) => i.text);
  t.i++;
  const next = t.stops[t.i];
  const el = toast(`✅ ${esc(stop.store.name)}: ${names.map(esc).join('، ')}
    <div class="actions-row" style="margin:6px 0 0"><button class="btn small primary" data-bought>✓ خریدم</button>
    ${next ? `<button class="btn small purple" data-next>بعدی: ${esc(next.store.name)}</button>` : ''}</div>`, 'good', 12000);
  $('[data-bought]', el).onclick = () => {
    setList(getList().map((i) => (stop.items.includes(i.id) ? { ...i, done: true } : i)));
    vibrate(30);
    $('[data-bought]', el).replaceWith('✓');
  };
  if (next) {
    $('[data-next]', el).onclick = () => { el.remove(); state.engine.routeToStore(next.store, true); };
  } else {
    state.tour = null;
    setTimeout(() => toast('🎉 مسیر خرید تمام شد!', 'good'), 600);
  }
  return true;
}

// ---------- favorites ----------

const getFavs = () => store('favs', []);
export const isFav = (key) => getFavs().some((f) => f.key === key);

export function toggleFav(item) {
  const favs = getFavs();
  const on = !favs.some((f) => f.key === item.key);
  persist('favs', on ? [{ ...item, at: Date.now() }, ...favs].slice(0, 100) : favs.filter((f) => f.key !== item.key));
  vibrate(20);
  toast(on ? '❤️ به علاقه‌مندی‌ها اضافه شد' : 'از علاقه‌مندی‌ها حذف شد', on ? 'good' : '', 2000);
  return on;
}

export const storeFav = (s, mall) => ({ key: `s:${s.id}`, type: 'store', id: s.id, mallId: mall.id, name: s.name, mallName: mall.name, category: s.category });
export const productFav = (p, s, mall) => ({
  key: `p:${p.id}`, type: 'product', id: p.id, storeId: s.id, mallId: mall.id,
  name: p.name, storeName: s.name, mallName: mall.name, category: s.category, price: finalPrice(p, s),
});

export async function openFavs() {
  const el = $('#favs-panel');
  const favs = getFavs();
  const render = (prices = new Map()) => {
    openDrawer(el, `
      <h2>❤️ علاقه‌مندی‌ها</h2>
      <div class="sub">کالاهای ذخیره‌شده را زیر نظر داریم؛ اگر ارزان شوند اینجا می‌بینید.</div>
      ${favs.length ? '' : '<div class="empty-state">💜<br>هنوز چیزی ذخیره نکرده‌اید.<br><small>در صفحه هر فروشگاه روی ♡ بزنید.</small></div>'}
      ${favs.map((f) => {
        const now = prices.get(f.id);
        const drop = f.type === 'product' && now && now < f.price;
        return `<div class="result" data-go="${f.mallId}/${f.type === 'store' ? f.id : f.storeId}">
          <div class="ico">${cat(f.category).icon}</div>
          <div class="main"><div class="title">${esc(f.name)} ${drop ? `<span class="chip green">⬇ ${fa(Math.round((1 - now / f.price) * 100))}٪ ارزان‌تر</span>` : ''}</div>
            <div class="sub">${f.type === 'product' ? `${esc(f.storeName)} · ` : ''}${esc(f.mallName)}</div></div>
          ${f.type === 'product' ? `<div class="price">${drop ? `<s class="sub">${toman(f.price)}</s><br>` : ''}${toman(now ?? f.price)}</div>` : ''}
          <button class="icon-btn" data-unfav="${f.key}" aria-label="حذف">✕</button>
        </div>`;
      }).join('')}`);
    for (const r of $$('[data-go]', el)) r.onclick = (ev) => { if (!ev.target.closest('[data-unfav]')) go(`#/mall/${r.dataset.go}`); };
    for (const b of $$('[data-unfav]', el)) b.onclick = () => { persist('favs', getFavs().filter((f) => f.key !== b.dataset.unfav)); openFavs(); };
  };
  render();
  // Price watch: current prices of saved products.
  const products = favs.filter((f) => f.type === 'product').slice(0, 20);
  if (!products.length) return;
  const prices = new Map();
  await Promise.all([...new Set(products.map((f) => f.storeId))].map(async (sid) => {
    const s = await api(`/stores/${sid}`).catch(() => null);
    for (const p of s?.products ?? []) prices.set(p.id, finalPrice(p, s));
  }));
  if (!el.classList.contains('hidden')) render(prices);
}

// ---------- price comparison ----------

export async function compare(p, s) {
  const box = openModal(`<h2>⚖️ مقایسه قیمت</h2><div class="sub">${esc(p.name)}</div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`);
  const res = await api(`/search?q=${encodeURIComponent(p.name)}`).catch(() => []);
  if (!box.isConnected || $('#modal').classList.contains('hidden')) return;
  const same = res.filter((r) => r.product.name === p.name);
  const list = (same.length ? same : res.slice(0, 15)).map((r) => ({ ...r, price: finalPrice(r.product, r.store) })).sort((a, b) => a.price - b.price);
  const min = list[0]?.price, max = list[list.length - 1]?.price;
  const d = (r) => { const m = state.city?.mall(r.store.mallId); return m && geo.best ? distance(geo.best, m) : null; };
  box.innerHTML = `<button class="close-x" data-close>✕</button>
    <h2>⚖️ مقایسه قیمت</h2>
    <div class="sub">${esc(p.name)} در ${fa(list.length)} فروشگاه${min && max > min ? ` · تا <b class="good-text">${toman(max - min)}</b> صرفه‌جویی` : ''}</div>
    ${list.map((r, i) => `<div class="result ${r.store.id === s.id ? 'active' : ''}" data-go="${r.store.mallId}/${r.store.id}">
      <div class="ico">${i === 0 ? '🏆' : cat(r.store.category).icon}</div>
      <div class="main"><div class="title">${esc(r.store.name)} ${r.store.id === s.id ? '<span class="chip green">همین فروشگاه</span>' : ''}</div>
        <div class="sub">${esc(r.store.mallName)} · ${esc(r.store.floorName)}${d(r) != null ? ` · ${fmtDist(d(r))}` : ''}${r.product.inStock ? '' : ' · ناموجود'}</div></div>
      <div class="price">${r.store.discount ? `<s class="sub">${toman(r.product.price)}</s><br>` : ''}${toman(r.price)}</div>
    </div>`).join('')}`;
  for (const r of $$('[data-go]', box)) r.onclick = () => { closeModal(); go(`#/mall/${r.dataset.go}`); };
}

// ---------- recently viewed ----------

export function addRecent(s, mall) {
  const list = store('recent', []).filter((r) => r.id !== s.id);
  persist('recent', [{ id: s.id, mallId: mall.id, name: s.name, mallName: mall.name, category: s.category }, ...list].slice(0, 12));
}

export const getRecent = () => store('recent', []);
