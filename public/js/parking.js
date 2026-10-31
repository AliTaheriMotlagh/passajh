// Parking: remember the mall, floor and spot number where the car is, with a note and an optional
// photo of the pillar sign, show how long it has been parked, and route back to it.

import { $, $$, esc, toast, openDrawer, store, persist, vibrate } from './ui.js';
import { toLatinDigits } from '/shared/text.js';
import { fmtDuration } from './geo.js';
import { state, go } from './state.js';

export const getParking = () => store('parking', null);

function setParking(p) {
  persist('parking', p);
  renderParkChip();
}

const parkedFor = (p) => fmtDuration((Date.now() - new Date(p.ts)) / 1000);

// Put the saved car back on the map when its mall opens.
export function restoreParking() {
  const p = getParking();
  state.engine.car = p?.mallId === state.mall.id ? { floor: p.floor, x: p.x, y: p.y, spot: p.spot } : null;
  renderParkChip();
}

export function renderParkChip() {
  const chip = $('#park-chip');
  if (!chip) return;
  const p = getParking();
  chip.classList.toggle('hidden', !p);
  if (p) chip.innerHTML = `🚗 ${esc(p.floorName)}${p.spot ? ` · <b dir="ltr">${esc(p.spot)}</b>` : ''} <small>${parkedFor(p)}</small>`;
}
setInterval(renderParkChip, 30000);

