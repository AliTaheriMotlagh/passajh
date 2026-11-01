// Floor plan editor: trace a mall's real floors over its building outline (optionally over a photo of the
// evacuation plan), then save. Plans are stored in lat/lng; the server turns them into indoor maps.

import { $, $$, esc, fa, api, toast, openModal, closeModal, store, persist, debounce } from './ui.js';
import { CATEGORIES } from '/shared/catalog.js';
import { tokens, matchScore } from '/shared/text.js';

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const RASTER_STYLE = {
  version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '&copy; OpenStreetMap' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};
const SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const FONT = ['Noto Sans Bold'];
const FLOOR_ID = /^(P[1-9]|B[1-9]|G|[1-9]\d?)$/;
const FLOOR_NAMES = { G: 'همکف', 1: 'طبقه اول', 2: 'طبقه دوم', 3: 'طبقه سوم', 4: 'طبقه چهارم', 5: 'طبقه پنجم', B1: 'زیرزمین اول', B2: 'زیرزمین دوم', B3: 'زیرزمین سوم', P1: 'پارکینگ P1', P2: 'پارکینگ P2', P3: 'پارکینگ P3' };
const floorName = (id) => FLOOR_NAMES[id] ?? `طبقه ${fa(id)}`;
const levelOf = (id) => (id[0] === 'P' || id[0] === 'B' ? -Number(id.slice(1)) : id === 'G' ? 0 : Number(id));
const POINT_LABEL = {
  entrance: 'ورودی', elevator: 'آسانسور', stairs: 'پله', wc: 'سرویس', prayer: 'نمازخانه', atm: 'خودپرداز', info: 'اطلاعات',
  foodcourt: 'فودکورت', kids: 'کودک', firstaid: 'کمک‌های اولیه', fireexit: 'خروج اضطراری',
};
const pointLabel = (p) => (p.type === 'escalator' ? `پله برقی ${p.dir === 'down' ? '▼' : '▲'}` : POINT_LABEL[p.type] ?? p.type);
const AREA_LABEL = { void: 'نورگیر', service: 'بسته', seating: 'غذاخوری' };
const HINTS = {
  select: 'روی واحد، فضا یا نقطه بزنید تا ویرایش شود. گوشه‌های واحد انتخاب‌شده را با ماوس جابه‌جا کنید. Delete حذف می‌کند.',
  rect: 'سه کلیک: دو گوشه جلوی مغازه (سمت راهرو)، بعد عمق مغازه. گوشه‌ها به دیوار واحدهای کناری می‌چسبند.',
  unit: 'روی گوشه‌ها کلیک کنید؛ با کلیک روی نقطه اول یا Enter بسته می‌شود. Backspace آخرین نقطه را برمی‌دارد، Esc لغو.',
  void: 'دور نورگیر یا آتریوم را بکشید (راه رفتن ممنوع). Enter برای بستن.',
  service: 'فضاهای بسته (تأسیسات، انبار، دیوار ضخیم) را بکشید. Enter برای بستن.',
  seating: 'محوطه میزهای فودکورت را بکشید (قابل عبور). Enter برای بستن.',
  image: 'عکس را با ماوس بکشید تا جابه‌جا شود.',
  point: 'روی نقشه کلیک کنید تا اضافه شود.',
};
const COLORS = ['match', ['get', 'category'], ...Object.entries(CATEGORIES).flatMap(([k, v]) => [k, v.color]), '#3a4553'];
const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const EMPTY = { type: 'FeatureCollection', features: [] };

let map, malls = [], data = null, plan = null, floorId = 'G', tool = 'select', draft = [], hover = null, selected = null;
let undoStack = [], dirty = false, satellite = false, image = null, drag = null;

// ---------- geometry ----------

