// App shell: routing between city and mall views, HUD, panels, real-location sync inside malls,
// product requests, live offers, and the hub (shopping list, favorites, friends, parking, install).

import { $, $$, esc, fa, toman, cat, finalPrice, api, toast, openModal, closeModal, openDrawer, timeAgo, debounce, store, persist, openStatus, vibrate } from './ui.js';
import { CityView } from './city.js';
import { MallEngine } from './mall.js';
import { geo, distance, fmtDist, mallFrame } from './geo.js';
import { state, uid, go, findStore, floorOf } from './state.js';
import { openParking, onSpotClick, restoreParking, renderParkChip } from './parking.js';
import { openList, renderListBadge, onTourArrive, openFavs, isFav, toggleFav, storeFav, productFav, compare, addRecent, getRecent } from './shopping.js';
import { openFriends, joinGroup, goToFriend, start as startFriends, group } from './friends.js';
import { CATEGORIES, AMENITIES } from '/shared/catalog.js';
import { tokens, matchScore } from '/shared/text.js';

// ---------- city ----------

const city = (state.city = new CityView({
  onEnter: (id) => go(`#/mall/${id}`),
  onResult: (r) => go(`#/mall/${r.store.mallId}/${r.store.id}`),
}));
city.onParking = () => openParking();
city.onFriend = (f) => {
  const box = openModal(`<h2>${esc(f.emoji)} ${esc(f.name)}</h2>
    <div class="sub">${f.mallName ? `در ${esc(f.mallName)} · ${esc(f.floorName ?? '')}` : 'روی نقشه شهر'} · ${timeAgo(new Date(f.at))}</div>
    <div class="actions-row"><button class="btn primary" id="fr-go">${f.mallName ? '🏬 برو پیشش' : '🧭 مسیریابی پیاده'}</button></div>`);
  $('#fr-go', box).onclick = () => { closeModal(); goToFriend(f); };
};

// ---------- routing ----------

async function route() {
  const [, view, id, storeId] = location.hash.split('/');
  closeModal();
  if (view === 'join' && id) {
    joinGroup(id);
    history.replaceState(null, '', '#/');
    route();
    openFriends();
    return;
  }
  if (view === 'mall' && id) {
    await enterMall(id, storeId);
  } else {
    state.engine?.stop();
    state.mall = null;
    state.frame = null;
    state.tour = null;
    $('#mall-view').classList.add('hidden');
    $('#city-view').classList.remove('hidden');
    for (const d of $$('.drawer')) d.classList.add('hidden');
    city.invalidate();
    city.renderPark?.();
  }
}

// ---------- mall view ----------

async function enterMall(id, storeId) {
  if (state.mall?.id !== id) {
    let mall;
    try {
      mall = await api(`/malls/${id}`);
    } catch (e) {
      toast(esc(e.message));
      return go('#/');
    }
    state.mall = mall;
    state.tour = null;
    $('#city-view').classList.add('hidden');
    $('#mall-view').classList.remove('hidden');
    for (const d of $$('.drawer')) d.classList.add('hidden');
    if (!state.engine) state.engine = new MallEngine($('#mall-canvas'), $('#radar'), engineHooks);
    state.engine.resize();
    const coupons = new Set(store(`coupons.${id}`, []));
    await document.fonts?.ready;
    state.engine.load(mall, coupons);
    state.engine.friends = state.friends.filter((f) => f.mallId === id);
    restoreParking();
    $('#mall-title').innerHTML = `${esc(mall.name)}<small>${esc((mall.nameEn || '').toUpperCase())}</small>`;
    renderFloors();
    renderMoney();
    renderQuickBar();
    const st = openStatus(mall.hours);
    help(`به <b>${esc(mall.name)}</b> خوش آمدید! 👋${st && !st.open ? ` <span class="closed">(${st.text})</span>` : ''}<br>با جوی‌استیک یا لمس راهرو راه بروید. از کنار مغازه‌های <b>٪</b>دار رد شوید تا کوپن بگیرید.`);
    setupFrame(id);
  }
  if (storeId) {
    const s = findStore(storeId);
    if (s) {
      state.engine.routeToStore(s);
      openStore(s);
    }
  }
}

// ---------- real location inside the mall ----------

let gpsFollow = false;

// Map this mall's indoor grid onto its real building outline, then place the user if they're there.
function setupFrame(id) {
  state.frame = null;
  gpsFollow = false;
  const sum = city.mall(id) ?? state.mall;
  const ready = () => {
    if (state.mall?.id !== id) return;
    const g = state.engine.ground;
    state.frame = mallFrame(sum, g.w, g.h);
    state.engine.north = sum.rings?.length ? state.frame.north : null;
    applyGps(true);
  };
  if (city.mall(id)) city.footprint(sum).catch(() => {}).finally(ready);
  else ready();
}

