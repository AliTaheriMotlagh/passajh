// Deterministic generator for mall data: floors, indoor layout, stores, products, discounts.
// Mall centers are approximate; indoor layouts are generated (real floor plans are not public),
// so the same mall always produces the same map. Replace with surveyed data when available.

import { CATEGORIES, NAME_POOL } from '../public/shared/catalog.js';

const MODERN = { fashion: 26, shoes: 12, mobile: 10, cosmetics: 9, jewelry: 6, home: 7, toys: 6, sports: 7, books: 3, optics: 4, food: 3 };

export const MALL_DEFS = [
  {
    id: 'iranmall', name: 'ایران مال', nameEn: 'Iran Mall', lat: 35.7553, lng: 51.1950,
    osm: 'ایران مال|ایرانمال|Iran Mall',
    address: 'غرب تهران، بزرگراه شهید خرازی، کنار دریاچه چیتگر',
    description: 'یکی از بزرگ‌ترین مراکز خرید تهران در غرب شهر.',
    blocks: 3, floors: ['P2', 'P1', 'G', '1', '2', '3'], food: true, cinema: true, weights: MODERN,
  },
  {
    id: 'palladium', name: 'مرکز خرید پالادیوم', nameEn: 'Palladium', lat: 35.7967, lng: 51.4103,
    osm: 'پالادیوم|Palladium',
    address: 'شمال تهران، زعفرانیه، خیابان مقدس اردبیلی',
    description: 'مرکز خرید شمال تهران در محله زعفرانیه.',
    blocks: 2, floors: ['P2', 'P1', 'G', '1', '2', '3'], food: true, cinema: false, weights: MODERN,
  },
  {
    id: 'sana', name: 'سانا مال', nameEn: 'Sana Mall', lat: 35.7930, lng: 51.4560,
    osm: 'سانا|Sana',
    address: 'شمال شرق تهران (موقعیت از OpenStreetMap اصلاح می‌شود)',
    description: 'مرکز خرید مدرن با فروشگاه‌های برند، فودکورت و سینما.',
    blocks: 3, floors: ['P3', 'P2', 'P1', 'G', '1', '2', '3'], food: true, cinema: true, weights: MODERN,
  },
  {
    id: 'opal', name: 'مرکز خرید اپال', nameEn: 'Opal Mall', lat: 35.7825, lng: 51.3770,
    osm: 'اپال|Opal',
    address: 'شمال غرب تهران (موقعیت از OpenStreetMap اصلاح می‌شود)',
    description: 'مرکز خرید چندطبقه با فودکورت و پارکینگ.',
    blocks: 2, floors: ['P2', 'P1', 'G', '1', '2', '3', '4'], food: true, cinema: true, weights: MODERN,
  },
  {
    id: 'kourosh', name: 'مجتمع کوروش', nameEn: 'Kourosh Mall', lat: 35.7563, lng: 51.3105,
    osm: 'کوروش|Kourosh',
    address: 'غرب تهران، بزرگراه ستاری',
    description: 'مجتمع تجاری و سینمایی در غرب تهران.',
    blocks: 2, floors: ['P1', 'G', '1', '2', '3', '4'], food: true, cinema: true, weights: MODERN,
  },
  {
    id: 'arg', name: 'مرکز خرید ارگ', nameEn: 'Arg Tajrish', lat: 35.8038, lng: 51.4294,
    osm: 'ارگ|Arg',
    address: 'شمال تهران، میدان تجریش',
    description: 'مرکز خرید نزدیک میدان تجریش.',
    blocks: 1, floors: ['P2', 'P1', 'G', '1', '2'], food: true, cinema: false, weights: MODERN,
  },
  {
    id: 'tandis', name: 'مرکز خرید تندیس', nameEn: 'Tandis Center', lat: 35.8016, lng: 51.4300,
    osm: 'تندیس|Tandis',
    address: 'شمال تهران، خیابان ولیعصر، نزدیک تجریش',
    description: 'مرکز خرید در محدوده تجریش.',
    blocks: 1, floors: ['P1', 'G', '1', '2', '3'], food: true, cinema: false, weights: MODERN,
  },
  {
    id: 'ghaem', name: 'پاساژ قائم', nameEn: 'Ghaem Passage', lat: 35.8051, lng: 51.4346,
    osm: 'قائم|Ghaem',
    address: 'تجریش، کنار بازار تجریش',
    description: 'پاساژ قدیمی در کنار بازار تجریش.',
    blocks: 1, floors: ['G', '1', '2'], food: false, cinema: false, weights: MODERN,
  },
  {
    id: 'charsou', name: 'مجتمع چارسو', nameEn: 'Charsou', lat: 35.6930, lng: 51.4124,
    osm: 'چارسو|Charsou',
    address: 'مرکز تهران، خیابان حافظ، تقاطع جمهوری',
    description: 'مجتمع تجاری و پردیس سینمایی در مرکز شهر.',
    blocks: 2, floors: ['P2', 'P1', 'G', '1', '2', '3'], food: true, cinema: true, weights: MODERN,
  },
  {
    id: 'alaedin', name: 'پاساژ علاءالدین', nameEn: 'Alaedin', lat: 35.6953, lng: 51.4136,
    osm: 'علاءالدین|علاالدین|Alaedin|Aladdin',
    address: 'مرکز تهران، خیابان جمهوری، تقاطع حافظ',
    description: 'قطب خرید موبایل و لوازم جانبی در تهران.',
    blocks: 1, floors: ['G', '1', '2', '3'], food: false, cinema: false,
    weights: { mobile: 70, cosmetics: 4, optics: 4, shoes: 4, fashion: 4, food: 3, books: 2 },
  },
  {
    id: 'bazaar', name: 'بازار بزرگ تهران', nameEn: 'Grand Bazaar', lat: 35.6745, lng: 51.4225,
    osm: 'بازار بزرگ|بازار تهران|Grand Bazaar',
    address: 'جنوب تهران، خیابان پانزده خرداد',
    description: 'بازار تاریخی تهران با راسته‌های سنتی.',
    blocks: 3, floors: ['G', '1'], food: false, cinema: false,
    weights: { fabric: 20, spice: 15, jewelry: 15, home: 15, fashion: 10, shoes: 10, toys: 5, food: 3 },
  },
];