// Downscale a camera photo so it fits comfortably in local storage.
async function shrink(file) {
  try {
    const img = await createImageBitmap(file);
    const k = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

export function saveParking({ floorId, spot, note = '', photo = null }) {
  const e = state.engine;
  const floor = state.mall.floors.find((f) => f.id === floorId);
  const car = e.parkCar(spot, floorId);
  const summary = state.city?.mall(state.mall.id);
  const p = {
    mallId: state.mall.id, mallName: state.mall.name, floor: floor.id, floorName: floor.name,
    spot: car.spot, x: car.x, y: car.y, note, photo, ts: new Date().toISOString(),
    lat: summary?.lat ?? state.mall.lat, lng: summary?.lng ?? state.mall.lng,
  };
  setParking(p);
  // Browser storage full: keep the spot, drop the photo.
  if (photo && getParking()?.ts !== p.ts) {
    setParking({ ...p, photo: null });
    toast('عکس ذخیره نشد (حافظه مرورگر پر است)');
  }
  vibrate(60);
  toast(`🚗 محل پارک ذخیره شد: <b>${esc(floor.name)}${car.spot ? ` · ${esc(car.spot)}` : ''}</b>`, 'good');
}

// Tapping a numbered spot on a parking floor.
export function onSpotClick(spot, floor) {
  const t = toast(`🅿️ جای پارک <b dir="ltr">${esc(spot.label)}</b> · ${esc(floor.name)}
    <div class="actions-row" style="margin:6px 0 0"><button class="btn small primary" data-park>🚗 ماشینم اینجاست</button>
    <button class="btn small" data-walk>🚶 برو اینجا</button></div>`, '', 6000);
  $('[data-park]', t).onclick = () => { t.remove(); saveParking({ floorId: floor.id, spot }); };
  $('[data-walk]', t).onclick = () => {
    t.remove();
    const c = state.engine.nearestOpen(spot.x + spot.w / 2, spot.y + spot.h / 2, floor.id, 8);
    if (c) state.engine.setWaypoint({ floor: floor.id, ...c, label: `جای پارک ${spot.label}` }, true);
  };
}

export function openParking(edit = false) {
  const p = getParking();
  const el = $('#parking-panel');
  if (p && !edit) {
    const here = state.mall?.id === p.mallId;
    openDrawer(el, `
      <h2>🅿️ ماشین من</h2>
      <div class="park-card">
        <div class="park-spot" dir="ltr">${esc(p.spot || 'P')}</div>
        <div><b>${esc(p.mallName)}</b><div class="sub">${esc(p.floorName)} · ${parkedFor(p)} پارک شده</div>
          ${p.note ? `<div class="sub">📝 ${esc(p.note)}</div>` : ''}</div>
      </div>
      ${p.photo ? `<img class="park-photo" src="${p.photo}" alt="عکس محل پارک">` : ''}
      <div class="actions-row">
        ${here ? '<button class="btn primary" id="pk-route">🧭 مسیر تا ماشین</button><button class="btn purple" id="pk-go">🚶 برو</button>'
          : '<button class="btn primary" id="pk-open">🏬 نقشه پارکینگ</button><button class="btn purple" id="pk-nav">🧭 مسیریابی تا پاساژ</button>'}
        <button class="btn" id="pk-edit">✏️ ویرایش</button>
        <button class="btn danger" id="pk-clear">ماشین را برداشتم</button>
      </div>`);
    const on = (id, fn) => { const b = $(id, el); if (b) b.onclick = fn; };
    on('#pk-route', () => { state.engine.routeToCar(false); el.classList.add('hidden'); });
    on('#pk-go', () => { state.engine.routeToCar(true); el.classList.add('hidden'); });
    on('#pk-open', () => go(`#/mall/${p.mallId}`));
    on('#pk-nav', () => { go('#/'); state.city.navigate({ id: p.mallId, name: p.mallName, lat: p.lat, lng: p.lng }); });
    on('#pk-edit', () => (here ? openParking(true) : go(`#/mall/${p.mallId}`)));
    on('#pk-clear', () => {
      setParking(null);
      if (state.engine) state.engine.car = null;
      el.classList.add('hidden');
      toast('🚗 سفر خوش!', 'good');
    });
    return;
  }

  if (!state.mall) {
    openDrawer(el, `<h2>🅿️ ماشین من</h2>
      <div class="sub">برای ثبت شماره جای پارک، وارد نقشه پاساژ شوید و طبقه پارکینگ را انتخاب کنید.<br>
      اگر بیرون پارک کرده‌اید، روی نقشه شهر دکمه 🚗 را بزنید تا موقعیت GPS ماشین ذخیره شود.</div>`);
    return;
  }
  const floors = state.mall.floors.filter((f) => f.type === 'parking');
  if (!floors.length) {
    openDrawer(el, `<h2>🅿️ پارکینگ</h2><div class="sub">${esc(state.mall.name)} پارکینگ طبقاتی ندارد.</div>`);
    return;
  }
  const cur = floors.find((f) => f.id === (p?.mallId === state.mall.id ? p.floor : state.engine.player.floor)) ?? floors[0];
  openDrawer(el, `
    <h2>🅿️ ثبت جای پارک</h2>
    <div class="sub">بعداً با یک لمس مسیر برگشت تا ماشین را نشانتان می‌دهیم.</div>
    <form id="pk-form">
      <label>طبقه پارکینگ</label>
      <div class="radio-row">${floors.map((f) => `<label><input type="radio" name="floor" value="${f.id}" ${f === cur ? 'checked' : ''}> ${esc(f.name)}</label>`).join('')}</div>
      <label>شماره جای پارک (روی ستون یا کف)</label>
      <input class="field" name="spot" dir="ltr" autocomplete="off" autocapitalize="characters" enterkeyhint="next" placeholder="B14" list="pk-spots" value="${esc(p?.spot ?? '')}">
      <datalist id="pk-spots"></datalist>
      <div class="hint">می‌توانید روی نقشه هم روی جای پارک بزنید.</div>
      <label>یادداشت</label>
      <input class="field" name="note" maxlength="80" enterkeyhint="done" placeholder="ستون زرد، کنار آسانسور" value="${esc(p?.note ?? '')}">
      <label>عکس از تابلو یا ستون (اختیاری)</label>
      <input class="field" type="file" name="photo" accept="image/*" capture="environment">
      <div class="form-error" id="pk-err"></div>
      <button class="btn primary block" type="submit">💾 ذخیره محل پارک</button>
    </form>`);
  const form = $('#pk-form', el);
  const fillSpots = () => {
    const f = floors.find((x) => x.id === form.floor.value);
    $('#pk-spots', el).innerHTML = (f.spots ?? []).map((sp) => `<option value="${sp.label}">`).join('');
  };
  fillSpots();
  for (const r of $$('input[name=floor]', form)) r.onchange = fillSpots;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const f = floors.find((x) => x.id === form.floor.value);
    const label = toLatinDigits(form.spot.value).toUpperCase().replace(/[\s-]/g, '');
    const spot = label ? f.spots?.find((sp) => sp.label === label) : null;
    if (label && !spot && f.spots?.length) {
      $('#pk-err', el).textContent = `جای پارک «${label}» در ${f.name} نیست. (مثلاً ${f.spots[0].label} تا ${f.spots[f.spots.length - 1].label})`;
      return;
    }
    const file = form.photo.files[0];
    const photo = file ? await shrink(file) : p?.mallId === state.mall.id ? p.photo : null;
    saveParking({ floorId: f.id, spot, note: form.note.value.trim().slice(0, 80), photo });
    state.engine.setViewFloor(f.id);
    openParking();
  };
}
