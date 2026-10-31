// GTA-style indoor map engine: floor grid, rendering, player movement, radar, A* routing.

import { CATEGORIES, AMENITIES } from '/shared/catalog.js';
import { toFaDigits } from '/shared/text.js';

const T = { BLOCK: 0, WALK: 1, STORE: 2, DOOR: 3, VOID: 4, ESC: 5, ELEV: 6, STAIR: 7, SEAT: 8 };
const WALKABLE = [false, true, true, true, false, true, true, true, true];
const TRIGGERS = new Set([T.ESC, T.ELEV, T.STAIR]);
const RADIUS = 0.3;
const COLORS = {
  bg: '#0b1118', slab: '#1a232e', slabEdge: '#2f3e50', walk: '#3c4858', parking: '#2a333e',
  service: '#121920', void: '#05080c', rail: '#8fb3d9', seat: '#463826',
  route: '#c04cff', player: '#ffffff', up: '#2fd27a', down: '#ff9f43', elev: '#2d5e8a', stair: '#5a4a7a',
};
const FONT = 'Vazirmatn, Tahoma, sans-serif';

class FloorGrid {
  constructor(floor) {
    this.floor = floor;
    this.w = floor.w;
    this.h = floor.h;
    this.t = new Uint8Array(this.w * this.h);
    this.sid = new Int32Array(this.w * this.h).fill(-1);
    for (const r of floor.walk) this.fill(r, T.WALK);
    for (const r of floor.services) this.fill(r, T.BLOCK);
    for (const r of floor.voids) this.fill(r, T.VOID);
    for (const r of floor.seating) this.fill(r, T.SEAT);
    floor.stores.forEach((s, i) => {
      this.fill(s, T.BLOCK);
      this.fill({ x: s.x + 1, y: s.y + 1, w: s.w - 2, h: s.h - 2 }, T.STORE, i);
      this.fill(s.door, T.DOOR, i);
    });
    for (const r of floor.escalators) this.fill(r, T.ESC);
    for (const r of floor.elevators) this.fill(r, T.ELEV);
    for (const r of floor.stairs) this.fill(r, T.STAIR);
  }
  fill(r, v, sid = -1) {
    for (let y = Math.max(0, r.y); y < Math.min(this.h, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x); x < Math.min(this.w, r.x + r.w); x++) {
        this.t[y * this.w + x] = v;
        this.sid[y * this.w + x] = sid;
      }
    }
  }
  at(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? T.BLOCK : this.t[y * this.w + x];
  }
  storeAt(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const i = this.sid[y * this.w + x];
    return i >= 0 ? this.floor.stores[i] : null;
  }
  walkable(x, y) { return WALKABLE[this.at(x, y)]; }
  canOccupy(x, y) {
    return this.walkable(x - RADIUS, y - RADIUS) && this.walkable(x + RADIUS, y - RADIUS)
      && this.walkable(x - RADIUS, y + RADIUS) && this.walkable(x + RADIUS, y + RADIUS);
  }

  // A* on cells (8-neighbour, no corner cutting). Trigger cells only allowed as goal.
  path(sx, sy, gx, gy) {
    const { w, h } = this;
    const exact = { x: sx, y: sy };
    sx = Math.floor(sx); sy = Math.floor(sy); gx = Math.floor(gx); gy = Math.floor(gy);
    const goal = gy * w + gx;
    const ok = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const t = this.t[y * w + x];
      return WALKABLE[t] && (!TRIGGERS.has(t) || y * w + x === goal);
    };
    if (!WALKABLE[this.at(gx, gy)]) return null;
    const g = new Float32Array(w * h).fill(Infinity);
    const from = new Int32Array(w * h).fill(-1);
    const closed = new Uint8Array(w * h);
    const heap = [];
    const push = (i, f) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    const hfn = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    const start = sy * w + sx;
    g[start] = 0;
    push(start, hfn(sx, sy));
    while (heap.length) {
      const [, i] = pop();
      if (closed[i]) continue;
      if (i === goal) break;
      closed[i] = 1;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (!ok(nx, ny)) continue;
          if (dx && dy && (!ok(x + dx, y) || !ok(x, y + dy))) continue;
          const j = ny * w + nx;
          const ng = g[i] + (dx && dy ? Math.SQRT2 : 1);
          if (ng < g[j]) { g[j] = ng; from[j] = i; push(j, ng + hfn(nx, ny)); }
        }
      }
    }
    if (from[goal] < 0 && goal !== start) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = from[i]) cells.push({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 });
    cells.reverse();
    // Smooth from the exact position so straight segments are clear for the real body.
    if (this.canOccupy(exact.x, exact.y)) cells[0] = exact;
    const points = this.smooth(cells);
    points.shift();
    return { points, length: g[goal] };
  }

  lineClear(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(d / 0.25);
    for (let k = 1; k < steps; k++) {
      const x = a.x + ((b.x - a.x) * k) / steps, y = a.y + ((b.y - a.y) * k) / steps;
      if (!this.canOccupy(x, y) || TRIGGERS.has(this.at(x, y))) return false;
    }
    return true;
  }

  smooth(cells) {
    if (cells.length < 3) return cells;
    const out = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.lineClear(cells[i], cells[j])) j--;
      out.push(cells[j]);
      i = j;
    }
    return out;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export class MallEngine {
  constructor(canvas, radar, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.radar = radar;
    this.rctx = radar.getContext('2d');
    this.hooks = hooks; // { onStoreEnter, onDiscount, onFloorChange, onElevator, onStairs, onArrive, onLocation, onRoute }
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.cam = { x: 0, y: 0, s: 18, follow: true };
    this.filter = null; // Set of category keys, or null
    this.highlight = new Set();
    this.waypoint = null;
    this.route = null;
    this.auto = false;
    this.time = 0;
    this.collected = new Set();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  load(mall, collected) {
    this.mall = mall;
    this.grids = new Map(mall.floors.map((f) => [f.id, new FloorGrid(f)]));
    this.collected = collected;
    this.waypoint = null;
    this.route = null;
    this.highlight.clear();
    this.filter = null;
    this.car = null;
    const ground = mall.floors.find((f) => f.level === 0) ?? mall.floors[0];
    const entrance = ground.amenities.find((a) => a.type === 'entrance' && a.y > ground.h / 2);
    this.player = {
      floor: ground.id, x: entrance ? entrance.x : ground.w / 2, y: entrance ? entrance.y - 1.5 : ground.h / 2,
      heading: -Math.PI / 2, moving: false,
    };
    this.viewFloor = ground.id;
    this.lastCell = null;
    this.lastStore = null;
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
    this.cam.follow = true;
    this.fitZoom(0.9);
    this.cam.s = Math.max(this.cam.s, 14);
    this.onCell(true);
    if (!this.running) {
      this.running = true;
      let last = performance.now();
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        this.time += dt;
        if (!this.paused) this.update(dt);
        this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  stop() { this.running = false; }

  get floor() { return this.grids.get(this.player.floor).floor; }
  get grid() { return this.grids.get(this.player.floor); }
  get viewed() { return this.grids.get(this.viewFloor).floor; }
  floorById(id) { return this.grids.get(id)?.floor; }
  floorByLevel(level) { return this.mall.floors.find((f) => f.level === level); }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.radar]) {
      const r = c.getBoundingClientRect();
      c.width = Math.max(1, r.width * dpr);
      c.height = Math.max(1, r.height * dpr);
    }
    this.dpr = dpr;
  }

  fitZoom(pad = 0.92) {
    const f = this.viewed;
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    this.cam.s = Math.min((w * pad) / f.w, (h * pad) / f.h);
  }

  showFullMap() {
    const f = this.viewed;
    this.cam.follow = false;
    this.cam.x = f.w / 2;
    this.cam.y = f.h / 2;
    this.fitZoom();
  }

  setViewFloor(id) {
    this.viewFloor = id;
    if (id !== this.player.floor) this.showFullMap();
    else this.cam.follow = true;
  }

  // ---------- input ----------

  bindInput() {
    const c = this.canvas;
    const typing = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    window.addEventListener('keydown', (e) => {
      if (typing(e) || !this.running) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'ص', 'ش', 'س', 'ی', 'shift'].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
      if (k === 'm' || k === 'پ') this.showFullMap();
      if (k === '+' || k === '=') this.zoomBy(1.2);
      if (k === '-') this.zoomBy(1 / 1.2);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    const pointers = new Map();
    let drag = null, pinch = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.cam.s };
        drag = null;
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this.cam.s = Math.min(60, Math.max(3, (pinch.s * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d));
      } else if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved) {
          this.cam.follow = false;
          this.cam.x = drag.cx - dx / this.cam.s;
          this.cam.y = drag.cy - dy / this.cam.s;
        }
      }
    });
    const end = (e) => {
      if (drag && !drag.moved && pointers.size === 1) this.click(e.clientX, e.clientY);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; pinch = null; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }

  zoomBy(f, sx, sy) {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    sx ??= w / 2; sy ??= h / 2;
    const before = this.toWorld(sx, sy);
    this.cam.s = Math.min(60, Math.max(3, this.cam.s * f));
    if (!this.cam.follow) {
      const after = this.toWorld(sx, sy);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
    }
  }

  toWorld(sx, sy) {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    return { x: this.cam.x + (sx - w / 2) / this.cam.s, y: this.cam.y + (sy - h / 2) / this.cam.s };
  }

  click(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const p = this.toWorld(clientX - r.left, clientY - r.top);
    const grid = this.grids.get(this.viewFloor);
    const store = grid.floor.stores.find((s) => p.x >= s.x && p.x < s.x + s.w && p.y >= s.y && p.y < s.y + s.h);
    if (store) { this.hooks.onStoreClick?.(store); return; }
    if (grid.walkable(p.x, p.y)) {
      this.setWaypoint({ floor: this.viewFloor, x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5, label: 'مقصد' }, true);
    }
  }

  // ---------- waypoint & routing ----------

  setWaypoint(wp, auto = false) {
    this.waypoint = wp;
    this.auto = auto;
    if (this.checkArrival()) return;
    this.planRoute();
    if (auto) { this.viewFloor = this.player.floor; this.cam.follow = true; }
  }

  routeToStore(store, auto = false) {
    this.highlight = new Set([store.id]);
    this.setWaypoint({ floor: store.floor, x: store.entry.x + 0.5, y: store.entry.y + 0.5, store, label: store.name }, auto);
  }

  clearWaypoint() {
    this.waypoint = null;
    this.route = null;
    this.auto = false;
    this.hooks.onRoute?.(null);
  }

  planRoute() {
    const wp = this.waypoint;
    if (!wp) return;
    const { x, y } = this.player;
    const grid = this.grid;
    if (wp.floor === this.player.floor) {
      const p = grid.path(x, y, wp.x, wp.y);
      this.route = p ? { points: p.points, via: null } : null;
    } else {
      const cur = this.floor.level, target = this.floorById(wp.floor).level;
      let options = [];
      if (cur >= 0 && target >= 0) {
        options = this.floor.escalators
          .filter((e) => (target > cur ? e.dir === 'up' : e.dir === 'down'))
          .map((e) => ({ kind: 'escalator', conn: e, goal: { x: e.entry.x < e.x ? e.x : e.x + e.w - 1, y: e.entry.y } }));
      }
      if (!options.length) {
        options = this.floor.elevators.map((e) => ({ kind: 'elevator', conn: e, goal: { x: e.x + e.w - 1, y: e.y + 1 } }));
      }
      let best = null;
      for (const o of options) {
        const p = grid.path(x, y, o.goal.x, o.goal.y);
        if (p && (!best || p.length < best.p.length)) best = { ...o, p };
      }
      this.route = best ? { points: best.p.points, via: best } : null;
    }
    this.hooks.onRoute?.(this.route && this.describeRoute());
  }

  describeRoute() {
    const wp = this.waypoint;
    const target = this.floorById(wp.floor);
    const pts = [{ x: this.player.x, y: this.player.y }, ...this.route.points];
    let dist = 0;
    for (let i = 1; i < pts.length; i++) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const via = this.route.via;
    let step = `${wp.label} · ${target.name}`;
    if (via?.kind === 'escalator') step = `با پله برقی ${via.conn.dir === 'up' ? 'بالا' : 'پایین'} بروید ← ${target.name}`;
    if (via?.kind === 'elevator') step = `با آسانسور به ${target.name} بروید`;
    return { label: wp.label, step, meters: Math.round(dist) };
  }

  // ---------- simulation ----------

  update(dt) {
    const p = this.player;
    const k = this.keys;
    let ix = (k.has('arrowright') || k.has('d') || k.has('ی') ? 1 : 0) - (k.has('arrowleft') || k.has('a') || k.has('ش') ? 1 : 0) + this.joy.x;
    let iy = (k.has('arrowdown') || k.has('s') || k.has('س') ? 1 : 0) - (k.has('arrowup') || k.has('w') || k.has('ص') ? 1 : 0) + this.joy.y;
    let speed = k.has('shift') ? 9 : 5;

    if (ix || iy) {
      this.auto = false;
      const m = Math.hypot(ix, iy);
      if (m > 1) { ix /= m; iy /= m; }
    } else if (this.auto && this.route?.points.length) {
      const next = this.route.points[0];
      const dx = next.x - p.x, dy = next.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.2) {
        this.route.points.shift();
      } else {
        ix = dx / d; iy = dy / d;
        speed = 6.5;
        if (d < speed * dt) speed = d / dt;
      }
    }

    p.moving = !!(ix || iy);
    if (p.moving) {
      if (this.viewFloor !== p.floor) this.viewFloor = p.floor;
      this.cam.follow = true;
      const g = this.grid;
      const ox = p.x, oy = p.y;
      const nx = p.x + ix * speed * dt, ny = p.y + iy * speed * dt;
      if (g.canOccupy(nx, p.y)) p.x = nx;
      if (g.canOccupy(p.x, ny)) p.y = ny;
      // Autopilot snagged on a corner: step back to the cell center, then carry on.
      this.stuck = this.auto && Math.hypot(p.x - ox, p.y - oy) < speed * dt * 0.2 ? (this.stuck || 0) + dt : 0;
      if (this.stuck > 0.25 && this.route) {
        this.route.points.unshift({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });
        this.stuck = 0;
      }
      const target = Math.atan2(iy, ix);
      let diff = target - p.heading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      p.heading += diff * Math.min(1, dt * 14);
      this.onCell();
    }

    if (this.cam.follow && this.viewFloor === p.floor) {
      this.cam.x += (p.x - this.cam.x) * Math.min(1, dt * 8);
      this.cam.y += (p.y - this.cam.y) * Math.min(1, dt * 8);
    }
  }

  onCell(force = false) {
    const p = this.player;
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const key = `${p.floor}:${cx}:${cy}`;
    if (!force && key === this.lastCell) return;
    const prevType = this.lastType;
    this.lastCell = key;
    const g = this.grid;
    const type = g.at(cx, cy);
    this.lastType = type;

    if (!force && TRIGGERS.has(type) && !TRIGGERS.has(prevType)) {
      if (type === T.ESC) {
        const esc = this.floor.escalators.find((e) => cx >= e.x && cx < e.x + e.w && cy >= e.y && cy < e.y + e.h);
        if (esc) return this.takeEscalator(esc);
      }
      if (type === T.ELEV) {
        if (this.auto && this.waypoint) return this.changeFloor(this.waypoint.floor, 'elevator');
        this.keys.clear();
        return this.hooks.onElevator?.();
      }
      if (type === T.STAIR) {
        this.keys.clear();
        return this.hooks.onStairs?.();
      }
    }

    // Entering a store
    const store = type === T.STORE || type === T.DOOR ? g.storeAt(cx, cy) : null;
    if (store && store !== this.lastStore) this.hooks.onStoreEnter?.(store);
    this.lastStore = store;

    // Discount proximity
    for (const s of this.floor.stores) {
      if (!s.discount || this.collected.has(s.id)) continue;
      if (Math.hypot(s.entry.x + 0.5 - p.x, s.entry.y + 0.5 - p.y) < 4.5) {
        this.collected.add(s.id);
        this.hooks.onDiscount?.(s);
      }
    }

    // Location text: current store, or the nearest storefront
    let near = store, best = 3.5;
    if (!near) {
      for (const s of this.floor.stores) {
        const d = Math.hypot(s.entry.x + 0.5 - p.x, s.entry.y + 0.5 - p.y);
        if (d < best) { best = d; near = s; }
      }
    }
    this.hooks.onLocation?.({ floor: this.floor, store: near, inside: !!store, type });

    if (this.waypoint && !this.checkArrival()) this.planRoute();
  }

  checkArrival() {
    const wp = this.waypoint, p = this.player;
    if (!wp || wp.floor !== p.floor || Math.hypot(wp.x - p.x, wp.y - p.y) >= 1.1) return false;
    this.clearWaypoint();
    this.hooks.onArrive?.(wp);
    return true;
  }

  takeEscalator(esc) {
    const target = this.floorByLevel(esc.to);
    if (!target) return;
    const back = target.escalators.find((e) => e.block === esc.block && e.to === this.floor.level)
      ?? target.escalators.find((e) => e.block === esc.block);
    const spawn = back ? { x: back.entry.x + 0.5, y: back.entry.y + 0.5 } : null;
    this.changeFloor(target.id, 'escalator', spawn);
  }

  changeFloor(floorId, via, spawn) {
    const target = this.floorById(floorId);
    if (!target || floorId === this.player.floor) return;
    const p = this.player;
    if (!spawn) {
      if (via === 'stairs') {
        const st = target.stairs[0];
        spawn = { x: st.x - 0.5, y: st.y + st.h / 2 };
      } else {
        const el = target.elevators[0];
        spawn = { x: el.x + el.w + 0.5, y: el.y + el.h + 0.5 };
      }
    }
    p.floor = floorId;
    p.x = spawn.x;
    p.y = spawn.y;
    this.viewFloor = floorId;
    this.cam.x = p.x;
    this.cam.y = p.y;
    this.cam.follow = true;
    this.lastStore = null;
    this.hooks.onFloorChange?.(target, via);
    this.lastType = this.grid.at(p.x, p.y);
    this.lastCell = null;
    this.onCell(true);
    this.lastCell = `${p.floor}:${Math.floor(p.x)}:${Math.floor(p.y)}`;
    if (this.waypoint) this.planRoute();
  }

  parkCar() {
    this.car = { floor: this.player.floor, x: this.player.x, y: this.player.y };
    return this.car;
  }

  // ---------- rendering ----------

  render() {
    const { ctx, dpr, cam } = this;
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    this.drawGrid(ctx, W, H);
    ctx.save();
    ctx.translate(W / 2 - cam.x * cam.s, H / 2 - cam.y * cam.s);
    ctx.scale(cam.s, cam.s);
    const floor = this.viewed;
    this.drawFloor(ctx, floor, cam.s, true);
    if (floor.id === this.player.floor) {
      this.drawRoute(ctx, cam.s);
      this.drawWaypoint(ctx, cam.s);
    }
    if (this.car?.floor === floor.id) this.drawBlip(ctx, this.car.x, this.car.y, '🚗', cam.s, 1.1, '#1d6fe0');
    if (floor.id === this.player.floor) this.drawPlayer(ctx, cam.s);
    ctx.restore();
    this.renderRadar();
  }

  drawGrid(ctx, W, H) {
    const s = this.cam.s * 4;
    if (s < 12) return;
    ctx.strokeStyle = 'rgba(120,150,180,0.05)';
    ctx.lineWidth = 1;
    const ox = (W / 2 - this.cam.x * this.cam.s) % s, oy = (H / 2 - this.cam.y * this.cam.s) % s;
    ctx.beginPath();
    for (let x = ox; x < W; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy; y < H; y += s) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  drawFloor(ctx, f, s, detailed) {
    const px = 1 / s; // one screen pixel in world units
    const t = this.time;

    // Slab
    roundRect(ctx, -0.6, -0.6, f.w + 1.2, f.h + 1.2, 1.2);
    ctx.fillStyle = COLORS.slab;
    ctx.fill();
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = COLORS.slabEdge;
    ctx.stroke();

    ctx.fillStyle = f.type === 'parking' ? COLORS.parking : COLORS.walk;
    for (const r of f.walk) ctx.fillRect(r.x, r.y, r.w, r.h);

    for (const r of f.services) {
      ctx.fillStyle = COLORS.service;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (detailed) {
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.15;
        for (let k = -r.h; k < r.w; k += 1) { ctx.beginPath(); ctx.moveTo(r.x + k, r.y + r.h); ctx.lineTo(r.x + k + r.h, r.y); ctx.stroke(); }
        ctx.restore();
      }
    }

    // Parking spots and lane markings
    if (f.type === 'parking') {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = Math.max(0.06, px);
      for (const sp of f.spots) ctx.strokeRect(sp.x, sp.y, sp.w, sp.h);
      if (detailed && s > 12) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        this.text(ctx, '', 0.9, 'center');
        for (const sp of f.spots) this.ft(ctx, sp.label, sp.x + sp.w / 2, sp.y + sp.h / 2);
      }
      ctx.setLineDash([1, 1]);
      ctx.strokeStyle = 'rgba(245,197,24,0.35)';
      ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.moveTo(4, f.h / 2); ctx.lineTo(f.w - 4, f.h / 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Atrium voids with railings
    for (const v of f.voids) {
      const g = ctx.createLinearGradient(v.x, v.y, v.x, v.y + v.h);
      g.addColorStop(0, '#0a1119'); g.addColorStop(0.5, COLORS.void); g.addColorStop(1, '#0a1119');
      ctx.fillStyle = g;
      ctx.fillRect(v.x, v.y, v.w, v.h);
      ctx.strokeStyle = COLORS.rail;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 0.14;
      ctx.strokeRect(v.x + 0.07, v.y + 0.07, v.w - 0.14, v.h - 0.14);
      ctx.globalAlpha = 1;
      if (detailed && s > 9) {
        ctx.fillStyle = 'rgba(143,179,217,0.25)';
        this.text(ctx, '700', 1.1, 'center');
        this.ft(ctx, 'نورگیر / آتریوم', v.x + v.w / 2, v.y + v.h / 2);
      }
    }

    // Food-court seating
    for (const r of f.seating) {
      ctx.fillStyle = COLORS.seat;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (detailed) {
        ctx.fillStyle = 'rgba(255,220,170,0.25)';
        for (let x = r.x + 1.5; x < r.x + r.w - 0.5; x += 2.5) {
          for (let y = r.y + 1; y < r.y + r.h - 0.5; y += 2) { ctx.beginPath(); ctx.arc(x, y, 0.45, 0, Math.PI * 2); ctx.fill(); }
        }
      }
    }

    // Stores
    for (const st of f.stores) this.drawStore(ctx, st, s, detailed);

    // Escalators (پله برقی)
    for (const e of f.escalators) {
      const col = e.dir === 'up' ? COLORS.up : COLORS.down;
      ctx.fillStyle = '#4b5562';
      ctx.fillRect(e.x, e.y + 0.1, e.w, e.h - 0.2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.06;
      for (let x = e.x + 0.4; x < e.x + e.w; x += 0.4) { ctx.beginPath(); ctx.moveTo(x, e.y + 0.15); ctx.lineTo(x, e.y + e.h - 0.15); ctx.stroke(); }
      // Animated chevrons moving away from the entry side
      const fromLeft = e.entry.x < e.x;
      const off = (t * 2) % 1.5;
      ctx.strokeStyle = col;
      ctx.lineWidth = 0.18;
      ctx.save();
      ctx.beginPath(); ctx.rect(e.x, e.y, e.w, e.h); ctx.clip();
      for (let k = -1.5; k < e.w + 1.5; k += 1.5) {
        const x = fromLeft ? e.x + k + off : e.x + e.w - k - off;
        const d = fromLeft ? 0.4 : -0.4;
        ctx.beginPath();
        ctx.moveTo(x - d, e.y + 0.4); ctx.lineTo(x, e.y + e.h / 2); ctx.lineTo(x - d, e.y + e.h - 0.4);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = col;
      ctx.lineWidth = 0.1;
      ctx.strokeRect(e.x, e.y + 0.1, e.w, e.h - 0.2);
      if (detailed && s > 11) {
        const target = this.floorByLevel(e.to);
        ctx.fillStyle = col;
        this.text(ctx, '800', 0.75, 'center');
        this.ft(ctx, `${e.dir === 'up' ? '▲' : '▼'} ${target?.name ?? ''}`, e.x + e.w / 2, e.dir === 'up' ? e.y - 0.45 : e.y + e.h + 0.5);
      }
    }

    for (const e of f.elevators) {
      ctx.fillStyle = COLORS.elev;
      ctx.fillRect(e.x + 0.1, e.y + 0.1, e.w - 0.2, e.h - 0.2);
      ctx.strokeStyle = '#8cc4ff'; ctx.lineWidth = 0.08;
      ctx.strokeRect(e.x + 0.1, e.y + 0.1, e.w - 0.2, e.h - 0.2);
      ctx.beginPath(); ctx.moveTo(e.x + e.w / 2, e.y + 0.3); ctx.lineTo(e.x + e.w / 2, e.y + e.h - 0.3); ctx.stroke();
    }
    for (const st of f.stairs) {
      ctx.fillStyle = COLORS.stair;
      ctx.fillRect(st.x + 0.1, st.y + 0.1, st.w - 0.2, st.h - 0.2);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.06;
      for (let y = st.y + 0.5; y < st.y + st.h; y += 0.5) { ctx.beginPath(); ctx.moveTo(st.x + 0.2, y); ctx.lineTo(st.x + st.w - 0.2, y); ctx.stroke(); }
    }

    // Amenity blips
    if (detailed) {
      for (const a of f.amenities) {
        const am = AMENITIES[a.type];
        if (!am) continue;
        this.drawBlip(ctx, a.x, a.y, am.icon, s, 0.85);
        if (s > 16) {
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          this.text(ctx, '600', 0.62, 'center');
          this.ft(ctx, am.label, a.x, a.y + 1.45);
        }
      }
    }
  }

  drawStore(ctx, st, s, detailed) {
    const cat = CATEGORIES[st.category];
    const dim = this.filter && !this.filter.has(st.category);
    const hl = this.highlight.has(st.id);
    ctx.globalAlpha = dim ? 0.18 : 1;
    ctx.fillStyle = cat.color + (hl ? 'ee' : '99');
    ctx.fillRect(st.x + 0.08, st.y + 0.08, st.w - 0.16, st.h - 0.16);
    ctx.strokeStyle = cat.color;
    ctx.lineWidth = 0.16;
    ctx.strokeRect(st.x + 0.08, st.y + 0.08, st.w - 0.16, st.h - 0.16);
    // Entrance
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const d = st.door;
    if (d.w > d.h) ctx.fillRect(d.x, d.y + (d.y === st.y ? 0 : d.h - 0.22), d.w, 0.22);
    else ctx.fillRect(d.x + (d.x === st.x ? 0 : d.w - 0.22), d.y, 0.22, d.h);

    if (hl) {
      ctx.strokeStyle = '#f5c518';
      ctx.lineWidth = 0.18 + 0.1 * Math.sin(this.time * 6);
      ctx.strokeRect(st.x - 0.2, st.y - 0.2, st.w + 0.4, st.h + 0.4);
    }

    if (detailed) {
      const c = center(st);
      const big = st.w * s > 46 && st.h * s > 30;
      this.text(ctx, '', Math.min(st.w, st.h) * 0.32, 'center');
      ctx.fillStyle = '#fff';
      if (big) {
        this.ft(ctx, cat.icon, c.x, c.y - Math.min(1, st.h * 0.18));
        this.text(ctx, '700', Math.min(0.85, Math.max(0.5, 12 / s)), 'center');
        this.ft(ctx, this.fit(ctx, st.name, st.w - 0.6), c.x, c.y + Math.min(1.1, st.h * 0.22));
      } else if (st.w * s > 14) {
        this.ft(ctx, cat.icon, c.x, c.y);
      }
      if (st.discount) {
        const got = this.collected.has(st.id);
        const pulse = got ? 1 : 1 + 0.08 * Math.sin(this.time * 5 + st.x);
        const bw = 2.6 * pulse, bh = 1.1 * pulse;
        const bx = st.x + 0.3, by = st.y + 0.3;
        roundRect(ctx, bx, by, bw, bh, 0.5);
        ctx.fillStyle = got ? 'rgba(60,60,60,0.9)' : '#ff3b5c';
        ctx.fill();
        ctx.fillStyle = '#fff';
        this.text(ctx, '800', 0.7 * pulse, 'center');
        this.ft(ctx, `${got ? '✓ ' : ''}${toFaDigits(st.discount.percent)}٪`, bx + bw / 2, by + bh / 2 + 0.04);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Text is drawn in screen space (tiny world-unit font sizes render poorly in some browsers).
  text(ctx, weight, size, align) {
    this.font = { weight, size, align };
  }

  ft(ctx, str, x, y) {
    const m = ctx.getTransform();
    const pt = m.transformPoint(new DOMPoint(x, y));
    const { weight, size, align } = this.font;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${weight} ${size * m.a}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillText(str, pt.x, pt.y);
    ctx.restore();
  }

  fit(ctx, str, maxWorld) {
    const m = ctx.getTransform();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${this.font.weight} ${this.font.size * m.a}px ${FONT}`;
    let out = str;
    while (ctx.measureText(out).width > maxWorld * m.a && out.length > 3) out = out.slice(0, -1);
    ctx.restore();
    return out === str ? str : out.slice(0, -1) + '…';
  }

  drawBlip(ctx, x, y, icon, s, r = 0.85, fill = 'rgba(10,14,20,0.92)') {
    const rr = Math.max(r, 9 / s);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = Math.max(0.08, 1.5 / s);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    this.text(ctx, '', rr * 1.15, 'center');
    this.ft(ctx, icon, x, y + rr * 0.08);
  }

  drawRoute(ctx, s) {
    if (!this.route) return;
    const pts = [{ x: this.player.x, y: this.player.y }, ...this.route.points];
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = COLORS.route;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = COLORS.route;
    ctx.lineWidth = Math.max(0.35, 5 / s);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([0.5, 1]);
    ctx.lineDashOffset = -this.time * 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(0.1, 1.5 / s);
    ctx.stroke();
    ctx.restore();
    const via = this.route.via;
    if (via) {
      const c = center(via.conn);
      this.drawBlip(ctx, c.x, c.y, via.kind === 'escalator' ? (via.conn.dir === 'up' ? '⬆️' : '⬇️') : '🛗', s, 1, COLORS.route);
    }
  }

  drawWaypoint(ctx, s) {
    const wp = this.waypoint;
    if (!wp || wp.floor !== this.viewFloor) return;
    const bob = Math.sin(this.time * 4) * 0.25;
    const r = Math.max(0.9, 11 / s);
    ctx.save();
    ctx.translate(wp.x, wp.y - r * 1.4 + bob);
    ctx.beginPath();
    ctx.moveTo(0, r * 1.4);
    ctx.lineTo(-r * 0.8, 0);
    ctx.arc(0, 0, r * 0.8, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = COLORS.route;
    ctx.fill();
    ctx.lineWidth = Math.max(0.08, 1.5 / s);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }

  drawPlayer(ctx, s) {
    const p = this.player;
    const r = Math.max(0.55, 9 / s);
    const pulse = (this.time * 1.2) % 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * (1 + pulse * 2.2), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - pulse)})`;
    ctx.lineWidth = Math.max(0.06, 1.5 / s);
    ctx.stroke();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.heading + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.3);
    ctx.lineTo(r, r);
    ctx.lineTo(0, r * 0.45);
    ctx.lineTo(-r, r);
    ctx.closePath();
    ctx.fillStyle = COLORS.player;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(0.08, 1.5 / s);
    ctx.strokeStyle = '#111';
    ctx.stroke();
    ctx.restore();
  }

  renderRadar() {
    const { rctx: ctx, dpr } = this;
    const W = this.radar.width / dpr, H = this.radar.height / dpr;
    const s = 3.4;
    const p = this.player;
    const f = this.floor;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d141c';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2 - p.x * s, H / 2 - p.y * s);
    ctx.scale(s, s);
    ctx.fillStyle = COLORS.slab;
    ctx.fillRect(0, 0, f.w, f.h);
    ctx.fillStyle = f.type === 'parking' ? COLORS.parking : '#56657a';
    for (const r of f.walk) ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = COLORS.void;
    for (const r of f.voids) ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = COLORS.seat;
    for (const r of f.seating) ctx.fillRect(r.x, r.y, r.w, r.h);
    for (const st of f.stores) {
      ctx.fillStyle = CATEGORIES[st.category].color + '88';
      ctx.fillRect(st.x + 0.2, st.y + 0.2, st.w - 0.4, st.h - 0.4);
    }
    for (const e of f.escalators) { ctx.fillStyle = e.dir === 'up' ? COLORS.up : COLORS.down; ctx.fillRect(e.x, e.y + 0.3, e.w, e.h - 0.6); }
    if (this.route) {
      ctx.strokeStyle = COLORS.route;
      ctx.lineWidth = 0.9;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      for (const q of this.route.points) ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.restore();

    // Blips, clamped to the radar edge like in GTA
    const blip = (wx, wy, color, size = 4, clamp = false) => {
      let x = W / 2 + (wx - p.x) * s, y = H / 2 + (wy - p.y) * s;
      const m = 7;
      if (x < m || y < m || x > W - m || y > H - m) {
        if (!clamp) return;
        x = Math.min(W - m, Math.max(m, x));
        y = Math.min(H - m, Math.max(m, y));
      }
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#000'; ctx.stroke();
    };
    for (const st of f.stores) {
      if (st.discount && !this.collected.has(st.id)) blip(st.entry.x + 0.5, st.entry.y + 0.5, '#ff3b5c', 3);
    }
    for (const a of f.amenities) if (a.type === 'wc' || a.type === 'elevator') blip(a.x, a.y, '#6fb7ff', 2.5);
    if (this.car?.floor === f.id) blip(this.car.x, this.car.y, '#1d6fe0', 4, true);
    if (this.route?.via) { const c = center(this.route.via.conn); blip(c.x, c.y, COLORS.route, 4.5, true); }
    else if (this.waypoint?.floor === f.id) blip(this.waypoint.x, this.waypoint.y, COLORS.route, 4.5, true);

    // Player arrow at center
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(p.heading + Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `800 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 11);
  }
}
