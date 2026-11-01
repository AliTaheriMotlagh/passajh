// Fitting a mall's indoor grid onto its real building outline. Shared by the server (placing real shops
// in the floor plan near their mapped position) and the browser (showing the user's GPS dot indoors).

function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Fit the w×h indoor grid onto the minimum-area rectangle around the building's real outline,
// long side along the grid's x axis, kept roughly north-up. Without an outline the grid is
// centered on the mall at 1 cell = 1 m.
export function mallFrame(mall, w, h) {
  const lat0 = mall.lat, lng0 = mall.lng;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const toXY = (lat, lng) => [(lng - lng0) * kx, (lat - lat0) * ky];
  let c = [0, 0], ex = [1, 0], ey = [0, -1], L = w, S = h;

  const pts = (mall.rings || []).flat().map(([lat, lng]) => toXY(lat, lng));
  if (pts.length >= 3) {
    const hp = hull(pts);
    let best = null;
    for (let i = 0; i < hp.length; i++) {
      const a = hp[i], b = hp[(i + 1) % hp.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!len) continue;
      const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], v = [-u[1], u[0]];
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const q of hp) {
        const pu = q[0] * u[0] + q[1] * u[1], pv = q[0] * v[0] + q[1] * v[1];
        u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
      }
      const area = (u1 - u0) * (v1 - v0);
      if (!best || area < best.area) best = { area, u, v, lu: u1 - u0, lv: v1 - v0, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2 };
    }
    if (best && Math.min(best.lu, best.lv) > 12) {
      c = [best.cu * best.u[0] + best.cv * best.v[0], best.cu * best.u[1] + best.cv * best.v[1]];
      let [ax, ay] = best.lu >= best.lv ? [best.u, best.v] : [best.v, best.u];
      [L, S] = best.lu >= best.lv ? [best.lu, best.lv] : [best.lv, best.lu];
      if (ax[0] < 0) ax = [-ax[0], -ax[1]]; // grid x points east-ish
      if (ay[1] > 0) ay = [-ay[0], -ay[1]]; // grid y points south-ish (screen down)
      ex = ax; ey = ay;
    }
  }
  const sx = L / w, sy = S / h; // meters per cell
  return {
    cellMeters: Math.sqrt(sx * sy),
    north: Math.atan2(ey[1] / sy, ex[1] / sx), // direction of real north on the grid
    toGrid(lat, lng) {
      const [x, y] = toXY(lat, lng);
      const d = [x - c[0], y - c[1]];
      return { x: (d[0] * ex[0] + d[1] * ex[1]) / sx + w / 2, y: (d[0] * ey[0] + d[1] * ey[1]) / sy + h / 2 };
    },
  };
}

// Footprint area in m² (shoelace on a local projection).
export function areaOf(rings) {
  let total = 0;
  for (const r of rings || []) {
    const kx = 111320 * Math.cos((r[0][0] * Math.PI) / 180), ky = 110540;
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][1] * kx * r[i][0] * ky - r[i][1] * kx * r[j][0] * ky;
    total += Math.abs(a / 2);
  }
  return Math.round(total);
}
