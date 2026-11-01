// Turns a real mall (from OpenStreetMap, see scripts/fetch-tehran.mjs) into floors, units and stores.
// Real indoor floor plans of Tehran malls aren't public, so each mall gets a schematic plan fitted to its
// real building outline. The shops mapped in OpenStreetMap go into the units nearest their real position;
// the remaining units stay "vacant" until a shop claims one from the seller panel. Nothing is invented:
// no store names, phone numbers, products, prices, ratings or discounts.

import { mallFrame, areaOf } from '../public/shared/frame.js';
import { norm, toFaDigits } from '../public/shared/text.js';
import { planToFloors, levelOf, fidOf, floorName } from './plan.js';

export { levelOf };

// Big malls whose floors (including parking) and facilities are known. Matched to the OpenStreetMap
// entry by name near `lat`/`lng`; the ids are kept so older links (#/mall/iranmall) still work.
export const CURATED = [
  {
    id: 'iranmall', match: 'بازار بزرگ ایران|ایران ?مال|iran ?mall', name: 'ایران مال', nameEn: 'Iran Mall', lat: 35.7553, lng: 51.1950,
    address: 'غرب تهران، بزرگراه شهید خرازی، کنار دریاچه چیتگر',
    description: 'یکی از بزرگ‌ترین مراکز خرید تهران در غرب شهر.',
    floors: ['P2', 'P1', 'G', '1', '2', '3'], food: true, cinema: true, hours: '10:00 تا 22:00',
  },
  {
    id: 'palladium', match: 'پالادیوم|palladium', name: 'مرکز خرید پالادیوم', nameEn: 'Palladium', lat: 35.7967, lng: 51.4103,
    address: 'شمال تهران، زعفرانیه، خیابان مقدس اردبیلی', description: 'مرکز خرید شمال تهران در محله زعفرانیه.',
    floors: ['P2', 'P1', 'G', '1', '2', '3'], food: true, hours: '10:00 تا 22:00',
  },
  {
    id: 'sana', match: 'سانا|sana', name: 'سانا مال', nameEn: 'Sana Mall', lat: 35.7930, lng: 51.4560,
    description: 'مرکز خرید مدرن با فروشگاه‌های برند، فودکورت و سینما.',
    floors: ['P3', 'P2', 'P1', 'G', '1', '2', '3'], food: true, cinema: true, hours: '10:00 تا 22:00',
  },
  {
    id: 'opal', match: 'اپال|opal', name: 'مرکز خرید اپال', nameEn: 'Opal Mall', lat: 35.7771, lng: 51.3514,
    description: 'مرکز خرید چندطبقه با فودکورت و پارکینگ.',
    floors: ['P2', 'P1', 'G', '1', '2', '3', '4'], food: true, cinema: true, hours: '10:00 تا 22:00',
  },
  {
    id: 'kourosh', match: 'کوروش مال|kourosh', name: 'کوروش مال', nameEn: 'Kourosh Mall', lat: 35.7563, lng: 51.3105,
    address: 'غرب تهران، بزرگراه ستاری', description: 'مجتمع تجاری و سینمایی در غرب تهران.',
    floors: ['P1', 'G', '1', '2', '3', '4'], food: true, cinema: true, hours: '10:00 تا 22:00',
  },
  {
    id: 'arg', match: 'ارگ|arg', name: 'مرکز خرید ارگ', nameEn: 'Arg Tajrish', lat: 35.8038, lng: 51.4294,
    address: 'شمال تهران، میدان تجریش', description: 'مرکز خرید نزدیک میدان تجریش.',
    floors: ['P2', 'P1', 'G', '1', '2'], food: true, hours: '10:00 تا 22:00',
  },
  {
    id: 'tandis', match: 'تندیس|tandis', name: 'مرکز خرید تندیس', nameEn: 'Tandis Center', lat: 35.8016, lng: 51.4300,
    address: 'شمال تهران، خیابان ولیعصر، نزدیک تجریش', floors: ['P1', 'G', '1', '2', '3'], food: true, hours: '10:00 تا 22:00',
  },
  {
    id: 'charsou', match: 'چارسو|charsou', name: 'مجتمع چارسو', nameEn: 'Charsou', lat: 35.6930, lng: 51.4124,
    address: 'مرکز تهران، خیابان حافظ، تقاطع جمهوری', description: 'مجتمع تجاری و پردیس سینمایی در مرکز شهر.',
    floors: ['P2', 'P1', 'G', '1', '2', '3'], food: true, cinema: true, hours: '10:00 تا 21:00',
  },
  {
    id: 'alaedin', match: '^پاساژ علاء? ?الدین$|alaedin|aladdin', name: 'پاساژ علاءالدین', nameEn: 'Alaedin', lat: 35.6953, lng: 51.4136,
    address: 'مرکز تهران، خیابان جمهوری، تقاطع حافظ', description: 'قطب خرید موبایل و لوازم جانبی در تهران.',
    floors: ['G', '1', '2', '3'], hours: '10:00 تا 20:00',
  },
  {
    id: 'aminhozour', match: 'امین حضور', name: 'مرکز تجاری امین حضور', nameEn: 'Amin Hozour', lat: 35.6832, lng: 51.4372,
    address: 'خیابان امین حضور، سه‌راه امین حضور', description: 'راسته لوازم خانگی و صوتی‌تصویری تهران.',
  },
];

