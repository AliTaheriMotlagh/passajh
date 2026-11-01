// Small DOM, API, storage and formatting helpers, shared by the app, the shop owner page and the editor.

import { toFaDigits, toLatinDigits } from '/shared/text.js';
import { CATEGORIES } from '/shared/catalog.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fa = toFaDigits;
export const cat = (key) => CATEGORIES[key] ?? CATEGORIES.other;

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'ارتباط با سرور برقرار نشد');
  return data;
}

export function toast(html, kind = '', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, ms);
  setTimeout(() => el.remove(), ms + 350);
  return el;
}

// ---------- bottom sheet (a centred dialog on wide screens) ----------

let current = null;

export function sheet(html, { onClose } = {}) {
  closeSheet(true);
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('section');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<button class="btn ghost icon x" data-close aria-label="بستن">✕</button>${html}`;
  document.body.append(scrim, el);
  requestAnimationFrame(() => { scrim.classList.add('on'); el.classList.add('on'); });
  current = { el, scrim, onClose, prev: document.activeElement };
  scrim.onclick = () => closeSheet();
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  setTimeout(() => (el.querySelector('[autofocus]') ?? el).focus?.({ preventScroll: true }), 60);
  el.tabIndex = -1;
  return el;
}

export function closeSheet(instant = false) {
  if (!current) return;
  const { el, scrim, onClose, prev } = current;
  current = null;
  el.classList.remove('on');
  scrim.classList.remove('on');
  setTimeout(() => { el.remove(); scrim.remove(); }, instant ? 0 : 260);
  onClose?.();
  if (!instant) prev?.focus?.({ preventScroll: true });
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); closeModal(); } });

// The floor plan editor's modal (#modal in editor.html).
export function openModal(html) {
  $('#modal-box').innerHTML = `<button class="close-x" data-close>✕</button>${html}`;
  $('#modal').classList.remove('hidden');
  return $('#modal-box');
}

export function closeModal() {
  if (!$('#modal')) return;
  $('#modal').classList.add('hidden');
  $('#modal-box').innerHTML = '';
}

document.addEventListener('click', (e) => {
  if (!$('#modal')) return;
  if (e.target.closest('#modal [data-close]') || e.target.id === 'modal') closeModal();
});

// ---------- formatting ----------

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'همین الان';
  if (s < 3600) return `${fa(Math.floor(s / 60))} دقیقه پیش`;
  if (s < 86400) return `${fa(Math.floor(s / 3600))} ساعت پیش`;
  return `${fa(Math.floor(s / 86400))} روز پیش`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Time and weekday in Tehran, whatever the phone's time zone.
function tehranNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { min: +get('hour') * 60 + +get('minute'), friday: get('weekday') === 'Fri' };
}

// Open / closed right now, from hours like "۱۰:۰۰ تا ۲۲:۰۰". `friday: 'closed'` when people reported it.
// Returns { state: 'open' | 'closed' | 'unknown', text }.
export function openStatus(hours, { friday } = {}) {
  const now = tehranNow();
  if (now.friday && friday === 'closed') return { state: 'closed', text: 'جمعه‌ها تعطیل' };
  const m = toLatinDigits(hours).match(/(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/);
  if (!m) return { state: 'unknown', text: 'ساعت کاری نامشخص' };
  const [o, c] = [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]];
  if (c - o >= 1440 || (o === 0 && c === 0)) return { state: 'open', text: 'شبانه‌روزی' };
  const open = c > o ? now.min >= o && now.min < c : now.min >= o || now.min < c;
  const hhmm = (h, mm) => `${fa(String(+h).padStart(2, '0'))}:${fa(mm)}`;
  if (!open) return { state: 'closed', text: `بسته · باز می‌شود ${hhmm(m[1], m[2])}` };
  const left = (c - now.min + 1440) % 1440;
  return { state: 'open', text: left <= 60 ? `باز · ${fa(left)} دقیقه تا تعطیلی` : `باز تا ${hhmm(m[3], m[4])}` };
}

export const statusPill = (st) => `<span class="pill ${st.state}">${esc(st.text)}</span>`;

export const lineBadges = (lines) => `<span class="lines">${(lines ?? []).map((l) => `<span class="line" data-l="${esc(l)}" title="خط ${fa(l)}">${fa(l)}</span>`).join('')}</span>`;

export function vibrate(p) {
  try { navigator.vibrate?.(p); } catch { /* not supported */ }
}

// ---------- storage (this device only) ----------

export function store(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`passajh.${key}`)) ?? fallback; } catch { return fallback; }
}

export function persist(key, value) {
  try {
    if (value == null) localStorage.removeItem(`passajh.${key}`);
    else localStorage.setItem(`passajh.${key}`, JSON.stringify(value));
  } catch { /* storage unavailable or full */ }
}

export async function share(title, url) {
  try {
    if (navigator.share) return await navigator.share({ title, url });
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('🔗 لینک کپی شد', 'good'); } catch { toast(`<span class="ltr">${esc(url)}</span>`, '', 8000); }
}
