// Real-world location: live GPS fix and compass, distances, road routing (OSRM) with turn-by-turn
// progress, and fitting a mall's indoor grid onto its real building outline (shared/frame.js).

import { toFaDigits as fa } from '/shared/text.js';

const LAST_KEY = 'passajh.lastpos';
const ERRORS = {
  1: 'اجازه دسترسی به موقعیت داده نشد. از تنظیمات مرورگر، دسترسی Location را برای این سایت فعال کنید.',
  2: 'موقعیت شما پیدا نشد. GPS یا Wi-Fi گوشی را روشن کنید.',
  3: 'دریافت موقعیت طول کشید. دوباره تلاش کنید.',
};

class Geo extends EventTarget {
  constructor() {
    super();
    this.pos = null; // { lat, lng, accuracy, speed, heading, altitude, ts }
    this.compass = null; // degrees clockwise from north
    this.watchId = null;
    try { this.last = JSON.parse(localStorage.getItem(LAST_KEY)); } catch { this.last = null; }
  }

  get active() { return this.watchId !== null; }

  // Best known position: the live fix, or the last one saved on this device.
  get best() { return this.pos ?? this.last; }

  // Direction of travel when moving, otherwise where the phone points.
  get bearing() {
    const p = this.pos;
    if (p?.heading != null && !Number.isNaN(p.heading) && p.speed > 1) return p.heading;
    return this.compass;
  }

  // Start watching. Resolves with the first fix; must be called from a tap so iOS can ask for the compass.
  start() {
    this.startCompass();
    if (this.active) {
      return this.pos ? Promise.resolve(this.pos)
        : new Promise((resolve) => this.addEventListener('position', () => resolve(this.pos), { once: true }));
    }
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext) return reject(new Error('موقعیت‌یابی فقط روی HTTPS یا localhost کار می‌کند.'));
      if (!navigator.geolocation) return reject(new Error('مرورگر شما موقعیت‌یابی را پشتیبانی نمی‌کند.'));
      let first = true;
      const accept = (p) => {
        if (!this.plausible(p)) return;
        const c = p.coords;
        this.pos = {
          lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed,
          heading: c.heading, altitude: c.altitude, ts: p.timestamp,
        };
        this.last = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, ts: p.timestamp };
        try { localStorage.setItem(LAST_KEY, JSON.stringify(this.last)); } catch { /* storage unavailable */ }
        this.dispatchEvent(new Event('position'));
        if (first) { first = false; resolve(this.pos); }
      };
      this.watchId = navigator.geolocation.watchPosition(accept, (err) => {
        const e = new Error(ERRORS[err.code] || 'خطا در موقعیت‌یابی');
        e.code = err.code;
        if (err.code === 1) this.stop();
        if (first) { first = false; reject(e); } else if (err.code !== 3) this.dispatchEvent(Object.assign(new Event('error'), { error: e }));
      }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
      // GPS can take a while to lock (indoors, between tall buildings); a quick Wi-Fi/cell fix shows the
      // user right away and the watch above refines it.
      navigator.geolocation.getCurrentPosition((p) => { if (!this.pos && this.active) accept(p); }, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 });
    });
  }

  // Drop fixes that jump impossibly far (GPS spoofing and jamming are common in Tehran). Three rejected
  // fixes in a row are taken as the truth, in case the earlier fix was the wrong one.
  plausible(p) {
    const c = p.coords;
    const prev = this.pos;
    if (!prev || this.rejected >= 3) { this.rejected = 0; return true; }
    const dt = Math.max(1, (p.timestamp - prev.ts) / 1000);
    // Movement beyond both fixes' error circles (a coarse Wi-Fi fix followed by GPS isn't a jump).
    const moved = distance(prev, { lat: c.latitude, lng: c.longitude }) - prev.accuracy - c.accuracy;
    if (moved / dt > 85) {
      this.rejected = (this.rejected || 0) + 1;
      return false;
    }
    this.rejected = 0;
    return true;
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.pos = null;
    this.dispatchEvent(new Event('stop'));
  }

  startCompass() {
    const D = window.DeviceOrientationEvent;
    if (!D || this.compassAsked) return;
    this.compassAsked = true;
    const listen = () => {
      const absolute = 'ondeviceorientationabsolute' in window;
      window.addEventListener(absolute ? 'deviceorientationabsolute' : 'deviceorientation', (e) => {
        let h = e.webkitCompassHeading ?? ((absolute || e.absolute) && e.alpha != null ? 360 - e.alpha : null);
        if (h == null) return;
        h = (h + (screen.orientation?.angle || 0) + 360) % 360;
        if (this.compass != null && Math.abs(((h - this.compass + 540) % 360) - 180) < 2) return;
        this.compass = h;
        this.dispatchEvent(new Event('heading'));
      });
    };
    // iOS asks for motion permission, and only from inside a tap.
    if (typeof D.requestPermission === 'function') {
      D.requestPermission().then((s) => s === 'granted' && listen()).catch(() => { this.compassAsked = false; });
    } else {
      listen();
    }
  }
}

export const geo = new Geo();

// ---------- distances & formatting ----------

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

export function fmtDuration(s) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${fa(min)} دقیقه`;
  return `${fa(Math.floor(min / 60))} ساعت${min % 60 ? ` و ${fa(min % 60)} دقیقه` : ''}`;
}

export function fmtClock(date) {
  return fa(date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }));
}

// Rough travel time from straight-line distance, for lists and when the router is unreachable.
const SPEED = { car: 6.5, foot: 1.3 }; // m/s, Tehran city traffic / walking
const DETOUR = 1.35;
export const estimate = (m, mode = 'car') => (m * DETOUR) / SPEED[mode] + (mode === 'car' ? 120 : 0);

export function pointInRings(pt, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i], [yj, xj] = ring[j];
      if ((yi > pt.lat) !== (yj > pt.lat) && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function shareUrl(p) {
  return `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

