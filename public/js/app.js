// App shell: routing between city and mall views, HUD, panels, product requests, live offers.

import { $, $$, esc, fa, toman, cat, finalPrice, api, toast, openModal, closeModal, openDrawer, timeAgo, debounce, store, persist } from './ui.js';
import { CityView } from './city.js';
import { MallEngine } from './mall.js';
import { CATEGORIES, AMENITIES } from '/shared/catalog.js';
import { tokens, matchScore } from '/shared/text.js';

const uid = store('uid', null) ?? crypto.randomUUID();
persist('uid', uid);

const state = { mall: null, engine: null, unread: 0 };
window.passajh = state; // handy for debugging from the console

// ---------- city ----------

const city = new CityView({
  onEnter: (id) => go(`#/mall/${id}`),
  onResult: (r) => go(`#/mall/${r.store.mallId}/${r.store.id}`),
});

// ---------- routing ----------

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const [, view, mallId, storeId] = location.hash.split('/');
  if (view === 'mall' && mallId) {
    await enterMall(mallId, storeId);
  } else {
    state.engine?.stop();
    state.mall = null;
    $('#mall-view').classList.add('hidden');
    $('#city-view').classList.remove('hidden');
    for (const d of $$('.drawer')) d.classList.add('hidden');
    city.invalidate();
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
    $('#city-view').classList.add('hidden');
    $('#mall-view').classList.remove('hidden');
    for (const d of $$('.drawer')) d.classList.add('hidden');
    if (!state.engine) state.engine = new MallEngine($('#mall-canvas'), $('#radar'), engineHooks);
    state.engine.resize();
    const coupons = new Set(store(`coupons.${id}`, []));
    await document.fonts?.ready;
    state.engine.load(mall, coupons);
    $('#mall-title').innerHTML = `${esc(mall.name)}<small>${esc(mall.nameEn.toUpperCase())}</small>`;
    renderFloors();
    renderMoney();
    help(`به <b>${esc(mall.name)}</b> خوش آمدید! 👋<br>با کلیدهای جهت (یا جوی‌استیک) راه بروید. از کنار مغازه‌های <b>٪</b>دار رد شوید تا کوپن تخفیف بگیرید.`);
  }
  if (storeId) {
    const s = findStore(storeId);
    if (s) {
      state.engine.routeToStore(s);
      openStore(s);
    }
  }
}

function findStore(id) {
  for (const f of state.mall.floors) for (const s of f.stores) if (s.id === id) return s;
  return null;
}

function floorOf(s) { return state.mall.floors.find((f) => f.id === s.floor); }

const engineHooks = {
  onStoreClick: (s) => openStore(s),
  onStoreEnter: (s) => {
    toast(`${cat(s.category).icon} وارد <b>${esc(s.name)}</b> شدید`, '', 2200);
    openStore(s);
  },
  onDiscount: (s) => {
    persist(`coupons.${state.mall.id}`, [...state.engine.collected]);
    toast(`🏷️ <b>${fa(s.discount.percent)}٪ تخفیف</b> در ${esc(s.name)} — ${esc(s.discount.title)}<br><small>کوپن به کیف شما اضافه شد</small>`, 'deal', 4500);
    renderMoney();
    beep();
  },
  onFloorChange: (f, via) => {
    const fade = $('#fade');
    fade.textContent = `${via === 'escalator' ? 'پله برقی' : via === 'stairs' ? 'پله' : 'آسانسور'} ← ${f.name}`;
    fade.classList.add('on');
    setTimeout(() => fade.classList.remove('on'), 450);
    renderFloors();
  },
  onElevator: () => floorModal('elevator'),
  onStairs: () => floorModal('stairs'),
  onArrive: (wp) => {
    toast(`📍 رسیدید: <b>${esc(wp.label)}</b>`, 'good');
    renderFloors();
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
    el.innerHTML = `<span>🧭 ${esc(info.step)}</span><span class="m">${fa(info.meters)} متر</span>
      <button class="btn small purple" id="route-go">🚶 برو</button><button class="btn small" id="route-clear">✕</button>`;
    $('#route-go').onclick = () => { state.engine.auto = true; state.engine.cam.follow = true; };
    $('#route-clear').onclick = () => { state.engine.clearWaypoint(); state.engine.highlight.clear(); };
    renderFloors();
  },
};