const kxOf = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const KY = 110540;
const px = (ll) => map.project([ll[1], ll[0]]); // [lat, lng] → screen point
const ll = (e) => [Math.round(e.lngLat.lat * 1e7) / 1e7, Math.round(e.lngLat.lng * 1e7) / 1e7];
const closed = (ring) => [...ring, ring[0]].map(([lat, lng]) => [lng, lat]);

// Snap to a nearby vertex of another unit or the building outline, so neighbouring shops share walls.
function snap(p) {
  const s = px(p);
  let best = null;
  const consider = (q) => {
    const d = Math.hypot(px(q).x - s.x, px(q).y - s.y);
    if (d < 9 && (!best || d < best.d)) best = { d, q };
  };
  for (const u of floor().units) for (const q of u.ring) consider(q);
  for (const a of floor().areas) for (const q of a.ring) consider(q);
  for (const r of data.mall.rings) for (const q of r) consider(q);
  return best ? [...best.q] : p;
}

// Third click of the rectangle tool: extend the front edge A→B by the perpendicular depth to C.
function rectFrom([a, b], c) {
  const kx = kxOf(a[0]);
  const v = [(b[1] - a[1]) * kx, (b[0] - a[0]) * KY];
  const len = Math.hypot(...v) || 1;
  const n = [-v[1] / len, v[0] / len];
  const depth = (c[1] - a[1]) * kx * n[0] + (c[0] - a[0]) * KY * n[1];
  const off = [n[1] * depth / KY, n[0] * depth / kx]; // [dlat, dlng]
  return [a, b, [b[0] + off[0], b[1] + off[1]], [a[0] + off[0], a[1] + off[1]]];
}

// ---------- state ----------

const floor = () => {
  let f = plan.floors.find((x) => x.id === floorId);
  if (!f) { f = { id: floorId, units: [], areas: [], points: [] }; plan.floors.push(f); }
  return f;
};

function change(fn) {
  undoStack.push(JSON.stringify(plan));
  if (undoStack.length > 80) undoStack.shift();
  fn();
  dirty = true;
  persist(`editor.draft.${data.mall.id}`, { plan, at: Date.now() });
  fillFloors();
  render();
}

function undo() {
  if (!undoStack.length) return;
  plan = JSON.parse(undoStack.pop());
  selected = null;
  dirty = true;
  render();
}

// ---------- boot ----------

async function boot() {
  $('#ed-key').value = store('editor.key', '');
  $('#ed-key').oninput = (e) => persist('editor.key', e.target.value);
  try { maplibregl.setRTLTextPlugin('https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js', true); } catch { /* set */ }
  map = new maplibregl.Map({ container: 'ed-map', style: STYLE, center: [51.39, 35.7], zoom: 12, dragRotate: false, attributionControl: { compact: true } });
  map.touchZoomRotate.disableRotation();
  map.doubleClickZoom.disable();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  let loaded = false;
  map.once('load', () => { loaded = true; });
  map.on('error', (e) => { if (!loaded && /openfreemap/.test(e.error?.url ?? '')) { loaded = true; map.setStyle(RASTER_STYLE); } });
  map.on('style.load', addLayers);
  bindMap();
  bindUi();

  malls = (await api('/malls')).sort((a, b) => (b.plan ? 1 : 0) - (a.plan ? 1 : 0) || a.name.localeCompare(b.name, 'fa'));
  fillMalls();
  const want = decodeURIComponent(location.hash.slice(1)) || store('editor.mall', null) || 'iranmall';
  await openMall(malls.some((m) => m.id === want) ? want : malls[0].id);
}

function fillMalls() {
  const qt = tokens($('#ed-mall-q').value);
  const list = qt.length ? malls.filter((m) => matchScore(qt, `${m.name} ${m.nameEn ?? ''} ${m.area ?? ''}`) >= 1) : malls;
  $('#ed-mall').innerHTML = list.slice(0, 400).map((m) => `<option value="${m.id}" ${m.id === data?.mall.id ? 'selected' : ''}>${m.plan ? '🗺️ ' : ''}${esc(m.name)}${m.area ? ` — ${esc(m.area)}` : ''}</option>`).join('');
}

