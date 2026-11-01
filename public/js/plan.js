// A real floor plan (OpenStreetMap indoor mapping or drawn in the editor) as a plain SVG: the building
// outline, shop units coloured by category with their names, atriums, and the lifts and toilets.
// Drag to pan, pinch / wheel / buttons to zoom, tap a unit for its name. Coordinates are metres.

import { esc, cat } from './ui.js';
import { AMENITIES } from '/shared/catalog.js';

export function renderPlan(box, mall, floorId, onUnit) {
  const floor = mall.plan.floors.find((f) => f.id === floorId);
  const rings = [...(mall.rings ?? []), ...floor.units.map((u) => u.ring)];
  const pts = rings.flat();
  const lat0 = Math.max(...pts.map((p) => p[0])), lng0 = Math.min(...pts.map((p) => p[1]));
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const xy = ([lat, lng]) => [(lng - lng0) * kx, (lat0 - lat) * ky];
  const path = (ring) => `M${ring.map((p) => xy(p).map((v) => v.toFixed(2)).join(',')).join('L')}Z`;
  const all = pts.map(xy);
  const W = Math.max(...all.map((p) => p[0])), H = Math.max(...all.map((p) => p[1]));
  const pad = Math.max(W, H) * 0.04;

  const center = (ring) => {
    const q = ring.map(xy);
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };

  const units = floor.units.map((u, i) => {
    const c = center(u.ring);
    const size = Math.min(c.w * 0.9 / Math.max(2, (u.name?.length ?? 0) * 0.55), c.h * 0.5, 2.6);
    return `<path class="unit ${u.name ? 'named' : ''}" data-i="${i}" d="${path(u.ring)}" style="--c:${cat(u.category ?? 'other').color}"/>
      ${u.name && size > 0.55 ? `<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" font-size="${size.toFixed(2)}">${esc(u.name)}</text>` : ''}`;
  }).join('');
  const areas = (floor.areas ?? []).map((a) => `<path class="area ${a.kind}" d="${path(a.ring)}"/>`).join('');
  const points = (floor.points ?? []).map((p) => {
    const [x, y] = xy([p.lat, p.lng]);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="3" style="stroke:none">${AMENITIES[p.type]?.icon ?? ''}</text>`;
  }).join('');

  box.innerHTML = `<svg viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}" role="img" aria-label="نقشه طبقه">
      ${(mall.rings ?? []).map((r) => `<path class="outline" d="${path(r)}"/>`).join('')}
      ${areas}${units}${points}
    </svg>
    <div class="zoom"><button class="btn icon" data-z="1.4" aria-label="بزرگ‌نمایی">+</button><button class="btn icon" data-z="0.7" aria-label="کوچک‌نمایی">−</button></div>`;

  const svg = box.querySelector('svg');
  const home = { x: -pad, y: -pad, w: W + 2 * pad, h: H + 2 * pad };
  const vb = { ...home };
  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const zoom = (k, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => {
    const w = Math.min(home.w * 1.2, Math.max(home.w / 12, vb.w / k));
    const f = w / vb.w;
    vb.x = cx - (cx - vb.x) * f;
    vb.y = cy - (cy - vb.y) * f;
    vb.w = w;
    vb.h *= f;
    apply();
  };
  // Screen point → plan coordinates (the SVG keeps its aspect ratio, centred).
  const toPlan = (ev) => {
    const r = svg.getBoundingClientRect();
    const s = Math.max(vb.w / r.width, vb.h / r.height);
    return { x: vb.x + vb.w / 2 + (ev.clientX - r.left - r.width / 2) * s, y: vb.y + vb.h / 2 + (ev.clientY - r.top - r.height / 2) * s, s };
  };

  for (const b of box.querySelectorAll('[data-z]')) b.onclick = () => zoom(Number(b.dataset.z));
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const p = toPlan(ev);
    zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  }, { passive: false });

  const pointers = new Map();
  let moved = 0, pinch = null;
  svg.addEventListener('pointerdown', (ev) => {
    svg.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    moved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  svg.addEventListener('pointermove', (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    pointers.set(ev.pointerId, cur);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toPlan({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      zoom(d / pinch, mid.x, mid.y);
      pinch = d;
      moved += 10;
      return;
    }
    const s = toPlan(ev).s;
    vb.x -= (cur.x - prev.x) * s;
    vb.y -= (cur.y - prev.y) * s;
    moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
    apply();
  });
  const up = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (moved > 6 || pointers.size) return;
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.unit');
    if (!hit) return;
    for (const u of svg.querySelectorAll('.unit.hit')) u.classList.remove('hit');
    hit.classList.add('hit');
    onUnit(floor.units[hit.dataset.i]);
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', (ev) => { pointers.delete(ev.pointerId); pinch = null; });
}
