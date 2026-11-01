// Shop owners: find your mall, pick your shop (or add it), and keep its details right — what you sell,
// hours, phone, Instagram. No account: the first registration returns a management code that this
// device remembers and that's needed for later edits.

import { $, $$, esc, fa, cat, api, toast, share } from './ui.js';
import { uid, myShops, loadBoot, data } from './data.js';
import { categoryOptions, floorOptions } from './forms.js';
import { tokens, matchScore } from '/shared/text.js';
import { floorName } from '/shared/floors.js';

const main = $('#view');
const params = new URLSearchParams(location.search);

const KIND = { mall: 'مرکز خرید', passage: 'پاساژ', bazaar: 'بازار' };

async function start() {
  main.innerHTML = '<div style="height:20px"></div><div class="skeleton"></div><div class="skeleton"></div>';
  await loadBoot();
  const shopId = params.get('shop');
  if (shopId) {
    // The shop id starts with its mall's id; find the mall whose id is the longest such prefix.
    const mall = [...data.byId.keys()].filter((id) => shopId.startsWith(`${id}-`)).sort((a, b) => b.length - a.length)[0];
    if (mall) return openMall(mall, shopId);
  }
  if (params.get('mall') && data.byId.has(params.get('mall'))) return openMall(params.get('mall'));
  home();
}

function home() {
  const mine = Object.entries(myShops.all());
  main.innerHTML = `
    <section class="hero">
      <h1>مغازه‌تان را ثبت کنید</h1>
      <p>رایگان و بدون حساب کاربری. کسی که در پاساژ دنبال جنس شماست، با اسم مغازه و چیزهایی که می‌فروشید پیدایتان می‌کند.</p>
    </section>
    ${mine.length ? `<section class="section"><div class="section-head"><h2>مغازه‌های من</h2></div><div class="list">
      ${mine.map(([id, x]) => `<a class="row" href="?shop=${encodeURIComponent(id)}"><span class="ico">🏪</span><span class="main"><span class="t">${esc(x.name)}</span>
        <span class="s">${esc(data.byId.get(x.mallId)?.name ?? '')}</span></span><span class="muted">ویرایش</span></a>`).join('')}</div></section>` : ''}
    <section class="section">
      <div class="section-head"><h2>۱. مغازه‌تان در کدام پاساژ است؟</h2></div>
      <div class="search"><span class="ico">🔎</span><input id="mall-q" type="search" autocomplete="off" autofocus placeholder="نام پاساژ یا محله، مثلاً علاءالدین" aria-label="جستجوی پاساژ"></div>
      <div id="mall-results" style="margin-top:10px"></div>
    </section>
    <div class="notice" style="margin-top:24px"><span class="i">💡</span><span>مغازه‌تان در خیابان است، نه پاساژ؟ فعلاً فقط مغازه‌های داخل پاساژ، بازار و مرکز خرید ثبت می‌شوند.</span></div>`;
  const input = $('#mall-q');
  const run = () => {
    const qt = tokens(input.value);
    const list = qt.length ? data.malls.filter((m) => matchScore(qt, `${m.name} ${m.nameEn ?? ''} ${m.hood ?? ''}`) >= 1).slice(0, 15) : [];
    $('#mall-results').innerHTML = list.length ? `<div class="list">${list.map((m) => `<button class="row" data-mall="${esc(m.id)}">
        <span class="ico">🏬</span><span class="main"><span class="t">${esc(m.name)}</span><span class="s">${KIND[m.kind] ?? ''}${m.hood ? ` · ${esc(m.hood)}` : ''} · ${fa(m.shops)} مغازه ثبت‌شده</span></span></button>`).join('')}</div>`
      : qt.length ? '<p class="small muted">پیدا نشد. نام دیگری امتحان کنید (مثلاً بدون «پاساژ»).</p>' : '';
  };
  input.oninput = run;
  $('#mall-results').onclick = (e) => {
    const b = e.target.closest('[data-mall]');
    if (b) openMall(b.dataset.mall);
  };
}