async function openMall(id) {
  if (dirty && !confirm('تغییرات ذخیره‌نشده از بین می‌رود. ادامه؟')) { $('#ed-mall').value = data.mall.id; return; }
  data = await api(`/plans/${encodeURIComponent(id)}`);
  persist('editor.mall', id);
  window.history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  $('#ed-view').href = `/#/mall/${encodeURIComponent(id)}`;
  plan = data.plan ? JSON.parse(JSON.stringify({ floors: data.plan.floors })) : { floors: [] };
  for (const f of plan.floors) { f.units ??= []; f.areas ??= []; f.points ??= []; }
  undoStack = [];
  dirty = false;
  selected = null;
  const draftSaved = store(`editor.draft.${id}`, null);
  if (draftSaved && (!data.plan || draftSaved.at > Date.parse(data.plan.updated ?? 0)) && confirm('یک پیش‌نویس ذخیره‌نشده از این پاساژ در این مرورگر هست. بازش کنم؟')) {
    plan = draftSaved.plan;
    dirty = true;
  }
  const ids = new Set([...data.mall.floors.map((f) => f.id), ...plan.floors.map((f) => f.id)]);
  floorId = ids.has('G') ? 'G' : [...ids][0] ?? 'G';
  fillFloors();
  fillMalls();
  const pts = data.mall.rings.flat();
  if (pts.length) {
    const b = new maplibregl.LngLatBounds([pts[0][1], pts[0][0]], [pts[0][1], pts[0][0]]);
    for (const [lat, lng] of pts) b.extend([lng, lat]);
    map.fitBounds(b, { padding: 40, duration: 0, maxZoom: 20 });
  } else {
    map.jumpTo({ center: [data.mall.lng, data.mall.lat], zoom: 19 });
  }
  render();
}

function fillFloors() {
  const ids = [...new Set([...data.mall.floors.map((f) => f.id), ...plan.floors.map((f) => f.id), floorId])].sort((a, b) => levelOf(b) - levelOf(a));
  $('#ed-floor').innerHTML = ids.map((id) => {
    const f = plan.floors.find((x) => x.id === id);
    const n = f ? f.units.length : 0;
    return `<option value="${id}" ${id === floorId ? 'selected' : ''}>${esc(floorName(id))}${n ? ` · ${fa(n)} واحد` : ''}</option>`;
  }).join('');
}

// ---------- map layers ----------

