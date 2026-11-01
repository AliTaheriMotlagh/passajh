// App shell: loads the data, routes between pages and keeps the tab bar and header in step.
//
//   #/            home: what do you want to buy?
//   #/c/<cat>     where to buy a category
//   #/q/<text>    search
//   #/m/<id>      a mall, passage or bazaar
//   #/map[/c/<cat> | /s/<street> | /m/<id>]
//   #/list        shopping list
//   #/me          saved places, parking, my shops

import { $, $$, esc, fa, closeSheet, store } from './ui.js';
import { geo } from './geo.js';
import { loadBoot } from './data.js';
import { nav } from './nav.js';
import * as home from './views/home.js';
import * as find from './views/find.js';
import * as mall from './views/mall.js';
import * as map from './views/map.js';
import * as list from './views/list.js';
import * as me from './views/me.js';

const ROUTES = { '': home, c: find, q: find, m: mall, mall, map, list, me };
const TAB = { '': 'home', c: 'home', q: 'home', m: 'home', mall: 'home', map: 'map', list: 'list', me: 'me' };

let leave = null;
let lastHash = null;
const scrolls = new Map();

async function route() {
  const hash = location.hash || '#/';
  const [, page = '', ...params] = hash.split('/').map((p) => decodeURIComponent(p));
  if (lastHash) scrolls.set(lastHash, scrollY);
  lastHash = hash;
  closeSheet(true);
  leave?.();
  leave = null;

  const view = ROUTES[page] ?? home;
  document.body.classList.toggle('map-mode', view === map);
  for (const a of $$('.tabbar a')) a.classList.toggle('on', a.dataset.tab === TAB[page]);
  const main = $('#view');
  const header = $('#header');
  try {
    leave = (await view.render({ main, header, page, params })) ?? null;
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="empty"><span class="i">⚠️</span><h3>این صفحه باز نشد</h3><p>${esc(e.message)}</p><a class="btn" href="#/">برگشت به خانه</a></div>`;
  }
  scrollTo(0, scrolls.get(hash) ?? 0);
}

// Re-render the current page (after data changed), keeping the scroll position.
function refresh() {
  scrolls.set(location.hash || '#/', scrollY);
  lastHash = null;
  route();
}

function renderListCount() {
  const n = store('list', []).filter((i) => !i.done).length;
  const b = $('#list-count');
  b.textContent = n ? fa(n) : '';
  b.classList.toggle('hidden', !n);
}

addEventListener('scroll', () => $('#header').classList.toggle('scrolled', scrollY > 4), { passive: true });
const online = () => $('#offline').classList.toggle('hidden', navigator.onLine);
addEventListener('online', online);
addEventListener('offline', online);

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

nav.refresh = refresh;
nav.listCount = renderListCount;
online();
renderListCount();
$('#view').innerHTML = '<div style="height:24px"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
try {
  await loadBoot(() => { if (!document.querySelector('.sheet')) refresh(); });
} catch {
  $('#view').innerHTML = '<div class="empty"><span class="i">📡</span><h3>اتصال برقرار نشد</h3><p>اینترنت را بررسی کنید و دوباره امتحان کنید.</p><button class="btn primary" onclick="location.reload()">تلاش دوباره</button></div>';
  throw new Error('offline on first visit');
}
addEventListener('hashchange', route);
route();
// Location was allowed on an earlier visit: sort by distance without asking again.
geo.resume().then(() => {
  if (geo.pos && (['#/', '', '#/me'].includes(location.hash) || /^#\/(c|q)\//.test(location.hash))) refresh();
});
