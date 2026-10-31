// Seller dashboard: live customer requests, call the customer, send offers, manage discount & products.

import { $, $$, esc, fa, toman, cat, finalPrice, api, toast, timeAgo, store, persist } from './ui.js';
import { distance, fmtDist } from './geo.js';

let shop = null;
let requests = [];
let fresh = new Set();
let es = null;

async function boot() {
  const malls = await api('/malls');
  const selMall = $('#sel-mall'), selStore = $('#sel-store');
  selMall.innerHTML = malls.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  const fillStores = async () => {
    const mall = await api(`/malls/${selMall.value}`);
    selStore.innerHTML = mall.floors.filter((f) => f.stores.length).map((f) => `
      <optgroup label="${esc(f.name)}">${f.stores.map((s) => `<option value="${s.id}">${cat(s.category).icon} ${esc(s.name)}</option>`).join('')}</optgroup>`).join('');
  };
  selMall.onchange = fillStores;
  const saved = store('seller', null);
  if (saved) selMall.value = saved.split('-')[0];
  await fillStores();
  if (saved) selStore.value = saved;
  $('#btn-login').onclick = () => login(selStore.value);
  if (saved && new URLSearchParams(location.search).has('auto')) login(saved);

  for (const b of $$('[data-tab]')) {
    b.onclick = () => {
      for (const x of $$('[data-tab]')) x.classList.toggle('on', x === b);
      for (const t of ['requests', 'discount', 'products']) $(`#tab-${t}`).classList.toggle('hidden', t !== b.dataset.tab);
      if (b.dataset.tab === 'requests') { fresh.clear(); badge(); }
    };
  }
}

async function login(id) {
  if (!id) return;
  shop = await api(`/stores/${id}`);
  persist('seller', id);
  $('#login').classList.add('hidden');
  $('#panel').classList.remove('hidden');
  renderInfo();
  renderDiscount();
  renderProducts();
  requests = await api(`/stores/${id}/requests`);
  renderRequests();
  es?.close();
  es = new EventSource(`/api/events?store=${id}`);
  es.onopen = () => $('#live').classList.remove('hidden');
  es.onerror = () => $('#live').classList.add('hidden');
  es.addEventListener('request', (ev) => {
    const r = JSON.parse(ev.data);
    requests.unshift(r);
    fresh.add(r.id);
    renderRequests();
    badge();
    ring();
    toast(`🔔 مشتری جدید: <b>${esc(r.query)}</b> — ${esc(r.name)}`, 'good', 7000);
    if (window.Notification?.permission === 'granted') new Notification('درخواست مشتری جدید', { body: `${r.query} — ${r.name}` });
  });
  es.addEventListener('closed', (ev) => {
    const { id: rid } = JSON.parse(ev.data);
    const r = requests.find((x) => x.id === rid);
    if (r) { r.status = 'closed'; renderRequests(); }
  });
  if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
}

function renderInfo() {
  const c = cat(shop.category);
  $('#store-info').innerHTML = `
    <div class="store-head">
      <div class="store-ico" style="background:${c.color}">${c.icon}</div>
      <div style="flex:1"><h2 style="margin:0">${esc(shop.name)}</h2>
        <div class="sub">${c.label} · ${esc(shop.mallName)} · ${esc(shop.floorName)} · ☎️ <span dir="ltr">${fa(shop.phone)}</span></div></div>
      <button class="btn small" id="logout">تغییر فروشگاه</button>
    </div>`;
  $('#logout').onclick = () => { es?.close(); persist('seller', null); location.reload(); };
}

function badge() {
  const b = $('#req-badge');
  b.textContent = fa(fresh.size);
  b.classList.toggle('hidden', !fresh.size);
}