const FLOOR_NAMES = {
  P3: 'پارکینگ P3', P2: 'پارکینگ P2', P1: 'پارکینگ P1', G: 'همکف',
  1: 'طبقه اول', 2: 'طبقه دوم', 3: 'طبقه سوم', 4: 'طبقه چهارم', 5: 'طبقه پنجم',
};
const DISCOUNT_TITLES = ['حراج پاییزه', 'تخفیف ویژه', 'فروش فوق‌العاده', 'جشنواره خرید', 'تخفیف افتتاحیه', 'بلک فرایدی'];

// Layout constants (1 unit = 1 cell ≈ 1 meter).
const D = 8;   // outer store depth
const C = 4;   // corridor width
const I = 5;   // inner store depth
const WK = 2;  // walkway beside atrium
const AH = 6;  // atrium void height
const A = 22;  // atrium block width

export function levelOf(fid) {
  if (fid[0] === 'P') return -Number(fid.slice(1));
  return fid === 'G' ? 0 : Number(fid);
}

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
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function weighted(r, weights) {
  const entries = Object.entries(weights);
  let total = 0;
  for (const [, w] of entries) total += w;
  let x = r() * total;
  for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
  return entries[entries.length - 1][0];
}

// Split a band of `len` cells into store widths between min and max.
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

