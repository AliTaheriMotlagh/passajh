// The user's location (asked for only when they want "near me"), distances, and handing a destination
// to the navigation apps people in Iran already use (Neshan, Balad), or Google Maps / Waze / Apple Maps.

import { toFaDigits as fa } from '/shared/text.js';

const LAST_KEY = 'passajh.lastpos';
const ERRORS = {
  1: 'اجازه موقعیت داده نشد. از تنظیمات مرورگر، Location را برای این سایت روشن کنید.',
  2: 'موقعیت شما پیدا نشد. GPS یا Wi-Fi گوشی را روشن کنید.',
  3: 'پیدا کردن موقعیت طول کشید. دوباره امتحان کنید.',
};

class Geo extends EventTarget {
  constructor() {
    super();
    this.pos = null; // { lat, lng, accuracy, ts }
    this.watchId = null;
    try { this.last = JSON.parse(localStorage.getItem(LAST_KEY)); } catch { this.last = null; }
    // A position from more than a day ago is somewhere else by now.
    if (this.last && Date.now() - this.last.ts > 24 * 3600e3) this.last = null;
  }

  get active() { return this.watchId !== null; }
  get best() { return this.pos ?? this.last; }

  // Start watching; resolves with the first fix. Call from a tap the first time, so the browser asks.
  start() {
    if (this.active) {
      return this.pos ? Promise.resolve(this.pos)
        : new Promise((resolve) => this.addEventListener('position', () => resolve(this.pos), { once: true }));
    }
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext) return reject(new Error('موقعیت‌یابی فقط روی HTTPS کار می‌کند.'));
      if (!navigator.geolocation) return reject(new Error('مرورگر شما موقعیت‌یابی ندارد.'));
      let first = true;
      const accept = (p) => {
        const c = p.coords;
        // GPS spoofing is common in Tehran: ignore fixes that jump impossibly fast.
        if (this.pos && distance(this.pos, { lat: c.latitude, lng: c.longitude }) - c.accuracy - this.pos.accuracy > 85 * Math.max(1, (p.timestamp - this.pos.ts) / 1000)) return;
        this.pos = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, ts: p.timestamp };
        this.last = this.pos;
        try { localStorage.setItem(LAST_KEY, JSON.stringify(this.pos)); } catch { /* storage unavailable */ }
        this.dispatchEvent(new Event('position'));
        if (first) { first = false; resolve(this.pos); }
      };
      this.watchId = navigator.geolocation.watchPosition(accept, (err) => {
        const e = new Error(ERRORS[err.code] || 'خطا در موقعیت‌یابی');
        if (err.code === 1) this.stop();
        if (first) { first = false; reject(e); }
      }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
      // A quick Wi-Fi/cell fix while GPS locks.
      navigator.geolocation.getCurrentPosition((p) => { if (!this.pos && this.active) accept(p); }, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 });
    });
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.dispatchEvent(new Event('stop'));
  }

  // Resume watching if the user already allowed it on an earlier visit (no prompt).
  async resume() {
    try {
      const s = await navigator.permissions?.query({ name: 'geolocation' });
      if (s?.state === 'granted') await this.start();
    } catch { /* not supported */ }
  }
}

export const geo = new Geo();

export function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fmtDist(m) {
  if (m < 1000) return `${fa(Math.max(10, Math.round(m / 10) * 10))} متر`;
  return `${fa((m / 1000).toFixed(m < 10000 ? 1 : 0))} کیلومتر`;
}

// Walking minutes for a straight-line distance (streets add about a third).
export const walkMin = (m) => Math.max(1, Math.round((m * 1.3) / 75));

export const distTo = (p) => (geo.best ? distance(geo.best, p) : null);

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(navigator.userAgent);

// Navigation apps for a destination, the ones most used in Iran first.
export function navLinks(p, name = '') {
  const ll = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const links = [
    { label: 'نشان', icon: '🧭', href: `https://neshan.org/maps/@${ll},17z,0p` },
    { label: 'بلد', icon: '🗺️', href: `https://balad.ir/location?latitude=${p.lat.toFixed(6)}&longitude=${p.lng.toFixed(6)}&zoom=17` },
    { label: 'Google Maps', icon: '📍', href: `https://www.google.com/maps/dir/?api=1&destination=${ll}` },
    { label: 'Waze', icon: '🚗', href: `https://waze.com/ul?ll=${ll}&navigate=yes` },
  ];
  if (isIOS) links.push({ label: 'Apple Maps', icon: '🍎', href: `https://maps.apple.com/?daddr=${ll}&q=${encodeURIComponent(name)}` });
  if (isAndroid) links.unshift({ label: 'برنامه مسیریاب گوشی', icon: '📱', href: `geo:${ll}?q=${ll}(${encodeURIComponent(name)})` });
  return links;
}