function applyGps(first = false) {
  const e = state.engine, fr = state.frame, p = geo.pos;
  if (!e || !fr || !p) {
    if (e) e.gps = null;
    return renderGpsTool();
  }
  const g = fr.toGrid(p.lat, p.lng);
  const f = e.ground;
  const outside = Math.max(-g.x, g.x - f.w, -g.y, g.y - f.h, 0) * fr.cellMeters; // meters from the building
  if (outside > 400) {
    e.gps = null;
    gpsFollow = false;
    if (first) help(`📍 شما الان ${fmtDist(distance(p, city.mall(state.mall.id) ?? state.mall))} از این پاساژ فاصله دارید. وقتی برسید، موقعیت واقعی‌تان روی نقشه می‌آید.`);
    return renderGpsTool();
  }
  e.gps = { x: g.x, y: g.y, r: p.accuracy / fr.cellMeters };
  if (first) {
    if (outside < 1) {
      e.moveTo(g.x, g.y);
      gpsFollow = true;
      help('📡 <b>موقعیت واقعی شما</b> روی نقشه است و با راه رفتنتان جابه‌جا می‌شود.<br>طبقه را GPS نمی‌داند؛ از دکمه‌های طبقه یا پله برقی استفاده کنید.', 9000);
    } else {
      const s = e.entranceNear(g.x, g.y);
      if (s) e.moveTo(s.x, s.y, s.floor);
      help(`📍 ${fmtDist(outside)} تا ساختمان؛ از <b>نزدیک‌ترین ورودی</b> به شما شروع کردیم.`);
    }
    renderFloors();
  } else if (gpsFollow && !e.auto && !e.player.moving && outside < 30) {
    if (Math.hypot(g.x - e.player.x, g.y - e.player.y) > Math.max(2.5, e.gps.r / 4)) e.moveTo(g.x, g.y);
  }
  renderGpsTool();
}

function renderGpsTool() {
  const b = $('#btn-gps');
  b.classList.toggle('on', !!state.engine?.gps);
  b.classList.toggle('follow', gpsFollow);
  b.title = !geo.active ? 'موقعیت واقعی من' : gpsFollow ? 'دنبال کردن GPS خاموش شود' : 'من را روی موقعیت واقعی‌ام ببر';
}

async function gpsTool() {
  if (!geo.active) {
    try { await geo.start(); } catch (e) { return toast(esc(e.message), '', 8000); }
    return applyGps(true);
  }
  const e = state.engine;
  if (!e.gps) return toast(state.frame ? 'موقعیت شما بیرون از این پاساژ است' : 'نقشه ساختمان هنوز آماده نیست');
  gpsFollow = !gpsFollow;
  if (gpsFollow) { e.clearWaypoint(); e.moveTo(e.gps.x, e.gps.y); renderFloors(); }
  toast(gpsFollow ? '📡 نقشه با موقعیت واقعی شما حرکت می‌کند' : 'دنبال کردن GPS خاموش شد', '', 2200);
  renderGpsTool();
}

geo.addEventListener('position', () => { if (state.mall) applyGps(); });

// ---------- engine hooks & HUD ----------