// Layout constants (1 unit = 1 cell ≈ 1 meter).
const D = 8;   // outer store depth
const C = 4;   // corridor width
const I = 5;   // inner store depth
const WK = 2;  // walkway beside atrium
const AH = 6;  // atrium void height
const A = 22;  // atrium block width


function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));

// Split a band of `len` cells into unit widths between min and max.
function split(r, len, min = 5, max = 9) {
  const out = [];
  let rem = len;
  while (rem > max) {
    let w = int(r, min, max);
    if (rem - w < min) w = rem - min;
    out.push(w);
    rem -= w;
  }
  if (rem > 0) out.push(rem);
  return out;
}

function door(x, y, w, h, side) {
  const cx = x + Math.floor(w / 2) - 1;
  const cy = y + Math.floor(h / 2) - 1;
  switch (side) {
    case 'S': return { door: { x: cx, y: y + h - 1, w: 2, h: 1 }, entry: { x: cx, y: y + h } };
    case 'N': return { door: { x: cx, y, w: 2, h: 1 }, entry: { x: cx, y: y - 1 } };
    case 'E': return { door: { x: x + w - 1, y: cy, w: 1, h: 2 }, entry: { x: x + w, y: cy } };
    default: return { door: { x, y: cy, w: 1, h: 2 }, entry: { x: x - 1, y: cy } };
  }
}

function unit(slot) {
  return { x: slot.x, y: slot.y, w: slot.w, h: slot.h, ...door(slot.x, slot.y, slot.w, slot.h, slot.side) };
}

// A real shop from OpenStreetMap (or one a seller registered) in a unit of the plan.
function realStore(mall, floor, slot, s) {
  return {
    id: `${mall.id}-${s.osm}`, name: s.name, nameEn: s.nameEn || null, brand: s.brand || null,
    category: s.category, floor: floor.id, ...unit(slot),
    phone: s.phone || null, website: s.website || null, instagram: s.instagram || null,
    hours: s.hours || mall.hours || null, rating: null, discount: null, products: [],
    source: 'osm', floorKnown: !!s.floor,
  };
}

function vacantUnit(mall, floor, slot, n) {
  // The cinema hall only exists for curated malls known to have one.
  const cinema = slot.category === 'cinema';
  return {
    id: `${mall.id}-${floor.id}-${n}`, name: cinema ? 'سینما' : `واحد ${toFaDigits(n)}`, category: cinema ? 'cinema' : 'vacant',
    vacant: !cinema, floor: floor.id, ...unit(slot), phone: null, hours: mall.hours || null, rating: null, discount: null, products: [],
  };
}