async function openMall(mallId, shopId) {
  main.innerHTML = '<div style="height:20px"></div><div class="skeleton"></div><div class="skeleton"></div>';
  let m;
  try { m = await api(`/malls/${encodeURIComponent(mallId)}`); } catch (e) { toast(esc(e.message), 'bad'); return home(); }
  history.replaceState(null, '', shopId ? `?shop=${encodeURIComponent(shopId)}` : `?mall=${encodeURIComponent(mallId)}`);
  const shop = shopId && m.shops.find((s) => s.id === shopId);
  if (shop || shopId === 'new') return form(m, shop || null);

  main.innerHTML = `
    <p style="margin-top:14px"><button class="btn sm ghost" id="back">→ پاساژ دیگر</button></p>
    <h1 class="page-title">${esc(m.name)}</h1>
    <p class="lead">${KIND[m.kind] ?? ''}${m.hood ? ` · ${esc(m.hood)}` : ''}</p>
    <section class="section">
      <div class="section-head"><h2>۲. مغازه‌تان در این فهرست هست؟</h2></div>
      ${m.shops.length ? `<div class="list">${m.shops.map((s) => `<button class="row" data-shop="${esc(s.id)}">
        <span class="ico" style="--c:${cat(s.category).color}">${cat(s.category).icon}</span>
        <span class="main"><span class="t">${esc(s.name)}</span><span class="s">${esc(cat(s.category).short)}${s.floor ? ` · ${esc(floorName(s.floor))}` : ''}</span></span>
        <span class="muted small">${s.source === 'owner' ? (myShops.all()[s.id] ? 'مال شما' : 'ثبت‌شده توسط مالک') : 'این است'}</span></button>`).join('')}</div>`
        : '<p class="small muted">هنوز مغازه‌ای برای اینجا ثبت نشده.</p>'}
      <div class="actions"><button class="btn primary block" id="new">+ مغازه‌ام در فهرست نیست</button></div>
    </section>`;
  $('#back').onclick = () => { history.replaceState(null, '', location.pathname); home(); };
  $('#new').onclick = () => form(m, null);
  for (const b of $$('[data-shop]')) b.onclick = () => form(m, m.shops.find((s) => s.id === b.dataset.shop));
}

