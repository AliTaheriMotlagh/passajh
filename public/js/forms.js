// The small forms that fill in what's missing: add a shop, say a shop is still there or gone, say what a
// mall sells, report its real opening hours or that it closed down — and remember where I parked.

import { $, $$, esc, fa, cat, api, toast, sheet, closeSheet, persist, timeAgo } from './ui.js';
import { geo, distance, fmtDist } from './geo.js';
import { uid, loadMall, keep, myVotes, myShops, contributions } from './data.js';
import { CATEGORIES, SHOP_CATEGORIES } from '/shared/catalog.js';
import { floorName } from '/shared/floors.js';

const SOURCE = { osm: 'OpenStreetMap', user: 'یک بازدیدکننده', owner: 'مالک مغازه' };
const OTHER = ['food', 'services', 'cinema', 'other'];

export const categoryOptions = (selected) => `
  <optgroup label="فروشگاه">${SHOP_CATEGORIES.map((k) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${CATEGORIES[k].icon} ${esc(CATEGORIES[k].label)}</option>`).join('')}</optgroup>
  <optgroup label="سایر">${OTHER.map((k) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${CATEGORIES[k].icon} ${esc(CATEGORIES[k].label)}</option>`).join('')}</optgroup>`;

export const floorOptions = (floors, selected) => `<option value="">نمی‌دانم</option>${floors.filter((f) => f.id[0] !== 'P')
  .map((f) => `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${esc(f.name ?? floorName(f.id))}</option>`).join('')}`;

const nearMall = (m) => geo.best && distance(geo.best, m) < 300;

async function reload(m, draw) {
  try { draw(await loadMall(m.id, { fresh: true })); } catch { /* offline: the page keeps what it shows */ }
}

// ---------- add a shop ----------

export function addShopSheet(m, draw) {
  let added = 0;
  let last = { category: null, floor: null };
  const el = sheet(`<h2>افزودن مغازه</h2>
    <div class="sub">${esc(m.name)} · همان چیزی که روی تابلوی مغازه می‌بینید؛ لازم نیست کامل باشد.</div>
    <form id="f-shop" autocomplete="off">
      <label class="lbl" for="f-name">نام مغازه</label>
      <input class="field" id="f-name" name="name" required minlength="2" maxlength="50" enterkeyhint="next" autofocus placeholder="مثلاً موبایل آریا">
      <div class="row2">
        <div><label class="lbl" for="f-cat">چه می‌فروشد؟</label><select class="field" id="f-cat" name="category" required><option value="" disabled selected>انتخاب کنید</option>${categoryOptions()}</select></div>
        <div><label class="lbl" for="f-floor">طبقه</label><select class="field" id="f-floor" name="floor">${floorOptions(m.floors)}</select></div>
      </div>
      <label class="lbl" for="f-kw">جزئیات <span class="muted">(اختیاری، برای پیدا شدن در جستجو)</span></label>
      <input class="field" id="f-kw" name="keywords" maxlength="200" placeholder="مثلاً قاب و گلس، لوازم جانبی آیفون">
      <label class="lbl" for="f-phone">تلفن <span class="muted">(اختیاری)</span></label>
      <input class="field" id="f-phone" name="phone" type="tel" inputmode="tel" dir="ltr" maxlength="16" placeholder="021…">
      <label class="check"><input type="checkbox" name="here" ${nearMall(m) ? 'checked' : ''}> الان در همین پاساژ هستم و مغازه را می‌بینم</label>
      <div class="form-error" id="f-err"></div>
      <div class="actions fill"><button class="btn primary" type="submit">ثبت مغازه</button></div>
    </form>
    <p class="small muted" id="f-done"></p>`, { onClose: () => { if (added) reload(m, draw); } });

  const form = $('#f-shop', el);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await api(`/malls/${encodeURIComponent(m.id)}/shops`, { method: 'POST', body: { ...fd, here: fd.here === 'on', userId: uid } });
      added++;
      contributions.add();
      last = { category: fd.category, floor: fd.floor };
      toast(`✅ «${esc(fd.name)}» اضافه شد. ممنون!`, 'good');
      // Ready for the next shop on the same floor.
      form.reset();
      $('#f-cat', form).value = last.category;
      $('#f-floor', form).value = last.floor;
      $('#f-err', form).textContent = '';
      $('#f-done', el).textContent = `${fa(added)} مغازه ثبت کردید. مغازه بعدی را بنویسید یا ببندید.`;
      $('#f-name', form).focus();
    } catch (err) {
      $('#f-err', form).textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
}

// ---------- one shop ----------

export function shopSheet(m, s, draw) {
  const c = cat(s.category);
  const tel = s.phone?.replace(/[^\d+]/g, '');
  const ig = s.instagram?.replace(/^.*instagram\.com\//, '').replace(/[/@]/g, '');
  const vote = myVotes.get(`shop:${s.id}`);
  const mine = myShops.all()[s.id];
  const el = sheet(`<h2>${c.icon} ${esc(s.name)}</h2>
    <div class="sub">${esc(c.label)} · ${s.floor ? esc(floorName(s.floor)) : 'طبقه نامشخص'}</div>
    <div class="facts" style="margin-top:14px">
      ${s.keywords ? `<div class="fact"><span class="i">🏷️</span><span class="v"><b>${esc(s.keywords)}</b></span></div>` : ''}
      ${s.hours ? `<div class="fact"><span class="i">🕘</span><span class="v"><b>${esc(fa(s.hours))}</b></span></div>` : ''}
      ${s.phone ? `<div class="fact"><span class="i">📞</span><span class="v"><b class="ltr">${esc(fa(s.phone))}</b></span></div>` : ''}
      <div class="fact"><span class="i">ℹ️</span><span class="v"><span class="muted">ثبت توسط ${SOURCE[s.source] ?? 'کاربران'}${s.at ? ` · ${timeAgo(s.at)}` : ''}${s.source === 'owner' ? ' ✓' : ''}</span></span></div>
    </div>
    ${tel || ig || s.website ? `<div class="actions fill">
      ${tel ? `<a class="btn primary" href="tel:${esc(tel)}">📞 تماس</a>` : ''}
      ${ig ? `<a class="btn" href="https://instagram.com/${encodeURIComponent(ig)}" target="_blank" rel="noopener">📷 اینستاگرام</a>` : ''}
      ${s.website ? `<a class="btn" href="${esc(/^https?:/.test(s.website) ? s.website : `https://${s.website}`)}" target="_blank" rel="noopener">🌐 سایت</a>` : ''}
    </div>` : ''}
    <div class="card soft" style="margin-top:16px">
      <b>این مغازه هنوز اینجاست؟</b>
      <div class="actions fill" id="s-votes">
        <button class="btn ${vote === 'here' ? 'primary' : ''}" data-vote="here">👍 هست${s.here ? ` (${fa(s.here)})` : ''}</button>
        <button class="btn ${vote === 'gone' ? 'primary' : ''}" data-vote="gone">👎 دیگر نیست${s.gone ? ` (${fa(s.gone)})` : ''}</button>
      </div>
    </div>
    <p class="small" style="margin-top:14px">${mine ? `<a href="/seller?shop=${encodeURIComponent(s.id)}">✏️ ویرایش مغازه من</a>`
      : s.source === 'owner' ? '' : `مالک این مغازه هستید؟ <a href="/seller?shop=${encodeURIComponent(s.id)}">اطلاعاتش را خودتان ثبت و به‌روز کنید ←</a>`}</p>`);

  for (const b of $$('[data-vote]', el)) {
    b.onclick = async () => {
      const next = vote === b.dataset.vote ? null : b.dataset.vote;
      try {
        await api(`/shops/${encodeURIComponent(s.id)}/vote`, { method: 'POST', body: { userId: uid, vote: next } });
        myVotes.set(`shop:${s.id}`, next);
        if (next) contributions.add();
        toast(next ? 'ممنون! نظرتان ثبت شد' : 'رأی برداشته شد', 'good');
        closeSheet();
        reload(m, draw);
      } catch (e) { toast(esc(e.message), 'bad'); }
    };
  }
}

// ---------- what does this mall sell? ----------

export function tagSheet(m, draw) {
  const mine = new Set(SHOP_CATEGORIES.filter((k) => myVotes.get(`tag:${m.id}:${k}`)));
  const el = sheet(`<h2>${esc(m.name)} بیشتر چه می‌فروشد؟</h2>
    <div class="sub">هر چند تا که درست است انتخاب کنید. این کمک می‌کند کسی که دنبال همین جنس است، اینجا را پیدا کند.</div>
    <div class="seg" style="margin-top:14px">${SHOP_CATEGORIES.map((k) => `<label><input type="checkbox" value="${k}" ${mine.has(k) ? 'checked' : ''}><span>${CATEGORIES[k].icon} ${esc(CATEGORIES[k].short)}</span></label>`).join('')}</div>
    <div class="form-error" id="t-err"></div>
    <div class="actions fill"><button class="btn primary" id="t-save">ثبت</button></div>`);
  $('#t-save', el).onclick = async () => {
    const chosen = new Set($$('input:checked', el).map((i) => i.value));
    const changes = SHOP_CATEGORIES.filter((k) => chosen.has(k) !== mine.has(k));
    if (!changes.length) return closeSheet();
    try {
      let fresh;
      for (const k of changes) {
        fresh = await api(`/malls/${encodeURIComponent(m.id)}/vote`, { method: 'POST', body: { userId: uid, kind: 'tag', category: k, on: chosen.has(k) } });
        myVotes.set(`tag:${m.id}:${k}`, chosen.has(k) || null);
      }
      contributions.add();
      keep(fresh);
      closeSheet();
      toast('ممنون! ثبت شد', 'good');
      draw(fresh);
    } catch (e) { $('#t-err', el).textContent = e.message; }
  };
}

// ---------- opening hours ----------

export function hoursSheet(m, draw) {
  const [o, c] = (m.hours?.match(/\d{1,2}:\d{2}/g) ?? []);
  const el = sheet(`<h2>ساعت کاری ${esc(m.name)}</h2>
    <div class="sub">بیشتر پاساژها ساعت کاری‌شان را جایی ثبت نکرده‌اند. اگر می‌دانید، بنویسید.</div>
    <form id="h-form">
      <div class="row2">
        <div><label class="lbl" for="h-open">باز می‌شود</label><input class="field" type="time" id="h-open" name="open" value="${o?.padStart(5, '0') ?? '10:00'}" dir="ltr"></div>
        <div><label class="lbl" for="h-close">بسته می‌شود</label><input class="field" type="time" id="h-close" name="close" value="${c?.padStart(5, '0') ?? '21:00'}" dir="ltr"></div>
      </div>
      <label class="lbl">جمعه‌ها</label>
      <div class="seg">
        <label><input type="radio" name="friday" value="open"><span>باز است</span></label>
        <label><input type="radio" name="friday" value="closed"><span>تعطیل است</span></label>
        <label><input type="radio" name="friday" value="" checked><span>نمی‌دانم</span></label>
      </div>
      <div class="form-error" id="h-err"></div>
      <div class="actions fill"><button class="btn primary" type="submit">ثبت</button></div>
    </form>`);
  $('#h-form', el).onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const fresh = await api(`/malls/${encodeURIComponent(m.id)}/vote`, { method: 'POST', body: { userId: uid, kind: 'hours', ...fd } });
      contributions.add();
      keep(fresh);
      closeSheet();
      toast('ممنون! ساعت کاری ثبت شد', 'good');
      draw(fresh);
    } catch (err) { $('#h-err', el).textContent = err.message; }
  };
}

// ---------- closed down ----------

export function closedSheet(m, draw) {
  const on = !!myVotes.get(`closed:${m.id}`);
  const el = sheet(`<h2>${on ? 'گزارش شما ثبت شده' : 'این مکان بسته شده؟'}</h2>
    <div class="sub">${on ? 'می‌خواهید گزارش‌تان را پس بگیرید؟' : 'اگر این پاساژ تعطیل شده، جای دیگری است یا اصلاً مرکز خرید نیست، گزارش دهید. با چند گزارش، در فهرست‌ها پایین می‌رود.'}</div>
    <div class="actions fill"><button class="btn ${on ? '' : 'primary'}" id="c-go">${on ? 'پس گرفتن گزارش' : 'بله، گزارش بده'}</button><button class="btn ghost" data-close>انصراف</button></div>`);
  $('#c-go', el).onclick = async () => {
    try {
      const fresh = await api(`/malls/${encodeURIComponent(m.id)}/vote`, { method: 'POST', body: { userId: uid, kind: 'closed', on: !on } });
      myVotes.set(`closed:${m.id}`, !on || null);
      keep(fresh);
      closeSheet();
      toast(on ? 'گزارش برداشته شد' : 'ممنون! گزارش ثبت شد', 'good');
      draw(fresh);
    } catch (e) { toast(esc(e.message), 'bad'); }
  };
}

// ---------- where I parked (this device only) ----------

export function parkingSheet(m = null) {
  const parking = (m?.floors ?? []).filter((f) => f.id[0] === 'P');
  const el = sheet(`<h2>🚗 کجا پارک کردید؟</h2>
    <div class="sub">فقط روی همین گوشی ذخیره می‌شود. موقع برگشت از صفحه «من» پیدایش کنید.</div>
    <form id="p-form">
      ${parking.length ? `<label class="lbl">طبقه پارکینگ</label><div class="seg">${parking.map((f, i) => `<label><input type="radio" name="floor" value="${f.id}" ${i === 0 ? 'checked' : ''}><span>${esc(f.id)}</span></label>`).join('')}</div>` : ''}
      <label class="lbl" for="p-note">شماره ستون، جا یا نشانی</label>
      <input class="field" id="p-note" name="note" maxlength="80" autofocus placeholder="مثلاً ستون B14، کنار آسانسور">
      <label class="check"><input type="checkbox" name="gps" checked> موقعیت فعلی‌ام را هم ذخیره کن (برای مسیریابی برگشت)</label>
      <div class="form-error" id="p-err"></div>
      <div class="actions fill"><button class="btn primary" type="submit">ذخیره</button></div>
    </form>`);
  $('#p-form', el).onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    let pos = null;
    if (fd.gps === 'on') pos = await geo.start().catch(() => null);
    const near = pos && m && distance(pos, m) > 600 ? ` (${fmtDist(distance(pos, m))} تا ${m.name})` : '';
    persist('parking', {
      note: [fd.floor, fd.note].filter(Boolean).join(' · ') || null,
      mallId: m?.id ?? null, mallName: m?.name ?? null,
      lat: pos?.lat ?? m?.lat ?? null, lng: pos?.lng ?? m?.lng ?? null, at: new Date().toISOString(),
    });
    closeSheet();
    toast(`🚗 جای پارک ذخیره شد${near}`, 'good');
  };
}
