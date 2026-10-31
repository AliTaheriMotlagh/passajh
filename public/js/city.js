// City view: Tehran map with mall blips, real building outlines from OpenStreetMap, mall list,
// live GPS tracking, turn-by-turn navigation to a mall, arrival detection and a parked-car pin.

import { $, $$, esc, fa, api, toast, debounce, cat, toman, finalPrice, openModal, closeModal, openStatus, notify, askNotifications, vibrate, timeAgo, store, persist } from './ui.js';
import { geo, distance, fmtDist, fmtDuration, fmtClock, estimate, pointInRings, shareUrl, externalNav, route, progress } from './geo.js';

const TEHRAN = [35.735, 51.36];
const MODES = { car: '🚗 ماشین', foot: '🚶 پیاده' };

export class CityView {
  constructor({ onEnter, onResult }) {
    this.onEnter = onEnter;
    this.onResult = onResult;
    this.markers = new Map();
    this.footprints = new Map();
    this.layer = null;
    this.follow = false;
    this.nav = null; // { target, mode, route, line, index, started }
    this.navMode = 'car';
    this.car = store('car', null);
    this.here = null; // id of the mall the user is standing in
    this.discovered = new Set(); // ~10 km tiles already asked about
    try { this.arrived = new Set(JSON.parse(sessionStorage.getItem('passajh.arrived')) || []); } catch { this.arrived = new Set(); }
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
    map.on('dragstart', () => this.setFollow(false));
    // Panning around Iran finds the malls there.
    map.on('moveend', debounce(() => {
      const c = map.getCenter();
      if (map.getZoom() >= 11) this.discover(c.lat, c.lng);
    }, 600));

    this.malls = await api('/malls');
    for (const m of this.malls) this.addMarker(m);
    this.renderList();
    // Start where the user was last time if that's away from the Tehran malls; otherwise show Tehran.
    const last = geo.best;
    if (last && !this.malls.some((m) => !m.discovered && distance(last, m) < 30000)) map.setView([last.lat, last.lng], 13);
    else map.fitBounds(L.latLngBounds(this.malls.filter((m) => !m.discovered).map((m) => [m.lat, m.lng])).pad(0.15));
    if (this.car) this.drawCar();

    $('#btn-locate').addEventListener('click', () => this.locate());
    $('#mall-list').addEventListener('click', (e) => { if (e.target.closest('.sheet-handle')) e.currentTarget.classList.toggle('collapsed'); });
    $('#btn-park').addEventListener('click', () => this.carMenu());
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]');
      if (b) this.navigate(this.malls.find((m) => m.id === b.dataset.nav));
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.nav?.started) this.keepAwake();
    });
    geo.addEventListener('position', () => this.onPosition());
    geo.addEventListener('heading', () => this.drawHeading());
    geo.addEventListener('error', (e) => toast(esc(e.error.message), '', 6000));
    geo.addEventListener('stop', () => this.clearMe());
    this.bindSearch();
    // Already allowed on an earlier visit: start tracking without asking again.
    navigator.permissions?.query({ name: 'geolocation' })
      .then((s) => { if (s.state === 'granted') this.startTracking(false); })
      .catch(() => {});
    // Snap mall centers to OpenStreetMap in the background, one at a time (Overpass rate limits).
    (async () => {
      for (const m of this.malls) await this.footprint(m).catch(() => {});
    })();
  }

  mall(id) { return this.malls?.find((m) => m.id === id); }

  addMarker(m) {
    const icon = L.divIcon({
      className: 'blip-icon', iconSize: [34, 34], iconAnchor: [17, 17],
      html: `<div class="blip">🛍️${m.discounts > 40 ? '<span class="pulse"></span>' : ''}<span class="blip-label">${esc(m.name)}</span></div>`,
    });
    const mk = L.marker([m.lat, m.lng], { icon, riseOnHover: true }).addTo(this.map);
    mk.on('click', () => this.select(m.id));
    this.markers.set(m.id, mk);
  }

  // Distance in meters from the live (or last known) position, or null.
  dist(m) {
    return geo.best ? distance(geo.best, m) : null;
  }

  renderList() {
    const items = [...this.malls];
    if (geo.best) items.sort((a, b) => this.dist(a) - this.dist(b));
    $('#mall-list').innerHTML = `
      <button class="sheet-handle" aria-label="باز و بسته کردن فهرست">${geo.best ? 'نزدیک‌ترین‌ها به شما' : 'مراکز خرید'}</button>
      <h3>🗺️ مراکز خرید (${fa(items.length)})${geo.best && !geo.pos ? ' <span class="chip">آخرین موقعیت شما</span>' : ''}</h3>
      ${items.map((m) => {
        const st = openStatus(m.hours);
        const d = this.dist(m);
        return `
        <div class="mall-item ${m.id === this.selected ? 'active' : ''}" data-id="${m.id}">
          <div class="row"><b>${esc(m.name)}</b>${m.id === this.here ? '<span class="chip green">📍 اینجا هستید</span>' : m.discounts ? `<span class="chip">${fa(m.discounts)} تخفیف</span>` : ''}</div>
          <div class="meta">${fa(m.floors.length)} طبقه · ${fa(m.stores)} فروشگاه · ${fa(m.products)} کالا
            ${st ? ` · <span class="${st.open ? 'open' : 'closed'}">${st.text}</span>` : ''}</div>
          ${d != null ? `<div class="meta"><span class="chip green">${fmtDist(d)}</span> 🚗 ${fmtDuration(estimate(d, 'car'))}${d < 4000 ? ` · 🚶 ${fmtDuration(estimate(d, 'foot'))}` : ''}</div>` : ''}
        </div>`;
      }).join('')}`;
    for (const el of $$('.mall-item')) el.addEventListener('click', () => this.select(el.dataset.id));
  }

  async select(id) {
    const m = this.mall(id);
    this.selected = id;
    this.setFollow(false);
    for (const [mid, mk] of this.markers) mk.getElement()?.querySelector('.blip')?.classList.toggle('active', mid === id);
    this.renderList();
    this.map.flyTo([m.lat, m.lng], 17, { duration: 1.2 });
    this.showCard(m, null);
    const fp = await this.footprint(m).catch(() => null);
    if (this.selected === id) this.showCard(m, fp);
  }

  showCard(m, fp) {
    this.cardFp = fp;
    const top = Object.entries(m.categories).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const st = openStatus(m.hours);
    const d = this.dist(m);
    const card = $('#mall-card');
    card.classList.remove('hidden');
    card.innerHTML = `
      <button class="close-x" id="card-close">✕</button>
      <h2>${esc(m.name)}</h2>
      <div class="en">${esc(m.nameEn)}</div>
      <p>${esc(m.description)}</p>
      <div class="sub">📍 ${esc(m.address)}<br>🕘 ساعت کاری: ${esc(m.hours)}
        ${st ? ` · <b class="${st.open ? 'open' : 'closed'}">${st.text}</b>` : ''}</div>
      ${d != null ? `<div class="sub dist-line">${m.id === this.here ? '📍 الان اینجا هستید' : `📏 ${fmtDist(d)} از شما · 🚗 حدود ${fmtDuration(estimate(d, 'car'))}${d < 4000 ? ` · 🚶 ${fmtDuration(estimate(d, 'foot'))}` : ''}`}</div>` : ''}
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
        ${m.id === this.here ? '' : `<button class="btn purple" data-nav="${m.id}">🧭 مسیریابی از موقعیت من</button>`}
        <button class="btn" id="card-share" title="اشتراک‌گذاری">📤</button>
      </div>
      <div class="ext-links">باز کردن در: ${externalNav(m, m.name).map((x) => `<a target="_blank" rel="noopener" href="${esc(x.href)}">${esc(x.label)}</a>`).join(' · ')}</div>`;
    $('#card-enter').addEventListener('click', () => this.onEnter(m.id));
    $('#card-close').addEventListener('click', () => card.classList.add('hidden'));
    $('#card-share').addEventListener('click', () => this.share(m, `${m.name} — پاساژ`, `${location.origin}/#/mall/${m.id}`));
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

  // The server looks the outline up on OpenStreetMap (Overpass is often blocked inside Iran) and caches it.
  async loadFootprint(m) {
    const fp = m.discovered ? { lat: m.lat, lng: m.lng, rings: m.rings } : await api(`/footprint/${m.id}`);
    const rings = fp.rings ?? [];
    if (fp.none || fp.lat == null) {
      L.circle([m.lat, m.lng], { radius: 90, color: '#f5c518', weight: 2, dashArray: '6 6', fillOpacity: 0.05, interactive: false }).addTo(this.layer);
      return false;
    }
    m.lat = fp.lat;
    m.lng = fp.lng;
    m.rings = rings;
    this.markers.get(m.id)?.setLatLng([m.lat, m.lng]);
    for (const r of rings) {
      L.polygon(r, { color: '#2fd27a', weight: 2.5, fillColor: '#2fd27a', fillOpacity: 0.18, className: 'footprint' })
        .bindTooltip(m.name, { sticky: true }).on('click', () => this.select(m.id)).addTo(this.layer);
    }
    if (!rings.length) return false;
    L.marker([m.lat, m.lng], { icon: L.divIcon({ className: 'center-mark', html: '⌖', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false }).addTo(this.layer);
    return true;
  }

  // ---------- malls anywhere in Iran ----------

  // Ask the server for the malls around a point (it reads OpenStreetMap once per ~30 km area).
  async discover(lat, lng) {
    const key = `${Math.floor(lat * 10)}:${Math.floor(lng * 10)}`;
    if (this.discovered.has(key)) return;
    this.discovered.add(key);
    const chip = $('#discover-chip');
    chip.classList.remove('hidden');
    try {
      const { malls, partial } = await api(`/discover?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`);
      if (partial) this.discovered.delete(key);
      const fresh = malls.filter((m) => !this.mall(m.id));
      for (const m of fresh) {
        this.malls.push(m);
        this.addMarker(m);
        this.footprint(m);
      }
      if (fresh.length) {
        this.renderList();
        toast(`🛍️ ${fa(fresh.length)} مرکز خرید در این منطقه پیدا شد`, 'good', 3000);
        this.onDiscover?.(fresh);
      }
    } catch {
      this.discovered.delete(key);
    } finally {
      chip.classList.add('hidden');
    }
  }

  // ---------- live location ----------

  // Locate button: start tracking → follow me → stop.
  locate() {
    if (!geo.active) return this.startTracking(true);
    if (!this.follow) {
      this.setFollow(true);
      if (geo.pos) this.map.flyTo([geo.pos.lat, geo.pos.lng], Math.max(this.map.getZoom(), 16));
      return;
    }
    if (this.nav) return toast('در حین مسیریابی، ردیابی موقعیت روشن می‌ماند');
    geo.stop();
    toast('ردیابی موقعیت خاموش شد');
  }

  async startTracking(announce) {
    const btn = $('#btn-locate');
    btn.classList.add('busy');
    try {
      const p = await geo.start();
      if (announce) {
        this.setFollow(true);
        this.map.flyTo([p.lat, p.lng], 15);
        const nearest = [...this.malls].sort((a, b) => this.dist(a) - this.dist(b))[0];
        toast(`📍 نزدیک‌ترین پاساژ: <b>${esc(nearest.name)}</b> (${fmtDist(this.dist(nearest))})
          <div class="actions-row" style="margin:6px 0 0"><button class="btn small purple" data-nav="${nearest.id}">🧭 مسیریابی</button></div>`, 'good', 7000);
      }
    } catch (e) {
      if (announce) toast(esc(e.message), '', 8000);
    } finally {
      btn.classList.remove('busy');
      this.renderLocate();
    }
  }

  setFollow(on) {
    this.follow = on && geo.active;
    this.renderLocate();
  }

  renderLocate() {
    const btn = $('#btn-locate');
    btn.classList.toggle('on', geo.active);
    btn.classList.toggle('follow', this.follow);
    btn.title = !geo.active ? 'موقعیت من' : this.follow ? 'خاموش کردن ردیابی' : 'دنبال کردن من';
  }

  onPosition() {
    const p = geo.pos;
    const ll = [p.lat, p.lng];
    if (!this.meMarker) {
      this.meCircle = L.circle(ll, { radius: p.accuracy, color: '#3b8fd9', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(this.map);
      this.meMarker = L.marker(ll, {
        zIndexOffset: 1000,
        icon: L.divIcon({ className: 'blip-icon', html: '<div class="me-blip"><i class="cone"></i></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).addTo(this.map).on('click', () => this.meMenu());
    } else {
      this.meMarker.setLatLng(ll);
      this.meCircle.setLatLng(ll).setRadius(p.accuracy);
    }
    this.drawHeading();
    if (this.follow) this.map.panTo(ll, { animate: true, duration: 0.5 });
    if (this.nav) this.updateNav();
    if (!this.discoverAt || distance(this.discoverAt, p) > 5000) {
      this.discoverAt = p;
      this.discover(p.lat, p.lng);
    }
    this.checkArrival();
    this.checkNearby();
    if (!this.listAt || distance(this.listAt, p) > 100) {
      this.listAt = p;
      this.renderList();
      const m = this.mall(this.selected);
      if (m && !$('#mall-card').classList.contains('hidden')) this.showCard(m, this.cardFp);
    }
  }

  drawHeading() {
    const cone = this.meMarker?.getElement()?.querySelector('.cone');
    if (!cone) return;
    const b = geo.bearing;
    cone.style.display = b == null ? 'none' : '';
    if (b != null) cone.style.transform = `rotate(${b}deg)`;
  }

  clearMe() {
    this.meMarker?.remove();
    this.meCircle?.remove();
    this.meMarker = this.meCircle = null;
    this.follow = false;
    this.renderLocate();
  }

  meMenu() {
    const p = geo.pos;
    if (!p) return;
    const nearest = [...this.malls].sort((a, b) => this.dist(a) - this.dist(b))[0];
    const box = openModal(`
      <h2>📍 موقعیت شما</h2>
      <div class="coords">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</div>
      <div class="sub">دقت: حدود ${fmtDist(p.accuracy)}${p.speed > 0.5 ? ` · سرعت ${fa(Math.round(p.speed * 3.6))} کیلومتر بر ساعت` : ''}
        <br>نزدیک‌ترین پاساژ: <b>${esc(nearest.name)}</b> (${fmtDist(this.dist(nearest))})</div>
      <div class="actions-row">
        <button class="btn primary" id="me-share">📤 ارسال موقعیتم برای دوست</button>
        <button class="btn" id="me-park">🚗 ماشینم اینجاست</button>
        <button class="btn purple" data-nav="${nearest.id}">🧭 برو به ${esc(nearest.name)}</button>
      </div>`);
    $('#me-share', box).onclick = () => this.share(p, 'موقعیت من');
    $('#me-park', box).onclick = () => { closeModal(); this.parkCar(); };
  }

  async share(p, title, url = shareUrl(p)) {
    const text = url === shareUrl(p) ? title : `${title}\n📍 ${shareUrl(p)}`;
    try {
      if (navigator.share) return await navigator.share({ title, text, url });
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast('🔗 لینک کپی شد', 'good');
    } catch {
      toast(`<span dir="ltr">${esc(url)}</span>`, '', 10000);
    }
  }

  // ---------- arrival & nearby ----------

  checkArrival() {
    const p = geo.pos;
    if (!p || !this.malls) return;
    const at = this.malls.find((m) => (m.rings?.length ? pointInRings(p, m.rings) || distance(p, m) < 50 : distance(p, m) < 120));
    if ((at?.id ?? null) === this.here) return;
    this.here = at?.id ?? null;
    this.renderList();
    if (at) this.arrive(at);
  }

  arrive(m) {
    if (this.nav?.target.id === m.id) this.endNav(true);
    if (this.arrived.has(m.id)) return;
    this.arrived.add(m.id);
    try { sessionStorage.setItem('passajh.arrived', JSON.stringify([...this.arrived])); } catch { /* ignore */ }
    vibrate([200, 100, 200]);
    notify(`به ${m.name} رسیدید 🛍️`, `${m.discounts} فروشگاه تخفیف دارند. نقشه داخلی را باز کنید.`, `arrive-${m.id}`);
    if (location.hash.startsWith('#/mall/')) return;
    const html = `📍 به <b>${esc(m.name)}</b> رسیدید! ${fa(m.discounts)} فروشگاه تخفیف دارند.`;
    // Don't cover a form or panel the user is in the middle of; offer it as a toast instead.
    if (!$('#modal').classList.contains('hidden') || $$('.drawer:not(.hidden)').length) {
      const t = toast(`${html}<div class="actions-row" style="margin:6px 0 0"><button class="btn small primary" data-enter="${m.id}">🚶 نقشه داخلی</button></div>`, 'good', 10000);
      $('[data-enter]', t).onclick = () => this.onEnter(m.id);
      return;
    }
    const box = openModal(`
      <h2>📍 به ${esc(m.name)} رسیدید</h2>
      <div class="sub">${html}<br>نقشه داخلی با موقعیت واقعی شما باز شود؟ از جلوی هر مغازه‌ای که تخفیف دارد رد شوید، کوپنش را می‌گیرید.</div>
      <div class="actions-row"><button class="btn primary" id="arr-enter">🚶 ورود به نقشه داخلی</button><button class="btn" data-close>بعداً</button></div>`);
    $('#arr-enter', box).onclick = () => { closeModal(); this.onEnter(m.id); };
  }

  // Once per visit: point out the nearest mall with discounts when it's within walking distance.
  checkNearby() {
    if (this.nearbyShown || this.nav || this.here) return;
    const p = geo.pos;
    const [m, d] = this.malls.filter((x) => x.discounts).map((x) => [x, distance(p, x)]).sort((a, b) => a[1] - b[1])[0] ?? [];
    if (!m || d > 1500) return;
    this.nearbyShown = true;
    toast(`🔥 <b>${fa(m.discounts)} تخفیف</b> فعال در ${esc(m.name)}، فقط ${fmtDist(d)} از شما
      <div class="actions-row" style="margin:6px 0 0"><button class="btn small primary" data-nav="${m.id}">🧭 مسیر</button></div>`, 'deal', 9000);
    notify(`${m.discounts} تخفیف نزدیک شما`, `${m.name} — ${fmtDist(d)} از شما`, `near-${m.id}`);
  }

  // ---------- navigation ----------

  async navigate(target, mode = this.navMode) {
    if (!target) return;
    closeModal();
    $('#mall-card').classList.add('hidden');
    let pos;
    try {
      pos = await geo.start();
    } catch (e) {
      return toast(esc(e.message), '', 8000);
    }
    this.renderLocate();
    askNotifications();
    if (target.id === this.here) return toast(`الان در ${esc(target.name)} هستید 🙂`);
    this.navMode = mode;
    this.endNav();
    const nav = (this.nav = { target, mode, index: 0, rerouteAt: Date.now() });
    $('#mall-list').classList.add('collapsed');
    this.renderNav();
    nav.route = await route(pos, target, mode);
    if (this.nav !== nav) return;
    this.drawRoute();
    const b = L.latLngBounds([...nav.route.coords, [pos.lat, pos.lng]]);
    this.map.fitBounds(b, { paddingTopLeft: [30, 200], paddingBottomRight: [30, 40] });
    this.updateNav();
  }

  drawRoute() {
    const nav = this.nav;
    nav.line?.remove();
    const dash = nav.route.real ? null : '8 10';
    nav.line = L.layerGroup([
      L.polyline(nav.route.coords, { color: '#000', weight: 10, opacity: 0.5, interactive: false }),
      L.polyline(nav.route.coords, { color: '#c04cff', weight: 6, dashArray: dash, className: 'nav-line', interactive: false }),
      L.marker(nav.route.coords[nav.route.coords.length - 1], {
        interactive: false,
        icon: L.divIcon({ className: 'blip-icon', html: '<div class="dest-pin">🏁</div>', iconSize: [30, 30], iconAnchor: [15, 28] }),
      }),
    ]).addTo(this.map);
  }

  updateNav() {
    const nav = this.nav;
    if (!nav?.route || !geo.pos) return this.renderNav();
    const pr = progress(nav.route, geo.pos, nav.index);
    nav.index = pr.index;
    nav.progress = pr;
    if (pr.stepIndex !== nav.stepIndex) {
      if (nav.stepIndex != null) vibrate(120);
      nav.stepIndex = pr.stepIndex;
    }
    if (pr.remaining < 30 || distance(geo.pos, nav.target) < 25) {
      const m = this.mall(nav.target.id);
      this.endNav(true);
      if (m) this.arrive(m);
      return;
    }
    // Off the route: fetch a new one, at most every 15 seconds.
    if (pr.offRoute > 40 + Math.min(geo.pos.accuracy, 60) && Date.now() - nav.rerouteAt > 15000) this.reroute();
    this.renderNav();
  }

  async reroute() {
    const nav = this.nav;
    nav.rerouteAt = Date.now();
    const r = await route(geo.pos, nav.target, nav.mode);
    if (this.nav !== nav || (!r.real && nav.route.real)) return;
    nav.route = r;
    nav.index = 0;
    nav.stepIndex = null;
    this.drawRoute();
    toast('🧭 مسیر جدید پیدا شد', '', 2000);
    this.updateNav();
  }

  renderNav() {
    const nav = this.nav;
    const el = $('#nav-panel');
    if (!nav) return el.classList.add('hidden');
    el.classList.remove('hidden');
    const r = nav.route, pr = nav.progress;
    const head = !r ? '<div class="nav-icon">⏳</div><div class="nav-main"><div class="nav-text">در حال مسیریابی…</div></div>'
      : `<div class="nav-icon">${pr?.next.icon ?? '🚩'}</div>
        <div class="nav-main"><div class="nav-text">${esc(pr?.next.text ?? r.steps[0].text)}</div>
          ${pr ? `<div class="nav-sub">${fmtDist(pr.toNext)} دیگر</div>` : ''}</div>`;
    const remaining = pr?.remaining ?? r?.distance;
    const duration = pr?.duration ?? r?.duration;
    el.innerHTML = `
      <div class="nav-top">${head}</div>
      ${r ? `<div class="nav-stats"><b>${fmtDuration(duration)}</b> · ${fmtDist(remaining)} · رسیدن ${fmtClock(new Date(Date.now() + duration * 1000))}
        <span class="sub">${!r.real ? '(تخمینی، خط مستقیم)' : nav.mode === 'car' ? '(بدون احتساب ترافیک)' : ''}</span></div>` : ''}
      <div class="nav-dest">🏁 ${esc(nav.target.name)}</div>
      <div class="nav-actions">
        <div class="seg">${Object.entries(MODES).map(([k, v]) => `<button data-mode="${k}" class="${k === nav.mode ? 'on' : ''}">${v}</button>`).join('')}</div>
        ${nav.started ? '' : '<button class="btn small primary" id="nav-start">▶ شروع</button>'}
        <button class="btn small" id="nav-ext">🔗</button>
        <button class="btn small danger" id="nav-end">✕</button>
      </div>
      <div class="ext-links hidden" id="nav-links">باز کردن در: ${externalNav(nav.target, nav.target.name).map((x) => `<a target="_blank" rel="noopener" href="${esc(x.href)}">${esc(x.label)}</a>`).join(' · ')}</div>`;
    for (const b of $$('[data-mode]', el)) b.onclick = () => b.dataset.mode !== nav.mode && this.navigate(nav.target, b.dataset.mode);
    $('#nav-end', el).onclick = () => this.endNav();
    $('#nav-ext', el).onclick = () => $('#nav-links', el).classList.toggle('hidden');
    const start = $('#nav-start', el);
    if (start) {
      start.onclick = () => {
        nav.started = true;
        this.setFollow(true);
        if (geo.pos) this.map.setView([geo.pos.lat, geo.pos.lng], 17);
        this.keepAwake();
        this.renderNav();
      };
    }
  }

  async keepAwake() {
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch { /* not supported or not allowed */ }
  }

  endNav(arrived = false) {
    const nav = this.nav;
    if (!nav) return;
    this.nav = null;
    nav.line?.remove();
    this.wake?.release().catch(() => {});
    this.wake = null;
    this.renderNav();
    if (arrived) {
      vibrate([200, 100, 200]);
      toast(`🏁 به ${esc(nav.target.name)} رسیدید`, 'good');
      notify(`به ${nav.target.name} رسیدید`, 'مسیریابی تمام شد', 'nav-end');
    }
  }

  // ---------- parked car ----------

  async carMenu() {
    // A spot saved inside a mall's parking takes over when there's no outdoor pin.
    if (!this.car && store('parking', null)) return this.onParking?.();
    if (!this.car) return this.parkCar();
    const d = geo.best ? distance(geo.best, this.car) : null;
    const box = openModal(`
      <h2>🚗 ماشین شما</h2>
      <div class="sub">پارک شده ${timeAgo(this.car.ts)}${d != null ? ` · ${fmtDist(d)} از شما` : ''}${this.car.note ? `<br>📝 ${esc(this.car.note)}` : ''}</div>
      <div class="actions-row">
        <button class="btn primary" id="car-go">🚶 مسیر پیاده تا ماشین</button>
        <button class="btn" id="car-show">📍 نمایش روی نقشه</button>
        <button class="btn" id="car-share">📤</button>
        <button class="btn danger" id="car-clear">برداشتن</button>
      </div>`);
    $('#car-go', box).onclick = () => this.navigate({ id: 'car', name: 'ماشین شما', lat: this.car.lat, lng: this.car.lng }, 'foot');
    $('#car-show', box).onclick = () => { closeModal(); this.setFollow(false); this.map.flyTo([this.car.lat, this.car.lng], 18); };
    $('#car-share', box).onclick = () => this.share(this.car, 'محل پارک ماشین');
    $('#car-clear', box).onclick = () => {
      closeModal();
      this.car = null;
      persist('car', null);
      this.carMarker?.remove();
      if (this.nav?.target.id === 'car') this.endNav();
      this.renderPark();
      toast('محل پارک پاک شد');
    };
  }

  async parkCar() {
    let p;
    try {
      p = await geo.start();
    } catch (e) {
      return toast(esc(e.message), '', 8000);
    }
    this.renderLocate();
    const here = this.mall(this.here);
    this.car = { lat: p.lat, lng: p.lng, accuracy: p.accuracy, ts: new Date().toISOString(), note: here ? `نزدیک ${here.name}` : '' };
    persist('car', this.car);
    this.drawCar();
    toast(`🚗 محل پارک ذخیره شد${p.accuracy > 60 ? ` (دقت ${fmtDist(p.accuracy)})` : ''}. برای برگشت، دکمه 🚗 را بزنید.`, 'good', 6000);
  }

  drawCar() {
    this.carMarker?.remove();
    this.carMarker = L.marker([this.car.lat, this.car.lng], {
      zIndexOffset: 900,
      icon: L.divIcon({ className: 'blip-icon', html: '<div class="blip car-blip">🚗</div>', iconSize: [34, 34], iconAnchor: [17, 17] }),
    }).addTo(this.map).on('click', () => this.carMenu());
    this.renderPark();
  }

  renderPark() {
    const b = $('#btn-park');
    b.classList.toggle('on', !!(this.car || store('parking', null)));
    b.title = this.car ? 'ماشین من کجاست؟' : 'ماشینم را اینجا پارک کردم';
  }

  // ---------- friends ----------

  setFriends(list) {
    this.friendMarkers ??= new Map();
    const seen = new Set();
    for (const f of list) {
      if (f.lat == null) continue;
      seen.add(f.id);
      let mk = this.friendMarkers.get(f.id);
      if (!mk) {
        mk = L.marker([f.lat, f.lng], { zIndexOffset: 950 }).addTo(this.map);
        mk.on('click', () => this.onFriend?.(mk.friend));
        this.friendMarkers.set(f.id, mk);
      }
      mk.friend = f;
      mk.setLatLng([f.lat, f.lng]);
      const key = `${f.emoji}|${f.name}|${f.mallName}`;
      if (mk.key !== key) {
        mk.key = key;
        mk.setIcon(L.divIcon({
          className: 'blip-icon', iconSize: [34, 34], iconAnchor: [17, 17],
          html: `<div class="blip friend-blip">${esc(f.emoji)}<span class="blip-label">${esc(f.name)}${f.mallName ? ` · ${esc(f.mallName)}` : ''}</span></div>`,
        }));
      }
    }
    for (const [id, mk] of this.friendMarkers) if (!seen.has(id)) { mk.remove(); this.friendMarkers.delete(id); }
  }

  // ---------- search ----------

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
      // Nearest first among equally good matches.
      const d = (r) => this.dist(this.mall(r.store.mallId)) ?? 0;
      results.sort((a, b) => b.score - a.score || d(a) - d(b) || a.product.price - b.product.price);
      box.innerHTML = (geo.best ? '<div class="results-note">📍 مرتب‌شده بر اساس نزدیکی به شما</div>' : '') + results.map((r, i) => `
        <div class="result" data-i="${i}">
          <div class="ico">${cat(r.store.category).icon}</div>
          <div class="main">
            <div class="title">${esc(r.product.name)} ${r.store.discount ? `<span class="chip">${fa(r.store.discount.percent)}٪</span>` : ''}</div>
            <div class="sub">${esc(r.store.name)} · ${esc(r.store.mallName)} · ${esc(r.store.floorName)}${geo.best ? ` · ${fmtDist(d(r))}` : ''}</div>
          </div>
          <div class="price">${toman(finalPrice(r.product, r.store))}</div>
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
