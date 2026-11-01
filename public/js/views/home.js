// Home: "what do you want to buy?" — search, the category grid, places near me, Tehran's best-known
// shopping streets, and an honest note on how much is known (and how to help).

import { $, esc, fa, cat, toast, store } from '../ui.js';
import { geo, distance, fmtDist } from '../geo.js';
import { data, nearestMalls, sortByDistance } from '../data.js';
import { SHOP_CATEGORIES, CATEGORIES } from '/shared/catalog.js';
import { mallList, streetCard } from '../parts.js';
import { nav } from '../nav.js';

export function render({ main, header }) {
  header.innerHTML = `<a class="logo" href="#/"><span class="mark">پ</span>پاساژ<small>کجا بخرم؟ · تهران</small></a>`;
  const s = data.stats;
  const near = nearestMalls(5);
  const streets = geo.best ? sortByDistance(data.hotspots).slice(0, 8) : [...data.hotspots].sort((a, b) => b.count - a.count).slice(0, 8);
  const car = store('parking', null);

  main.innerHTML = `
    <section class="hero">
      <h1>دنبال چی هستی؟</h1>
      <p>بگو چی می‌خوای، می‌گیم تو تهران کجا پیداش می‌کنی.</p>
    </section>
    <form class="search" id="q-form" role="search">
      <span class="ico" aria-hidden="true">🔎</span>
      <input id="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="گوشی، لوستر، مبل، اسم پاساژ…" aria-label="جستجو">
    </form>
    <div class="chips">
      <button class="chip ${geo.best ? 'on' : ''}" id="near">📍 ${geo.best ? 'نزدیک من' : 'پاساژهای نزدیک من'}</button>
      ${['mobile', 'lighting', 'appliance', 'furniture', 'fashion'].map((k) => `<a class="chip" href="#/c/${k}">${cat(k).icon} ${esc(cat(k).short)}</a>`).join('')}
    </div>

    ${car ? `<div class="card accent" style="margin-top:16px"><div class="spot"><span class="ico" style="--c:var(--accent)">🚗</span>
      <div class="grow"><div class="t">ماشینت اینجاست</div><div class="s">${esc(car.note || 'پارک شده')}${car.mallName ? ` · ${esc(car.mallName)}` : ''}</div></div>
      <a class="btn sm" href="#/me">جزئیات</a></div></div>` : ''}

    <section class="section">
      <div class="section-head"><h2>چی می‌خوای بخری؟</h2></div>
      <div class="cat-grid">
        ${SHOP_CATEGORIES.map((k) => `<a class="cat" href="#/c/${k}" style="--c:${CATEGORIES[k].color}"><span class="ico">${CATEGORIES[k].icon}</span>${esc(CATEGORIES[k].short)}</a>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>${geo.best ? 'راسته‌های نزدیک شما' : 'راسته‌های معروف تهران'}</h2><a class="more" href="#/map">نقشه ←</a></div>
      <p class="lead">در تهران هر جنسی راسته خودش را دارد؛ آنجا مغازه‌ها کنار هم‌اند و می‌شود قیمت گرفت.</p>
      <div class="rail">${streets.map(streetCard).join('')}</div>
    </section>

    <section class="section" id="near-section">
      <div class="section-head"><h2>نزدیک‌ترین‌ها به شما</h2>${near.length ? '<a class="more" href="#/map">همه روی نقشه ←</a>' : ''}</div>
      ${near.length ? mallList(near) : `<div class="card soft"><div class="spot"><span class="ico">📍</span><div class="grow">
        <div class="t">پاساژهای اطرافت را ببین</div><div class="s">موقعیتت فقط روی همین گوشی می‌ماند و برای مرتب کردن بر اساس فاصله است.</div></div></div>
        <div class="actions"><button class="btn primary" id="near2">موقعیت من را پیدا کن</button></div></div>`}
    </section>

    <section class="section">
      <div class="card brand">
        <h3>این نقشه را با هم کامل کنیم</h3>
        <p class="small" style="margin:6px 0 0">از ${fa(s.malls)} مرکز خرید و پاساژ تهران، فقط برای ${fa(s.withShops)} تا می‌دانیم چه مغازه‌هایی دارند.
        هر بار که به پاساژی رفتی، چند مغازه‌اش را اضافه کن؛ ۱۰ ثانیه طول می‌کشد و به نفر بعدی کمک می‌کند.</p>
        <div class="meter" aria-hidden="true"><i style="width:${Math.max(3, Math.round((s.withShops / s.malls) * 100))}%"></i></div>
        <div class="actions"><button class="btn primary sm" id="here">📍 الان توی پاساژم</button><a class="btn sm" href="/seller">🏪 مغازه‌دار هستم</a></div>
      </div>
    </section>

    <p class="foot">داده‌ها: OpenStreetMap (${fa(s.malls)} مکان، ${fa(s.streetShops)} مغازه در راسته‌ها، ${fa(s.stations)} ایستگاه مترو) و کاربران پاساژ.<br>
      نقشه از <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="#/me">درباره و تنظیمات</a></p>`;

  $('#q-form', main).onsubmit = (e) => {
    e.preventDefault();
    const q = $('#q', main).value.trim();
    if (q) location.hash = `#/q/${encodeURIComponent(q)}`;
  };
  const askNear = async () => {
    try {
      await geo.start();
      nav.refresh();
      setTimeout(() => $('#near-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) { toast(esc(e.message), 'bad', 6000); }
  };
  $('#near', main).onclick = () => (geo.best ? $('#near-section').scrollIntoView({ behavior: 'smooth' }) : askNear());
  $('#near2', main)?.addEventListener('click', askNear);
  // "I'm in a mall right now": open the nearest one, ready to add shops.
  $('#here', main).onclick = async () => {
    try {
      const p = await geo.start();
      const m = sortByDistance(data.malls)[0];
      if (!m || distance(p, m) > 400) return toast(`پاساژی در ${fmtDist(400)}ی شما ثبت نشده؛ از نقشه پیدایش کنید.`, '', 5000);
      location.hash = `#/m/${encodeURIComponent(m.id)}/add`;
    } catch (e) { toast(esc(e.message), 'bad', 6000); }
  };
}
