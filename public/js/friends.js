// Friends: a private group joined with a 6-character code. Members who turn sharing on can see
// each other on the city map and inside a mall (floor and position). Sharing is off by default,
// shows an indicator while on, and stops when turned off or the group is left.

import { $, $$, esc, fa, api, toast, openDrawer, store, persist, timeAgo, vibrate } from './ui.js';
import { geo, distance, fmtDist } from './geo.js';
import { state, uid, go } from './state.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMOJIS = ['🙂', '😎', '🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐝', '🌸', '⭐', '🔥'];
const POLL_MS = 5000;

let myId = store('friends.pid', null);
let timer = null;

export const group = () => store('group', null);
const sharing = () => store('sharing', false) && !!group();
const me = () => store('friends.me', { name: store('profile', {}).name || '', emoji: EMOJIS[0] });

export function joinGroup(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) return toast('کد گروه ۶ حرفی است');
  persist('group', code);
  start();
  toast(`👥 به گروه <b dir="ltr">${code}</b> پیوستید`, 'good');
}

function leave() {
  const code = group();
  if (code) api('/presence', { method: 'POST', body: { userId: uid, group: code, sharing: false } }).catch(() => {});
  persist('group', null);
  persist('sharing', false);
  state.friends = [];
  publish();
  stop();
}

export function start() {
  if (timer || !group()) return;
  tick();
  timer = setInterval(tick, POLL_MS);
}

function stop() {
  clearInterval(timer);
  timer = null;
  renderIndicator();
}

async function tick() {
  const code = group();
  if (!code) return stop();
  if (document.hidden) return;
  if (sharing()) {
    const e = state.engine, inMall = state.mall && e;
    const p = geo.pos;
    const r = await api('/presence', {
      method: 'POST',
      body: {
        userId: uid, group: code, ...me(),
        lat: p?.lat, lng: p?.lng, accuracy: p?.accuracy,
        mallId: inMall ? state.mall.id : null, floor: inMall ? e.player.floor : null,
        x: inMall ? Math.round(e.player.x * 10) / 10 : null, y: inMall ? Math.round(e.player.y * 10) / 10 : null,
      },
    }).catch(() => null);
    if (r?.id && r.id !== myId) { myId = r.id; persist('friends.pid', myId); }
  }
  const list = await api(`/groups/${code}`).catch(() => null);
  if (!list) return;
  const before = new Set(state.friends.map((f) => f.id));
  state.friends = list.filter((f) => f.id !== myId);
  for (const f of state.friends) {
    if (before.size && !before.has(f.id)) toast(`${esc(f.emoji)} <b>${esc(f.name)}</b> موقعیتش را با گروه به اشتراک گذاشت`, 'good', 3500);
  }
  publish();
  const panel = $('#friends-panel');
  if (!panel.classList.contains('hidden') && !panel.contains(document.activeElement)) openFriends();
}

// Push the latest friend positions to the city map, the mall engine and the badges.
function publish() {
  state.city?.setFriends(state.friends);
  if (state.engine) state.engine.friends = state.friends.filter((f) => f.mallId && f.mallId === state.mall?.id);
  for (const b of $$('[data-count=friends]')) { b.textContent = fa(state.friends.length); b.classList.toggle('hidden', !state.friends.length); }
  renderIndicator();
}

function renderIndicator() {
  for (const el of $$('.share-indicator')) el.classList.toggle('hidden', !sharing());
}

const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

function where(f) {
  if (f.mallId) return `${f.mallName} · ${f.floorName ?? ''}`;
  if (f.lat != null && geo.best) return `${fmtDist(distance(geo.best, f))} از شما`;
  return f.lat != null ? 'روی نقشه' : 'موقعیت نامشخص';
}

// Walk (inside the same mall) or navigate (in the city) to a friend.
export function goToFriend(f) {
  if (f.mallId && f.mallId === state.mall?.id && f.floor != null) {
    const c = state.engine.nearestOpen(f.x, f.y, f.floor, 10);
    if (c) state.engine.setWaypoint({ floor: f.floor, ...c, label: f.name }, false);
    $('#friends-panel').classList.add('hidden');
    return;
  }
  if (f.mallId) return go(`#/mall/${f.mallId}`);
  if (f.lat == null) return toast('موقعیت این دوست مشخص نیست');
  go('#/');
  state.city.navigate({ id: `friend-${f.id}`, name: f.name, lat: f.lat, lng: f.lng }, 'foot');
}