function makeStore(ctx, floor, slot, category) {
  const { r, mall, used } = ctx;
  const cat = CATEGORIES[category];
  let name;
  for (let i = 0; i < 30; i++) {
    name = `${pick(r, cat.prefixes)} ${pick(r, NAME_POOL)}`;
    if (!used.has(name)) break;
  }
  used.add(name);
  const id = `${mall.id}-${floor.id}-${floor.stores.length + 1}`;
  const hasDiscount = category !== 'cinema' && r() < 0.35;
  const discount = hasDiscount
    ? { percent: pick(r, [10, 15, 20, 25, 30, 40, 50]), title: pick(r, DISCOUNT_TITLES) }
    : null;
  const pool = [...cat.products];
  const count = Math.min(pool.length, int(r, 5, 9));
  const products = [];
  for (let k = 0; k < count; k++) {
    const [pname, base, tags] = pool.splice(Math.floor(r() * pool.length), 1)[0];
    const price = Math.max(10000, Math.round((base * (0.85 + r() * 0.3)) / 10000) * 10000);
    products.push({ id: `${id}-p${k + 1}`, name: pname, price, tags, inStock: r() > 0.08 });
  }
  return {
    id, name, category, floor: floor.id,
    x: slot.x, y: slot.y, w: slot.w, h: slot.h,
    ...door(slot.x, slot.y, slot.w, slot.h, slot.side),
    phone: `021-0000-${String(int(r, 1000, 9999))}`,
    rating: Math.round((3.4 + r() * 1.6) * 10) / 10,
    hours: '۱۰:۰۰ تا ۲۲:۰۰',
    discount,
    products,
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

function buildFloor(ctx, fid, isTop) {
  const { mall, r } = ctx;
  const n = mall.blocks;
  const level = levelOf(fid);
  const W = 2 * D + 2 * C + n * A + (n - 1) * C;
  const H = 2 * D + 2 * C + 2 * I + 2 * WK + AH;
  const cy = H / 2;
  const food = mall.food && isTop;
  const f = {
    id: fid, level, name: FLOOR_NAMES[fid] ?? fid,
    type: level < 0 ? 'parking' : food ? 'food' : 'retail',
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
    return f;
  }

  f.walk.push({ x: D, y: D, w: W - 2 * D, h: H - 2 * D });
  f.walk.push({ x: 0, y: cy - 4, w: D, h: 8 }, { x: W - D, y: cy - 4, w: D, h: 8 });
  for (const [x, y] of [[0, 0], [W - D, 0], [0, H - D], [W - D, H - D]]) {
    f.services.push({ x, y, w: D, h: D, label: 'تأسیسات' });
    f.amenities.push({ type: 'fireexit', x: x === 0 ? D - 1.5 : W - D + 1.5, y: y === 0 ? D - 1.5 : H - D + 1.5 });
  }
  f.amenities.push(
    { type: 'wc', x: W - D + 2.5, y: cy + 2 },
    { type: 'prayer', x: W - D + 2.5, y: cy - 2 },
    { type: 'atm', x: D + 2, y: cy },
  );

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
    f.amenities.push(
      { type: 'entrance', x: gap + 3, y: H - 1 },
      { type: 'info', x: W / 2, y: H - D - 2 },
      { type: 'firstaid', x: W - D - 2, y: cy + 6 },
    );
  } else {
    band(D, W - D, (x, w) => ({ x, y: H - D, w, h: D, side: 'N' }));
  }

  // Left / right outer bands around the cores.
  for (const [y0, y1] of [[D, cy - 4], [cy + 4, H - D]]) {
    band(y0, y1, (y, h) => ({ x: 0, y, w: D, h, side: 'E' }));
    band(y0, y1, (y, h) => ({ x: W - D, y, w: D, h, side: 'W' }));
  }

  // Atrium blocks: inner store rows, void (or food-court seating), escalators.
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
    const has = (lv) => ctx.levels.has(lv) && lv >= 0;
    if (has(level + 1)) {
      f.escalators.push({ id: `${fid}-e${i}u`, x: ex, y: vy + 1, w: 6, h: 2, dir: 'up', to: level + 1, block: i, entry: { x: entryX, y: vy + 1 } });
    }
    if (has(level - 1)) {
      f.escalators.push({ id: `${fid}-e${i}d`, x: ex, y: vy + 3, w: 6, h: 2, dir: 'down', to: level - 1, block: i, entry: { x: entryX, y: vy + 3 } });
    }
  }
  if (level === 2 || (isTop && !food && level > 0)) f.amenities.push({ type: 'kids', x: W / 2, y: D + 2 });

  for (const s of slots) {
    const category = s.category ?? (food ? 'food' : weighted(r, mall.weights));
    f.stores.push(makeStore(ctx, f, s, category));
  }
  return f;
}

export function buildMall(def) {
  const r = mulberry32(hashStr(def.id));
  const levels = new Set(def.floors.map(levelOf));
  const topLevel = Math.max(...levels);
  const ctx = { mall: def, r, used: new Set(), levels };
  const floors = def.floors.map((fid) => buildFloor(ctx, fid, levelOf(fid) === topLevel));
  floors.sort((a, b) => b.level - a.level);
  const { weights, ...rest } = def;
  return { ...rest, hours: '۱۰:۰۰ تا ۲۲:۰۰', floors };
}

export function buildMalls() {
  return MALL_DEFS.map(buildMall);
}

const FLOOR_SETS = [['G', '1'], ['P1', 'G', '1', '2'], ['P1', 'G', '1', '2', '3'], ['P2', 'P1', 'G', '1', '2', '3']];

// A mall found on OpenStreetMap anywhere in Iran. Its indoor layout is generated from its id, so every
// server instance builds the same map; "building:levels" sets the number of floors when OSM has it.
export function discoveredDef({ id, name, nameEn, lat, lng, levels, city, rings }) {
  const h = hashStr(id);
  let floors = FLOOR_SETS[h % FLOOR_SETS.length];
  const n = Math.round(Number(levels));
  if (n >= 1) floors = [...(h % 2 ? ['P1'] : []), 'G', ...Array.from({ length: Math.min(n, 6) - 1 }, (_, i) => String(i + 1))];
  if (floors.filter((f) => f[0] !== 'P').length < 2) floors = [...floors, '1'];
  return {
    id, name, nameEn: nameEn || '', lat, lng, osm: null, rings, discovered: true,
    address: city ? `${city} (از OpenStreetMap)` : 'موقعیت از OpenStreetMap',
    description: 'مرکز خرید ثبت‌شده در OpenStreetMap. نقشه داخلی نمونه است تا نقشه واقعی اضافه شود.',
    blocks: 1 + ((h >> 4) % 3), floors, food: (h >> 7) % 3 !== 0, cinema: (h >> 9) % 4 === 0, weights: MODERN,
  };
}
