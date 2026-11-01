// Me: where I parked, saved and recent places, the shops I registered, settings, and a plain account
// of where the data comes from and what it doesn't know.

import { $, esc, fa, store, persist, timeAgo, sheet, toast } from '../ui.js';
import { geo, distance, fmtDist } from '../geo.js';
import { data, saved, myShops, contributions } from '../data.js';
import { mallList, navSheet } from '../parts.js';
import { parkingSheet } from '../forms.js';
import { nav } from '../nav.js';

let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function render({ main, header }) {
  header.innerHTML = '<span class="title">من</span>';
  const car = store('parking', null);
  const savedMalls = saved.all().map((id) => data.byId.get(id)).filter(Boolean);
  const recent = store('recent', []).map((id) => data.byId.get(id)).filter((m) => m && !saved.has(m.id)).slice(0, 5);
  const shops = Object.entries(myShops.all());
  const s = data.stats;
  const n = contributions.count();

  main.innerHTML = `
    <section class="section" style="margin-top:12px">
      <div class="section-head"><h2>🚗 ماشین من</h2></div>
      ${car ? `<div class="card accent">
          <div class="t" style="font-weight:900">${esc(car.note || 'جای پارک ذخیره شده')}</div>
          <div class="small muted">${car.mallName ? `${esc(car.mallName)} · ` : ''}${timeAgo(car.at)}${car.lat && geo.best ? ` · ${fmtDist(distance(geo.best, car))} از شما` : ''}</div>
          <div class="actions fill">${car.lat ? '<button class="btn primary sm" id="car-go">🧭 مسیر تا ماشین</button>' : ''}<button class="btn sm" id="car-clear">پاک کن</button></div>
        </div>`
      : `<div class="card soft"><p class="small" style="margin:0 0 8px">در پارکینگ‌های بزرگ، شماره ستون یادتان می‌رود. همین‌جا ذخیره‌اش کنید.</p>
          <button class="btn sm" id="car-new">ذخیره جای پارک</button></div>`}
    </section>

    <section class="section">
      <div class="section-head"><h2>♥ ذخیره‌شده‌ها</h2></div>
      ${savedMalls.length ? mallList(savedMalls) : '<p class="small muted">با دکمه ♡ در صفحه هر پاساژ، اینجا نگهش دارید.</p>'}
    </section>

    ${recent.length ? `<section class="section"><div class="section-head"><h2>اخیراً دیده‌شده</h2></div>${mallList(recent)}
      <p class="small muted">این‌ها بدون اینترنت هم باز می‌شوند.</p></section>` : ''}

    <section class="section">
      <div class="section-head"><h2>🏪 مغازه‌های من</h2><a class="more" href="/seller">ثبت مغازه ←</a></div>
      ${shops.length ? `<div class="list">${shops.map(([id, x]) => `<a class="row" href="/seller?shop=${encodeURIComponent(id)}">
          <span class="ico">🏪</span><span class="main"><span class="t">${esc(x.name)}</span><span class="s">${esc(data.byId.get(x.mallId)?.name ?? '')}</span></span><span class="muted">ویرایش</span></a>`).join('')}</div>`
        : '<p class="small muted">مغازه دارید؟ ثبتش کنید تا کسی که دنبال جنس شماست پیدایتان کند. رایگان است و حساب کاربری نمی‌خواهد.</p>'}
    </section>

    ${n ? `<div class="card brand" style="margin-top:20px"><b>ممنون! 🙏</b><p class="small" style="margin:4px 0 0">${fa(n)} بار به کامل‌تر شدن اطلاعات پاساژها کمک کرده‌اید.</p></div>` : ''}

    <section class="section">
      <div class="section-head"><h2>تنظیمات</h2></div>
      <div class="list">
        <div class="row static"><span class="ico">📍</span><span class="main"><span class="t">موقعیت من</span>
          <span class="s">${geo.active ? 'روشن — فهرست‌ها بر اساس فاصله مرتب می‌شوند' : 'خاموش — فقط وقتی «نزدیک من» را بزنید روشن می‌شود'}</span></span>
          <button class="btn sm" id="geo-t">${geo.active ? 'خاموش' : 'روشن'}</button></div>
        ${!standalone() && (installPrompt || isIOS) ? `<div class="row static"><span class="ico">📲</span><span class="main"><span class="t">نصب روی گوشی</span><span class="s">مثل یک اپ، بدون مارکت</span></span><button class="btn sm" id="install">نصب</button></div>` : ''}
        <div class="row static"><span class="ico">🧹</span><span class="main"><span class="t">پاک کردن اطلاعات این گوشی</span><span class="s">ذخیره‌ها، لیست خرید، جای پارک</span></span><button class="btn sm danger" id="wipe">پاک کن</button></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>این اطلاعات از کجاست؟</h2></div>
      <div class="card facts small">
        <div class="fact"><span class="i">🗺️</span><span class="v"><b>${fa(s.malls)} مرکز خرید، پاساژ و بازار تهران</b><span class="muted">از OpenStreetMap، نقشه آزادی که داوطلبان می‌سازند (به‌روزرسانی ${new Date(s.updated).toLocaleDateString('fa-IR')}).</span></span></div>
        <div class="fact"><span class="i">🛍️</span><span class="v"><b>${fa(s.streetShops)} مغازه در راسته‌ها</b><span class="muted">از روی آن‌ها معلوم کرده‌ایم هر جنس در کدام خیابان جمع شده است.</span></span></div>
        <div class="fact"><span class="i">🚇</span><span class="v"><b>${fa(s.stations)} ایستگاه مترو</b><span class="muted">فاصله‌ها مستقیم است؛ پیاده کمی بیشتر می‌شود.</span></span></div>
        <div class="fact"><span class="i">⚠️</span><span class="v"><b>چیزهایی که نمی‌دانیم</b><span class="muted">قیمت و موجودی کالا، بیشتر ساعت‌های کاری، و مغازه‌های داخل ${fa(s.malls - s.withShops)} پاساژ. همین‌ها را شما و مغازه‌دارها کامل می‌کنید.</span></span></div>
      </div>
      <p class="foot"><a href="/seller">پنل مغازه‌داران</a> · <a href="/editor">ویرایشگر نقشه طبقات</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></p>
    </section>`;

  $('#car-go', main)?.addEventListener('click', () => navSheet({ lat: car.lat, lng: car.lng }, 'ماشین من'));
  $('#car-clear', main)?.addEventListener('click', () => { persist('parking', null); nav.refresh(); });
  $('#car-new', main)?.addEventListener('click', () => {
    const near = geo.best ? data.malls.find((m) => distance(geo.best, m) < 250) : null;
    parkingSheet(near ? { ...near, floors: [] } : null);
  });
  $('#geo-t', main).onclick = async () => {
    if (geo.active) geo.stop();
    else { try { await geo.start(); } catch (e) { toast(esc(e.message), 'bad', 6000); } }
    nav.refresh();
  };
  $('#install', main)?.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => {});
      installPrompt = null;
      return nav.refresh();
    }
    sheet(`<h2>📲 نصب روی آیفون</h2><ol class="small" style="line-height:2.2">
      <li>در Safari دکمه <b>اشتراک‌گذاری</b> (مربع با فلش رو به بالا) را بزنید.</li>
      <li><b>Add to Home Screen</b> را انتخاب کنید.</li><li><b>Add</b> را بزنید.</li></ol>`);
  });
  $('#wipe', main).onclick = () => {
    if (!confirm('ذخیره‌ها، لیست خرید، جای پارک و کدهای مغازه از این گوشی پاک شود؟')) return;
    for (const k of Object.keys(localStorage)) if (k.startsWith('passajh.') && !k.endsWith('.uid')) localStorage.removeItem(k);
    nav.listCount();
    nav.refresh();
  };
}
