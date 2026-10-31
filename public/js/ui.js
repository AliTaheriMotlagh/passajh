// Small DOM, API and formatting helpers.

import { toFaDigits, toLatinDigits, formatToman } from '/shared/text.js';
import { CATEGORIES } from '/shared/catalog.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fa = toFaDigits;
export const toman = formatToman;
export const cat = (key) => CATEGORIES[key] ?? { label: key, icon: '🏬', color: '#777' };
export const finalPrice = (product, store) => (store.discount ? product.price * (1 - store.discount.percent / 100) : product.price);

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطا در ارتباط با سرور');
  return data;
}

export function toast(html, kind = '', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, ms);
  setTimeout(() => el.remove(), ms + 350);
  return el;
}

export function openModal(html) {
  $('#modal-box').innerHTML = `<button class="close-x" data-close>✕</button>${html}`;
  $('#modal').classList.remove('hidden');
  return $('#modal-box');
}

export function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal-box').innerHTML = '';
}

export function openDrawer(el, html) {
  for (const d of document.querySelectorAll('.drawer')) if (d !== el) d.classList.add('hidden');
  el.innerHTML = `<button class="close-x" data-close-drawer>✕</button>${html}`;
  el.classList.remove('hidden');
  el.scrollTop = 0;
  return el;
}

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

// Open / closed right now in Tehran, from hours like "۱۰:۰۰ تا ۲۲:۰۰".
export function openStatus(hours) {
  const m = toLatinDigits(hours).match(/(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [o, c] = [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]];
  const [hh, mm] = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).split(':');
  const now = +hh * 60 + +mm;
  const open = c > o ? now >= o && now < c : now >= o || now < c;
  if (!open) return { open, text: `بسته · از ${fa(m[1].padStart(2, '0'))}:${fa(m[2])}` };
  const left = (c - now + 1440) % 1440;
  return { open, text: left <= 60 ? `${fa(left)} دقیقه تا تعطیلی` : `باز است · تا ${fa(m[3].padStart(2, '0'))}:${fa(m[4])}` };
}

// System notification when the page is in the background (Android only allows them through the service worker).
export async function notify(title, body, tag) {
  if (!document.hidden || window.Notification?.permission !== 'granted') return;
  const opts = { body, tag, icon: '/icon.svg', badge: '/icon.svg', lang: 'fa', dir: 'rtl' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, opts);
    new Notification(title, opts);
  } catch { /* notifications unavailable */ }
}

export function askNotifications() {
  if (window.Notification?.permission === 'default') Notification.requestPermission().catch(() => {});
}

export function vibrate(p) {
  try { navigator.vibrate?.(p); } catch { /* not supported */ }
}

export function store(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`passajh.${key}`)) ?? fallback; } catch { return fallback; }
}

export function persist(key, value) {
  try { localStorage.setItem(`passajh.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target.id === 'modal') closeModal();
  const d = e.target.closest('[data-close-drawer]');
  if (d) d.closest('.drawer').classList.add('hidden');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