function form(m, s) {
  const mine = s && myShops.all()[s.id];
  const claimed = s?.source === 'owner';
  const [open, close] = s?.hours?.match(/\d{1,2}:\d{2}/g) ?? [];
  history.replaceState(null, '', s ? `?shop=${encodeURIComponent(s.id)}` : `?mall=${encodeURIComponent(m.id)}`);
  main.innerHTML = `
    <p style="margin-top:14px"><button class="btn sm ghost" id="back">→ ${esc(m.name)}</button></p>
    <h1 class="page-title">${s ? (mine ? 'ویرایش مغازه' : `ثبت «${esc(s.name)}» به نام شما`) : 'مغازه جدید'}</h1>
    <p class="lead">${esc(m.name)}</p>
    ${claimed && !mine ? `<div class="notice"><span class="i">🔑</span><span>این مغازه قبلاً توسط مالکش ثبت شده. برای ویرایش، کد مدیریتی که موقع ثبت گرفتید را وارد کنید.</span></div>` : ''}
    <form id="s-form" autocomplete="off">
      ${claimed && !mine ? '<label class="lbl" for="s-token">کد مدیریت مغازه</label><input class="field" id="s-token" name="token" dir="ltr" required>' : ''}
      <label class="lbl" for="s-name">نام مغازه</label>
      <input class="field" id="s-name" name="name" required minlength="2" maxlength="50" value="${esc(s?.name ?? '')}">
      <div class="row2">
        <div><label class="lbl" for="s-cat">دسته</label><select class="field" id="s-cat" name="category" required>${s ? '' : '<option value="" disabled selected>انتخاب کنید</option>'}${categoryOptions(s?.category)}</select></div>
        <div><label class="lbl" for="s-floor">طبقه</label><select class="field" id="s-floor" name="floor">${floorOptions(m.floors, s?.floor)}</select></div>
      </div>
      <label class="lbl" for="s-kw">چه می‌فروشید؟ <span class="muted">(مهم‌ترین بخش برای پیدا شدن)</span></label>
      <textarea class="field" id="s-kw" name="keywords" maxlength="200" placeholder="مثلاً گوشی سامسونگ و شیائومی، قاب و گلس، هندزفری، تعمیر">${esc(s?.keywords ?? '')}</textarea>
      <div class="row2">
        <div><label class="lbl" for="s-open">باز می‌شود</label><input class="field" type="time" id="s-open" name="open" dir="ltr" value="${open?.padStart(5, '0') ?? ''}"></div>
        <div><label class="lbl" for="s-close">بسته می‌شود</label><input class="field" type="time" id="s-close" name="close" dir="ltr" value="${close?.padStart(5, '0') ?? ''}"></div>
      </div>
      <div class="row2">
        <div><label class="lbl" for="s-phone">تلفن</label><input class="field" id="s-phone" name="phone" type="tel" inputmode="tel" dir="ltr" maxlength="16" value="${esc(s?.phone ?? '')}" placeholder="021… یا 09…"></div>
        <div><label class="lbl" for="s-ig">اینستاگرام</label><input class="field" id="s-ig" name="instagram" dir="ltr" maxlength="40" value="${esc(s?.instagram ?? '')}" placeholder="@shop"></div>
      </div>
      <div class="form-error" id="s-err"></div>
      <div class="actions fill"><button class="btn primary" type="submit">${s && mine ? 'ذخیره تغییرات' : 'ثبت مغازه'}</button></div>
      ${mine ? '<div class="actions"><button class="btn sm ghost danger" type="button" id="s-remove">مغازه را از پاساژ بردارید (تعطیل شده / جابه‌جا شده)</button></div>' : ''}
    </form>
    <p class="small muted" style="margin-top:16px">اطلاعات شما برای همه قابل دیدن است. ${s && !claimed ? 'با ثبت، این مغازه به نام شما می‌شود و فقط با کد مدیریت ویرایش می‌شود.' : ''}</p>`;

  $('#back').onclick = () => openMall(m.id);
  const f = $('#s-form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = { ...Object.fromEntries(new FormData(f)), userId: uid };
    if (mine) body.token = mine.token;
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      const r = s
        ? await api(`/shops/${encodeURIComponent(s.id)}`, { method: 'POST', body })
        : await api(`/malls/${encodeURIComponent(m.id)}/shops`, { method: 'POST', body: { ...body, owner: true } });
      myShops.add(r.shop, m.id, r.token ?? body.token);
      done(m, r.shop, r.token ?? (mine ? null : body.token));
    } catch (err) {
      $('#s-err').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  $('#s-remove')?.addEventListener('click', async () => {
    if (!confirm(`«${s.name}» از فهرست ${m.name} برداشته شود؟`)) return;
    try {
      await api(`/shops/${encodeURIComponent(s.id)}`, { method: 'POST', body: { token: mine.token, remove: true } });
      myShops.remove(s.id);
      toast('برداشته شد', 'good');
      openMall(m.id);
    } catch (err) { $('#s-err').textContent = err.message; }
  });
}

function done(m, shop, token) {
  const link = `${location.origin}/#/m/${encodeURIComponent(m.id)}/s/${encodeURIComponent(shop.id)}`;
  main.innerHTML = `
    <div class="empty" style="padding-top:36px"><span class="i">✅</span><h3>«${esc(shop.name)}» ثبت شد</h3>
      <p class="small">از همین حالا در جستجوی پاساژ پیدا می‌شود.</p></div>
    ${token ? `<div class="card accent"><b>کد مدیریت مغازه</b>
      <p class="small" style="margin:4px 0 10px">این گوشی کد را نگه می‌دارد. اگر با گوشی دیگری خواستید ویرایش کنید، این کد لازم است؛ جایی یادداشتش کنید.</p>
      <div class="code">${esc(token)}</div>
      <div class="actions"><button class="btn sm" id="copy">کپی کد</button></div></div>` : ''}
    <div class="card" style="margin-top:12px"><b>به مشتری‌ها خبر دهید</b>
      <p class="small" style="margin:4px 0 10px">لینک مغازه را در اینستاگرام یا واتساپ بگذارید تا مشتری‌ها مسیر و طبقه را پیدا کنند.</p>
      <div class="actions fill"><button class="btn primary" id="share">اشتراک لینک</button><a class="btn" href="${esc(link)}">دیدن صفحه</a></div></div>
    <div class="actions"><button class="btn ghost" id="again">ثبت یا ویرایش مغازه دیگر</button></div>`;
  $('#copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(token); toast('کپی شد', 'good'); } catch { toast('کد را دستی انتخاب و کپی کنید'); }
  });
  $('#share').onclick = () => share(`${shop.name} — ${m.name}`, link);
  $('#again').onclick = () => { history.replaceState(null, '', location.pathname); home(); };
}

start();