function renderFloors() {
  const e = state.engine;
  const wpFloor = e.waypoint?.floor;
  $('#floor-picker').innerHTML = `<div class="lbl">طبقات</div>` + state.mall.floors.map((f) => `
    <button data-floor="${f.id}" title="${esc(f.name)}" class="${f.id === e.viewFloor ? 'view' : ''} ${f.id === e.player.floor ? 'here' : ''} ${f.id === wpFloor ? 'target' : ''}">
      ${f.type === 'parking' ? 'P' + fa(-f.level) : f.level === 0 ? 'G' : fa(f.level)}
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
    <div class="elevator-grid">${floors.map((f) => `<button data-f="${f.id}" class="${f.id === cur.id ? 'current' : ''}">${esc(f.name)}</button>`).join('')}</div>`);
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
  const el = openDrawer($('#store-panel'), `
    <div class="store-head">
      <div class="store-ico" style="background:${c.color}">${c.icon}</div>
      <div><h2>${esc(s.name)}</h2><div class="sub">${c.label} · ${esc(f.name)} · ⭐ ${fa(s.rating)}</div></div>
    </div>
    ${s.discount ? `<div class="discount-banner"><span>🏷️ ${esc(s.discount.title)}<br><small>روی همه کالاها</small></span><span class="pct">${fa(s.discount.percent)}٪</span></div>` : ''}
    <div class="sub">🕘 ${esc(s.hours)} · ☎️ <span dir="ltr">${fa(s.phone)}</span></div>
    <div class="actions-row">
      <button class="btn purple" id="sp-route">🧭 مسیریابی</button>
      <button class="btn primary" id="sp-go">🚶 برو اونجا</button>
      <a class="btn" href="tel:${esc(s.phone.replace(/-/g, ''))}">📞 تماس</a>
    </div>
    <h3>محصولات (${fa(s.products.length)})</h3>
    ${s.products.map((p) => `
      <div class="product ${p.inStock ? '' : 'out'}">
        <div><div class="n">${esc(p.name)}</div><div class="t">${p.inStock ? 'موجود' : 'ناموجود'}</div></div>
        <div class="p">${s.discount ? `<span class="old">${toman(p.price)}</span>` : ''}<span class="new">${toman(finalPrice(p, s))}</span></div>
      </div>`).join('')}
    <h3>کالای مورد نظرت نیست؟</h3>
    <button class="btn block" data-action="request">📣 درخواست کالا از همه فروشنده‌ها</button>`);
  $('#sp-route', el).onclick = () => state.engine.routeToStore(s, false);
  $('#sp-go', el).onclick = () => state.engine.routeToStore(s, true);
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
      ${Object.values(AMENITIES).map((a) => `<div class="legend-item"><span class="swatch" style="background:#111;border:2px solid #fff;border-radius:50%">${a.icon}</span>${a.label}</div>`).join('')}
      <div class="legend-item"><span class="swatch" style="background:#2fd27a"></span>پله برقی رو به بالا</div>
      <div class="legend-item"><span class="swatch" style="background:#ff9f43"></span>پله برقی رو به پایین</div>
      <div class="legend-item"><span class="swatch" style="background:#05080c;border:1px solid #8fb3d9"></span>نورگیر (آتریوم)</div>
      <div class="legend-item"><span class="swatch" style="background:#ff3b5c">٪</span>تخفیف فعال</div>
      <div class="legend-item"><span class="swatch" style="background:#c04cff"></span>مسیر GPS</div>`);
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
      <div class="price" style="color:#ff6b84">${fa(s.discount.percent)}٪</div></div>`).join('')}`);
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
  const box = openModal(`
    <h2>📣 درخواست کالا</h2>
    <div class="sub">بگویید چه می‌خواهید؛ همه فروشگاه‌هایی که این کالا را دارند خبردار می‌شوند و با شما تماس می‌گیرند یا پیشنهاد قیمت می‌فرستند.</div>
    <form id="req-form">
      <label>چه کالایی می‌خواهید؟</label>
      <input class="field" name="query" required maxlength="100" placeholder="مثلاً آیفون ۱۶ پرو، کفش ورزشی سایز ۴۲" value="${esc(prefill)}">
      <label>توضیحات (رنگ، سایز، مدل…)</label>
      <textarea name="details" rows="2" maxlength="300"></textarea>
      <label>حداکثر بودجه (تومان، اختیاری)</label>
      <input class="field" name="budget" inputmode="numeric" placeholder="مثلاً ۵۰۰۰۰۰۰۰">
      <label>کجا جستجو شود؟</label>
      <div class="radio-row">
        ${state.mall ? `<label><input type="radio" name="scope" value="mall" checked> فقط ${esc(state.mall.name)}</label>` : ''}
        <label><input type="radio" name="scope" value="all" ${state.mall ? '' : 'checked'}> همه پاساژهای تهران</label>
      </div>
      <div class="row2">
        <div><label>نام شما</label><input class="field" name="name" required maxlength="40" value="${esc(me.name || '')}"></div>
        <div><label>شماره موبایل</label><input class="field" name="phone" required inputmode="tel" dir="ltr" placeholder="09121234567" value="${esc(me.phone || '')}"></div>
      </div>
      <label class="consent"><input type="checkbox" name="consent" required> موافقم نام و شماره‌ام برای فروشگاه‌هایی که این کالا را دارند ارسال شود تا با من تماس بگیرند.</label>
      <div class="form-error" id="req-err"></div>
      <button class="btn primary block" type="submit">ارسال درخواست</button>
    </form>`);
  $('#req-form', box).onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = {
      userId: uid, query: fd.get('query'), details: fd.get('details'), budget: fd.get('budget'),
      name: fd.get('name'), phone: fd.get('phone'), consent: fd.get('consent') === 'on',
      mallId: fd.get('scope') === 'mall' ? state.mall?.id : null,
    };
    try {
      const r = await api('/requests', { method: 'POST', body });
      persist('profile', { name: body.name, phone: body.phone });
      showRequestResult(r);
    } catch (e) {
      $('#req-err', box).textContent = e.message;
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
  const list = await api(`/requests?user=${uid}`).catch(() => []);
  const el = openDrawer($('#myreq-panel'), `
    <h2>📬 درخواست‌های من</h2>
    <div class="sub">پیشنهاد فروشنده‌ها به‌صورت زنده اینجا می‌آید.</div>
    <div style="margin:12px 0"><button class="btn primary small" data-action="request">+ درخواست جدید</button></div>
    ${list.length ? '' : '<div class="sub">هنوز درخواستی ثبت نکرده‌اید.</div>'}
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
  for (const b of $$('[data-action=myreq] .badge')) {
    b.textContent = fa(state.unread);
    b.classList.toggle('hidden', !state.unread);
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
    const t = toast(`💬 <b>${esc(o.store.name)}</b> برای «${esc(o.query)}» پیشنهاد داد${o.price ? `: ${toman(o.price)}` : ''}
      <div class="actions-row" style="margin:6px 0 0"><a class="btn small primary" href="tel:${esc(o.store.phone.replace(/-/g, ''))}">📞 تماس</a>
      <button class="btn small" data-action="myreq">مشاهده</button></div>`, 'offer', 9000);
    t.style.pointerEvents = 'auto';
    if (!$('#myreq-panel').classList.contains('hidden')) openMyRequests();
  });
  es.addEventListener('discount', (ev) => {
    const d = JSON.parse(ev.data);
    if (state.mall?.id !== d.mallId) return;
    const s = findStore(d.storeId);
    if (!s) return;
    s.discount = d.discount;
    state.engine.collected.delete(s.id);
    if (d.discount) toast(`🔥 تخفیف جدید: <b>${fa(d.discount.percent)}٪</b> در ${esc(s.name)} (${esc(floorOf(s).name)})`, 'deal', 6000);
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
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'request') openRequest(a.dataset.q || $('#mall-search')?.value || '');
    if (a.dataset.action === 'myreq') { closeModal(); openMyRequests(); }
  });
  $('#btn-back').onclick = () => go('#/');
  $('#btn-legend').onclick = openLegend;
  $('#btn-discounts').onclick = openDiscounts;
  $('#btn-zoom-in').onclick = () => state.engine.zoomBy(1.3);
  $('#btn-zoom-out').onclick = () => state.engine.zoomBy(1 / 1.3);
  $('#btn-full').onclick = () => state.engine.showFullMap();
  $('#btn-center').onclick = () => { const e = state.engine; e.setViewFloor(e.player.floor); renderFloors(); };
  $('#btn-car').onclick = () => {
    const e = state.engine;
    if (e.car && e.car.floor !== e.player.floor) {
      e.setWaypoint({ floor: e.car.floor, x: e.car.x, y: e.car.y, label: 'ماشین شما' });
      return toast('🚗 مسیر تا ماشین شما روی نقشه است');
    }
    if (e.floor.type !== 'parking') return toast('ابتدا به طبقه پارکینگ بروید، سپس محل ماشین را ثبت کنید. (اگر قبلاً ثبت کرده‌اید، دکمه مسیر را نشان می‌دهد)');
    e.parkCar();
    toast(`🚗 محل پارک ثبت شد: ${esc(e.floor.name)}`, 'good');
  };

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
  joy.addEventListener('pointerdown', (ev) => { jid = ev.pointerId; joy.setPointerCapture(jid); move(ev); });
  joy.addEventListener('pointermove', (ev) => { if (ev.pointerId === jid) move(ev); });
  const end = () => { jid = null; stick.style.transform = ''; if (state.engine) state.engine.joy = { x: 0, y: 0 }; };
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);
}

// ---------- boot ----------

bindControls();
bindMallSearch();
connectEvents();
window.addEventListener('hashchange', route);
await city.init().catch((e) => toast(`خطا در بارگذاری: ${esc(e.message)}`));
route();