const engineHooks = {
  onStoreClick: (s) => openStore(s),
  onStoreEnter: (s) => {
    toast(`${cat(s.category).icon} وارد <b>${esc(s.name)}</b> شدید`, '', 2200);
    openStore(s);
  },
  onSpotClick,
  onDiscount: (s) => {
    persist(`coupons.${state.mall.id}`, [...state.engine.collected]);
    toast(`🏷️ <b>${fa(s.discount.percent)}٪ تخفیف</b> در ${esc(s.name)} — ${esc(s.discount.title)}<br><small>کوپن به کیف شما اضافه شد</small>`, 'deal', 4500);
    renderMoney();
    vibrate([40, 40, 40]);
    beep();
  },
  onFloorChange: (f, via) => {
    const fade = $('#fade');
    fade.textContent = `${{ escalator: 'پله برقی', stairs: 'پله', elevator: 'آسانسور', gps: '📡' }[via] ?? ''} ← ${f.name}`;
    fade.classList.add('on');
    setTimeout(() => fade.classList.remove('on'), 450);
    renderFloors();
  },
  onElevator: () => floorModal('elevator'),
  onStairs: () => floorModal('stairs'),
  onArrive: (wp) => {
    vibrate(80);
    renderFloors();
    if (onTourArrive(wp)) return;
    toast(`📍 رسیدید: <b>${esc(wp.label)}</b>`, 'good');
    if (wp.store) openStore(wp.store);
  },
  onLocation: ({ floor, store: s, inside }) => {
    $('#location-text').innerHTML = `${s ? `${inside ? '' : 'نزدیک '}${esc(s.name)}` : floor.type === 'parking' ? 'پارکینگ' : 'راهرو'}
      <small>${esc(floor.name)} · ${esc(state.mall.name)}</small>`;
  },
  onRoute: (info) => {
    const el = $('#route-hint');
    if (!info) { el.classList.add('hidden'); renderFloors(); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<span class="step">🧭 ${esc(info.step)}</span><span class="m">${fa(info.meters)} متر</span>
      <button class="btn small purple" id="route-go">🚶 برو</button><button class="btn small icon" id="route-clear" aria-label="لغو">✕</button>`;
    $('#route-go').onclick = () => { gpsFollow = false; renderGpsTool(); state.engine.auto = true; state.engine.cam.follow = true; };
    $('#route-clear').onclick = () => { state.engine.clearWaypoint(); state.engine.highlight.clear(); state.tour = null; };
    renderFloors();
  },
};

function renderFloors() {
  const e = state.engine;
  const wpFloor = e.waypoint?.floor;
  const car = e.car?.floor;
  $('#floor-picker').innerHTML = `<div class="lbl">طبقات</div>` + state.mall.floors.map((f) => `
    <button data-floor="${f.id}" title="${esc(f.name)}" class="${f.id === e.viewFloor ? 'view' : ''} ${f.id === e.player.floor ? 'here' : ''} ${f.id === wpFloor ? 'target' : ''}">
      ${f.type === 'parking' ? 'P' + fa(-f.level) : f.level === 0 ? 'G' : fa(f.level)}${f.id === car ? '<i class="car-dot">🚗</i>' : ''}
      ${e.friends.some((fr) => fr.floor === f.id) ? '<i class="friend-dot"></i>' : ''}
    </button>`).join('');
  for (const b of $$('#floor-picker button')) {
    b.onclick = () => { e.setViewFloor(b.dataset.floor); renderFloors(); };
  }
}

function renderMoney() {
  const e = state.engine;
  let saving = 0;
  for (const id of e.collected) {
    const s = findStore(id);
    if (!s?.discount) continue;
    const avg = s.products.reduce((a, p) => a + p.price, 0) / s.products.length;
    saving += (avg * s.discount.percent) / 100;
  }
  $('#hud-money').innerHTML = `${toman(saving).replace(' تومان', '')} <span style="font-size:14px">ت</span>
    <small>🎟️ ${fa(e.collected.size)} کوپن تخفیف</small>`;
}

// One-tap routes to the nearest restroom, prayer room, ATM, food court, exit…
const QUICK = ['wc', 'prayer', 'atm', 'foodcourt', 'entrance', 'elevator', 'kids', 'firstaid', 'info'];
function renderQuickBar() {
  const have = new Set(state.mall.floors.flatMap((f) => f.amenities.map((a) => a.type)));
  const bar = $('#quick-bar');
  bar.innerHTML = QUICK.filter((t) => have.has(t)).map((t) => `<button class="qchip" data-amenity="${t}">${AMENITIES[t].icon} ${t === 'entrance' ? 'خروجی' : AMENITIES[t].label}</button>`).join('');
  for (const b of $$('[data-amenity]', bar)) {
    b.onclick = () => {
      const e = state.engine;
      const r = e.nearestAmenity(b.dataset.amenity);
      if (!r) return toast('پیدا نشد');
      const label = b.textContent.trim();
      e.setWaypoint({ floor: r.floor, x: r.x, y: r.y, label }, false);
      vibrate(20);
    };
  }
}

let helpTimer;
function help(html, ms = 7000) {
  const el = $('#help-box');
  el.innerHTML = html;
  el.classList.remove('hidden');
  clearTimeout(helpTimer);
  helpTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function floorModal(kind) {
  const e = state.engine;
  const cur = e.floor;
  let floors = state.mall.floors;
  if (kind === 'stairs') floors = floors.filter((f) => Math.abs(f.level - cur.level) === 1);
  e.paused = true;
  const box = openModal(`
    <h2>${kind === 'elevator' ? '🛗 آسانسور' : '🪜 پله'}</h2>
    <div class="sub">الان در ${esc(cur.name)} هستید. کدام طبقه؟</div>
    <div class="elevator-grid">${floors.map((f) => `<button data-f="${f.id}" class="${f.id === cur.id ? 'current' : ''}">${esc(f.name)}${f.id === e.car?.floor ? ' 🚗' : ''}</button>`).join('')}</div>`);
  for (const b of $$('button[data-f]', box)) {
    b.onclick = () => { closeModal(); e.changeFloor(b.dataset.f, kind); };
  }
  const obs = new MutationObserver(() => {
    if ($('#modal').classList.contains('hidden')) { e.paused = false; obs.disconnect(); }
  });
  obs.observe($('#modal'), { attributes: true });
}

// ---------- store panel ----------

function openStore(s) {
  const c = cat(s.category);
  const f = floorOf(s);
  const st = openStatus(s.hours);
  addRecent(s, state.mall);
  const el = openDrawer($('#store-panel'), `
    <div class="store-head">
      <div class="store-ico" style="background:${c.color}">${c.icon}</div>
      <div class="grow"><h2>${esc(s.name)}</h2><div class="sub">${c.label} · ${esc(f.name)} · ⭐ ${fa(s.rating)}</div></div>
      <button class="icon-btn fav ${isFav(`s:${s.id}`) ? 'on' : ''}" id="sp-fav" aria-label="علاقه‌مندی">${isFav(`s:${s.id}`) ? '♥' : '♡'}</button>
    </div>
    ${s.discount ? `<div class="discount-banner"><span>🏷️ ${esc(s.discount.title)}<br><small>روی همه کالاها</small></span><span class="pct">${fa(s.discount.percent)}٪</span></div>` : ''}
    <div class="sub">🕘 ${esc(s.hours)}${st ? ` · <b class="${st.open ? 'open' : 'closed'}">${st.text}</b>` : ''} · ☎️ <span dir="ltr">${fa(s.phone)}</span></div>
    <div class="actions-row">
      <button class="btn purple" id="sp-route">🧭 مسیریابی</button>
      <button class="btn primary" id="sp-go">🚶 برو اونجا</button>
      <a class="btn" href="tel:${esc(s.phone.replace(/-/g, ''))}">📞 تماس</a>
      <button class="btn icon" id="sp-share" aria-label="اشتراک">📤</button>
    </div>
    <h3>محصولات (${fa(s.products.length)})</h3>
    ${s.products.map((p) => `
      <div class="product ${p.inStock ? '' : 'out'}">
        <div class="grow"><div class="n">${esc(p.name)}</div><div class="t">${p.inStock ? 'موجود' : 'ناموجود'}</div></div>
        <div class="p">${s.discount ? `<span class="old">${toman(p.price)}</span>` : ''}<span class="new">${toman(finalPrice(p, s))}</span></div>
        <div class="product-actions">
          <button class="icon-btn" data-compare="${p.id}" aria-label="مقایسه قیمت" title="مقایسه قیمت در همه پاساژها">⚖️</button>
          <button class="icon-btn fav ${isFav(`p:${p.id}`) ? 'on' : ''}" data-pfav="${p.id}" aria-label="ذخیره">${isFav(`p:${p.id}`) ? '♥' : '♡'}</button>
        </div>
      </div>`).join('')}
    <h3>کالای مورد نظرت نیست؟</h3>
    <button class="btn block" data-action="request">📣 درخواست کالا از همه فروشنده‌ها</button>`);
  $('#sp-route', el).onclick = () => state.engine.routeToStore(s, false);
  $('#sp-go', el).onclick = () => { gpsFollow = false; state.engine.routeToStore(s, true); };
  $('#sp-fav', el).onclick = (ev) => { const on = toggleFav(storeFav(s, state.mall)); ev.currentTarget.classList.toggle('on', on); ev.currentTarget.textContent = on ? '♥' : '♡'; };
  $('#sp-share', el).onclick = () => shareLink(`${s.name} — ${state.mall.name}`, `${location.origin}/#/mall/${state.mall.id}/${s.id}`);
  for (const b of $$('[data-compare]', el)) b.onclick = () => compare(s.products.find((p) => p.id === b.dataset.compare), s);
  for (const b of $$('[data-pfav]', el)) {
    b.onclick = () => {
      const on = toggleFav(productFav(s.products.find((p) => p.id === b.dataset.pfav), s, state.mall));
      b.classList.toggle('on', on);
      b.textContent = on ? '♥' : '♡';
    };
  }
}

async function shareLink(title, url) {
  try {
    if (navigator.share) return await navigator.share({ title, url });
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('🔗 لینک کپی شد', 'good'); } catch { toast(`<span dir="ltr">${esc(url)}</span>`, '', 8000); }
}

// ---------- legend & discounts ----------

function openLegend() {
  const e = state.engine;
  const counts = {};
  for (const f of state.mall.floors) for (const s of f.stores) counts[s.category] = (counts[s.category] || 0) + 1;
  const keys = Object.keys(CATEGORIES).filter((k) => counts[k]);
  const render = () => {
    const el = openDrawer($('#legend'), `
      <h2>🗺️ راهنمای نقشه</h2>
      <div class="sub">روی دسته‌ها بزنید تا روی نقشه فیلتر شوند.</div>
      <h3>دسته‌بندی فروشگاه‌ها</h3>
      ${keys.map((k) => `<div class="legend-item ${e.filter && !e.filter.has(k) ? 'off' : ''}" data-k="${k}">
        <span class="swatch" style="background:${CATEGORIES[k].color}">${CATEGORIES[k].icon}</span>${CATEGORIES[k].label}<span class="count">${fa(counts[k])}</span></div>`).join('')}
      ${e.filter ? '<button class="btn small" id="lg-all">نمایش همه</button>' : ''}
      <h3>امکانات</h3>
      ${Object.values(AMENITIES).map((a) => `<div class="legend-item"><span class="swatch amenity">${a.icon}</span>${a.label}</div>`).join('')}
      <div class="legend-item"><span class="swatch" style="background:#2fd27a"></span>پله برقی رو به بالا</div>
      <div class="legend-item"><span class="swatch" style="background:#ff9f43"></span>پله برقی رو به پایین</div>
      <div class="legend-item"><span class="swatch" style="background:#05080c;border:1px solid #8fb3d9"></span>نورگیر (آتریوم)</div>
      <div class="legend-item"><span class="swatch" style="background:#ff3b5c">٪</span>تخفیف فعال</div>
      <div class="legend-item"><span class="swatch" style="background:#c04cff"></span>مسیر GPS</div>
      <div class="legend-item"><span class="swatch" style="background:#3b8fd9;border-radius:50%"></span>موقعیت واقعی شما (GPS)</div>
      <div class="legend-item"><span class="swatch" style="background:#7a2fd0;border-radius:50%">🙂</span>دوستان شما</div>`);
    for (const it of $$('.legend-item[data-k]', el)) {
      it.onclick = () => {
        const k = it.dataset.k;
        if (!e.filter) e.filter = new Set([k]);
        else if (e.filter.has(k)) { e.filter.delete(k); if (!e.filter.size) e.filter = null; }
        else e.filter.add(k);
        render();
      };
    }
    const all = $('#lg-all', el);
    if (all) all.onclick = () => { e.filter = null; render(); };
  };
  render();
}

function openDiscounts() {
  const list = [];
  for (const f of state.mall.floors) for (const s of f.stores) if (s.discount) list.push(s);
  list.sort((a, b) => b.discount.percent - a.discount.percent);
  const got = state.engine.collected;
  const el = openDrawer($('#discounts-panel'), `
    <h2>🏷️ تخفیف‌های ${esc(state.mall.name)}</h2>
    <div class="sub">${fa(list.length)} فروشگاه تخفیف دارند · ${fa(got.size)} کوپن جمع کرده‌اید</div>
    <h3>بیشترین تخفیف</h3>
    ${list.map((s) => `<div class="result" data-id="${s.id}">
      <div class="ico">${cat(s.category).icon}</div>
      <div class="main"><div class="title">${esc(s.name)} ${got.has(s.id) ? '✅' : ''}</div><div class="sub">${esc(s.discount.title)} · ${esc(floorOf(s).name)}</div></div>
      <div class="price deal-text">${fa(s.discount.percent)}٪</div></div>`).join('')}`);
  for (const r of $$('.result', el)) r.onclick = () => { const s = findStore(r.dataset.id); state.engine.routeToStore(s); openStore(s); };
}

// ---------- in-mall search ----------

function bindMallSearch() {
  const input = $('#mall-search');
  const box = $('#mall-results');
  const run = debounce(() => {
    const q = input.value.trim();
    if (!state.mall || q.length < 2) return box.classList.add('hidden');
    const qt = tokens(q);
    const hits = [];
    for (const f of state.mall.floors) {
      for (const s of f.stores) {
        const ss = matchScore(qt, `${s.name} ${cat(s.category).label} ${CATEGORIES[s.category]?.keywords.join(' ')}`);
        if (ss >= 1) hits.push({ s, f, score: 1.1 });
        for (const p of s.products) {
          const ps = matchScore(qt, `${p.name} ${p.tags}`);
          if (ps >= 1) hits.push({ s, f, p, score: ps });
        }
      }
    }
    hits.sort((a, b) => b.score - a.score || (a.p && b.p ? finalPrice(a.p, a.s) - finalPrice(b.p, b.s) : 0));
    const top = hits.slice(0, 40);
    state.engine.highlight = new Set(top.map((h) => h.s.id));
    box.classList.remove('hidden');
    box.innerHTML = (top.length ? top.map((h, i) => `
      <div class="result" data-i="${i}">
        <div class="ico">${cat(h.s.category).icon}</div>
        <div class="main"><div class="title">${esc(h.p ? h.p.name : h.s.name)} ${h.s.discount ? `<span class="chip">${fa(h.s.discount.percent)}٪</span>` : ''}</div>
          <div class="sub">${h.p ? esc(h.s.name) + ' · ' : ''}${esc(h.f.name)}</div></div>
        ${h.p ? `<div class="price">${toman(finalPrice(h.p, h.s))}</div>` : ''}
      </div>`).join('') : '<div class="empty">در این پاساژ پیدا نشد.</div>')
      + `<div class="empty"><button class="btn small primary" data-action="request" data-q="${esc(q)}">📣 به فروشنده‌های «${esc(q)}» خبر بده تا با شما تماس بگیرند</button></div>`;
    for (const r of $$('.result', box)) {
      r.onclick = () => {
        const h = top[r.dataset.i];
        box.classList.add('hidden');
        input.blur();
        state.engine.routeToStore(h.s);
        openStore(h.s);
      };
    }
  }, 200);
  input.addEventListener('input', run);
  input.addEventListener('focus', run);
  document.addEventListener('click', (e) => { if (!e.target.closest('#mall-view .search')) box.classList.add('hidden'); });
}

// ---------- product request ----------

function openRequest(prefill = '') {
  const me = store('profile', {});
  const near = geo.best;
  const box = openModal(`
    <h2>📣 درخواست کالا</h2>
    <div class="sub">بگویید چه می‌خواهید؛ همه فروشگاه‌هایی که این کالا را دارند خبردار می‌شوند و با شما تماس می‌گیرند یا پیشنهاد قیمت می‌فرستند.</div>
    <form id="req-form">
      <label>چه کالایی می‌خواهید؟</label>
      <input class="field" name="query" required maxlength="100" enterkeyhint="next" placeholder="مثلاً آیفون ۱۶ پرو، کفش ورزشی سایز ۴۲" value="${esc(prefill)}">
      <label>توضیحات (رنگ، سایز، مدل…)</label>
      <textarea name="details" rows="2" maxlength="300"></textarea>
      <label>حداکثر بودجه (تومان، اختیاری)</label>
      <input class="field" name="budget" inputmode="numeric" autocomplete="off" enterkeyhint="next" placeholder="مثلاً ۵۰۰۰۰۰۰۰">
      <label>کجا جستجو شود؟</label>
      <div class="radio-row">
        ${state.mall ? `<label><input type="radio" name="scope" value="mall" checked> فقط ${esc(state.mall.name)}</label>` : ''}
        <label><input type="radio" name="scope" value="near" ${!state.mall && near ? 'checked' : ''}> نزدیک من
          <select name="radius" aria-label="شعاع"><option value="3000">۳ کیلومتر</option><option value="5000" selected>۵ کیلومتر</option><option value="10000">۱۰ کیلومتر</option><option value="25000">۲۵ کیلومتر</option></select></label>
        <label><input type="radio" name="scope" value="all" ${!state.mall && !near ? 'checked' : ''}> همه پاساژها</label>
      </div>
      <div class="row2">
        <div><label>نام شما</label><input class="field" name="name" required maxlength="40" autocomplete="name" enterkeyhint="next" value="${esc(me.name || '')}"></div>
        <div><label>شماره موبایل</label><input class="field" name="phone" type="tel" required inputmode="tel" autocomplete="tel" dir="ltr" enterkeyhint="done" placeholder="09121234567" value="${esc(me.phone || '')}"></div>
      </div>
      <label class="consent"><input type="checkbox" name="consent" required> موافقم نام و شماره‌ام برای فروشگاه‌هایی که این کالا را دارند ارسال شود تا با من تماس بگیرند.</label>
      <label class="consent"><input type="checkbox" name="shareLocation"> موقعیت تقریبی من (حدود ۱۰۰ متر) هم برای فروشنده‌ها ارسال شود تا فاصله را ببینند.</label>
      <div class="form-error" id="req-err"></div>
      <button class="btn primary block" type="submit">ارسال درخواست</button>
    </form>`);
  $('#req-form', box).onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const scope = fd.get('scope');
    const err = $('#req-err', box);
    let pos = geo.best;
    if (scope === 'near' || fd.get('shareLocation') === 'on') {
      pos = await geo.start().catch((e) => { err.textContent = e.message; return null; });
      if (!pos) return;
    }
    let mallIds = null;
    if (scope === 'near') {
      const r = Number(fd.get('radius'));
      mallIds = (city.malls ?? []).filter((m) => distance(pos, m) <= r).map((m) => m.id);
      if (!mallIds.length) { err.textContent = `در ${fmtDist(r)}ی شما پاساژی ثبت نشده؛ شعاع را بیشتر کنید.`; return; }
    }
    const body = {
      userId: uid, query: fd.get('query'), details: fd.get('details'), budget: fd.get('budget'),
      name: fd.get('name'), phone: fd.get('phone'), consent: fd.get('consent') === 'on',
      mallId: scope === 'mall' ? state.mall?.id : null, mallIds,
      shareLocation: fd.get('shareLocation') === 'on', location: pos ? { lat: pos.lat, lng: pos.lng } : null,
    };
    try {
      const r = await api('/requests', { method: 'POST', body });
      persist('profile', { name: body.name, phone: body.phone });
      showRequestResult(r);
    } catch (e) {
      err.textContent = e.message;
    }
  };
  setTimeout(() => $('input[name=query]', box)?.focus(), 50);
}

function showRequestResult(r) {
  const box = openModal(`
    <h2>${r.stores.length ? '✅ درخواست ارسال شد' : '📭 فروشنده‌ای پیدا نشد'}</h2>
    <div class="sub">${r.stores.length
      ? `«${esc(r.query)}» برای <b>${fa(r.stores.length)} فروشگاه</b> ارسال شد. وقتی پیشنهاد بدهند همین‌جا خبردار می‌شوید.`
      : 'فعلاً هیچ فروشگاهی این کالا را ثبت نکرده است. درخواست شما ذخیره شد.'}</div>
    ${r.stores.slice(0, 20).map((s) => `<div class="result" data-mall="${s.mallId}" data-id="${s.id}">
      <div class="ico">${cat(s.category).icon}</div>
      <div class="main"><div class="title">${esc(s.name)}</div><div class="sub">${esc(s.mallName)} · ${esc(s.floorName)}</div></div>
      ${s.discount ? `<span class="chip">${fa(s.discount.percent)}٪</span>` : ''}</div>`).join('')}
    <div class="actions-row"><button class="btn" data-action="myreq">📬 درخواست‌های من</button></div>`);
  for (const el of $$('.result', box)) el.onclick = () => { closeModal(); go(`#/mall/${el.dataset.mall}/${el.dataset.id}`); };
}

async function openMyRequests() {
  state.unread = 0;
  renderBadge();
  const el = openDrawer($('#myreq-panel'), '<h2>📬 درخواست‌های من</h2><div class="skeleton"></div><div class="skeleton"></div>');
  const list = await api(`/requests?user=${uid}`).catch(() => []);
  if (el.classList.contains('hidden')) return;
  openDrawer(el, `
    <h2>📬 درخواست‌های من</h2>
    <div class="sub">پیشنهاد فروشنده‌ها به‌صورت زنده اینجا می‌آید.</div>
    <div style="margin:12px 0"><button class="btn primary small" data-action="request">+ درخواست جدید</button></div>
    ${list.length ? '' : '<div class="empty-state">📭<br>هنوز درخواستی ثبت نکرده‌اید.</div>'}
    ${list.map((r) => `
      <div class="req-card">
        <div class="row" style="display:flex;justify-content:space-between;align-items:center">
          <span class="q">${esc(r.query)}</span><span class="status ${r.status}">${r.status === 'open' ? 'باز' : 'بسته'}</span>
        </div>
        <div class="meta">${timeAgo(r.createdAt)} · ${r.mallName ? esc(r.mallName) : 'همه پاساژها'} · ${fa(r.matches.length)} فروشگاه خبردار شدند${r.budget ? ` · بودجه ${toman(r.budget)}` : ''}</div>
        ${r.offers.map((o) => `
          <div class="offer">
            <div class="who">${cat(o.store.category).icon} ${esc(o.store.name)} <span class="sub">· ${esc(o.store.mallName)} · ${esc(o.store.floorName)}</span></div>
            ${o.price ? `<div class="price">${toman(o.price)}</div>` : ''}
            ${o.message ? `<div>${esc(o.message)}</div>` : ''}
            <div class="actions-row">
              <a class="btn small primary" href="tel:${esc(o.store.phone.replace(/-/g, ''))}">📞 تماس</a>
              <button class="btn small purple" data-goto="${o.store.mallId}/${o.store.id}">🧭 برو به فروشگاه</button>
            </div>
          </div>`).join('') || '<div class="meta">هنوز پیشنهادی نرسیده…</div>'}
        ${r.status === 'open' ? `<button class="btn small" data-close-req="${r.id}" style="margin-top:8px">✓ پیدا کردم، ببند</button>` : ''}
      </div>`).join('')}`);
  for (const b of $$('[data-goto]', el)) b.onclick = () => { el.classList.add('hidden'); go(`#/mall/${b.dataset.goto}`); };
  for (const b of $$('[data-close-req]', el)) {
    b.onclick = async () => { await api(`/requests/${b.dataset.closeReq}/close`, { method: 'POST', body: { userId: uid } }); openMyRequests(); };
  }
}

function renderBadge() {
  for (const b of $$('[data-count=offers]')) {
    b.textContent = fa(state.unread);
    b.classList.toggle('hidden', !state.unread);
  }
}

// ---------- hub ----------

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function openHub() {
  const recent = getRecent();
  const list = store('list', []).filter((i) => !i.done).length;
  const el = openDrawer($('#hub-panel'), `
    <h2>پاساژ من</h2>
    <div class="hub-grid">
      <button class="tile" data-open="list"><span>🛒</span>لیست خرید${list ? `<b class="badge">${fa(list)}</b>` : ''}</button>
      <button class="tile" data-open="favs"><span>❤️</span>علاقه‌مندی‌ها</button>
      <button class="tile" data-open="friends"><span>👥</span>دوستان${state.friends.length ? `<b class="badge">${fa(state.friends.length)}</b>` : ''}</button>
      <button class="tile" data-open="parking"><span>🅿️</span>ماشین من</button>
      <button class="tile" data-open="myreq"><span>📬</span>درخواست‌ها${state.unread ? `<b class="badge">${fa(state.unread)}</b>` : ''}</button>
      <button class="tile" data-open="request"><span>📣</span>درخواست کالا</button>
    </div>
    <div class="toggle-card ${geo.active ? 'on' : ''}">
      <div><b>📍 موقعیت زنده ${geo.active ? 'روشن است' : 'خاموش است'}</b>
        <div class="sub">${geo.active ? `دقت حدود ${fmtDist(geo.pos?.accuracy ?? 0)}` : 'برای مسیریابی، رسیدن به پاساژ و نقشه داخلی واقعی'}</div></div>
      <label class="switch"><input type="checkbox" id="hub-geo" ${geo.active ? 'checked' : ''}><span></span></label>
    </div>
    ${!standalone() && (installPrompt || isIOS) ? '<button class="btn block install-btn" id="hub-install">📲 نصب اپلیکیشن روی گوشی</button>' : ''}
    ${recent.length ? `<h3>🕘 اخیراً دیده‌شده</h3>${recent.map((r) => `<div class="result" data-go="${r.mallId}/${r.id}">
      <div class="ico">${cat(r.category).icon}</div><div class="main"><div class="title">${esc(r.name)}</div><div class="sub">${esc(r.mallName)}</div></div></div>`).join('')}` : ''}
    <div class="hub-foot"><a href="/seller">پنل فروشندگان</a> · داده نقشه از OpenStreetMap</div>`);
  const open = { list: openList, favs: openFavs, friends: openFriends, parking: () => openParking(), myreq: openMyRequests, request: () => { el.classList.add('hidden'); openRequest(); } };
  for (const b of $$('[data-open]', el)) b.onclick = () => open[b.dataset.open]();
  for (const r of $$('[data-go]', el)) r.onclick = () => go(`#/mall/${r.dataset.go}`);
  $('#hub-geo', el).onchange = async (ev) => {
    if (ev.target.checked) await city.startTracking(true);
    else if (city.nav) { ev.target.checked = true; toast('در حین مسیریابی، موقعیت روشن می‌ماند'); } else geo.stop();
    openHub();
  };
  const inst = $('#hub-install', el);
  if (inst) {
    inst.onclick = async () => {
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice.catch(() => {});
        installPrompt = null;
        return openHub();
      }
      openModal(`<h2>📲 نصب روی آیفون</h2>
        <ol class="steps"><li>در Safari، دکمه <b>اشتراک‌گذاری</b> <span class="kbd">⬆︎</span> پایین صفحه را بزنید.</li>
        <li><b>Add to Home Screen</b> را انتخاب کنید.</li><li><b>Add</b> را بزنید. حالا پاساژ مثل یک اپ روی صفحه گوشی است.</li></ol>`);
    };
  }
}