function addLayers() {
  for (const l of map.getStyle().layers) {
    if (l.type === 'symbol' && JSON.stringify(l.layout?.['text-field'] ?? '').includes('name')) map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:fa'], ['get', 'name']]);
  }
  const src = (id) => map.addSource(id, { type: 'geojson', data: EMPTY });
  map.addSource('sat', { type: 'raster', tiles: [SATELLITE], tileSize: 256, maxzoom: 19 });
  map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: satellite ? 'visible' : 'none' } });
  if (image) addImage();
  for (const id of ['outline', 'ghost', 'areas', 'units', 'points', 'shops', 'draft', 'sel']) src(id);
  map.addLayer({ id: 'outline-fill', type: 'fill', source: 'outline', paint: { 'fill-color': '#12a150', 'fill-opacity': 0.06 } });
  map.addLayer({ id: 'outline-line', type: 'line', source: 'outline', paint: { 'line-color': '#12a150', 'line-width': 2.5 } });
  map.addLayer({ id: 'ghost', type: 'line', source: 'ghost', paint: { 'line-color': '#7d8a99', 'line-width': 1, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['match', ['get', 'kind'], 'void', '#0b1220', 'seating', '#8a6a3a', '#5b6470'], 'fill-opacity': 0.55 } });
  map.addLayer({ id: 'units-fill', type: 'fill', source: 'units', paint: { 'fill-color': COLORS, 'fill-opacity': 0.55 } });
  map.addLayer({ id: 'units-line', type: 'line', source: 'units', paint: { 'line-color': '#1b2733', 'line-width': 1.2 } });
  map.addLayer({
    id: 'units-label', type: 'symbol', source: 'units',
    layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 12, 'text-max-width': 7 },
    paint: { 'text-color': '#0f1d14', 'text-halo-color': '#fff', 'text-halo-width': 1.4 },
  });
  map.addLayer({ id: 'shops', type: 'circle', source: 'shops', paint: { 'circle-radius': 4, 'circle-color': '#9b3dff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
  map.addLayer({
    id: 'shops-label', type: 'symbol', source: 'shops', minzoom: 18,
    layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 10, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#5b1fa8', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
  });
  map.addLayer({ id: 'points', type: 'circle', source: 'points', paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'type'], 'entrance', '#12a150', 'elevator', '#2d5e8a', 'stairs', '#5a4a7a', 'escalator', '#ff9f43', '#3b8fd9'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({
    id: 'points-label', type: 'symbol', source: 'points',
    layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': true },
    paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 1.4 },
  });
  map.addLayer({ id: 'sel-line', type: 'line', source: 'sel', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#f59e0b', 'line-width': 3 } });
  map.addLayer({ id: 'sel-vtx', type: 'circle', source: 'sel', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#f59e0b', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#c04cff', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'draft-vtx', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#c04cff' } });
  if (data) render();
}

const set = (id, fc) => map.getSource(id)?.setData(fc);
const poly = (ring, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [closed(ring)] } });
const point = (p, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p[1], p[0]] } });
const fc = (features) => ({ type: 'FeatureCollection', features });

function render() {
  if (!data || !map.getSource('units')) return renderPanel();
  const f = floor();
  set('outline', fc(data.mall.rings.map((r) => poly(r, {}))));
  // The floor below, dashed, to line this one up with it.
  const below = plan.floors.filter((x) => levelOf(x.id) < levelOf(floorId) && x.units.length).sort((a, b) => levelOf(b.id) - levelOf(a.id))[0];
  set('ghost', fc((below?.units ?? []).map((u) => poly(u.ring, {}))));
  set('areas', fc(f.areas.map((a, i) => poly(a.ring, { i, kind: a.kind }))));
  set('units', fc(f.units.map((u, i) => poly(u.ring, { i, category: u.category ?? (u.name ? 'other' : 'vacant'), label: u.name ?? '' }))));
  set('points', fc(f.points.map((p, i) => point([p.lat, p.lng], { i, type: p.type, label: pointLabel(p) }))));
  set('shops', fc(data.shops.filter((s) => s.lat != null && (s.floor ?? 'G') === floorId).map((s) => point([s.lat, s.lng], { name: s.name }))));
  renderDraft();
  renderSelection();
  renderPanel();
}

function renderDraft() {
  const pts = hover && tool !== 'select' && !tool.startsWith('point') && tool !== 'image' ? [...draft, hover] : draft;
  let ring = pts;
  if (tool === 'rect' && draft.length === 2 && hover) ring = rectFrom(draft, hover);
  const features = pts.map((p) => point(p, {}));
  if (ring.length >= 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: (ring.length > 2 ? closed(ring) : ring.map(([a, b]) => [b, a])) } });
  set('draft', fc(features));
}

function selection() {
  if (!selected) return null;
  const f = floor();
  return selected.kind === 'unit' ? f.units[selected.i] : selected.kind === 'area' ? f.areas[selected.i] : f.points[selected.i];
}

function renderSelection() {
  const s = selection();
  if (!s) return set('sel', EMPTY);
  if (selected.kind === 'point') return set('sel', fc([point([s.lat, s.lng], {})]));
  set('sel', fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: closed(s.ring) } }, ...s.ring.map((q) => point(q, {}))]));
}

// ---------- side panel ----------