function buildParking(f, W, H) {
  const cy = H / 2;
  f.walk.push({ x: 0, y: 0, w: W, h: H });
  const rows = [2, 11, H - 16, H - 7];
  rows.forEach((y, ri) => {
    let n = 1;
    for (let x = D + 1; x + 2.4 <= W - D - 1; x += 2.6) {
      f.spots.push({ x, y, w: 2.4, h: 5, label: `${'ABCD'[ri]}${n++}` });
    }
  });
  f.amenities.push({ type: 'ramp', x: W / 2, y: cy });
}

// Geometry of one floor: corridors, atriums, vertical circulation and the unit slots (not yet filled).
function buildFloor(ctx, fid, isTop) {
  const { mall, r, blocks: n } = ctx;
  const level = levelOf(fid);
  const W = 2 * D + 2 * C + n * A + (n - 1) * C;
  const H = 2 * D + 2 * C + 2 * I + 2 * WK + AH;
  const cy = H / 2;
  const food = mall.food && isTop;
  const f = {
    id: fid, level, name: floorName(fid),
    type: fid[0] === 'P' ? 'parking' : food ? 'food' : 'retail',
    w: W, h: H,
    walk: [], services: [], voids: [], seating: [], spots: [],
    escalators: [], elevators: [], stairs: [], amenities: [], stores: [],
  };

  // Vertical circulation core, identical on every floor so elevators/stairs line up.
  f.elevators.push({ id: `${fid}-el1`, x: 0, y: cy - 4, w: 2, h: 3 }, { id: `${fid}-el2`, x: 0, y: cy + 1, w: 2, h: 3 });
  f.stairs.push({ id: `${fid}-st1`, x: W - 2, y: cy - 4, w: 2, h: 8 });
  f.amenities.push({ type: 'elevator', x: 1, y: cy }, { type: 'stairs', x: W - 1, y: cy });

  if (f.type === 'parking') {
    buildParking(f, W, H);
    return { f, slots: [] };
  }

  f.walk.push({ x: D, y: D, w: W - 2 * D, h: H - 2 * D });
  f.walk.push({ x: 0, y: cy - 4, w: D, h: 8 }, { x: W - D, y: cy - 4, w: D, h: 8 });
  for (const [x, y] of [[0, 0], [W - D, 0], [0, H - D], [W - D, H - D]]) {
    f.services.push({ x, y, w: D, h: D, label: 'تأسیسات' });
    f.amenities.push({ type: 'fireexit', x: x === 0 ? D - 1.5 : W - D + 1.5, y: y === 0 ? D - 1.5 : H - D + 1.5 });
  }
  // Restrooms and a prayer room are in practically every mall in Iran; their spot in the plan is schematic.
  f.amenities.push({ type: 'wc', x: W - D + 2.5, y: cy + 2 }, { type: 'prayer', x: W - D + 2.5, y: cy - 2 });
  if (ctx.atm) f.amenities.push({ type: 'atm', x: D + 2, y: cy });

  const slots = [];
  const band = (from, to, make) => {
    let p = from;
    for (const w of split(r, to - from)) { slots.push(make(p, w)); p += w; }
  };

  // Top outer band (cinema takes the first 16 cells on the top floor).
  let topStart = D;
  if (isTop && mall.cinema) {
    slots.push({ x: D, y: 0, w: 16, h: D, side: 'S', category: 'cinema' });
    topStart = D + 16;
  }
  const gap = Math.floor(W / 2) - 3;
  const entrances = level === 0;
  if (entrances && n >= 2) {
    band(topStart, gap, (x, w) => ({ x, y: 0, w, h: D, side: 'S' }));
    band(gap + 6, W - D, (x, w) => ({ x, y: 0, w, h: D, side: 'S' }));
    f.walk.push({ x: gap, y: 0, w: 6, h: D });
    f.amenities.push({ type: 'entrance', x: gap + 3, y: 1 });
  } else {
    band(topStart, W - D, (x, w) => ({ x, y: 0, w, h: D, side: 'S' }));
  }

  // Bottom outer band, main entrance on the ground floor.
  if (entrances) {
    band(D, gap, (x, w) => ({ x, y: H - D, w, h: D, side: 'N' }));
    band(gap + 6, W - D, (x, w) => ({ x, y: H - D, w, h: D, side: 'N' }));
    f.walk.push({ x: gap, y: H - D, w: 6, h: D });
    f.amenities.push({ type: 'entrance', x: gap + 3, y: H - 1 });
    if (mall.curated) f.amenities.push({ type: 'info', x: W / 2, y: H - D - 2 }, { type: 'firstaid', x: W - D - 2, y: cy + 6 });
  } else {
    band(D, W - D, (x, w) => ({ x, y: H - D, w, h: D, side: 'N' }));
  }

  // Left / right outer bands around the cores.
  for (const [y0, y1] of [[D, cy - 4], [cy + 4, H - D]]) {
    band(y0, y1, (y, h) => ({ x: 0, y, w: D, h, side: 'E' }));
    band(y0, y1, (y, h) => ({ x: W - D, y, w: D, h, side: 'W' }));
  }

  // Atrium blocks: inner unit rows, void (or food-court seating), escalators between shopping floors.
  const vy = D + C + I + WK;
  for (let i = 0; i < n; i++) {
    const bx = D + C + i * (A + C);
    band(bx, bx + A, (x, w) => ({ x, y: D + C, w, h: I, side: 'S' }));
    band(bx, bx + A, (x, w) => ({ x, y: H - D - C - I, w, h: I, side: 'N' }));
    const atrium = { x: bx, y: vy, w: A, h: AH };
    if (food) {
      f.seating.push(atrium);
      if (i === 0) f.amenities.push({ type: 'foodcourt', x: bx + A / 2, y: vy + AH / 2 });
    } else {
      f.voids.push(atrium);
    }
    const left = i % 2 === 0;
    const ex = left ? bx : bx + A - 6;
    const entryX = left ? bx - 1 : bx + A;
    const has = (lv) => ctx.shopLevels.has(lv);
    if (has(level + 1)) {
      f.escalators.push({ id: `${fid}-e${i}u`, x: ex, y: vy + 1, w: 6, h: 2, dir: 'up', to: level + 1, block: i, entry: { x: entryX, y: vy + 1 } });
    }
    if (has(level - 1)) {
      f.escalators.push({ id: `${fid}-e${i}d`, x: ex, y: vy + 3, w: 6, h: 2, dir: 'down', to: level - 1, block: i, entry: { x: entryX, y: vy + 3 } });
    }
  }
  if (mall.curated && (level === 2 || (isTop && !food && level > 0))) f.amenities.push({ type: 'kids', x: W / 2, y: D + 2 });
  return { f, slots };
}

