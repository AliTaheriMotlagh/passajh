// City view: Tehran map with mall blips, real building outlines from OpenStreetMap, mall list.

import { $, esc, fa, api, toast, debounce, cat, toman } from './ui.js';

const TEHRAN = [35.735, 51.36];
const OVERPASS = 'https://overpass-api.de/api/interpreter';

export class CityView {
  constructor({ onEnter, onResult }) {
    this.onEnter = onEnter;
    this.onResult = onResult;
    this.markers = new Map();
    this.me = null;
    this.footprints = new Map();
    this.layer = null;
  }

  async init() {
    const map = (this.map = L.map('city-map', { zoomControl: false, attributionControl: true }).setView(TEHRAN, 12));
    // The dark "GTA" look is the standard OSM layer recolored in CSS (.gta-tiles); CARTO's dark tiles now need an API key.
    const gta = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, className: 'gta-tiles', attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery &copy; Esri',
    });
    L.control.layers({ 'نقشه بازی (GTA)': gta, 'خیابان‌ها': streets, 'ماهواره': sat }, null, { position: 'topleft' }).addTo(map);
    L.control.zoom({ position: 'topleft' }).addTo(map);
    this.layer = L.layerGroup().addTo(map);

    this.malls = await api('/malls');
    for (const m of this.malls) this.addMarker(m);
    this.renderList();
    map.fitBounds(L.latLngBounds(this.malls.map((m) => [m.lat, m.lng])).pad(0.15));

    $('#btn-locate').addEventListener('click', () => this.locate());
    this.bindSearch();
    // Snap mall centers to OpenStreetMap in the background, one at a time (Overpass rate limits).
    (async () => {
      for (const m of this.malls) await this.footprint(m).catch(() => {});
    })();
  }

  addMarker(m) {
    const icon = L.divIcon({
      className: 'blip-icon', iconSize: [34, 34], iconAnchor: [17, 17],
      html: `<div class="blip">🛍️${m.discounts > 40 ? '<span class="pulse"></span>' : ''}<span class="blip-label">${esc(m.name)}</span></div>`,
    });
    const mk = L.marker([m.lat, m.lng], { icon, riseOnHover: true }).addTo(this.map);
    mk.on('click', () => this.select(m.id));
    this.markers.set(m.id, mk);
  }

  renderList() {
    const items = [...this.malls];
    if (this.me) items.sort((a, b) => this.dist(a) - this.dist(b));
    $('#mall-list').innerHTML = `
      <h3>🗺️ مراکز خرید تهران (${fa(items.length)})</h3>
      ${items.map((m) => `
        <div class="mall-item ${m.id === this.selected ? 'active' : ''}" data-id="${m.id}">
          <div class="row"><b>${esc(m.name)}</b>${m.discounts ? `<span class="chip">${fa(m.discounts)} تخفیف</span>` : ''}</div>
          <div class="meta">${fa(m.floors.length)} طبقه · ${fa(m.stores)} فروشگاه · ${fa(m.products)} کالا
            ${this.me ? ` · <span class="chip green">${fa(this.dist(m).toFixed(1))} کیلومتر</span>` : ''}</div>
        </div>`).join('')}`;
    for (const el of document.querySelectorAll('.mall-item')) el.addEventListener('click', () => this.select(el.dataset.id));
  }

  dist(m) {
    return this.map.distance([this.me.lat, this.me.lng], [m.lat, m.lng]) / 1000;
  }

  async select(id) {
    const m = this.malls.find((x) => x.id === id);
    this.selected = id;
    for (const [mid, mk] of this.markers) mk.getElement()?.querySelector('.blip')?.classList.toggle('active', mid === id);
    this.renderList();
    this.map.flyTo([m.lat, m.lng], 17, { duration: 1.2 });
    this.showCard(m, null);
    const fp = await this.footprint(m).catch(() => null);
    if (this.selected === id) this.showCard(m, fp);
  }

  showCard(m, fp) {
    const top = Object.entries(m.categories).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const card = $('#mall-card');
    card.classList.remove('hidden');
    card.innerHTML = `
      <button class="close-x" id="card-close">✕</button>
      <h2>${esc(m.name)}</h2>
      <div class="en">${esc(m.nameEn)}</div>
      <p>${esc(m.description)}</p>
      <div class="sub">📍 ${esc(m.address)}<br>🕘 ساعت کاری: ${esc(m.hours)}</div>
      <div class="stats">
        <div class="stat"><b>${fa(m.floors.length)}</b><span>طبقه</span></div>
        <div class="stat"><b>${fa(m.stores)}</b><span>فروشگاه</span></div>
        <div class="stat"><b>${fa(m.discounts)}</b><span>تخفیف</span></div>
        <div class="stat"><b>${fa(m.products)}</b><span>کالا</span></div>
      </div>
      <div class="sub">${top.map(([k, n]) => `${cat(k).icon} ${cat(k).label} ${fa(n)}`).join(' · ')}</div>
      <div class="coords" style="margin-top:8px">⌖ ${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}
        ${fp === null ? ' · در حال دریافت ساختمان از OSM…' : fp ? ' · ✓ ساختمان واقعی از OpenStreetMap' : ' · مرکز تقریبی'}</div>
      <div class="card-actions">
        <button class="btn primary" id="card-enter">🚶 ورود به پاساژ</button>
        <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}">🧭 مسیریابی</a>
        <a class="btn" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lng}#map=18/${m.lat}/${m.lng}">OSM</a>
      </div>`;
    $('#card-enter').addEventListener('click', () => this.onEnter(m.id));
    $('#card-close').addEventListener('click', () => card.classList.add('hidden'));
  }

  // Fetch the mall's real building outline from OpenStreetMap and move its center onto it.
  footprint(m) {
    if (!this.footprints.has(m.id)) {
      const p = this.loadFootprint(m);
      p.catch(() => this.footprints.delete(m.id));
      this.footprints.set(m.id, p);
    }
    return this.footprints.get(m.id);
  }

  async loadFootprint(m) {
    const cacheKey = `passajh.osm.${m.id}`;
    let data = null;
    try { data = JSON.parse(sessionStorage.getItem(cacheKey)); } catch { /* ignore */ }
    if (!data) {
      const names = (m.osm || `${m.name}|${m.nameEn}`).replace(/"/g, '');
      const tehran = '35.55,51.10,35.85,51.65';
      const around = `around:600,${m.lat},${m.lng}`;
      const q = `[out:json][timeout:25];(
        nwr["shop"="mall"]["name"~"${names}",i](${tehran});
        nwr["shop"="mall"]["name:en"~"${names}",i](${tehran});
        nwr(${around})["name"~"${names}",i]["building"~"retail|commercial|yes"];
        nwr(${around})["amenity"="marketplace"]["name"~"${names}",i];
      );out geom 8;`;
      const res = await fetch(OVERPASS, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error('overpass');
      data = await res.json();
      try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* quota */ }
    }
    // Pick the matching element closest to our approximate center; draw only its outline.
    let best = null;
    for (const el of data.elements || []) {
      const ways = el.type === 'way' ? [el.geometry] : el.type === 'relation' ? (el.members || []).filter((x) => x.role !== 'inner' && x.geometry).map((x) => x.geometry) : [];
      const rings = ways.filter((g) => g && g.length >= 3).map((g) => g.map((p) => [p.lat, p.lon]));
      const pts = rings.flat();
      const c = pts.length
        ? pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0])
        : el.lat ? [el.lat, el.lon] : null;
      if (!c) continue;
      const d = this.map.distance(c, [m.lat, m.lng]) + (rings.length ? 0 : 200);
      if (d < 8000 && (!best || d < best.d)) best = { d, c, rings };
    }
    const rings = best?.rings ?? [];
    if (!best) {
      this.footprints.set(m.id, false);
      L.circle([m.lat, m.lng], { radius: 90, color: '#f5c518', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }).addTo(this.layer);
      return false;
    }
    m.lat = best.c[0];
    m.lng = best.c[1];
    this.markers.get(m.id)?.setLatLng(best.c);
    for (const r of rings) {
      L.polygon(r, { color: '#2fd27a', weight: 2.5, fillColor: '#2fd27a', fillOpacity: 0.18, className: 'footprint' })
        .bindTooltip(m.name, { sticky: true }).on('click', () => this.select(m.id)).addTo(this.layer);
    }
    L.marker(best.c, { icon: L.divIcon({ className: 'center-mark', html: '⌖', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false }).addTo(this.layer);
    this.footprints.set(m.id, true);
    return true;
  }

  locate() {
    if (!navigator.geolocation) return toast('مرورگر شما موقعیت‌یابی را پشتیبانی نمی‌کند');
    navigator.geolocation.getCurrentPosition((pos) => {
      this.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (this.meMarker) this.meMarker.setLatLng([this.me.lat, this.me.lng]);
      else this.meMarker = L.marker([this.me.lat, this.me.lng], { icon: L.divIcon({ className: 'blip-icon', html: '<div class="me-blip"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(this.map);
      const nearest = [...this.malls].sort((a, b) => this.dist(a) - this.dist(b))[0];
      this.renderList();
      this.map.flyTo([this.me.lat, this.me.lng], 13);
      toast(`📍 نزدیک‌ترین پاساژ: <b>${esc(nearest.name)}</b> (${fa(this.dist(nearest).toFixed(1))} کیلومتر)`, 'good');
    }, () => toast('دسترسی به موقعیت داده نشد'), { enableHighAccuracy: true, timeout: 10000 });
  }

  bindSearch() {
    const input = $('#city-search');
    const box = $('#city-results');
    const run = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) return box.classList.add('hidden');
      const results = await api(`/search?q=${encodeURIComponent(q)}`).catch(() => []);
      box.classList.remove('hidden');
      if (!results.length) {
        box.innerHTML = `<div class="empty">چیزی پیدا نشد.<br><button class="btn primary small" data-action="request" data-q="${esc(q)}">📣 درخواست بده تا فروشنده‌ها خبردار شوند</button></div>`;
        return;
      }
      box.innerHTML = results.map((r, i) => `
        <div class="result" data-i="${i}">
          <div class="ico">${cat(r.store.category).icon}</div>
          <div class="main">
            <div class="title">${esc(r.product.name)} ${r.store.discount ? `<span class="chip">${fa(r.store.discount.percent)}٪</span>` : ''}</div>
            <div class="sub">${esc(r.store.name)} · ${esc(r.store.mallName)} · ${esc(r.store.floorName)}</div>
          </div>
          <div class="price">${toman(r.store.discount ? r.product.price * (1 - r.store.discount.percent / 100) : r.product.price)}</div>
        </div>`).join('') + `<div class="empty"><button class="btn small" data-action="request" data-q="${esc(q)}">📣 به همه فروشنده‌های «${esc(q)}» خبر بده</button></div>`;
      for (const el of box.querySelectorAll('.result')) {
        el.addEventListener('click', () => { box.classList.add('hidden'); this.onResult(results[el.dataset.i]); });
      }
    }, 250);
    input.addEventListener('input', run);
    input.addEventListener('focus', run);
    document.addEventListener('click', (e) => { if (!e.target.closest('#city-view .search')) box.classList.add('hidden'); });
  }

  invalidate() { this.map?.invalidateSize(); }
}
