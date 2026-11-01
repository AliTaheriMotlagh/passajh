// The map: every mall and passage, and the shopping streets, filtered by what you want to buy. The map
// library (self-hosted) loads only when this page is opened, so the rest of the app stays light on slow
// connections. Tiles come from OpenFreeMap, falling back to the standard OpenStreetMap tiles.

import { $, $$, esc, fa, cat, toast, statusPill } from '../ui.js';
import { geo, distTo, fmtDist } from '../geo.js';
import { data, mallsWith, streetsOf } from '../data.js';
import { CATEGORIES, SHOP_CATEGORIES } from '/shared/catalog.js';
import { KIND, statusOf, topCats, metroText } from '../parts.js';

const TEHRAN = [51.39, 35.71];
const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const RASTER = {
  version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '&copy; OpenStreetMap' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.5 } }],
};
const FA_NAME = ['coalesce', ['get', 'name:fa'], ['get', 'name']];

let lib = null;
function loadLib() {
  lib ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/maplibre-gl-4.7.1.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = '/vendor/maplibre-gl-4.7.1.js';
    s.onload = () => {
      try { maplibregl.setRTLTextPlugin('/vendor/rtl-text-0.2.3.js', true); } catch { /* already set */ }
      resolve(maplibregl);
    };
    s.onerror = () => { lib = null; reject(new Error('نقشه بارگذاری نشد')); };
    document.head.append(s);
  });
  return lib;
}