function renderPanel() {
  if (!data) return;
  const f = plan.floors.find((x) => x.id === floorId) ?? { units: [], areas: [], points: [] };
  const named = f.units.filter((u) => u.name).length;
  $('#ed-stat').innerHTML = `<b>${esc(data.mall.name)}</b> · ${esc(floorName(floorId))}<br>${fa(f.units.length)} واحد (${fa(named)} با نام) · ${fa(f.areas.length)} فضا · ${fa(f.points.length)} نقطه
    <br>منبع فعلی: ${data.source === 'editor' ? 'ویرایشگر' : data.source === 'osm' ? 'OpenStreetMap' : 'هنوز نقشه‌ای ندارد'}${data.shops.length ? ` · ${fa(data.shops.length)} فروشگاه OSM (نقطه بنفش)` : ''}`;
  $('#ed-save').classList.toggle('dirty', dirty);
  $('#ed-status').textContent = `${floorName(floorId)} · ${tool === 'select' ? 'انتخاب' : $(`[data-tool="${tool}"]`)?.textContent ?? ''}${draft.length ? ` · ${fa(draft.length)} نقطه` : ''}`;
  $('#ed-hint').textContent = HINTS[tool.split(':')[0]] ?? '';
  for (const b of $$('[data-tool]')) b.classList.toggle('on', b.dataset.tool === tool);
  renderSelectedForm();
}

