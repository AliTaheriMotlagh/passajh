// One mall, passage or bazaar: open now?, how to get there (metro first), what it's known for, its shops
// by floor, the real floor plan when one exists — and quick ways to fill in what's missing.

import { $, $$, esc, fa, cat, toast, share, statusPill, lineBadges } from '../ui.js';
import { distTo, fmtDist, walkMin } from '../geo.js';
import { loadMall, saved } from '../data.js';
import { floorName, levelOf } from '/shared/floors.js';
import { KIND, navSheet, statusOf, topCats } from '../parts.js';
import { addShopSheet, shopSheet, tagSheet, hoursSheet, closedSheet, parkingSheet } from '../forms.js';
import { renderPlan } from '../plan.js';

// Metro data covers Tehran only; elsewhere, no station isn't news.
const inTehran = (p) => p.lat > 35.45 && p.lat < 35.9 && p.lng > 50.95 && p.lng < 51.75;

const SOURCE = { osm: 'OpenStreetMap', user: 'یک بازدیدکننده', owner: 'مالک مغازه' };

export async function render({ main, header, params }) {
  const [id, action, shopId] = params;
  header.innerHTML = `<a class="btn ghost icon back" href="#/" onclick="if (history.length > 1) { history.back(); return false; }" aria-label="بازگشت">→</a>
    <span class="title" id="m-title"></span>
    <button class="btn ghost icon" id="m-save" aria-label="ذخیره">♡</button>
    <button class="btn ghost icon" id="m-share" aria-label="اشتراک">⤴</button>`;
  main.innerHTML = '<div style="height:16px"></div><div class="skeleton" style="height:120px"></div><div class="skeleton"></div><div class="skeleton"></div>';

  let m;
  try {
    m = await loadMall(id);
  } catch (e) {
    main.innerHTML = `<div class="empty"><span class="i">🏚️</span><h3>این مکان باز نشد</h3><p>${esc(e.message)}</p><a class="btn" href="#/">خانه</a></div>`;
    return;
  }

  const draw = (fresh) => {
    if (fresh) m = fresh;
    paint(main, m);
    bind(main, m, draw);
  };
  $('#m-title', header).textContent = m.name;
  const saveBtn = $('#m-save', header);
  const paintSave = () => { const on = saved.has(m.id); saveBtn.textContent = on ? '♥' : '♡'; saveBtn.style.color = on ? 'var(--closed)' : ''; };
  paintSave();
  saveBtn.onclick = () => { const on = saved.toggle(m.id); paintSave(); toast(on ? '♥ ذخیره شد؛ در صفحه «من» پیدایش می‌کنید' : 'از ذخیره‌ها برداشته شد'); };
  $('#m-share', header).onclick = () => share(m.name, `${location.origin}/#/m/${encodeURIComponent(m.id)}`);
  draw();

  if (action === 'add') addShopSheet(m, draw);
  if (action === 's' && shopId) {
    const s = m.shops.find((x) => x.id === shopId);
    if (s) shopSheet(m, s, draw);
  }
}

