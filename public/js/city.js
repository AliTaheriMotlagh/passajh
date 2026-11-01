// City view: every mall, passage and bazaar in Tehran (and anywhere in Iran) on a calm vector map.
// Malls cluster when zoomed out and show their names and real building outlines when zoomed in.
// Live GPS tracking, turn-by-turn navigation to a mall, arrival detection and a parked-car pin.

import { $, $$, esc, fa, api, toast, debounce, cat, toman, finalPrice, openModal, closeModal, openStatus, notify, askNotifications, vibrate, timeAgo, store, persist } from './ui.js';
import { geo, distance, fmtDist, fmtDuration, fmtClock, estimate, pointInRings, shareUrl, externalNav, route, progress } from './geo.js';
import { tokens, matchScore } from '/shared/text.js';

const TEHRAN = { lat: 35.715, lng: 51.4 };
// Same box as the server's OpenStreetMap snapshot (data/tehran.json); malls outside it are discovered live.
const SNAPSHOT = { s: 35.56, w: 51.08, n: 35.84, e: 51.66 };
const inSnapshot = (p) => p.lat > SNAPSHOT.s && p.lat < SNAPSHOT.n && p.lng > SNAPSHOT.w && p.lng < SNAPSHOT.e;
const MODES = { car: '🚗 ماشین', foot: '🚶 پیاده' };
const KIND = { mall: 'مرکز خرید', passage: 'پاساژ', bazaar: 'بازار' };

// Shopping districts people ask for by name; a chip shows the malls inside each circle.
const DISTRICTS = [
  { name: 'امین حضور', lat: 35.6845, lng: 51.4368, r: 600 },
  { name: 'تهرانپارس', lat: 35.7395, lng: 51.5330, r: 2300 },
  { name: 'جمهوری و علاءالدین', lat: 35.6950, lng: 51.4110, r: 650 },
  { name: 'لاله‌زار', lat: 35.6885, lng: 51.4225, r: 550 },
  { name: 'بازار بزرگ', lat: 35.6755, lng: 51.4225, r: 650 },
  { name: 'تجریش', lat: 35.8040, lng: 51.4320, r: 900 },
  { name: 'صادقیه', lat: 35.7220, lng: 51.3330, r: 1300 },
  { name: 'ونک', lat: 35.7580, lng: 51.4100, r: 1200 },
];

// OpenFreeMap: free vector tiles from OpenStreetMap, no API key. If it can't be reached (filtering), fall
// back to the standard OpenStreetMap raster tiles, which load in Iran.
const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const RASTER_STYLE = {
  version: 8, glyphs: GLYPHS,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '&copy; OpenStreetMap' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.4, 'raster-contrast': -0.1 } }],
};
const SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const RTL_PLUGIN = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js';
const FONT = ['Noto Sans Bold'];
const GREEN = '#12a150';
const PURPLE = '#9b3dff';

// Map labels in Persian where OpenStreetMap has them.
const FA_NAME = ['coalesce', ['get', 'name:fa'], ['get', 'name']];
// Cluster counts in Persian digits (up to 999).
const FA_DIGITS = ['literal', [...'۰۱۲۳۴۵۶۷۸۹']];
const digit = (e) => ['to-string', ['at', ['%', ['floor', e], 10], FA_DIGITS]];
const faCount = (n) => ['case',
  ['>=', n, 100], ['concat', digit(['/', n, 100]), digit(['/', n, 10]), digit(n)],
  ['>=', n, 10], ['concat', digit(['/', n, 10]), digit(n)],
  digit(n)];

const EMPTY = { type: 'FeatureCollection', features: [] };
const ll = (p) => [p.lng, p.lat];

function circle(p, radius, n = 48) {
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180), ky = 110540;
  const ring = Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [p.lng + (radius * Math.cos(a)) / kx, p.lat + (radius * Math.sin(a)) / ky];
  });
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

const polygon = (rings, properties = {}) => ({
  type: 'Feature', properties,
  geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [r.map(([lat, lng]) => [lng, lat])]) },
});

function pin(html, className = '') {
  const el = document.createElement('div');
  el.className = `map-pin ${className}`;
  el.innerHTML = html;
  return el;
}

export class CityView {
  constructor({ onEnter, onResult }) {
    this.onEnter = onEnter;
    this.onResult = onResult;
    this.malls = [];
    this.rings = new Map(); // mall id -> real building outline, loaded around the map and the user
    this.footprints = new Map();
    this.follow = false;
    this.nav = null; // { target, mode, route, index, started }
    this.navMode = 'car';
    this.car = store('car', null);
    this.satellite = store('satellite', false);
    this.here = null; // id of the mall the user is standing in
    this.discovered = new Set(); // ~10 km tiles already asked about
    try { this.arrived = new Set(JSON.parse(sessionStorage.getItem('passajh.arrived')) || []); } catch { this.arrived = new Set(); }
  }

