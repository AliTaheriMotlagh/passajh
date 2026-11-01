// "Where do I buy X?": the shopping streets for it, the malls and passages that have it, and — for a
// typed search — shops and places by name. Says plainly when little is known.

import { $, $$, esc, fa, cat, api, toast } from '../ui.js';
import { geo, distTo, fmtDist } from '../geo.js';
import { mallsWith, streetsOf, mallsNamed, sortByDistance } from '../data.js';
import { CATEGORIES, detectCategories } from '/shared/catalog.js';
import { mallList, streetBlock, statusOf } from '../parts.js';
import { nav } from '../nav.js';

const filters = { open: false, metro: false };

export async function render({ main, header, page, params }) {
  const q = page === 'q' ? params.join('/') : '';
  const category = page === 'c' ? params[0] : null;
  if (page === 'c' && !CATEGORIES[category]) { location.replace('#/'); return; }

  header.innerHTML = `<a class="btn ghost icon back" href="#/" aria-label="بازگشت">→</a>
    <form class="search grow" id="q-form" role="search" style="box-shadow:none">
      <input id="q" type="search" enterkeyhint="search" autocomplete="off" value="${esc(q)}" placeholder="${category ? `${esc(cat(category).short)}… یا چیز دیگر` : 'چی می‌خوای بخری؟'}" aria-label="جستجو" style="padding:10px 12px">
    </form>`;
  $('#q-form', header).onsubmit = (e) => {
    e.preventDefault();
    const v = $('#q', header).value.trim();
    if (v) location.hash = `#/q/${encodeURIComponent(v)}`;
  };

  if (category) return renderCategory(main, category);

  // A search: what category it's about, places by name, shops by name or "what we sell".
  const cats = detectCategories(q);
  const best = cats.filter(([, s]) => s >= 2).map(([k]) => k);
  const guess = best.length ? best : cats.slice(0, 1).map(([k]) => k);
  const named = mallsNamed(q, 8);
  main.innerHTML = `
    <h1 class="page-title">«${esc(q)}»</h1>
    ${guess.length ? `<p class="lead" style="margin:0 0 6px">${guess.length > 1 ? 'این‌ها را پیدا کردیم:' : 'دسته مرتبط:'}</p>
      <div class="tags">${guess.map((k) => `<a class="chip on" href="#/c/${k}">${cat(k).icon} ${esc(cat(k).label)}</a>`).join('')}</div>` : ''}
    <div id="cat-block"></div>
    ${named.length ? `<section class="section"><div class="section-head"><h2>مکان‌ها با این نام</h2></div>${mallList(named)}</section>` : ''}
    <section class="section" id="shops-block"><div class="skeleton"></div></section>`;
  if (guess[0]) $('#cat-block', main).innerHTML = categoryBody(guess[0], { compact: true });

  let shops = [];
  try {
    shops = (await api(`/search?q=${encodeURIComponent(q)}`)).shops;
  } catch {
    $('#shops-block', main).innerHTML = '<p class="small muted">جستجوی مغازه‌ها به اینترنت نیاز دارد.</p>';
    return;
  }
  const box = $('#shops-block', main);
  if (!box) return;
  const ordered = geo.best ? sortByDistance(shops) : shops;
  box.innerHTML = ordered.length ? `<div class="section-head"><h2>مغازه‌ها</h2></div>
    <div class="list">${ordered.slice(0, 25).map((s) => `<a class="row" href="#/m/${encodeURIComponent(s.mallId)}/s/${encodeURIComponent(s.id)}">
      <span class="ico" style="--c:${cat(s.category).color}">${cat(s.category).icon}</span>
      <span class="main"><span class="t">${esc(s.name)}</span><span class="s"><span>${esc(s.mallName)}</span><span>${esc(cat(s.category).short)}</span></span></span>
      ${distTo(s) != null ? `<span class="end">${fmtDist(distTo(s))}</span>` : ''}</a>`).join('')}</div>` : '';
  if (!ordered.length && !named.length && !guess.length) {
    box.innerHTML = `<div class="empty"><span class="i">🤷</span><h3>چیزی پیدا نشد</h3>
      <p>اسم جنس را ساده‌تر بنویسید (مثلاً «گوشی» به‌جای مدل دقیق) یا از دسته‌ها انتخاب کنید.</p>
      <a class="btn" href="#/">دیدن دسته‌ها</a></div>`;
  }
}