// Put each real shop in the free unit nearest to where it's mapped (greedy over all shop–unit pairs).
function place(mall, floor, slots, shops, frame) {
  const centerOf = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
  const free = slots.map((s, i) => ({ ...s, i, c: centerOf(s) }));
  const pairs = [];
  shops.forEach((shop, si) => {
    const p = frame && shop.lat != null ? frame.toGrid(shop.lat, shop.lng) : { x: floor.w / 2, y: floor.h / 2 };
    for (const s of free) {
      // The cinema hall is kept for a cinema.
      if (s.category === 'cinema' && shop.category !== 'cinema') continue;
      pairs.push([Math.hypot(p.x - s.c.x, p.y - s.c.y), si, s.i]);
    }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const shopDone = new Set(), slotDone = new Map();
  for (const [, si, ui] of pairs) {
    if (shopDone.has(si) || slotDone.has(ui)) continue;
    shopDone.add(si);
    slotDone.set(ui, si);
  }
  slots.forEach((slot, i) => {
    floor.stores.push(slotDone.has(i) ? realStore(mall, floor, slot, shops[slotDone.get(i)]) : vacantUnit(mall, floor, slot, i + 1));
  });
  return shops.length - shopDone.size; // shops that didn't fit
}

// Floors: the curated list, or ground + "building:levels" from OSM, stretched to cover every level a mapped
// shop is on. No parking levels are added unless they're known.
function floorsOf(def) {
  if (def.curated && def.floors) return def.floors;
  const levels = new Set([0]);
  const above = Math.min(def.levels || 1, 8);
  for (let l = 1; l < above; l++) levels.add(l);
  for (const s of def.stores || []) if (s.floor) levels.add(levelOf(s.floor));
  const lo = Math.max(-3, Math.min(...levels)), hi = Math.min(10, Math.max(...levels));
  return Array.from({ length: hi - lo + 1 }, (_, i) => fidOf(lo + i));
}

// A mall with a real floor plan (OpenStreetMap indoor data, or drawn in the editor) uses it; the rest get
// the schematic plan below.
export function buildMall(def, plan = null) {
  const fids = floorsOf(def);
  const area = def.area ?? areaOf(def.rings);
  const shops = (def.stores || []).filter((s) => s.name);
  if (plan?.floors?.length) {
    const { stores, match, ...rest } = def;
    const { geo, floors, realStores } = planToFloors(def, plan, { floorIds: def.curated ? fids : [], shops });
    return { ...rest, curated: !!def.curated, hours: def.hours || null, area, geo, floors, realStores, plan: { source: plan.source, updated: plan.updated ?? null } };
  }
  const byFloor = new Map(fids.map((fid) => [fid, []]));
  for (const s of shops) (byFloor.get(s.floor) ?? byFloor.get('G') ?? byFloor.get(fids.find((x) => x[0] !== 'P'))).push(s);
  const shopLevels = new Set(fids.filter((x) => x[0] !== 'P').map(levelOf));
  const topLevel = Math.max(...shopLevels);
  const mall = {
    ...def, curated: !!def.curated, hours: def.hours || null,
    // Older cached malls carry made-up food/cinema flags; only curated facts count.
    food: !!(def.curated && def.food), cinema: def.curated ? !!def.cinema : false,
  };

  // Bigger buildings get more atrium blocks; add more while a floor can't hold its mapped shops.
  let blocks = !area ? 1 : area < 3000 ? 1 : area < 10000 ? 2 : 3;
  for (;;) {
    const r = mulberry32(hashStr(def.id));
    const ctx = { mall, r, blocks, shopLevels, atm: shops.some((s) => s.category === 'services') || mall.curated };
    let overflow = 0;
    const floors = fids.map((fid) => {
      const { f, slots } = buildFloor(ctx, fid, levelOf(fid) === topLevel);
      const frame = def.rings?.length ? mallFrame(def, f.w, f.h) : null;
      if (f.type !== 'parking') overflow += place(mall, f, slots, byFloor.get(fid), frame);
      return f;
    });
    if (overflow && blocks < 6) { blocks++; continue; }
    floors.sort((a, b) => b.level - a.level);
    const { stores, match, ...rest } = mall;
    return { ...rest, area, floors, realStores: shops.length - overflow };
  }
}

const near = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 90000);

// Apply the curated overlay to the OpenStreetMap snapshot: each curated mall takes over the nearest entry
// whose name matches (keeping its outline and shops); one with no match is added at its curated position.
export function mergeCurated(osmMalls) {
  const out = [...osmMalls];
  for (const c of CURATED) {
    const re = new RegExp(c.match, 'i');
    const hit = out
      .filter((m) => !m.curated && re.test(norm(`${m.name} ${m.nameEn || ''}`)) && near(m, c) < 3000)
      .sort((a, b) => !b.rings?.length - !a.rings?.length || near(a, c) - near(b, c))[0];
    const { match, ...info } = c;
    if (hit) {
      out[out.indexOf(hit)] = { ...hit, ...info, osmId: hit.id, osmName: hit.name, lat: hit.lat, lng: hit.lng, hours: hit.hours || c.hours, curated: true };
    } else {
      out.push({ ...info, rings: [], stores: [], curated: true });
    }
  }
  return out;
}

// A mall found live on OpenStreetMap outside the snapshot (anywhere in Iran).
export function discoveredDef({ id, name, nameEn, lat, lng, levels, city, rings, hours, phone }) {
  return {
    id, name, nameEn: nameEn || '', lat, lng, rings, levels: Number(levels) || null, hours: hours || null, phone: phone || null,
    discovered: true, stores: [], address: city || null,
  };
}