function renderSelectedForm() {
  const box = $('#ed-selected');
  const s = selection();
  if (!s) { box.innerHTML = ''; return; }
  if (selected.kind === 'unit') {
    const cats = Object.entries(CATEGORIES).filter(([k]) => k !== 'vacant');
    box.innerHTML = `<h3>واحد انتخاب‌شده</h3>
      <label>نام فروشگاه (خالی = ثبت‌نشده)</label><input class="field" id="u-name" list="u-shops" value="${esc(s.name ?? '')}" maxlength="60">
      <datalist id="u-shops">${data.shops.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>
      <label>دسته</label><select id="u-cat"><option value="">—</option>${cats.map(([k, v]) => `<option value="${k}" ${k === s.category ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select>
      <div class="row2"><div><label>تلفن</label><input class="field" id="u-phone" dir="ltr" value="${esc(s.phone ?? '')}"></div>
      <div><label>ساعت (۱۰:۰۰ تا ۲۲:۰۰)</label><input class="field" id="u-hours" value="${esc(s.hours ?? '')}"></div></div>
      <div class="actions-row"><button class="btn small danger" id="u-del">🗑 حذف واحد</button></div>`;
    const field = (id, key, after) => {
      $(id).onchange = (e) => change(() => {
        s[key] = e.target.value.trim() || null;
        after?.(e.target.value.trim());
      });
    };
    field('#u-name', 'name', (v) => { const shop = data.shops.find((x) => x.name === v); if (shop && !s.category) s.category = shop.category; });
    field('#u-cat', 'category');
    field('#u-phone', 'phone');
    field('#u-hours', 'hours');
    $('#u-del').onclick = removeSelected;
    return;
  }
  if (selected.kind === 'area') {
    box.innerHTML = `<h3>فضا</h3><select id="a-kind">${Object.entries(AREA_LABEL).map(([k, v]) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <div class="actions-row"><button class="btn small danger" id="a-del">🗑 حذف</button></div>`;
    $('#a-kind').onchange = (e) => change(() => { s.kind = e.target.value; });
    $('#a-del').onclick = removeSelected;
    return;
  }
  box.innerHTML = `<h3>${esc(pointLabel(s))}</h3><p class="hint">با ماوس بکشید تا جابه‌جا شود.</p>
    ${s.type === 'escalator' ? `<select id="p-dir"><option value="up" ${s.dir !== 'down' ? 'selected' : ''}>بالا ▲</option><option value="down" ${s.dir === 'down' ? 'selected' : ''}>پایین ▼</option></select>` : ''}
    <div class="actions-row"><button class="btn small danger" id="p-del">🗑 حذف</button></div>`;
  $('#p-dir')?.addEventListener('change', (e) => change(() => { s.dir = e.target.value; }));
  $('#p-del').onclick = removeSelected;
}

function removeSelected() {
  if (!selected) return;
  const list = { unit: 'units', area: 'areas', point: 'points' }[selected.kind];
  change(() => { floor()[list].splice(selected.i, 1); selected = null; });
}

// ---------- drawing ----------

function finish() {
  const kind = tool;
  const ring = kind === 'rect' ? (draft.length === 3 ? rectFrom(draft.slice(0, 2), draft[2]) : null) : draft.length >= 3 ? draft : null;
  draft = [];
  if (!ring) return render();
  change(() => {
    const f = floor();
    if (kind === 'rect' || kind === 'unit') {
      // Name it from the OSM shop inside, if there is one.
      const inside = data.shops.find((s) => s.lat != null && (s.floor ?? 'G') === floorId && inRing(s.lat, s.lng, ring));
      f.units.push({ uid: uid(), ring, name: inside?.name ?? null, category: inside?.category ?? null });
      selected = { kind: 'unit', i: f.units.length - 1 };
    } else {
      f.areas.push({ kind, ring });
      selected = { kind: 'area', i: f.areas.length - 1 };
    }
  });
}

function inRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bindMap() {
  map.on('click', (e) => {
    if (drag?.moved) return;
    const p = ll(e);
    if (tool === 'select') {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['points', 'units-fill', 'areas-fill'] })[0];
      selected = hit ? { kind: hit.layer.id === 'points' ? 'point' : hit.layer.id === 'units-fill' ? 'unit' : 'area', i: hit.properties.i } : null;
      return render();
    }
    if (tool.startsWith('point:')) {
      const [, type, dir] = tool.split(':');
      return change(() => {
        floor().points.push({ type, lat: p[0], lng: p[1], ...(dir ? { dir } : {}) });
        selected = { kind: 'point', i: floor().points.length - 1 };
      });
    }
    if (tool === 'image') return;
    const q = snap(p);
    if (tool !== 'rect' && draft.length >= 3) {
      const first = px(draft[0]), here = px(q);
      if (Math.hypot(first.x - here.x, first.y - here.y) < 10) return finish();
    }
    draft.push(q);
    if (tool === 'rect' && draft.length === 3) return finish();
    render();
  });
  map.on('dblclick', () => { if (draft.length >= 3 && tool !== 'rect') { draft.pop(); finish(); } });
  map.on('mousemove', (e) => {
    if (drag) return;
    hover = tool !== 'select' ? snap(ll(e)) : null;
    if (draft.length || tool === 'rect') renderDraft();
  });

  // Dragging: a vertex of the selected unit/area, the selected point, or the plan photo.
  map.on('mousedown', (e) => {
    const s = selection();
    if (tool === 'image' && image) {
      drag = { kind: 'image', start: e.lngLat, center: { ...image.center }, moved: false };
    } else if (tool === 'select' && s && selected.kind === 'point') {
      const q = px([s.lat, s.lng]);
      if (Math.hypot(q.x - e.point.x, q.y - e.point.y) < 12) drag = { kind: 'point', moved: false };
    } else if (tool === 'select' && s) {
      const i = s.ring.findIndex((q) => { const v = px(q); return Math.hypot(v.x - e.point.x, v.y - e.point.y) < 9; });
      if (i >= 0) drag = { kind: 'vertex', i, moved: false };
    }
    if (drag) { map.dragPan.disable(); undoStack.push(JSON.stringify(plan)); }
  });
  map.on('mousemove', (e) => {
    if (!drag) return;
    drag.moved = true;
    const s = selection();
    if (drag.kind === 'image') {
      image.center = { lat: drag.center.lat + e.lngLat.lat - drag.start.lat, lng: drag.center.lng + e.lngLat.lng - drag.start.lng };
      return placeImage();
    }
    if (drag.kind === 'point') { [s.lat, s.lng] = ll(e); } else s.ring[drag.i] = snap(ll(e));
    render();
  });
  map.on('mouseup', () => {
    if (!drag) return;
    map.dragPan.enable();
    if (drag.moved && drag.kind !== 'image') { dirty = true; persist(`editor.draft.${data.mall.id}`, { plan, at: Date.now() }); render(); }
    else if (!drag.moved && drag.kind !== 'image') undoStack.pop();
    setTimeout(() => { drag = null; }, 0);
  });
}

// ---------- plan photo overlay ----------

function corners() {
  const { center: c, width: w, aspect, rotation } = image;
  const h = w * aspect, kx = kxOf(c.lat), r = (rotation * Math.PI) / 180;
  return [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]].map(([x, y]) => {
    const rx = x * Math.cos(r) - y * Math.sin(r), ry = x * Math.sin(r) + y * Math.cos(r);
    return [c.lng + rx / kx, c.lat + ry / KY];
  });
}

function addImage() {
  if (map.getSource('plan-img')) map.removeLayer('plan-img'), map.removeSource('plan-img');
  map.addSource('plan-img', { type: 'image', url: image.url, coordinates: corners() });
  map.addLayer({ id: 'plan-img', type: 'raster', source: 'plan-img', paint: { 'raster-opacity': image.opacity, 'raster-fade-duration': 0 } }, map.getLayer('outline-fill') ? 'outline-fill' : undefined);
}

function placeImage() {
  map.getSource('plan-img')?.setCoordinates(corners());
  $('#ed-img-w-v').textContent = `${fa(Math.round(image.width))} متر`;
  $('#ed-img-r-v').textContent = `${fa(image.rotation)}°`;
}

function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const b = map.getBounds();
    const span = (b.getEast() - b.getWest()) * kxOf(b.getCenter().lat);
    const c = data.mall.rings.length ? { lat: data.mall.lat, lng: data.mall.lng } : { lat: b.getCenter().lat, lng: b.getCenter().lng };
    image = { url, aspect: img.naturalHeight / img.naturalWidth, center: c, width: Math.round(span * 0.6), rotation: 0, opacity: 0.6 };
    $('#ed-img-w').value = image.width;
    $('#ed-img-r').value = 0;
    $('#ed-img-op').value = 0.6;
    $('#ed-img-ctl').classList.remove('hidden');
    addImage();
    placeImage();
  };
  img.src = url;
}

// ---------- UI ----------

function bindUi() {
  for (const b of $$('[data-tool]')) b.onclick = () => { tool = b.dataset.tool; draft = []; selected = tool === 'select' ? selected : null; render(); };
  $('#ed-mall-q').oninput = debounce(fillMalls, 150);
  $('#ed-mall').onchange = (e) => openMall(e.target.value);
  $('#ed-floor').onchange = (e) => { floorId = e.target.value; selected = null; draft = []; render(); };
  $('#ed-undo').onclick = undo;
  $('#ed-sat').onclick = () => {
    satellite = !satellite;
    if (map.getLayer('sat')) map.setLayoutProperty('sat', 'visibility', satellite ? 'visible' : 'none');
    $('#ed-sat').classList.toggle('on', satellite);
  };
  $('#ed-add-floor').onclick = () => {
    const box = openModal(`<h2>طبقه جدید</h2><div class="sub">همکف = G، طبقه‌های بالا ۱، ۲، … زیرزمین B1، B2، پارکینگ P1، P2</div>
      <input class="field" id="nf" dir="ltr" placeholder="1" autocomplete="off"><div class="actions-row"><button class="btn primary" id="nf-ok">افزودن</button></div>`);
    $('#nf-ok', box).onclick = () => {
      const id = $('#nf', box).value.trim().toUpperCase().replace(/^0$/, 'G');
      if (!FLOOR_ID.test(id)) return toast('شناسه طبقه نامعتبر است');
      closeModal();
      floorId = id;
      floor();
      fillFloors();
      render();
    };
  };
  $('#ed-copy-floor').onclick = () => {
    const others = plan.floors.filter((f) => f.id !== floorId && (f.units.length || f.areas.length));
    if (!others.length) return toast('طبقه دیگری برای کپی نیست');
    const box = openModal(`<h2>کپی به ${esc(floorName(floorId))}</h2><div class="sub">واحدها، فضاها، آسانسور و پله‌ها کپی می‌شوند (بدون نام فروشگاه‌ها). در پاساژهایی که همه طبقه‌ها شبیه هم‌اند، فقط اسم‌ها را عوض کنید.</div>
      <div class="actions-row">${others.map((f) => `<button class="btn" data-from="${f.id}">${esc(floorName(f.id))} (${fa(f.units.length)})</button>`).join('')}</div>`);
    for (const b of $$('[data-from]', box)) {
      b.onclick = () => {
        closeModal();
        const src = plan.floors.find((f) => f.id === b.dataset.from);
        change(() => {
          const f = floor();
          f.units.push(...src.units.map((u) => ({ uid: uid(), ring: u.ring.map((q) => [...q]), name: null, category: null })));
          f.areas.push(...src.areas.map((a) => ({ kind: a.kind, ring: a.ring.map((q) => [...q]) })));
          f.points.push(...src.points.filter((p) => ['elevator', 'stairs', 'wc', 'prayer'].includes(p.type)).map((p) => ({ ...p })));
        });
        fillFloors();
      };
    }
  };
  $('#ed-save').onclick = save;
  $('#ed-img').onchange = (e) => e.target.files[0] && loadImage(e.target.files[0]);
  $('#ed-img-op').oninput = (e) => { image.opacity = Number(e.target.value); map.setPaintProperty('plan-img', 'raster-opacity', image.opacity); };
  $('#ed-img-w').oninput = (e) => { image.width = Number(e.target.value); placeImage(); };
  $('#ed-img-r').oninput = (e) => { image.rotation = Number(e.target.value); placeImage(); };
  $('#ed-img-center').onclick = () => { image.center = { lat: data.mall.lat, lng: data.mall.lng }; placeImage(); };
  $('#ed-img-del').onclick = () => {
    if (map.getLayer('plan-img')) { map.removeLayer('plan-img'); map.removeSource('plan-img'); }
    image = null;
    $('#ed-img').value = '';
    $('#ed-img-ctl').classList.add('hidden');
    if (tool === 'image') tool = 'select';
    render();
  };
  window.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { draft = []; selected = null; render(); }
    if (e.key === 'Enter' && draft.length) finish();
    if (e.key === 'Backspace' && draft.length) { draft.pop(); render(); e.preventDefault(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { removeSelected(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); }
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
}

async function save() {
  const floors = plan.floors.filter((f) => f.units.length || f.areas.length || f.points.length);
  if (!floors.length) return toast('هنوز چیزی کشیده نشده');
  const btn = $('#ed-save');
  btn.disabled = true;
  try {
    const m = await api(`/plans/${encodeURIComponent(data.mall.id)}`, {
      method: 'POST', body: { floors }, headers: { 'X-Editor-Key': $('#ed-key').value },
    });
    dirty = false;
    data.source = 'editor';
    persist(`editor.draft.${data.mall.id}`, null);
    const i = malls.findIndex((x) => x.id === m.id);
    if (i >= 0) malls[i] = m;
    toast(`✅ ذخیره شد · ${fa(m.stores)} فروشگاه · ${fa(m.mapped)} طبقه نقشه واقعی. <a href="/#/mall/${encodeURIComponent(m.id)}">مشاهده</a>`, 'good', 7000);
    fillFloors();
    render();
  } catch (e) {
    toast(esc(e.message), '', 7000);
  } finally {
    btn.disabled = false;
  }
}

boot().catch((e) => toast(esc(e.message), '', 10000));
