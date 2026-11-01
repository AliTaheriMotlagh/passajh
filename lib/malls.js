// Facts about malls that OpenStreetMap doesn't hold, and how the snapshot, discovered malls and real floor
// plans become the mall records the server serves. Nothing is invented: a mall shows the shops that are
// mapped in it or that people added, and a floor plan only when a real one exists.

import { norm } from '../public/shared/text.js';
import { levelOf, fidOf } from '../public/shared/floors.js';

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
    description: 'مرکز خرید با فروشگاه‌های برند، فودکورت و سینما.',
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

// The floors a mall is known to have: the curated list, the real plan's floors, ground plus
// "building:levels", and any floor a mapped shop is on. Used for the floor picker when adding a shop.
export function floorsOf(def, plan) {
  if (def.curated && def.floors) return def.floors;
  const levels = new Set([0]);
  for (let l = 1; l < Math.min(def.levels || 1, 10); l++) levels.add(l);
  for (const f of plan?.floors ?? []) levels.add(levelOf(f.id));
  for (const s of def.stores ?? []) if (s.floor) levels.add(levelOf(s.floor));
  return [...levels].sort((a, b) => a - b).map(fidOf);
}