// Hand a destination to the phone's own navigation apps.
export function externalNav(p, name = '') {
  const ll = `${p.lat},${p.lng}`;
  return [
    { label: 'Google Maps', href: `https://www.google.com/maps/dir/?api=1&destination=${ll}` },
    { label: 'Waze', href: `https://waze.com/ul?ll=${ll}&navigate=yes` },
    { label: 'نشان / بلد / سایر', href: `geo:${ll}?q=${ll}(${encodeURIComponent(name)})` },
  ];
}

// ---------- road routing ----------

const ROUTERS = {
  car: ['https://routing.openstreetmap.de/routed-car/route/v1/driving/', 'https://router.project-osrm.org/route/v1/driving/'],
  foot: ['https://routing.openstreetmap.de/routed-foot/route/v1/driving/'],
};

const TURN = {
  uturn: ['↩️', 'دور بزنید'], 'sharp right': ['↘️', 'تند به راست بپیچید'], right: ['➡️', 'به راست بپیچید'],
  'slight right': ['↗️', 'کمی به راست بروید'], straight: ['⬆️', 'مستقیم بروید'], 'slight left': ['↖️', 'کمی به چپ بروید'],
  left: ['⬅️', 'به چپ بپیچید'], 'sharp left': ['↙️', 'تند به چپ بپیچید'],
};

function instruction(step) {
  const m = step.maneuver;
  const name = step.name || step.ref || '';
  const turn = TURN[m.modifier] ?? ['⬆️', 'ادامه دهید'];
  let icon = turn[0], text = turn[1];
  switch (m.type) {
    case 'depart': return { icon: '🚩', text: `حرکت کنید${name ? ` در ${name}` : ''}` };
    case 'arrive': return { icon: '🏁', text: 'به مقصد رسیدید' };
    case 'roundabout': case 'rotary': icon = '🔄'; text = `وارد میدان شوید و از خروجی ${fa(m.exit ?? 1)} خارج شوید`; break;
    case 'exit roundabout': case 'exit rotary': icon = '🔄'; text = 'از میدان خارج شوید'; break;
    case 'merge': text = 'وارد مسیر شوید'; break;
    case 'on ramp': text = 'وارد رمپ شوید'; break;
    case 'off ramp': text = 'از خروجی خارج شوید'; break;
    case 'fork': text = m.modifier?.includes('left') ? 'در دوراهی سمت چپ بروید' : 'در دوراهی سمت راست بروید'; break;
    case 'continue': case 'new name': if (m.modifier === 'straight') text = 'مستقیم ادامه دهید'; break;
  }
  return { icon, text: name ? `${text}، ${name}` : text };
}

// Route between two points. Falls back to a straight line with an estimated time when no router answers.
export async function route(from, to, mode = 'car') {
  const pair = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  for (const base of ROUTERS[mode]) {
    try {
      const res = await fetch(`${base}${pair}?overview=full&geometries=geojson&steps=true`, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data = await res.json();
      const r = data.routes?.[0];
      if (data.code !== 'Ok' || !r) continue;
      const steps = r.legs[0].steps.map((s) => ({
        ...instruction(s), distance: s.distance,
        at: [s.maneuver.location[1], s.maneuver.location[0]],
        coords: s.geometry.coordinates.map(([x, y]) => [y, x]),
      }));
      return withTrack({ mode, real: true, distance: r.distance, duration: r.duration, coords: r.geometry.coordinates.map(([x, y]) => [y, x]), steps });
    } catch { /* try the next router */ }
  }
  const d = distance(from, to);
  return withTrack({
    mode, real: false, distance: d * DETOUR, duration: estimate(d, mode),
    coords: [[from.lat, from.lng], [to.lat, to.lng]],
    steps: [{ icon: '🧭', text: 'مستقیم به سمت مقصد (مسیریاب در دسترس نیست)', distance: d, coords: [[from.lat, from.lng], [to.lat, to.lng]] }],
  });
}

// Flatten the step geometries into one polyline with cumulative distance, for progress tracking.
function withTrack(r) {
  const track = [];
  let cum = 0;
  r.steps.forEach((s, i) => {
    s.start = cum;
    for (const [lat, lng] of s.coords) {
      const prev = track[track.length - 1];
      if (prev) cum += distance(prev, { lat, lng });
      track.push({ lat, lng, step: i, cum });
    }
  });
  r.track = track;
  r.length = cum || r.distance;
  return r;
}

// Where the traveller is along a route: off-route distance, remaining distance and the next maneuver.
export function progress(r, pos, hint = 0) {
  const t = r.track;
  let best = hint, bestD = Infinity;
  const from = Math.max(0, hint - 20);
  for (let i = from; i < t.length; i++) {
    const d = distance(pos, t[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  const at = t[best];
  const remaining = Math.max(0, r.length - at.cum);
  const nextIndex = Math.min(at.step + 1, r.steps.length - 1);
  const next = r.steps[nextIndex];
  return {
    index: best, offRoute: bestD, remaining,
    duration: (r.duration * remaining) / r.length,
    next, toNext: Math.max(0, next.start - at.cum), stepIndex: nextIndex,
  };
}

// ---------- indoor grid ↔ real world ----------

export { mallFrame } from '/shared/frame.js';