  async init() {
    try { maplibregl.setRTLTextPlugin(RTL_PLUGIN, true); } catch { /* already set */ }
    const last = geo.best && inSnapshot(geo.best) ? geo.best : null;
    const map = (this.map = new maplibregl.Map({
      container: 'city-map', style: STYLE,
      center: ll(last ?? TEHRAN), zoom: last ? 14 : 11,
      attributionControl: { compact: true }, maxPitch: 60, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      fadeDuration: 150,
    }));
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    this.watchStyle();
    map.on('style.load', () => this.addLayers());
    map.on('dragstart', () => this.setFollow(false));
    map.on('moveend', debounce(() => this.onMoveEnd(), 350));

    this.malls = await api('/malls');
    this.updateMalls();
    $('#mall-list').classList.toggle('collapsed', matchMedia('(max-width: 820px)').matches);
    this.renderChips();
    this.renderList();
    if (this.car) this.drawCar();

    $('#btn-locate').addEventListener('click', () => this.locate());
    $('#btn-layer').addEventListener('click', () => this.toggleSatellite());
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
  }

  mall(id) { return this.malls?.find((m) => m.id === id); }

  // ---------- map layers ----------

  // Switch to raster tiles if the vector style or its tiles don't load (OpenFreeMap filtered or down).
  watchStyle() {
    let tileErrors = 0;
    const fallback = () => {
      if (this.raster) return;
      this.raster = true;
      this.map.setStyle(RASTER_STYLE);
    };
    const timer = setTimeout(() => { if (!this.map.isStyleLoaded()) fallback(); }, 9000);
    this.map.once('load', () => clearTimeout(timer));
    // Only network failures count: the style itself, or repeated vector-tile errors.
    this.map.on('error', (e) => {
      if (this.raster) return;
      if (/openfreemap/.test(e.error?.url ?? '') && !this.map.isStyleLoaded()) fallback();
      else if (e.sourceId === 'openmaptiles' && ++tileErrors > 6) fallback();
    });
  }

  // Runs on every style load (setStyle drops custom layers), so all overlay data lives on `this`.
  addLayers() {
    const map = this.map;
    // Persian labels on the base map.
    for (const l of map.getStyle().layers) {
      const tf = l.layout?.['text-field'];
      if (l.type === 'symbol' && tf && JSON.stringify(tf).includes('name')) map.setLayoutProperty(l.id, 'text-field', FA_NAME);
    }
    const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    map.addSource('pj-sat', { type: 'raster', tiles: [SATELLITE], tileSize: 256, maxzoom: 19, attribution: 'Imagery &copy; Esri' });
    map.addLayer({ id: 'pj-sat', type: 'raster', source: 'pj-sat', layout: { visibility: this.satellite ? 'visible' : 'none' } }, firstLabel);

    map.addSource('pj-outlines', { type: 'geojson', data: this.outlineData() });
    map.addLayer({ id: 'pj-outline-fill', type: 'fill', source: 'pj-outlines', minzoom: 14.5, paint: { 'fill-color': GREEN, 'fill-opacity': 0.1 } });
    map.addLayer({ id: 'pj-outline-line', type: 'line', source: 'pj-outlines', minzoom: 14.5, paint: { 'line-color': GREEN, 'line-width': 1.5, 'line-opacity': 0.7 } });

    map.addSource('pj-selected', { type: 'geojson', data: this.selectedData() });
    map.addLayer({ id: 'pj-selected-fill', type: 'fill', source: 'pj-selected', paint: { 'fill-color': GREEN, 'fill-opacity': 0.22 } });
    map.addLayer({ id: 'pj-selected-line', type: 'line', source: 'pj-selected', paint: { 'line-color': GREEN, 'line-width': 3 } });

    map.addSource('pj-acc', { type: 'geojson', data: this.accData() });
    map.addLayer({ id: 'pj-acc', type: 'fill', source: 'pj-acc', paint: { 'fill-color': '#2f7fe0', 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'pj-acc-line', type: 'line', source: 'pj-acc', paint: { 'line-color': '#2f7fe0', 'line-width': 1, 'line-opacity': 0.4 } });

    map.addSource('pj-route', { type: 'geojson', data: this.routeData() });
    map.addLayer({ id: 'pj-route-casing', type: 'line', source: 'pj-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4b1a85', 'line-width': 9, 'line-opacity': 0.35 } });
    map.addLayer({ id: 'pj-route', type: 'line', source: 'pj-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': PURPLE, 'line-width': 5 } });
    this.dashRoute();