// ---------- live events ----------

function connectEvents() {
  const es = new EventSource(`/api/events?user=${uid}`);
  es.addEventListener('offer', (ev) => {
    const o = JSON.parse(ev.data);
    state.unread++;
    renderBadge();
    beep();
    vibrate([60, 60, 60]);
    const t = toast(`💬 <b>${esc(o.store.name)}</b> برای «${esc(o.query)}» پیشنهاد داد${o.price ? `: ${toman(o.price)}` : ''}
      <div class="actions-row" style="margin:6px 0 0"><a class="btn small primary" href="tel:${esc(o.store.phone.replace(/-/g, ''))}">📞 تماس</a>
      <button class="btn small" data-action="myreq">مشاهده</button></div>`, 'offer', 9000);
    t.style.pointerEvents = 'auto';
    if (!$('#myreq-panel').classList.contains('hidden')) openMyRequests();
  });
  es.addEventListener('discount', (ev) => {
    const d = JSON.parse(ev.data);
    if (state.mall?.id === d.mallId) {
      const s = findStore(d.storeId);
      if (!s) return;
      s.discount = d.discount;
      state.engine.collected.delete(s.id);
      if (d.discount) toast(`🔥 تخفیف جدید: <b>${fa(d.discount.percent)}٪</b> در ${esc(s.name)} (${esc(floorOf(s).name)})`, 'deal', 6000);
      return;
    }
    // A new deal in a mall near the user, while they're elsewhere.
    const m = city.mall(d.mallId);
    if (!d.discount || !m || !geo.best || distance(geo.best, m) > 3000) return;
    toast(`🔥 <b>${fa(d.discount.percent)}٪</b> تخفیف در ${esc(d.storeName)} · ${esc(m.name)} (${fmtDist(distance(geo.best, m))})
      <div class="actions-row" style="margin:6px 0 0"><button class="btn small primary" data-goto-store="${m.id}/${d.storeId}">مشاهده</button></div>`, 'deal', 8000);
  });
}

