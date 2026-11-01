// Real floor plans → indoor engine floors.
//
// A plan is stored in real-world coordinates so it survives any change to how floors are drawn:
//   { source: 'osm' | 'editor', updated, floors: [{ id: 'G', name?, units, areas, points }] }
//   unit:  { uid, ring: [[lat, lng], …], name?, category?, phone?, hours?, instagram?, website? }
//   area:  { kind: 'void' | 'service' | 'seating', ring }
//   point: { type: 'entrance' | 'elevator' | 'stairs' | 'escalator' | 'wc' | 'prayer' | 'atm' | …, lat, lng, dir? }
// Corridors aren't drawn: everything inside the building outline that isn't a unit or a blocked area is
// walkable. Units get a door where they touch the corridor. Floors the mall has but the plan doesn't map
// yet get the outline and the lifts in the same place as the mapped floors.

import { scanFill, bboxOf, labelPoint, pointInPoly } from '../public/shared/frame.js';
import { toFaDigits } from '../public/shared/text.js';

export const FLOOR_NAMES = {
  P3: 'پارکینگ P3', P2: 'پارکینگ P2', P1: 'پارکینگ P1', B3: 'زیرزمین سوم', B2: 'زیرزمین دوم', B1: 'زیرزمین اول',
  G: 'همکف', 1: 'طبقه اول', 2: 'طبقه دوم', 3: 'طبقه سوم', 4: 'طبقه چهارم', 5: 'طبقه پنجم',
};

export function levelOf(fid) {
  if (fid[0] === 'P' || fid[0] === 'B') return -Number(fid.slice(1));
  return fid === 'G' ? 0 : Number(fid);
}
export const fidOf = (level) => (level === 0 ? 'G' : level < 0 ? `B${-level}` : String(level));
export const floorName = (fid) => FLOOR_NAMES[fid] ?? `طبقه ${toFaDigits(fid)}`;

const MARGIN = 3; // metres of empty grid around the building
const WALK = 1, UNIT = 2;

// Metres east / south of the plan's north-west corner.
function projector(rings) {
  const pts = rings.flat();
  const lat0 = Math.max(...pts.map((p) => p[0])), lng0 = Math.min(...pts.map((p) => p[1]));
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const geo = { lat: lat0 + MARGIN / ky, lng: lng0 - MARGIN / kx };
  const xy = ([lat, lng]) => [(lng - geo.lng) * kx, (geo.lat - lat) * ky];
  const w = Math.ceil(Math.max(...pts.map((p) => xy(p)[0])) + MARGIN);
  const h = Math.ceil(Math.max(...pts.map((p) => xy(p)[1])) + MARGIN);
  return { geo, xy, w, h };
}

class Cells {
  constructor(w, h) { this.w = w; this.h = h; this.t = new Uint8Array(w * h); }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.t[y * this.w + x]; }
  set(x, y, v) { this.t[y * this.w + x] = v; }
  // Nearest walkable cell to a point (searching outward in rings).
  nearestWalk(px, py, max = 30) {
    const cx = Math.floor(px), cy = Math.floor(py);
    for (let r = 0; r <= max; r++) {
      let best = null;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || this.get(cx + dx, cy + dy) !== WALK) continue;
          const d = Math.hypot(cx + dx + 0.5 - px, cy + dy + 0.5 - py);
          if (!best || d < best.d) best = { x: cx + dx, y: cy + dy, d };
        }
      }
      if (best) return best;
    }
    return null;
  }
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// The door: the unit's cells that touch the corridor; the one in the middle of that frontage.
function doorOf(cells, unitCells, label) {
  const front = [];
  for (const [x, y] of unitCells) {
    for (const [dx, dy] of N4) if (cells.get(x + dx, y + dy) === WALK) { front.push({ x, y, ex: x + dx, ey: y + dy }); break; }
  }
  if (front.length) {
    const mx = front.reduce((a, c) => a + c.x, 0) / front.length, my = front.reduce((a, c) => a + c.y, 0) / front.length;
    const d = front.reduce((a, c) => (Math.hypot(c.x - mx, c.y - my) < Math.hypot(a.x - mx, a.y - my) ? c : a));
    return { door: { x: d.x, y: d.y, w: 1, h: 1 }, entry: { x: d.ex, y: d.ey } };
  }
  // Enclosed (e.g. a kiosk drawn inside another unit): enter from the nearest corridor cell.
  const e = cells.nearestWalk(label.x, label.y);
  if (!e) return null;
  const d = unitCells.reduce((a, c) => (Math.hypot(c[0] - e.x, c[1] - e.y) < Math.hypot(a[0] - e.x, a[1] - e.y) ? c : a));
  return { door: { x: d[0], y: d[1], w: 1, h: 1 }, entry: { x: e.x, y: e.y } };
}

const shape = (poly) => ({ poly, ...bboxOf(poly) });

