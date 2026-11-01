// Pieces of UI used on several pages: a mall row, a shopping-street card, and the sheets for getting
// somewhere (navigation apps, metro).

import { esc, fa, cat, sheet, openStatus, statusPill, lineBadges } from './ui.js';
import { distTo, fmtDist, walkMin, navLinks } from './geo.js';
import { data, sortByDistance } from './data.js';

export const KIND = { mall: 'مرکز خرید', passage: 'پاساژ', bazaar: 'بازار' };

export const metroText = (s) => (s ? `${lineBadges(s.lines)} مترو ${esc(s.name)} · ${fa(walkMin(s.m))} دقیقه پیاده` : '');

export const statusOf = (m) => openStatus(m.hours, { friday: m.fri });

// What a mall is known for, from its category counts: the top few shopping categories.
export function topCats(m, n = 3) {
  const score = { ...m.cats };
  for (const [k, n] of Object.entries(m.tags ?? {})) score[k] = (score[k] || 0) + n * 2;
  return Object.entries(score)
    .filter(([k]) => cat(k).shop !== false)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// One mall in a list. `focus` highlights a category ("۱۲ مغازه موبایل").
export function mallRow(m, { focus } = {}) {
  const d = distTo(m);
  const st = statusOf(m);
  const known = !focus ? '' : m.cats?.[focus] ? `<span>${cat(focus).icon} ${fa(m.cats[focus])} مغازه ${esc(cat(focus).short)}</span>`
    : m.tags?.[focus] ? `<span>${cat(focus).icon} به گفته ${fa(m.tags[focus])} بازدیدکننده</span>` : '';
  const cats = topCats(m).map((k) => cat(k).icon).join(' ');
  return `<a class="row" href="#/m/${encodeURIComponent(m.id)}">
    <span class="ico" style="--c:${focus ? cat(focus).color : 'var(--brand)'}">${m.kind === 'bazaar' ? '🏮' : m.kind === 'passage' ? '🏬' : '🏢'}</span>
    <span class="main">
      <span class="t">${esc(m.name)}</span>
      <span class="s">${known || (cats ? `<span>${cats}</span>` : '')}${m.hood ? `<span>${esc(m.hood)}</span>` : ''}${m.metro && m.metro.m <= 900 ? `<span>${lineBadges(m.metro.lines)} ${fa(walkMin(m.metro.m))} دقیقه</span>` : ''}</span>
    </span>
    <span class="end">${d != null ? `<b>${fmtDist(d)}</b>` : ''}${st.state !== 'unknown' ? statusPill(st) : ''}</span>
  </a>`;
}

export function mallList(malls, opts) {
  return malls.length ? `<div class="list">${malls.map((m) => mallRow(m, opts)).join('')}</div>` : '';
}

// A shopping street (a cluster of shops of one kind) as a card on a rail.
export function streetCard(h) {
  const c = cat(h.category);
  const d = distTo(h);
  return `<button class="street" data-street="${esc(h.id)}" style="--c:${c.color}">
    <span class="k">${c.icon} ${esc(c.short)}</span>
    <span class="n">${esc(h.name)}</span>
    <span class="m"><span>${fa(h.count)} مغازه</span>${h.metro ? `<span>${lineBadges(h.metro.lines)} ${esc(h.metro.name)}</span>` : ''}${d != null ? `<span>${fmtDist(d)}</span>` : ''}</span>
  </button>`;
}

// The same, as a full-width card with directions, for results pages.
export function streetBlock(h) {
  const c = cat(h.category);
  const d = distTo(h);
  return `<div class="card" style="--c:${c.color}">
    <div class="spot">
      <span class="ico">${c.icon}</span>
      <div class="grow">
        <div class="t">${esc(h.name)}</div>
        <div class="s"><span>حدود ${fa(h.count)} مغازه ${esc(c.short)}</span>${d != null ? `<span>${fmtDist(d)} از شما</span>` : ''}</div>
        ${h.metro ? `<div class="s">${metroText(h.metro)}</div>` : ''}
        ${h.examples?.length ? `<div class="ex">مثل ${h.examples.slice(0, 3).map(esc).join('، ')}</div>` : ''}
      </div>
    </div>
    <div class="actions fill">
      <button class="btn primary sm" data-go-to="${h.lat},${h.lng}" data-name="${esc(h.name)}">🧭 مسیریابی</button>
      <a class="btn sm" href="#/map/s/${encodeURIComponent(h.id)}">🗺️ روی نقشه</a>
    </div>
  </div>`;
}

export function navSheet(p, name) {
  sheet(`<h2>مسیریابی تا ${esc(name)}</h2>
    <div class="sub">با برنامه‌ای که دارید باز کنید.${distTo(p) != null ? ` فاصله مستقیم: ${fmtDist(distTo(p))}` : ''}</div>
    <div class="list" style="margin-top:14px">
      ${navLinks(p, name).map((l) => `<a class="row" href="${esc(l.href)}" target="_blank" rel="noopener"><span class="ico">${l.icon}</span><span class="main"><span class="t">${esc(l.label)}</span></span><span class="muted">↖</span></a>`).join('')}
    </div>
    ${p.metro ? `<div class="notice brand" style="margin-top:12px"><span class="i">🚇</span><span>در ترافیک تهران مترو معمولاً سریع‌تر است: ${metroText(p.metro)}</span></div>` : ''}`);
}

export function streetSheet(h) {
  const c = cat(h.category);
  const nearby = sortByDistance(data.malls.filter((m) => Math.abs(m.lat - h.lat) < 0.005 && Math.abs(m.lng - h.lng) < 0.006)).slice(0, 6);
  const el = sheet(`<h2>${c.icon} ${esc(h.name)}</h2>
    <div class="sub">راسته ${esc(c.label)} · حدود ${fa(h.count)} مغازه در OpenStreetMap ثبت شده</div>
    ${h.metro ? `<p class="small">${metroText(h.metro)}</p>` : ''}
    ${h.examples?.length ? `<p class="small muted">چند مغازه: ${h.examples.map(esc).join('، ')}</p>` : ''}
    <div class="actions fill">
      <button class="btn primary" data-go-to="${h.lat},${h.lng}" data-name="${esc(h.name)}">🧭 مسیریابی</button>
      <a class="btn" href="#/map/s/${encodeURIComponent(h.id)}" data-close>🗺️ روی نقشه</a>
    </div>
    ${nearby.length ? `<h3 style="margin:18px 0 8px;font-size:15px">پاساژهای همین حوالی</h3>${mallList(nearby, { focus: h.category })}` : ''}`);
  el.addEventListener('click', (e) => { if (e.target.closest('a.row')) el.querySelector('[data-close]').click(); });
}

// Buttons anywhere with data-go-to="lat,lng" open the navigation sheet; data-street opens a street.
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go-to]');
  if (g) {
    const [lat, lng] = g.dataset.goTo.split(',').map(Number);
    const h = data.hotspots.find((x) => x.lat === lat && x.lng === lng);
    navSheet({ lat, lng, metro: h?.metro }, g.dataset.name || '');
    return;
  }
  const s = e.target.closest('[data-street]');
  if (s) {
    const h = data.hotspots.find((x) => x.id === s.dataset.street);
    if (h) streetSheet(h);
  }
});