function renderCategory(main, category) {
  const c = cat(category);
  main.innerHTML = `
    <h1 class="page-title">${c.icon} ${esc(c.label)} کجا بخریم؟</h1>
    <div class="chips" id="filters">
      <button class="chip ${geo.best ? 'on' : ''}" data-f="near">📍 ${geo.best ? 'به ترتیب فاصله' : 'نزدیک من'}</button>
      <button class="chip ${filters.open ? 'on' : ''}" data-f="open">🟢 باز است</button>
      <button class="chip ${filters.metro ? 'on' : ''}" data-f="metro">🚇 نزدیک مترو</button>
      <a class="chip" href="#/map/c/${category}">🗺️ نقشه</a>
    </div>
    ${categoryBody(category)}`;
  for (const b of $$('[data-f]', main)) {
    b.onclick = async () => {
      if (b.dataset.f === 'near') {
        try { await geo.start(); } catch (e) { return toast(esc(e.message), 'bad', 6000); }
      } else {
        filters[b.dataset.f] = !filters[b.dataset.f];
      }
      nav.refresh();
    };
  }
}

// Streets first (that's where most shops are), then malls and passages, then a note on coverage.
function categoryBody(category, { compact = false } = {}) {
  const c = cat(category);
  let streets = streetsOf(category);
  streets = geo.best ? sortByDistance(streets) : streets.sort((a, b) => b.count - a.count);
  let malls = mallsWith(category);
  const total = malls.length;
  if (filters.open && !compact) malls = malls.filter((m) => statusOf(m).state === 'open');
  if (filters.metro && !compact) malls = malls.filter((m) => m.metro && m.metro.m <= 700);
  const score = (m) => (m.cats?.[category] ?? 0) + (m.tags?.[category] ?? 0) * 2;
  malls = geo.best ? sortByDistance(malls) : malls.sort((a, b) => score(b) - score(a));
  const shown = malls.slice(0, compact ? 6 : 40);
  const hidden = total - malls.length;

  return `
    ${streets.length ? `<section class="section">
      <div class="section-head"><h2>راسته‌های ${esc(c.short)}</h2></div>
      <p class="lead">جاهایی که مغازه‌های ${esc(c.short)} کنار هم جمع شده‌اند؛ برای مقایسه و قیمت گرفتن بهترین‌اند.</p>
      ${streets.slice(0, compact ? 2 : 6).map(streetBlock).join('')}
    </section>` : ''}
    <section class="section">
      <div class="section-head"><h2>پاساژها و مراکز خرید</h2>${compact && malls.length > shown.length ? `<a class="more" href="#/c/${category}">همه (${fa(malls.length)}) ←</a>` : ''}</div>
      ${shown.length ? mallList(shown, { focus: category }) : `<div class="card soft"><p class="small" style="margin:0">${total ? 'با این فیلترها چیزی نماند.' : `هنوز پاساژی با مغازه ${esc(c.short)} ثبت نشده.`}</p></div>`}
      ${hidden > 0 && !compact ? `<p class="small muted">${fa(hidden)} مکان دیگر با فیلترها پنهان شد${filters.open ? ' (ساعت کاری خیلی از پاساژها ثبت نشده)' : ''}.</p>` : ''}
    </section>
    ${compact ? '' : `<div class="notice" style="margin-top:20px"><span class="i">ℹ️</span><span>این فهرست از مغازه‌هایی است که در OpenStreetMap و توسط کاربران ثبت شده و کامل نیست.
      اگر جایی را می‌شناسید که ${esc(c.short)} دارد، در صفحه همان پاساژ با «این پاساژ چی دارد؟» اضافه‌اش کنید.</span></div>`}`;
}