export function planToFloors(mall, plan, { floorIds = [], shops = [] } = {}) {
  const unitRings = plan.floors.flatMap((f) => (f.units ?? []).map((u) => u.ring));
  const outlineLL = mall.rings?.length ? mall.rings : [];
  const { geo, xy, w, h } = projector([...outlineLL, ...unitRings].filter((r) => r?.length >= 3));
  const outline = outlineLL.map((r) => r.map(xy));
  // No building outline: the units' bounding box stands in for it.
  if (!outline.length) {
    const b = bboxOf(unitRings.flat().map(xy));
    outline.push([[b.x - 2, b.y - 2], [b.x + b.w + 2, b.y - 2], [b.x + b.w + 2, b.y + b.h + 2], [b.x - 2, b.y + b.h + 2]]);
  }
  const byId = new Map(plan.floors.map((f) => [f.id, f]));
  const ids = [...new Set([...plan.floors.map((f) => f.id), ...floorIds])];
  const levels = new Set(ids.map(levelOf));
  const outlineCenter = labelPoint(outline.reduce((a, r) => (r.length > a.length ? r : a)));
  let lift = null; // where the lifts are, so unmapped floors get them in the same place
  for (const f of plan.floors) {
    const p = (f.points ?? []).find((q) => q.type === 'elevator');
    if (p) { const [x, y] = xy([p.lat, p.lng]); lift = { x, y }; break; }
  }
  let realStores = 0;

  const floors = ids.map((fid) => {
    const level = levelOf(fid);
    const pf = byId.get(fid);
    const f = {
      id: fid, level, name: pf?.name || floorName(fid), type: fid[0] === 'P' ? 'parking' : 'retail',
      w, h, real: true, unmapped: !pf, outline,
      walk: outline.map(shape), services: [], voids: [], seating: [], spots: [],
      escalators: [], elevators: [], stairs: [], amenities: [], stores: [],
    };
    const cells = new Cells(w, h);
    for (const r of outline) scanFill(r, w, h, (x, y) => cells.set(x, y, WALK));
    for (const a of pf?.areas ?? []) {
      const poly = a.ring.map(xy);
      const list = a.kind === 'void' ? f.voids : a.kind === 'seating' ? f.seating : f.services;
      list.push(shape(poly));
      if (a.kind !== 'seating') scanFill(poly, w, h, (x, y) => cells.set(x, y, 0));
    }

    // Units: rasterize all first so doors only open onto real corridor.
    const units = (pf?.units ?? []).map((u) => {
      const poly = u.ring.map(xy);
      const own = [];
      scanFill(poly, w, h, (x, y) => { cells.set(x, y, UNIT); own.push([x, y]); });
      return { u: { ...u }, poly, own };
    }).filter((x) => x.own.length);
    // Shops mapped in OpenStreetMap name the unit they're in.
    for (const s of shops) {
      if ((s.floor ?? 'G') !== fid || s.lat == null) continue;
      const [x, y] = xy([s.lat, s.lng]);
      const hit = units.find((v) => pointInPoly(x, y, v.poly));
      if (!hit) continue;
      if (!hit.u.name) Object.assign(hit.u, { name: s.name, category: s.category });
      for (const k of ['phone', 'hours', 'website', 'instagram']) hit.u[k] ??= s[k] ?? null;
    }
    units.forEach(({ u, poly, own }, i) => {
      const label = labelPoint(poly);
      const d = doorOf(cells, own, label);
      if (!d) return;
      const named = !!u.name;
      if (named) realStores++;
      f.stores.push({
        id: `${mall.id}-${u.uid}`, name: named ? u.name : `واحد ${toFaDigits(i + 1)}`,
        category: named ? u.category || 'other' : 'vacant', vacant: !named || undefined, floor: fid,
        poly, ...bboxOf(poly), label, ...d,
        phone: u.phone || null, website: u.website || null, instagram: u.instagram || null,
        hours: u.hours || mall.hours || null, rating: null, discount: null, products: [],
        source: plan.source, floorKnown: true,
      });
    });

    // Points: lifts, stairs and escalators become small trigger areas; the rest are amenity icons.
    const box = (x, y, id, n = 2) => ({ id, x: Math.floor(x) - 1, y: Math.floor(y) - 1, w: n, h: n });
    for (const [i, p] of (pf?.points ?? []).entries()) {
      const [x, y] = xy([p.lat, p.lng]);
      if (p.type === 'elevator') { f.elevators.push(box(x, y, `${fid}-el${i}`)); f.amenities.push({ type: 'elevator', x, y }); }
      else if (p.type === 'stairs') { f.stairs.push(box(x, y, `${fid}-st${i}`)); f.amenities.push({ type: 'stairs', x, y }); }
      else if (p.type === 'escalator') {
        const to = level + (p.dir === 'down' ? -1 : 1);
        if (!levels.has(to)) continue;
        const e = box(x, y, `${fid}-e${i}`);
        for (let cy = e.y; cy < e.y + e.h; cy++) for (let cx = e.x; cx < e.x + e.w; cx++) if (cells.get(cx, cy)) cells.set(cx, cy, 0);
        const entry = cells.nearestWalk(e.x - 0.5, e.y + 0.5) ?? { x: e.x - 1, y: e.y };
        f.escalators.push({ ...e, dir: p.dir === 'down' ? 'down' : 'up', to, block: `${Math.round(x / 6)}:${Math.round(y / 6)}`, entry, goal: { x: e.x, y: e.y } });
      } else f.amenities.push({ type: p.type, x, y });
    }
    if (ids.length > 1 && !f.elevators.length) {
      const c = cells.nearestWalk((lift ?? outlineCenter).x, (lift ?? outlineCenter).y, 60);
      if (c) { f.elevators.push(box(c.x + 1, c.y + 1, `${fid}-el`)); f.amenities.push({ type: 'elevator', x: c.x + 0.5, y: c.y + 0.5 }); }
    }
    if (level === 0 && !f.amenities.some((a) => a.type === 'entrance')) {
      // Assume the main door faces the southernmost side of the building.
      const south = outline.flat().reduce((a, p) => (p[1] > a[1] ? p : a));
      const c = cells.nearestWalk(south[0], south[1] - 1, 60);
      if (c) f.amenities.push({ type: 'entrance', x: c.x + 0.5, y: c.y + 0.5 });
    }
    // Bays aren't invented: the shopper types the number on the pillar when saving where they parked.
    if (f.type === 'parking' && !pf) f.amenities.push({ type: 'ramp', x: outlineCenter.x, y: outlineCenter.y });
    return f;
  });
  floors.sort((a, b) => b.level - a.level);
  return { geo, floors, realStores };
}