let audio;
function beep() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    o.frequency.exponentialRampToValueAtTime(1320, audio.currentTime + 0.12);
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.26);
  } catch { /* audio not available */ }
}

// ---------- controls ----------

function bindControls() {
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto-store]');
    if (g) go(`#/mall/${g.dataset.gotoStore}`);
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'request') openRequest(a.dataset.q || $('#mall-search')?.value || '');
    if (act === 'myreq') { closeModal(); openMyRequests(); }
    if (act === 'hub') openHub();
    if (act === 'list') openList();
    if (act === 'friends') openFriends();
    if (act === 'parking') openParking();
  });
  $('#btn-back').onclick = () => go('#/');
  $('#btn-legend').onclick = openLegend;
  $('#btn-discounts').onclick = openDiscounts;
  $('#btn-zoom-in').onclick = () => state.engine.zoomBy(1.3);
  $('#btn-zoom-out').onclick = () => state.engine.zoomBy(1 / 1.3);
  $('#btn-full').onclick = () => state.engine.showFullMap();
  $('#btn-center').onclick = () => { const e = state.engine; e.setViewFloor(e.player.floor); renderFloors(); };
  $('#btn-gps').onclick = gpsTool;
  $('#btn-car').onclick = () => openParking();

  // Touch joystick
  const joy = $('#joystick'), stick = $('.stick', joy);
  let jid = null;
  const move = (ev) => {
    const r = joy.getBoundingClientRect();
    let dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy), max = r.width / 2 - 10;
    if (m > max) { dx = (dx / m) * max; dy = (dy / m) * max; }
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
    state.engine.joy = { x: dx / max, y: dy / max };
  };
  joy.addEventListener('pointerdown', (ev) => { jid = ev.pointerId; joy.setPointerCapture(jid); joy.classList.add('active'); gpsFollow = false; renderGpsTool(); move(ev); });
  joy.addEventListener('pointermove', (ev) => { if (ev.pointerId === jid) move(ev); });
  const end = () => { jid = null; stick.style.transform = ''; joy.classList.remove('active'); if (state.engine) state.engine.joy = { x: 0, y: 0 }; };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
}

// ---------- boot ----------

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
bindControls();
bindMallSearch();
connectEvents();
renderListBadge();
startFriends();
window.addEventListener('hashchange', route);
await city.init().catch((e) => toast(`خطا در بارگذاری: ${esc(e.message)}`));
city.renderPark();
renderParkChip();
document.documentElement.classList.add('ready');
route();
if (group()) startFriends();
