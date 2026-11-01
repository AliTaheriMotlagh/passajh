// Shopping list that plans the trip: each item is matched to what it is (a phone case → mobile) and the
// list suggests where to buy each kind, nearest first, with the metro. Kept on this device only.

import { $, $$, esc, fa, cat, store, persist, toast } from '../ui.js';
import { geo, distance, fmtDist } from '../geo.js';
import { streetsOf, mallsWith, sortByDistance } from '../data.js';
import { CATEGORIES, SHOP_CATEGORIES, detectCategories } from '/shared/catalog.js';
import { metroText } from '../parts.js';
import { nav } from '../nav.js';

const items = () => store('list', []);
const save = (list) => { persist('list', list); nav.listCount(); };

// The best place for a category: the nearest shopping street (or the biggest), else a mall that has it.
function placeFor(category) {
  const streets = streetsOf(category);
  const s = geo.best ? sortByDistance(streets)[0] : [...streets].sort((a, b) => b.count - a.count)[0];
  if (s) return { kind: 'street', id: s.id, name: s.name, lat: s.lat, lng: s.lng, metro: s.metro, note: `حدود ${fa(s.count)} مغازه` };
  const malls = mallsWith(category);
  const m = geo.best ? sortByDistance(malls)[0] : [...malls].sort((a, b) => (b.cats?.[category] ?? 0) - (a.cats?.[category] ?? 0))[0];
  if (m) return { kind: 'mall', id: m.id, name: m.name, lat: m.lat, lng: m.lng, metro: m.metro, note: m.cats?.[category] ? `${fa(m.cats[category])} مغازه ثبت‌شده` : 'به گفته بازدیدکنندگان' };
  return null;
}

export function render({ main, header }) {
  header.innerHTML = '<span class="title">لیست خرید</span>';
  const list = items();
  const open = list.filter((i) => !i.done);
  const cats = [...new Set(open.map((i) => i.cat).filter(Boolean))];
  const plan = cats.map((k) => ({ k, place: placeFor(k), items: open.filter((i) => i.cat === k) }));
  // Places within a kilometre of each other can be done in one trip.
  const near = plan.filter((p) => p.place).length > 1
    && plan.every((p) => !p.place || plan.every((q) => !q.place || distance(p.place, q.place) < 1500));

  main.innerHTML = `
    <section class="hero"><h1>چی باید بخری؟</h1><p>بنویس؛ برایت پیدا می‌کنیم هر کدام را کجا بخری.</p></section>
    <form class="inline-form" id="l-form" style="margin-top:8px">
      <input class="field" id="l-text" maxlength="80" enterkeyhint="done" autocomplete="off" placeholder="مثلاً قاب گوشی، لامپ، کفش ورزشی" aria-label="کالای جدید">
      <button class="btn primary" type="submit">افزودن</button>
    </form>

    ${list.length ? `<section class="section"><div class="list">${list.map((i) => `
      <div class="row static todo ${i.done ? 'done' : ''}">
        <input type="checkbox" data-done="${i.id}" ${i.done ? 'checked' : ''} aria-label="خریدم">
        <span class="main"><span class="t">${esc(i.text)}</span>
          <span class="s">${i.cat ? `<a href="#/c/${i.cat}">${cat(i.cat).icon} ${esc(cat(i.cat).short)}</a>` : `<select class="chip" data-cat="${i.id}" aria-label="دسته"><option value="">دسته؟</option>${SHOP_CATEGORIES.map((k) => `<option value="${k}">${CATEGORIES[k].icon} ${esc(CATEGORIES[k].short)}</option>`).join('')}</select>`}</span></span>
        <button class="btn ghost sm icon" data-del="${i.id}" aria-label="حذف">✕</button>
      </div>`).join('')}</div>
      ${list.some((i) => i.done) ? '<div class="actions"><button class="btn sm ghost" id="l-clear">پاک کردن خریده‌شده‌ها</button></div>' : ''}
    </section>` : `<div class="empty"><span class="i">📝</span><h3>لیست خالی است</h3><p class="small">چند چیز اضافه کنید تا برنامه خرید را ببینید.</p></div>`}

    ${plan.length ? `<section class="section">
      <div class="section-head"><h2>برنامه خرید</h2>${geo.best ? '' : '<button class="btn sm ghost" id="l-near">📍 نزدیک من</button>'}</div>
      ${near ? '<div class="notice brand" style="margin-bottom:10px"><span class="i">✨</span><span>همه نزدیک هم‌اند؛ می‌شود در یک سفر خرید کرد.</span></div>' : ''}
      ${plan.map(({ k, place, items: its }) => `<div class="card" style="--c:${cat(k).color}">
        <div class="spot"><span class="ico">${cat(k).icon}</span><div class="grow">
          <div class="small muted">${its.map((i) => esc(i.text)).join('، ')}</div>
          ${place ? `<div class="t">${esc(place.name)}</div>
            <div class="s"><span>${place.note}</span>${geo.best ? `<span>${fmtDist(distance(geo.best, place))}</span>` : ''}</div>
            ${place.metro ? `<div class="s">${metroText(place.metro)}</div>` : ''}`
          : `<div class="t">هنوز جایی برای ${esc(cat(k).short)} ثبت نشده</div>`}
        </div></div>
        <div class="actions fill">
          ${place ? `<button class="btn primary sm" data-go-to="${place.lat},${place.lng}" data-name="${esc(place.name)}">🧭 مسیریابی</button>
            ${place.kind === 'mall' ? `<a class="btn sm" href="#/m/${encodeURIComponent(place.id)}">مشاهده</a>` : `<button class="btn sm" data-street="${esc(place.id)}">جزئیات</button>`}` : ''}
          <a class="btn sm ghost" href="#/c/${k}">جاهای دیگر</a>
        </div>
      </div>`).join('')}
    </section>` : ''}`;

  $('#l-form', main).onsubmit = (e) => {
    e.preventDefault();
    const text = $('#l-text', main).value.trim();
    if (!text) return;
    const guess = detectCategories(text)[0]?.[0];
    const k = guess && CATEGORIES[guess].shop !== false ? guess : null;
    save([...items(), { id: Date.now().toString(36), text, cat: k, done: false }]);
    if (!k) toast('دسته‌اش را تشخیص ندادیم؛ از فهرست انتخاب کنید');
    nav.refresh();
    setTimeout(() => $('#l-text')?.focus(), 30);
  };
  for (const b of $$('[data-done]', main)) {
    b.onchange = () => { save(items().map((i) => (i.id === b.dataset.done ? { ...i, done: b.checked } : i))); nav.refresh(); };
  }
  for (const b of $$('[data-del]', main)) {
    b.onclick = () => { save(items().filter((i) => i.id !== b.dataset.del)); nav.refresh(); };
  }
  for (const s of $$('select[data-cat]', main)) {
    s.onchange = () => { save(items().map((i) => (i.id === s.dataset.cat ? { ...i, cat: s.value || null } : i))); nav.refresh(); };
  }
  $('#l-clear', main)?.addEventListener('click', () => { save(items().filter((i) => !i.done)); nav.refresh(); });
  $('#l-near', main)?.addEventListener('click', async () => {
    try { await geo.start(); nav.refresh(); } catch (e) { toast(esc(e.message), 'bad', 6000); }
  });
}