function paint(main, m) {
  const st = statusOf(m);
  const d = distTo(m);
  const cats = topCats(m, 6);
  const metro = m.metroAll ?? [];
  const parking = m.floors.some((f) => f.id[0] === 'P');

  main.innerHTML = `
    <section class="mall-hero">
      <div class="kind"><span>${KIND[m.kind] ?? 'مرکز خرید'}</span>${m.hood ? `<span>· ${esc(m.hood)}</span>` : ''}${d != null ? `<span>· ${fmtDist(d)} از شما</span>` : ''}</div>
      <h1>${esc(m.name)}</h1>
      ${m.nameEn && m.nameEn !== m.name ? `<div class="en">${esc(m.nameEn)}</div>` : ''}
      ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ''}
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">${statusPill(st)}
        ${m.hours ? `<span class="small muted">${fa(m.hours)}${m.hoursBy === 'users' ? ' (گزارش کاربران)' : ''}</span>` : ''}</div>
    </section>

    ${m.closed ? `<div class="notice bad" style="margin-top:12px"><span class="i">⚠️</span><span>چند نفر گزارش داده‌اند این مکان بسته شده یا اینجا نیست.</span></div>` : ''}

    <div class="quick">
      <button class="btn primary" id="m-nav"><span class="i">🧭</span>مسیریابی</button>
      ${m.phone ? `<a class="btn" href="tel:${esc(m.phone.replace(/[^\d+]/g, ''))}"><span class="i">📞</span>تماس</a>` : '<button class="btn" id="m-add2"><span class="i">➕</span>افزودن مغازه</button>'}
      <button class="btn" id="m-park"><span class="i">🚗</span>پارک کردم</button>
    </div>

    <section class="section">
      <div class="section-head"><h2>رسیدن</h2></div>
      <div class="card facts">
        ${metro.length ? metro.map((s) => `<div class="fact"><span class="i">🚇</span><span class="v"><b>${lineBadges(s.lines)} مترو ${esc(s.name)}</b>
          <span class="muted">${fmtDist(s.m)} · حدود ${fa(walkMin(s.m))} دقیقه پیاده</span></span></div>`).join('')
          : inTehran(m) ? '<div class="fact"><span class="i">🚇</span><span class="v"><b>ایستگاه مترو در فاصله پیاده نیست</b><span class="muted">تا ۱٫۵ کیلومتری ایستگاهی نیست؛ تاکسی یا ماشین بهتر است.</span></span></div>' : ''}
        ${parking ? '<div class="fact"><span class="i">🅿️</span><span class="v"><b>پارکینگ دارد</b><span class="muted">جای پارکتان را با «پارک کردم» ذخیره کنید.</span></span></div>' : ''}
        ${m.street || m.address ? `<div class="fact"><span class="i">📍</span><span class="v"><b>${esc(m.address ?? `خیابان ${m.street}`)}</b></span></div>` : ''}
      </div>
    </section>

    ${m.streets?.length ? `<div class="notice brand" style="margin-top:12px"><span class="i">🛍️</span><span>این ${KIND[m.kind] ?? 'مکان'} وسط راسته
      ${m.streets.map((h) => `<button class="chip soft" data-street="${esc(h.id)}" style="margin:2px">${cat(h.category).icon} ${esc(cat(h.category).short)} ${esc(h.name)}</button>`).join(' ')} است.</span></div>` : ''}

    <section class="section">
      <div class="section-head"><h2>چی دارد؟</h2><button class="btn sm ghost" id="m-tag">+ نظر شما</button></div>
      ${cats.length ? `<div class="tags">${cats.map((k) => `<a class="chip" href="#/c/${k}">${cat(k).icon} ${esc(cat(k).short)}${m.cats?.[k] ? ` <span class="n">${fa(m.cats[k])}</span>` : ''}</a>`).join('')}</div>
        ${m.tags && Object.keys(m.tags).length ? `<p class="small muted" style="margin:8px 0 0">بخشی بر اساس نظر ${fa(Object.values(m.tags).reduce((a, n) => a + n, 0))} بازدیدکننده.</p>` : ''}`
        : '<div class="card soft"><p class="small" style="margin:0">هنوز نمی‌دانیم اینجا بیشتر چه می‌فروشند. اگر رفته‌اید، با «نظر شما» بگویید.</p></div>'}
    </section>

    <section class="section">
      <div class="section-head"><h2>مغازه‌ها ${m.shops.length ? `<span class="muted small">(${fa(m.shops.length)})</span>` : ''}</h2><button class="btn sm soft" id="m-add">+ افزودن</button></div>
      ${m.shops.length > 8 ? `<div class="search" style="margin-bottom:10px;box-shadow:none"><span class="ico">🔎</span><input id="m-filter" type="search" placeholder="جستجو در مغازه‌های اینجا" aria-label="جستجو در مغازه‌ها"></div>` : ''}
      <div id="m-shops">${shopList(m)}</div>
    </section>

    ${m.plan ? `<section class="section">
      <div class="section-head"><h2>نقشه طبقات</h2><span class="pill brand">نقشه واقعی</span></div>
      <div class="floor-tabs" id="plan-floors">${m.plan.floors.filter((f) => f.units.length).sort((a, b) => levelOf(b.id) - levelOf(a.id))
        .map((f, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-floor="${f.id}">${esc(f.name || floorName(f.id))}</button>`).join('')}</div>
      <div class="plan-box" id="plan"></div>
      <p class="small muted">از ${m.plan.source === 'editor' ? 'نقشه ثبت‌شده در پاساژ' : 'OpenStreetMap'}. روی هر واحد بزنید تا نامش را ببینید.</p>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><h2>اطلاعات</h2></div>
      <div class="card facts">
        <div class="fact"><span class="i">🕘</span><span class="v"><b>${m.hours ? fa(m.hours) : 'ساعت کاری ثبت نشده'}</b>
          <span class="muted">${m.reports?.friday?.closed || m.reports?.friday?.open ? `جمعه‌ها: ${m.fri === 'closed' ? 'تعطیل' : 'باز'} (به گفته کاربران) · ` : ''}<button class="btn sm ghost" id="m-hours" style="min-height:28px;padding:0 6px">${m.hours ? 'اشتباه است؟' : 'گزارش ساعت کاری'}</button></span></span></div>
        ${m.phone ? `<div class="fact"><span class="i">📞</span><span class="v"><b><a href="tel:${esc(m.phone.replace(/[^\d+]/g, ''))}" class="ltr">${esc(fa(m.phone))}</a></b></span></div>` : ''}
        ${m.website ? `<div class="fact"><span class="i">🌐</span><span class="v"><b><a href="${esc(/^https?:/.test(m.website) ? m.website : `https://${m.website}`)}" target="_blank" rel="noopener" class="ltr">${esc(m.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></b></span></div>` : ''}
        ${m.instagram ? `<div class="fact"><span class="i">📷</span><span class="v"><b><a href="https://instagram.com/${encodeURIComponent(m.instagram.replace(/^.*instagram\.com\//, '').replace(/[/@]/g, ''))}" target="_blank" rel="noopener">اینستاگرام</a></b></span></div>` : ''}
        ${m.floors.length > 1 ? `<div class="fact"><span class="i">🏢</span><span class="v"><b>${fa(m.floors.filter((f) => f.id[0] !== 'P').length)} طبقه${parking ? ` و ${fa(m.floors.filter((f) => f.id[0] === 'P').length)} طبقه پارکینگ` : ''}</b></span></div>` : ''}
        ${m.food || m.cinema ? `<div class="fact"><span class="i">🍽️</span><span class="v"><b>${[m.food && 'فودکورت', m.cinema && 'سینما'].filter(Boolean).join(' و ')}</b></span></div>` : ''}
        ${m.wheelchair === 'yes' ? '<div class="fact"><span class="i">♿</span><span class="v"><b>دسترسی با ویلچر</b></span></div>' : ''}
      </div>
      <div class="actions"><button class="btn sm ghost danger" id="m-closed">این مکان بسته شده یا اینجا نیست</button></div>
    </section>

    <p class="foot">اطلاعات از OpenStreetMap و کاربران پاساژ · <a href="https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lng}#map=19/${m.lat}/${m.lng}" target="_blank" rel="noopener">ویرایش در OpenStreetMap</a></p>`;
}

function shopList(m, filter = '') {
  if (!m.shops.length) {
    return `<div class="empty card soft"><span class="i">🏪</span><h3>هنوز مغازه‌ای ثبت نشده</h3>
      <p class="small">اولین نفری باشید که مغازه‌های اینجا را اضافه می‌کند. اسم و نوع کافی است.</p>
      <button class="btn primary" data-add>+ افزودن مغازه</button></div>`;
  }
  const f = filter.trim();
  const shops = m.shops.filter((s) => !f || `${s.name} ${cat(s.category).label} ${s.keywords ?? ''}`.includes(f));
  if (!shops.length) return '<p class="small muted">پیدا نشد.</p>';
  // By floor, top floor first; shops whose floor isn't known at the end.
  const groups = new Map();
  for (const s of shops) {
    const k = s.floor ?? '?';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '?') - (b === '?') || levelOf(b) - levelOf(a));
  const single = keys.length === 1 && keys[0] === '?';
  return `<div class="list">${keys.map((k) => `
    ${single ? '' : `<div class="group-label">${k === '?' ? 'طبقه نامشخص' : esc(floorName(k))}</div>`}
    ${groups.get(k).sort((a, b) => (b.source === 'owner') - (a.source === 'owner') || a.name.localeCompare(b.name, 'fa')).map((s) => `
      <button class="row" data-shop="${esc(s.id)}">
        <span class="ico" style="--c:${cat(s.category).color}">${cat(s.category).icon}</span>
        <span class="main"><span class="t">${esc(s.name)}${s.source === 'owner' ? ' <span class="pill brand">✓ مالک</span>' : ''}</span>
          <span class="s"><span>${esc(cat(s.category).short)}</span>${s.gone >= 2 && s.gone > s.here ? '<span class="pill warn">شاید بسته شده</span>' : ''}${s.keywords ? `<span>${esc(s.keywords.slice(0, 40))}</span>` : ''}</span></span>
        ${s.phone ? '<span class="end">📞</span>' : ''}
      </button>`).join('')}`).join('')}</div>
    <p class="small muted" style="margin-top:8px">منبع: ${[...new Set(m.shops.map((s) => SOURCE[s.source]))].join('، ')}. فهرست کامل نیست؛ اگر مغازه‌ای را دیدید که اینجا نیست، اضافه‌اش کنید.</p>`;
}

function bind(main, m, draw) {
  $('#m-nav', main).onclick = () => navSheet({ lat: m.lat, lng: m.lng, metro: m.metroAll?.[0] }, m.name);
  for (const b of $$('#m-add, #m-add2, [data-add]', main)) b.onclick = () => addShopSheet(m, draw);
  $('#m-park', main).onclick = () => parkingSheet(m);
  $('#m-tag', main).onclick = () => tagSheet(m, draw);
  $('#m-hours', main).onclick = () => hoursSheet(m, draw);
  $('#m-closed', main).onclick = () => closedSheet(m, draw);
  const shopsBox = $('#m-shops', main);
  shopsBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shop]');
    if (b) shopSheet(m, m.shops.find((s) => s.id === b.dataset.shop), draw);
    if (e.target.closest('[data-add]')) addShopSheet(m, draw);
  });
  const filter = $('#m-filter', main);
  if (filter) filter.oninput = () => { shopsBox.innerHTML = shopList(m, filter.value); };

  if (m.plan) {
    const box = $('#plan', main);
    const show = (fid) => renderPlan(box, m, fid, (unit) => toast(unit.name ? `${cat(unit.category ?? 'other').icon} <b>${esc(unit.name)}</b>` : 'نام این واحد ثبت نشده'));
    const first = $('#plan-floors [data-floor]', main);
    if (first) show(first.dataset.floor);
    for (const b of $$('#plan-floors [data-floor]', main)) {
      b.onclick = () => {
        for (const x of $$('#plan-floors .chip', main)) x.classList.toggle('on', x === b);
        show(b.dataset.floor);
      };
    }
  }
}