function renderRequests() {
  const el = $('#tab-requests');
  if (!requests.length) {
    el.innerHTML = `<div class="box"><div class="sub">هنوز درخواستی نرسیده. وقتی مشتری کالایی بخواهد که شما دارید، همین‌جا به‌صورت زنده نمایش داده می‌شود.</div></div>`;
    return;
  }
  el.innerHTML = requests.map((r) => `
    <div class="req-card ${fresh.has(r.id) ? 'new' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span class="q">🔎 ${esc(r.query)}</span><span class="status ${r.status}">${r.status === 'open' ? 'باز' : 'بسته شد'}</span>
      </div>
      <div class="meta">${timeAgo(r.createdAt)} · ${r.mallName ? 'فقط ' + esc(r.mallName) : 'همه پاساژها'}${r.budget ? ` · بودجه تا ${toman(r.budget)}` : ''}</div>
      ${r.details ? `<div>${esc(r.details)}</div>` : ''}
      <div class="meta">👤 ${esc(r.name)} · <span dir="ltr">${fa(r.phone)}</span>
        ${r.location ? ` · 📍 حدود ${fmtDist(distance(r.location, { lat: shop.mallLat, lng: shop.mallLng }))} از پاساژ شما
          · <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${r.location.lat}&mlon=${r.location.lng}#map=15/${r.location.lat}/${r.location.lng}">نقشه</a>` : ''}</div>
      ${r.myProducts?.length ? `<div class="meta">کالاهای شما: ${r.myProducts.map((p) => `${esc(p.name)} (${toman(finalPrice(p, shop))})`).join('، ')}</div>` : ''}
      <div class="actions-row">
        <a class="btn primary call" href="tel:${esc(r.phone)}">📞 تماس با مشتری</a>
        ${r.status === 'open' ? `<button class="btn purple" data-offer="${r.id}">💬 ارسال پیشنهاد قیمت</button>` : ''}
      </div>
      ${(r.myOffers || []).map((o) => `<div class="offer"><span class="sub">پیشنهاد شما ${timeAgo(o.createdAt)}:</span> ${o.price ? `<span class="price">${toman(o.price)}</span>` : ''} ${esc(o.message)}</div>`).join('')}
      <form class="offer hidden" data-form="${r.id}">
        <div class="row2">
          <div><label>قیمت پیشنهادی (تومان)</label><input class="field" name="price" inputmode="numeric" autocomplete="off" value="${r.myProducts?.[0] ? Math.round(finalPrice(r.myProducts[0], shop)) : ''}"></div>
          <div><label>پیام</label><input class="field" name="message" maxlength="300" enterkeyhint="send" placeholder="موجود است، رنگ مشکی…"></div>
        </div>
        <div class="actions-row"><button class="btn primary" type="submit">ارسال برای مشتری</button></div>
      </form>
    </div>`).join('');
  for (const b of $$('[data-offer]', el)) b.onclick = () => $(`[data-form="${b.dataset.offer}"]`, el).classList.toggle('hidden');
  for (const f of $$('[data-form]', el)) {
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(f);
      try {
        const offer = await api(`/requests/${f.dataset.form}/offers`, { method: 'POST', body: { storeId: shop.id, price: fd.get('price'), message: fd.get('message') } });
        const r = requests.find((x) => x.id === f.dataset.form);
        (r.myOffers ??= []).push(offer);
        renderRequests();
        toast('✅ پیشنهاد برای مشتری ارسال شد', 'good');
      } catch (e) {
        toast(esc(e.message));
      }
    };
  }
}

function renderDiscount() {
  const d = shop.discount;
  $('#tab-discount').innerHTML = `
    <div class="box">
      <h3 style="margin-top:0">تخفیف فعلی: ${d ? `<span class="chip">${fa(d.percent)}٪ — ${esc(d.title)}</span>` : 'ندارد'}</h3>
      <div class="sub">مشتری‌ها وقتی روی نقشه از جلوی مغازه شما رد شوند، اعلان تخفیف می‌گیرند.</div>
      <form id="disc-form" class="row2">
        <div><label>درصد تخفیف</label><input class="field" name="percent" type="number" inputmode="numeric" min="0" max="90" value="${d?.percent ?? 20}"></div>
        <div><label>عنوان</label><input class="field" name="title" maxlength="40" value="${esc(d?.title ?? 'حراج ویژه')}"></div>
        <div class="actions-row"><button class="btn primary" type="submit">ذخیره تخفیف</button>
          ${d ? '<button class="btn danger" type="button" id="disc-off">حذف تخفیف</button>' : ''}</div>
      </form>
    </div>`;
  const submit = async (percent, title) => {
    shop = { ...shop, ...(await api(`/stores/${shop.id}/discount`, { method: 'POST', body: { percent, title } })) };
    renderDiscount();
    renderProducts();
    toast(percent ? '🏷️ تخفیف فعال شد و برای خریداران داخل پاساژ اعلام شد' : 'تخفیف حذف شد', 'good');
  };
  $('#disc-form').onsubmit = (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); submit(Number(fd.get('percent')), fd.get('title')); };
  const off = $('#disc-off');
  if (off) off.onclick = () => submit(0, '');
}

function renderProducts() {
  $('#tab-products').innerHTML = `
    <div class="box">
      <h3 style="margin-top:0">افزودن کالا</h3>
      <form id="prod-form" class="row2">
        <div><label>نام کالا</label><input class="field" name="name" required maxlength="60" autocomplete="off" enterkeyhint="next"></div>
        <div><label>قیمت (تومان)</label><input class="field" name="price" required inputmode="numeric" autocomplete="off" enterkeyhint="next"></div>
        <div style="grid-column:1/-1"><label>کلمات کلیدی (برای پیدا شدن در جستجو و درخواست‌ها)</label><input class="field" name="tags" maxlength="120" autocomplete="off" enterkeyhint="done" placeholder="مثلاً گوشی سامسونگ موبایل"></div>
        <div class="actions-row"><button class="btn primary" type="submit">افزودن</button></div>
      </form>
    </div>
    <div class="box">
      <h3 style="margin-top:0">کالاهای شما (${fa(shop.products.length)})</h3>
      ${shop.products.map((p) => `<div class="product"><div><div class="n">${esc(p.name)}</div><div class="t">${esc(p.tags)}</div></div>
        <div class="p">${shop.discount ? `<span class="old">${toman(p.price)}</span>` : ''}<span class="new">${toman(finalPrice(p, shop))}</span></div></div>`).join('')}
    </div>`;
  $('#prod-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      const p = await api(`/stores/${shop.id}/products`, { method: 'POST', body: Object.fromEntries(fd) });
      shop.products.push(p);
      renderProducts();
      toast('📦 کالا اضافه شد', 'good');
    } catch (e) {
      toast(esc(e.message));
    }
  };
}

let audio;
function ring() {
  try {
    audio ??= new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 988;
      g.gain.setValueAtTime(0.1, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.15);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t);
      o.stop(audio.currentTime + t + 0.16);
    });
  } catch { /* audio not available */ }
}

boot().catch((e) => toast(esc(e.message)));