export function openFriends() {
  const el = $('#friends-panel');
  const code = group();
  const m = me();
  if (!code) {
    openDrawer(el, `
      <h2>👥 دوستان</h2>
      <div class="sub">با دوستان و خانواده یک گروه خصوصی بسازید تا در شهر و داخل پاساژ همدیگر را روی نقشه ببینید. فقط کسانی که کد گروه را دارند موقعیت شما را می‌بینند، و فقط وقتی خودتان اشتراک را روشن کنید.</div>
      <div class="actions-row"><button class="btn primary block" id="fr-new">✨ ساخت گروه جدید</button></div>
      <form id="fr-join" class="inline-form">
        <input class="field" name="code" dir="ltr" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="کد گروه، مثلاً K7QM2P">
        <button class="btn" type="submit">پیوستن</button>
      </form>`);
    $('#fr-new', el).onclick = () => { joinGroup(newCode()); openFriends(); };
    $('#fr-join', el).onsubmit = (ev) => { ev.preventDefault(); joinGroup(ev.target.code.value); if (group()) openFriends(); };
    return;
  }
  const on = sharing();
  openDrawer(el, `
    <h2>👥 گروه <span dir="ltr" class="code">${code}</span></h2>
    <div class="sub">این کد را برای دوستانتان بفرستید.</div>
    <div class="actions-row">
      <button class="btn primary" id="fr-invite">📤 دعوت دوستان</button>
      <button class="btn" id="fr-leave">خروج از گروه</button>
    </div>
    <div class="toggle-card ${on ? 'on' : ''}">
      <div><b>${on ? '📡 موقعیت شما برای گروه نمایش داده می‌شود' : 'اشتراک موقعیت خاموش است'}</b>
        <div class="sub">${on ? 'هر وقت خواستید خاموشش کنید.' : 'دوستان شما را نمی‌بینند، ولی شما آن‌ها را می‌بینید.'}</div></div>
      <label class="switch"><input type="checkbox" id="fr-share" ${on ? 'checked' : ''}><span></span></label>
    </div>
    <form id="fr-me" class="row2">
      <div><label>نام شما در گروه</label><input class="field" name="name" maxlength="30" value="${esc(m.name)}" placeholder="مثلاً سارا"></div>
      <div><label>نشان</label><div class="emoji-row">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" class="${e === m.emoji ? 'on' : ''}">${e}</button>`).join('')}</div></div>
    </form>
    <h3>اعضای آنلاین (${fa(state.friends.length)})</h3>
    ${state.friends.length ? '' : '<div class="empty-state">👋<br>هنوز کسی موقعیتش را به اشتراک نگذاشته.</div>'}
    ${state.friends.map((f) => `<div class="result friend-row" data-friend="${f.id}">
      <div class="ico avatar">${esc(f.emoji)}</div>
      <div class="main"><div class="title">${esc(f.name)}</div><div class="sub">${esc(where(f))} · ${timeAgo(new Date(f.at))}</div></div>
      <button class="btn small purple">🧭</button>
    </div>`).join('')}`);
  $('#fr-invite', el).onclick = async () => {
    const url = `${location.origin}/#/join/${code}`;
    const text = `بیا تو گروه پاساژ تا همدیگر را روی نقشه ببینیم. کد: ${code}`;
    try {
      if (navigator.share) return await navigator.share({ title: 'دعوت به پاساژ', text, url });
    } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('🔗 لینک دعوت کپی شد', 'good'); } catch { toast(esc(url), '', 8000); }
  };
  $('#fr-leave', el).onclick = () => { leave(); openFriends(); };
  $('#fr-share', el).onchange = async (ev) => {
    const want = ev.target.checked;
    if (want) {
      if (!$('#fr-me', el).name.value.trim()) { ev.target.checked = false; $('#fr-me', el).name.focus(); return toast('اول یک نام برای خودتان بنویسید'); }
      geo.start().catch((e) => toast(esc(e.message), '', 6000));
    } else {
      api('/presence', { method: 'POST', body: { userId: uid, group: code, sharing: false } }).catch(() => {});
    }
    persist('sharing', want);
    vibrate(30);
    renderIndicator();
    tick();
    openFriends();
  };
  const form = $('#fr-me', el);
  form.name.onchange = () => persist('friends.me', { ...me(), name: form.name.value.trim().slice(0, 30) });
  for (const b of $$('[data-emoji]', form)) {
    b.onclick = () => { persist('friends.me', { ...me(), emoji: b.dataset.emoji }); openFriends(); };
  }
  for (const r of $$('[data-friend]', el)) r.onclick = () => goToFriend(state.friends.find((f) => f.id === r.dataset.friend));
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) tick(); });