export async function render({ main, header, params }) {
  const [mode, arg] = params;
  let category = mode === 'c' && CATEGORIES[arg] ? arg : null;
  header.innerHTML = '';
  main.innerHTML = `<div class="map-wrap">
      <div id="map"><div class="map-msg">در حال بارگذاری نقشه…</div></div>
      <div class="map-top">
        <a class="logo" href="#/" style="display:inline-flex;background:var(--surface);padding:6px 12px 6px 14px;border-radius:999px;box-shadow:var(--shadow-1);font-size:17px"><span class="mark" style="width:24px;height:24px;font-size:13px">پ</span>پاساژ</a>
        <div class="chips" id="map-cats">
          <button class="chip ${category ? '' : 'on'}" data-cat="">همه</button>
          ${SHOP_CATEGORIES.map((k) => `<button class="chip ${k === category ? 'on' : ''}" data-cat="${k}">${CATEGORIES[k].icon} ${esc(CATEGORIES[k].short)}</button>`).join('')}
        </div>
      </div>
      <div class="map-fab" id="map-fab"><button class="btn" id="map-me" aria-label="موقعیت من">◎</button></div>
      <div class="map-card hidden" id="map-card"></div>
    </div>`;

  $('#map-cats .chip.on', main)?.scrollIntoView({ inline: 'center', block: 'nearest' });

  let maplibre;
  try {
    maplibre = await loadLib();
  } catch (e) {
    $('#map', main).innerHTML = `<div class="map-msg"><div><p>${esc(e.message)}. اتصال اینترنت را بررسی کنید.</p><a class="btn" href="#/">برگشت به فهرست</a></div></div>`;
    return;
  }
  if (!$('#map', main)) return;
  $('#map', main).innerHTML = '';

  const start = mode === 'm' ? data.byId.get(arg) : mode === 's' ? data.hotspots.find((h) => h.id === arg) : null;
  const map = new maplibre.Map({
    container: 'map', style: STYLE,
    center: start ? [start.lng, start.lat] : geo.best ? [geo.best.lng, geo.best.lat] : TEHRAN,
    zoom: start ? 16 : geo.best ? 13.5 : 11.2,
    attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();

  // Fall back to raster tiles when OpenFreeMap can't be reached.
  let raster = false;
  const fallback = () => { if (!raster) { raster = true; map.setStyle(RASTER); } };
  const timer = setTimeout(() => { if (!map.isStyleLoaded()) fallback(); }, 8000);
  map.once('load', () => clearTimeout(timer));
  map.on('error', (e) => { if (!map.isStyleLoaded() && /openfreemap/.test(e.error?.url ?? e.error?.message ?? '')) fallback(); });

  const mallData = () => ({
    type: 'FeatureCollection',
    features: (category ? mallsWith(category) : data.malls).filter((m) => !m.closed).map((m) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
      properties: { id: m.id, name: m.name, n: category ? (m.cats?.[category] ?? 0) + (m.tags?.[category] ?? 0) : m.shops, known: m.shops > 0 || !!m.tags ? 1 : 0 },
    })),
  });
  const streetData = () => ({
    type: 'FeatureCollection',
    features: (category ? streetsOf(category) : data.hotspots).map((h) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
      properties: { id: h.id, label: `${cat(h.category).icon} ${h.name}`, color: cat(h.category).color, n: h.count },
    })),
  });

  map.on('style.load', () => {
    for (const l of map.getStyle().layers) {
      const tf = l.layout?.['text-field'];
      if (l.type === 'symbol' && tf && JSON.stringify(tf).includes('name')) map.setLayoutProperty(l.id, 'text-field', FA_NAME);
    }
    map.addSource('streets', { type: 'geojson', data: streetData() });
    map.addLayer({
      id: 'streets', type: 'circle', source: 'streets',
      paint: {
        'circle-color': ['get', 'color'], 'circle-opacity': 0.16, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.5,
        // A street is the ~350 m around its busiest shop: about 6 px at zoom 11 and 180 px at zoom 16 in Tehran.
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 11, 6, 16, 180],
      },
    });
    map.addLayer({
      id: 'street-labels', type: 'symbol', source: 'streets', minzoom: 12,
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': false },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#fff', 'text-halo-width': 2 },
    });
    map.addSource('malls', { type: 'geojson', data: mallData(), cluster: true, clusterRadius: 50, clusterMaxZoom: 12 });
    map.addLayer({
      id: 'clusters', type: 'circle', source: 'malls', filter: ['has', 'point_count'],
      paint: { 'circle-color': '#0f766e', 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 50, 22] },
    });
    map.addLayer({
      id: 'cluster-n', type: 'symbol', source: 'malls', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 },
      paint: { 'text-color': '#fff' },
    });
    map.addLayer({
      id: 'malls', type: 'circle', source: 'malls', filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['case', ['==', ['get', 'known'], 1], '#0f766e', '#8a857a'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, ['+', 7, ['min', 8, ['sqrt', ['get', 'n']]]]],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      },
    });
    map.addLayer({
      id: 'mall-labels', type: 'symbol', source: 'malls', filter: ['!', ['has', 'point_count']], minzoom: 14.5,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-max-width': 9 },
      paint: { 'text-color': '#1d1b16', 'text-halo-color': '#fff', 'text-halo-width': 1.8 },
    });
    if (start) (mode === 'm' ? showMall : showStreet)(start);
  });

  const card = $('#map-card', main);
  const fab = $('#map-fab', main);
  const showCard = (html) => { card.innerHTML = `<div class="card">${html}</div>`; card.classList.remove('hidden'); fab.classList.add('lift'); };
  const hideCard = () => { card.classList.add('hidden'); fab.classList.remove('lift'); };

  function showMall(m) {
    const d = distTo(m);
    showCard(`<div style="display:flex;gap:10px;align-items:flex-start">
        <div class="grow"><div class="small muted">${KIND[m.kind] ?? ''}${m.hood ? ` · ${esc(m.hood)}` : ''}${d != null ? ` · ${fmtDist(d)}` : ''}</div>
        <div style="font-weight:900;font-size:17px">${esc(m.name)}</div></div>
        <button class="btn ghost icon sm" id="card-x" aria-label="بستن">✕</button></div>
      <div class="small" style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:4px">${statusPill(statusOf(m))}${m.metro ? `<span>${metroText(m.metro)}</span>` : ''}</div>
      <div class="small muted" style="margin-top:6px">${m.shops ? `${fa(m.shops)} مغازه ثبت‌شده ${topCats(m).map((k) => cat(k).icon).join(' ')}` : 'هنوز مغازه‌ای ثبت نشده'}</div>
      <div class="actions fill"><a class="btn primary sm" href="#/m/${encodeURIComponent(m.id)}">مشاهده</a></div>`);
    $('#card-x', card).onclick = hideCard;
  }
  function showStreet(h) {
    const c = cat(h.category);
    showCard(`<div style="display:flex;gap:10px;align-items:flex-start">
        <div class="grow"><div class="small" style="color:${c.color};font-weight:800">${c.icon} راسته ${esc(c.short)}</div>
        <div style="font-weight:900;font-size:17px">${esc(h.name)}</div></div>
        <button class="btn ghost icon sm" id="card-x" aria-label="بستن">✕</button></div>
      <div class="small muted">حدود ${fa(h.count)} مغازه${h.metro ? ` · ${metroText(h.metro)}` : ''}</div>
      <div class="actions fill"><button class="btn primary sm" data-go-to="${h.lat},${h.lng}" data-name="${esc(h.name)}">🧭 مسیریابی</button><button class="btn sm" data-street="${esc(h.id)}">جزئیات</button></div>`);
    $('#card-x', card).onclick = hideCard;
  }

  map.on('click', (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['malls', 'clusters', 'streets'].filter((l) => map.getLayer(l)) })[0];
    if (!f) return hideCard();
    if (f.layer.id === 'clusters') return map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 });
    if (f.layer.id === 'malls') return showMall(data.byId.get(f.properties.id));
    showStreet(data.hotspots.find((h) => h.id === f.properties.id));
  });
  for (const l of ['malls', 'clusters', 'streets']) {
    map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
  }

  for (const b of $$('[data-cat]', main)) {
    b.onclick = () => {
      category = b.dataset.cat || null;
      for (const x of $$('[data-cat]', main)) x.classList.toggle('on', x === b);
      history.replaceState(null, '', category ? `#/map/c/${category}` : '#/map');
      map.getSource('malls')?.setData(mallData());
      map.getSource('streets')?.setData(streetData());
      hideCard();
    };
  }

  let me = null;
  const drawMe = () => {
    if (!geo.best) return;
    if (!me) {
      const el = document.createElement('div');
      el.className = 'me-dot';
      me = new maplibre.Marker({ element: el });
    }
    me.setLngLat([geo.best.lng, geo.best.lat]).addTo(map);
  };
  drawMe();
  const onPos = () => drawMe();
  geo.addEventListener('position', onPos);
  $('#map-me', main).onclick = async () => {
    try {
      const p = await geo.start();
      drawMe();
      map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14.5) });
    } catch (e) { toast(esc(e.message), 'bad', 6000); }
  };

  return () => {
    geo.removeEventListener('position', onPos);
    map.remove();
  };
}