    map.addSource('pj-malls', { type: 'geojson', data: this.mallData(), cluster: true, clusterRadius: 80, clusterMaxZoom: 13 });
    map.addLayer({
      id: 'pj-clusters', type: 'circle', source: 'pj-malls', filter: ['has', 'point_count'],
      paint: {
        'circle-color': GREEN, 'circle-opacity': 0.9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5,
        'circle-radius': ['step', ['get', 'point_count'], 13, 10, 16, 50, 20, 150, 24],
      },
    });
    map.addLayer({
      id: 'pj-cluster-count', type: 'symbol', source: 'pj-malls', filter: ['has', 'point_count'],
      layout: { 'text-field': faCount(['get', 'point_count']), 'text-font': FONT, 'text-size': 13, 'text-allow-overlap': true },
      paint: { 'text-color': '#fff' },
    });
    map.addLayer({
      id: 'pj-mall', type: 'circle', source: 'pj-malls', filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['case', ['==', ['get', 'id'], this.selected ?? ''], '#f59e0b', GREEN],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['get', 'big'], 6, 4.5], 17, ['case', ['get', 'big'], 10, 8]],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      },
    });
    map.addLayer({
      id: 'pj-mall-label', type: 'symbol', source: 'pj-malls', filter: ['!', ['has', 'point_count']], minzoom: 14,
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 18, 14],
        'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-max-width': 9, 'text-optional': true,
      },
      paint: { 'text-color': '#16432a', 'text-halo-color': '#fff', 'text-halo-width': 1.6 },
    });

    if (this.layersBound) return;
    this.layersBound = true;
    map.on('click', 'pj-clusters', async (e) => {
      const f = e.features[0];
      const zoom = await map.getSource('pj-malls').getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.3, duration: 500 });
    });
    map.on('click', 'pj-mall', (e) => this.select(e.features[0].properties.id));
    map.on('click', 'pj-outline-fill', (e) => {
      if (!map.queryRenderedFeatures(e.point, { layers: ['pj-mall'] }).length) this.select(e.features[0].properties.id);
    });
    for (const id of ['pj-clusters', 'pj-mall', 'pj-outline-fill']) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
  }

  setData(source, data) {
    this.map?.getSource(source)?.setData(data);
  }

  mallData() {
    return {
      type: 'FeatureCollection',
      features: this.malls.map((m) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: ll(m) },
        properties: { id: m.id, name: m.name, big: !!m.curated || m.stores >= 8 },
      })),
    };
  }

  outlineData() {
    return { type: 'FeatureCollection', features: [...this.rings].filter(([, r]) => r?.length).map(([id, r]) => polygon(r, { id })) };
  }

  selectedData() {
    const m = this.mall(this.selected);
    const r = m && this.rings.get(m.id);
    return { type: 'FeatureCollection', features: r?.length ? [polygon(r, { id: m.id })] : [] };
  }

  accData() {
    const p = geo.pos;
    return p ? { type: 'FeatureCollection', features: [circle(p, Math.min(p.accuracy, 3000))] } : EMPTY;
  }

  routeData() {
    const r = this.nav?.route;
    if (!r) return EMPTY;
    return { type: 'Feature', properties: { real: r.real }, geometry: { type: 'LineString', coordinates: r.coords.map(([lat, lng]) => [lng, lat]) } };
  }

  // A straight-line estimate (no router answered) is dashed. Dashes can't be data-driven, so set per route.
  dashRoute() {
    if (this.map.getLayer('pj-route')) this.map.setPaintProperty('pj-route', 'line-dasharray', this.nav?.route && !this.nav.route.real ? [1.5, 1.5] : null);
  }

  updateMalls() {
    this.setData('pj-malls', this.mallData());
  }

  restyleSelected() {
    if (!this.map.getLayer('pj-mall')) return;
    this.map.setPaintProperty('pj-mall', 'circle-color', ['case', ['==', ['get', 'id'], this.selected ?? ''], '#f59e0b', GREEN]);
    this.setData('pj-selected', this.selectedData());
  }

  toggleSatellite() {
    this.satellite = !this.satellite;
    persist('satellite', this.satellite);
    if (this.map.getLayer('pj-sat')) this.map.setLayoutProperty('pj-sat', 'visibility', this.satellite ? 'visible' : 'none');
    $('#btn-layer').classList.toggle('on', this.satellite);
    $('#btn-layer').title = this.satellite ? 'نقشه' : 'ماهواره';
  }

  onMoveEnd() {
    this.renderList();
    const c = this.map.getCenter();
    const p = { lat: c.lat, lng: c.lng };
    if (this.map.getZoom() >= 11 && !inSnapshot(p)) this.discover(p.lat, p.lng);
    if (this.map.getZoom() >= 14) this.loadOutlines(p, 'map');
    this.updateChips();
  }

  // Real outlines of the malls within ~1.5 km of a point: around the map center, and around the user for
  // arrival detection (`key` keeps the two from refetching each other).
  async loadOutlines(p, key) {
    this.outlinesAt ??= {};
    const last = this.outlinesAt[key];
    if (last && distance(last, p) < 700) return;
    this.outlinesAt[key] = p;
    try {
      const rings = await api(`/footprints?lat=${p.lat.toFixed(5)}&lng=${p.lng.toFixed(5)}`);
      let added = 0;
      for (const [id, r] of Object.entries(rings)) {
        if (!this.rings.has(id)) added++;
        this.rings.set(id, r);
        const m = this.mall(id);
        if (m) m.rings = r;
      }
      if (added) this.setData('pj-outlines', this.outlineData());
    } catch {
      this.outlinesAt[key] = null;
    }
  }

  // Distance in meters from the live (or last known) position, or null.
  dist(m) {
    return geo.best ? distance(geo.best, m) : null;
  }

  // ---------- list & districts ----------

  renderChips() {
    const box = $('#city-chips');
    box.innerHTML = '<button class="area-chip" data-near>📍 نزدیک من</button>'
      + DISTRICTS.map((d, i) => `<button class="area-chip" data-district="${i}">${esc(d.name)}</button>`).join('');
    $('[data-near]', box).onclick = () => this.nearMe();
    for (const b of $$('[data-district]', box)) b.onclick = () => this.showDistrict(DISTRICTS[b.dataset.district]);
    this.updateChips();
  }

  // Highlight the district the map is showing.
  updateChips() {
    const c = this.map.getCenter();
    const zoom = this.map.getZoom();
    for (const b of $$('#city-chips [data-district]')) {
      const d = DISTRICTS[b.dataset.district];
      const away = distance(d, { lat: c.lat, lng: c.lng });
      b.classList.toggle('on', (d === this.district && away < d.r * 2) || (zoom >= 13 && away < d.r));
    }
    $('#city-chips [data-near]')?.classList.toggle('on', this.follow);
  }

  showDistrict(d) {
    this.district = d;
    const inside = this.malls.filter((m) => distance(d, m) < d.r);
    this.setFollow(false);
    $('#mall-card').classList.add('hidden');
    $('#mall-list').classList.remove('collapsed');
    const pts = inside.length ? inside : [d];
    const b = new maplibregl.LngLatBounds(ll(pts[0]), ll(pts[0]));
    for (const m of pts) b.extend(ll(m));
    this.map.fitBounds(b, { padding: this.padding(), maxZoom: 16.5, duration: 900 });
  }

  async nearMe() {
    if (geo.pos) {
      this.setFollow(true);
      this.map.flyTo({ center: ll(geo.pos), zoom: Math.max(this.map.getZoom(), 15), duration: 900 });
      $('#mall-list').classList.remove('collapsed');
      return;
    }
    await this.startTracking(true);
  }

  // Room for the top bar and chips, and the bottom sheet on phones.
  padding() {
    const phone = matchMedia('(max-width: 820px)').matches;
    const sheet = $('#mall-list').classList.contains('collapsed') ? 70 : innerHeight * 0.38 + 20;
    return phone ? { top: 170, bottom: sheet, left: 30, right: 30 } : { top: 130, bottom: 40, left: 40, right: 400 };
  }

  // Malls in view, nearest first (to the user, or to the map center).
  renderList() {
    const b = this.map.getBounds();
    const c = this.map.getCenter();
    const from = geo.best && b.contains(ll(geo.best)) ? geo.best : { lat: c.lat, lng: c.lng };
    const inView = this.malls.filter((m) => b.contains(ll(m)));
    inView.sort((a, b2) => distance(from, a) - distance(from, b2));
    const items = inView.slice(0, 40);
    const title = inView.length ? `${fa(inView.length)} مرکز خرید در این محدوده` : 'مرکز خریدی در این محدوده نیست';
    $('#mall-list').innerHTML = `
      <button class="sheet-handle" aria-label="باز و بسته کردن فهرست">${title}</button>
      <h3>${title}${inView.length > items.length ? ` · ${fa(items.length)} نزدیک‌ترین` : ''}</h3>
      ${inView.length ? '' : '<div class="empty-state">🗺️<br>نقشه را جابه‌جا کنید یا یکی از محله‌های بالا را بزنید.</div>'}
      ${items.map((m) => {
        const st = openStatus(m.hours);
        const d = this.dist(m);
        const sub = [KIND[m.kind] ?? 'مرکز خرید', m.area, m.stores ? `${fa(m.stores)} فروشگاه` : null].filter(Boolean).map(esc).join(' · ');
        return `
        <div class="mall-item ${m.id === this.selected ? 'active' : ''}" data-id="${m.id}">
          <div class="row"><b>${esc(m.name)}</b>${m.id === this.here ? '<span class="chip green">📍 اینجا هستید</span>' : d != null ? `<span class="dist">${fmtDist(d)}</span>` : ''}</div>
          <div class="meta">${sub}${st ? ` · <span class="${st.open ? 'open' : 'closed'}">${st.text}</span>` : ''}${m.discounts ? ` · <span class="chip">${fa(m.discounts)} تخفیف</span>` : ''}</div>
        </div>`;
      }).join('')}`;
    for (const el of $$('.mall-item')) el.addEventListener('click', () => this.select(el.dataset.id));
  }

  async select(id) {
    const m = this.mall(id);
    if (!m) return;
    this.selected = id;
    this.setFollow(false);
    this.restyleSelected();
    $('#mall-list').classList.add('collapsed');
    // On phones the card covers the bottom of the map, so keep the mall above it.
    const phone = matchMedia('(max-width: 820px)').matches;
    this.map.flyTo({ center: ll(m), zoom: Math.max(this.map.getZoom(), 16.5), duration: 900, offset: [0, phone ? -110 : 0] });
    this.showCard(m);
    await this.footprint(m).catch(() => null);
    if (this.selected === id) this.restyleSelected();
  }

  showCard(m) {
    const top = Object.entries(m.categories).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const st = openStatus(m.hours);
    const d = this.dist(m);
    const tel = m.phone?.split(/[;,]/)[0].replace(/[^\d+]/g, '');
    const insta = m.instagram?.replace(/^.*instagram\.com\//, '').replace(/[/@]/g, '');
    const card = $('#mall-card');
    card.classList.remove('hidden');
    card.innerHTML = `
      <button class="close-x" id="card-close" aria-label="بستن">✕</button>
      <h2>${esc(m.name)}</h2>
      <div class="sub">${[KIND[m.kind] ?? 'مرکز خرید', m.area, m.street].filter(Boolean).map(esc).join(' · ')}
        ${st ? ` · <b class="${st.open ? 'open' : 'closed'}">${st.text}</b>` : ''}</div>
      ${m.description ? `<p>${esc(m.description)}</p>` : ''}
      ${d != null ? `<div class="sub dist-line">${m.id === this.here ? '📍 الان اینجا هستید' : `📏 ${fmtDist(d)} از شما · 🚗 حدود ${fmtDuration(estimate(d, 'car'))}${d < 4000 ? ` · 🚶 ${fmtDuration(estimate(d, 'foot'))}` : ''}`}</div>` : ''}
      <div class="facts">
        <span>🏬 ${fa(m.floors.length)} طبقه</span>
        <span>🛍️ ${m.stores ? `${fa(m.stores)} فروشگاه ثبت‌شده` : 'فروشگاهی ثبت نشده'}</span>
        ${m.discounts ? `<span class="deal-text">🏷️ ${fa(m.discounts)} تخفیف</span>` : ''}
        ${m.hours ? `<span>🕘 ${fa(m.hours)}</span>` : ''}
      </div>
      ${top.length ? `<div class="sub">${top.map(([k, n]) => `${cat(k).icon} ${cat(k).label} ${fa(n)}`).join(' · ')}</div>` : ''}
      <div class="card-actions">
        <button class="btn primary" id="card-enter">🚶 نقشه داخلی</button>
        ${m.id === this.here ? '' : `<button class="btn purple" data-nav="${m.id}">🧭 مسیریابی</button>`}
        ${tel ? `<a class="btn icon" href="tel:${esc(tel)}" aria-label="تماس">📞</a>` : ''}
        <button class="btn icon" id="card-share" aria-label="اشتراک‌گذاری">📤</button>
      </div>
      <div class="ext-links">باز کردن در: ${externalNav(m, m.name).map((x) => `<a target="_blank" rel="noopener" href="${esc(x.href)}">${esc(x.label)}</a>`).join(' · ')}
        ${insta ? ` · <a target="_blank" rel="noopener" href="https://instagram.com/${encodeURIComponent(insta)}">اینستاگرام</a>` : ''}
        ${m.website ? ` · <a target="_blank" rel="noopener" href="${esc(/^https?:/.test(m.website) ? m.website : `https://${m.website}`)}">وب‌سایت</a>` : ''}</div>
      <div class="source">منبع: OpenStreetMap${m.stores ? '' : ' · فروشنده هستید؟ <a href="/seller">مغازه‌تان را ثبت کنید</a>'}</div>`;
    $('#card-enter').addEventListener('click', () => this.onEnter(m.id));
    $('#card-close').addEventListener('click', () => {
      card.classList.add('hidden');
      this.selected = null;
      this.restyleSelected();
      this.renderList();
    });
    $('#card-share').addEventListener('click', () => this.share(m, `${m.name} — پاساژ`, `${location.origin}/#/mall/${m.id}`));
  }

  // The mall's real building outline (sets m.rings, which the indoor view uses to place the GPS dot).
  footprint(m) {
    if (!this.footprints.has(m.id)) {
      const p = (async () => {
        const fp = this.rings.has(m.id) ? { rings: this.rings.get(m.id) } : await api(`/footprint/${m.id}`);
        const rings = fp.rings ?? [];
        m.rings = rings;
        if (!rings.length) return false;
        if (!this.rings.has(m.id)) {
          this.rings.set(m.id, rings);
          this.setData('pj-outlines', this.outlineData());
        }
        return true;
      })();
      p.catch(() => this.footprints.delete(m.id));
      this.footprints.set(m.id, p);
    }
    return this.footprints.get(m.id);
  }

  // ---------- malls outside Tehran ----------

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
      if (fresh.length) {
        this.malls.push(...fresh);
        this.updateMalls();
        this.renderList();
        toast(`🛍️ ${fa(fresh.length)} مرکز خرید در این منطقه پیدا شد`, 'good', 3000);
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
      if (geo.pos) this.map.flyTo({ center: ll(geo.pos), zoom: Math.max(this.map.getZoom(), 16), duration: 800 });
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
        this.map.flyTo({ center: ll(p), zoom: 15, duration: 1000 });
        $('#mall-list').classList.remove('collapsed');
        const nearest = [...this.malls].sort((a, b) => this.dist(a) - this.dist(b))[0];
        if (nearest && this.dist(nearest) < 20000) {
          toast(`📍 نزدیک‌ترین: <b>${esc(nearest.name)}</b> (${fmtDist(this.dist(nearest))})
            <div class="actions-row" style="margin:6px 0 0"><button class="btn small purple" data-nav="${nearest.id}">🧭 مسیریابی</button></div>`, 'good', 6000);
        }
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
    $('#city-chips [data-near]')?.classList.toggle('on', this.follow);
  }

  renderLocate() {
    const btn = $('#btn-locate');
    btn.classList.toggle('on', geo.active);
    btn.classList.toggle('follow', this.follow);
    btn.title = !geo.active ? 'موقعیت من' : this.follow ? 'خاموش کردن ردیابی' : 'دنبال کردن من';
  }

  onPosition() {
    const p = geo.pos;
    if (!this.meMarker) {
      this.meMarker = new maplibregl.Marker({ element: pin('<div class="me-blip"><i class="cone"></i></div>', 'me-pin'), rotationAlignment: 'map' })
        .setLngLat(ll(p)).addTo(this.map);
      this.meMarker.getElement().addEventListener('click', (e) => { e.stopPropagation(); this.meMenu(); });
      this.meAt = p;
    } else {
      this.glide(p);
    }
    this.setData('pj-acc', this.accData());
    this.drawHeading();
    if (this.follow) this.camera(p);
    if (this.nav) this.updateNav();
    if (!this.discoverAt || distance(this.discoverAt, p) > 5000) {
      this.discoverAt = p;
      if (!inSnapshot(p)) this.discover(p.lat, p.lng);
    }
    this.loadOutlines(p, 'me').then(() => this.checkArrival());
    this.checkNearby();
    if (!this.listAt || distance(this.listAt, p) > 100) {
      this.listAt = p;
      this.renderList();
      const m = this.mall(this.selected);
      if (m && !$('#mall-card').classList.contains('hidden')) this.showCard(m);
    }
  }

  // Slide the blue dot to the new fix instead of jumping.
  glide(to) {
    const from = this.meAt ?? to;
    cancelAnimationFrame(this.glideFrame);
    if (distance(from, to) > 300) {
      this.meAt = to;
      return this.meMarker.setLngLat(ll(to));
    }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 800), e = 1 - (1 - k) ** 3;
      this.meAt = { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e };
      this.meMarker?.setLngLat(ll(this.meAt));
      if (k < 1) this.glideFrame = requestAnimationFrame(step);
    };
    this.glideFrame = requestAnimationFrame(step);
  }

  // Follow the user; while navigating, heading-up and tilted like a car navigator.
  camera(p) {
    const driving = this.nav?.started;
    const b = geo.bearing;
    this.map.easeTo({
      center: ll(p), duration: 800, easing: (t) => t,
      ...(driving ? { zoom: Math.max(this.map.getZoom(), 16.5), pitch: 45, ...(b != null ? { bearing: b } : {}) } : {}),
    });
  }

  drawHeading() {
    const el = this.meMarker?.getElement();
    const cone = el?.querySelector('.cone');
    if (!cone) return;
    const b = geo.bearing;
    cone.style.display = b == null ? 'none' : '';
    if (b != null) this.meMarker.setRotation(b);
  }

  clearMe() {
    this.meMarker?.remove();
    this.meMarker = this.meAt = null;
    this.setData('pj-acc', EMPTY);
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
        ${nearest ? `<br>نزدیک‌ترین: <b>${esc(nearest.name)}</b> (${fmtDist(this.dist(nearest))})` : ''}</div>
      <div class="actions-row">
        <button class="btn primary" id="me-share">📤 ارسال موقعیتم برای دوست</button>
        <button class="btn" id="me-park">🚗 ماشینم اینجاست</button>
        ${nearest ? `<button class="btn purple" data-nav="${nearest.id}">🧭 برو به ${esc(nearest.name)}</button>` : ''}
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

  // Inside a real outline, or right at a mall that has none. A rough fix can't tell neighbouring passages apart.
  checkArrival() {
    const p = geo.pos;
    if (!p || !this.malls.length || p.accuracy > 100) return;
    const near = this.malls.filter((m) => Math.abs(m.lat - p.lat) < 0.005 && Math.abs(m.lng - p.lng) < 0.006);
    const rings = (m) => this.rings.get(m.id) ?? m.rings;
    const at = near.find((m) => rings(m)?.length && pointInRings(p, rings(m)))
      ?? near.filter((m) => !rings(m)?.length && distance(p, m) < Math.min(80, 30 + p.accuracy / 2)).sort((a, b) => distance(p, a) - distance(p, b))[0];
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
    notify(`به ${m.name} رسیدید 🛍️`, m.stores ? `${m.stores} فروشگاه ثبت‌شده. نقشه داخلی را باز کنید.` : 'نقشه داخلی را باز کنید.', `arrive-${m.id}`);
    if (location.hash.startsWith('#/mall/')) return;
    const html = `📍 به <b>${esc(m.name)}</b> رسیدید!${m.discounts ? ` ${fa(m.discounts)} فروشگاه تخفیف دارند.` : ''}`;
    // Don't cover a form or panel the user is in the middle of; offer it as a toast instead.
    if (!$('#modal').classList.contains('hidden') || $$('.drawer:not(.hidden)').length) {
      const t = toast(`${html}<div class="actions-row" style="margin:6px 0 0"><button class="btn small primary" data-enter="${m.id}">🚶 نقشه داخلی</button></div>`, 'good', 10000);
      $('[data-enter]', t).onclick = () => this.onEnter(m.id);
      return;
    }
    const box = openModal(`
      <h2>📍 به ${esc(m.name)} رسیدید</h2>
      <div class="sub">${html}<br>نقشه داخلی با موقعیت واقعی شما باز شود؟</div>
      <div class="actions-row"><button class="btn primary" id="arr-enter">🚶 ورود به نقشه داخلی</button><button class="btn" data-close>بعداً</button></div>`);
    $('#arr-enter', box).onclick = () => { closeModal(); this.onEnter(m.id); };
  }

  // Once per visit: point out the nearest mall with live discounts when it's within walking distance.
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
    const b = new maplibregl.LngLatBounds(ll(pos), ll(pos));
    for (const [lat, lng] of nav.route.coords) b.extend([lng, lat]);
    this.map.fitBounds(b, { padding: { ...this.padding(), top: 230 }, maxZoom: 16, duration: 900 });
    this.updateNav();
  }

  drawRoute() {
    const nav = this.nav;
    this.setData('pj-route', this.routeData());
    this.dashRoute();
    const end = nav.route.coords[nav.route.coords.length - 1];
    nav.dest?.remove();
    nav.dest = new maplibregl.Marker({ element: pin('<div class="dest-pin">🏁</div>'), anchor: 'bottom' }).setLngLat([end[1], end[0]]).addTo(this.map);
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
        <button class="btn small" id="nav-ext" aria-label="باز کردن در برنامه دیگر">🔗</button>
        <button class="btn small danger" id="nav-end" aria-label="پایان">✕</button>
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
        if (geo.pos) this.camera(geo.pos);
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
    nav.dest?.remove();
    this.setData('pj-route', EMPTY);
    if (nav.started) this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
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
    $('#car-show', box).onclick = () => { closeModal(); this.setFollow(false); this.map.flyTo({ center: ll(this.car), zoom: 18 }); };
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
    this.carMarker = new maplibregl.Marker({ element: pin('<div class="blip car-blip">🚗</div>') }).setLngLat(ll(this.car)).addTo(this.map);
    this.carMarker.getElement().addEventListener('click', (e) => { e.stopPropagation(); this.carMenu(); });
    this.renderPark();
  }

  renderPark() {
    const b = $('#btn-park');
    b.classList.toggle('on', !!(this.car || store('parking', null)));
    b.title = this.car ? 'ماشین من کجاست؟' : 'ماشینم را اینجا پارک کردم';
  }

  // ---------- friends ----------

  setFriends(list) {
    if (!this.map) return;
    this.friendMarkers ??= new Map();
    const seen = new Set();
    for (const f of list) {
      if (f.lat == null) continue;
      seen.add(f.id);
      let mk = this.friendMarkers.get(f.id);
      if (!mk) {
        mk = new maplibregl.Marker({ element: pin('') }).setLngLat(ll(f)).addTo(this.map);
        mk.getElement().addEventListener('click', (e) => { e.stopPropagation(); this.onFriend?.(mk.friend); });
        this.friendMarkers.set(f.id, mk);
      }
      mk.friend = f;
      mk.setLngLat(ll(f));
      const key = `${f.emoji}|${f.name}|${f.mallName}`;
      if (mk.key !== key) {
        mk.key = key;
        mk.getElement().innerHTML = `<div class="blip friend-blip">${esc(f.emoji)}<span class="blip-label">${esc(f.name)}${f.mallName ? ` · ${esc(f.mallName)}` : ''}</span></div>`;
      }
    }
    for (const [id, mk] of this.friendMarkers) if (!seen.has(id)) { mk.remove(); this.friendMarkers.delete(id); }
  }

  // ---------- search: malls by name, then shops and products ----------

  bindSearch() {
    const input = $('#city-search');
    const box = $('#city-results');
    const run = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) return box.classList.add('hidden');
      const qt = tokens(q);
      const near = (m) => this.dist(m) ?? distance(this.map.getCenter(), m);
      const malls = this.malls
        .map((m) => ({ m, score: matchScore(qt, `${m.name} ${m.nameEn ?? ''} ${m.area ?? ''} ${m.street ?? ''}`) }))
        .filter((x) => x.score >= 1)
        .sort((a, b) => near(a.m) - near(b.m))
        .slice(0, 6);
      const results = await api(`/search?q=${encodeURIComponent(q)}`).catch(() => []);
      if (input.value.trim() !== q) return;
      box.classList.remove('hidden');
      const d = (r) => { const m = this.mall(r.store.mallId); return (m && this.dist(m)) ?? 0; };
      results.sort((a, b) => b.score - a.score || d(a) - d(b) || (a.product?.price ?? 0) - (b.product?.price ?? 0));
      box.innerHTML = (malls.length ? `<div class="results-note">مراکز خرید</div>${malls.map(({ m }) => `
        <div class="result" data-mall="${m.id}">
          <div class="ico">🏬</div>
          <div class="main"><div class="title">${esc(m.name)}</div><div class="sub">${[KIND[m.kind], m.area].filter(Boolean).map(esc).join(' · ')}</div></div>
          ${this.dist(m) != null ? `<div class="price dist">${fmtDist(this.dist(m))}</div>` : ''}
        </div>`).join('')}` : '')
        + (results.length ? `<div class="results-note">فروشگاه‌ها و کالاها${geo.best ? ' · نزدیک‌ترین اول' : ''}</div>${results.map((r, i) => `
        <div class="result" data-i="${i}">
          <div class="ico">${cat(r.store.category).icon}</div>
          <div class="main">
            <div class="title">${esc(r.product ? r.product.name : r.store.name)} ${r.store.discount ? `<span class="chip">${fa(r.store.discount.percent)}٪</span>` : ''}</div>
            <div class="sub">${r.product ? `${esc(r.store.name)} · ` : `${esc(cat(r.store.category).label)} · `}${esc(r.store.mallName)}${geo.best ? ` · ${fmtDist(d(r))}` : ''}</div>
          </div>
          ${r.product ? `<div class="price">${toman(finalPrice(r.product, r.store))}</div>` : ''}
        </div>`).join('')}` : '')
        + `<div class="empty">${malls.length || results.length ? '' : 'چیزی پیدا نشد.<br>'}<button class="btn small ${malls.length || results.length ? '' : 'primary'}" data-action="request" data-q="${esc(q)}">📣 به فروشنده‌های «${esc(q)}» خبر بده</button></div>`;
      for (const el of box.querySelectorAll('[data-i]')) {
        el.addEventListener('click', () => { box.classList.add('hidden'); this.onResult(results[el.dataset.i]); });
      }
      for (const el of box.querySelectorAll('[data-mall]')) {
        el.addEventListener('click', () => { box.classList.add('hidden'); input.blur(); this.select(el.dataset.mall); });
      }
    }, 250);
    input.addEventListener('input', run);
    input.addEventListener('focus', run);
    document.addEventListener('click', (e) => { if (!e.target.closest('#city-view .search')) box.classList.add('hidden'); });
  }

  invalidate() { this.map?.resize(); }
}
