// What people shop for (labels, icons, colours, search keywords) and the mapping from OpenStreetMap tags.
// Shared by the server (data import, search) and the browser (labels, icons, the category grid).
// `shop: false` marks categories that aren't something you go shopping for (food, banks); they're shown
// inside a mall but left out of the "what do you want to buy?" grid and the hotspots.

import { norm } from './text.js';

export const CATEGORIES = {
  mobile: {
    label: 'موبایل و لوازم جانبی', short: 'موبایل', icon: '📱', color: '#2f7fd8',
    keywords: ['موبایل', 'گوشی', 'آیفون', 'سامسونگ', 'شیائومی', 'هندزفری', 'شارژر', 'قاب', 'گلس', 'تبلت', 'ایرپاد', 'هدفون', 'ساعت هوشمند', 'پاوربانک'],
  },
  computer: {
    label: 'کامپیوتر و لپ‌تاپ', short: 'کامپیوتر', icon: '💻', color: '#3f5fd0',
    keywords: ['کامپیوتر', 'لپ تاپ', 'لپتاپ', 'کیس', 'مانیتور', 'پرینتر', 'کارتریج', 'هارد', 'رم', 'کیبورد', 'ماوس', 'گرافیک', 'مودم', 'دوربین', 'کنسول', 'پلی استیشن'],
  },
  appliance: {
    label: 'لوازم خانگی و صوتی‌تصویری', short: 'لوازم خانگی', icon: '📺', color: '#1f9aa8',
    keywords: ['لوازم خانگی', 'برقی', 'تلویزیون', 'یخچال', 'لباسشویی', 'ظرفشویی', 'جاروبرقی', 'کولر', 'اجاق', 'مایکروویو', 'صوتی', 'تصویری', 'اتو', 'سشوار', 'بخاری', 'آبگرمکن', 'پنکه'],
  },
  lighting: {
    label: 'لوستر و لوازم الکتریکی', short: 'لوستر و برق', icon: '💡', color: '#c79a12',
    keywords: ['چراغ', 'لوستر', 'لامپ', 'روشنایی', 'ال ای دی', 'الکتریکی', 'سیم', 'کابل', 'کلید', 'پریز', 'آباژور', 'قطعات الکترونیک'],
  },
  fashion: {
    label: 'پوشاک', short: 'پوشاک', icon: '👕', color: '#8b55d6',
    keywords: ['لباس', 'پوشاک', 'مانتو', 'شلوار', 'پیراهن', 'کت', 'شال', 'روسری', 'تیشرت', 'کاپشن', 'لباس مجلسی', 'جین', 'بچگانه', 'زیر پوش', 'چادر'],
  },
  shoes: {
    label: 'کیف و کفش', short: 'کیف و کفش', icon: '👟', color: '#c24f78',
    keywords: ['کفش', 'کیف', 'چرم', 'کتانی', 'بوت', 'کمربند', 'چمدان', 'کوله'],
  },
  jewelry: {
    label: 'طلا، جواهر و ساعت', short: 'طلا و ساعت', icon: '💍', color: '#c9a227',
    keywords: ['طلا', 'جواهر', 'زیورآلات', 'ساعت', 'النگو', 'انگشتر', 'گردنبند', 'سکه', 'نقره', 'بدلیجات'],
  },
  cosmetics: {
    label: 'آرایشی، بهداشتی و عطر', short: 'آرایشی و عطر', icon: '💄', color: '#d36aa6',
    keywords: ['آرایشی', 'بهداشتی', 'عطر', 'ادکلن', 'کرم', 'رژ', 'شامپو', 'لوازم آرایش'],
  },
  furniture: {
    label: 'مبلمان و سرویس خواب', short: 'مبلمان', icon: '🛋️', color: '#8a6a3c',
    keywords: ['مبل', 'مبلمان', 'سرویس خواب', 'تخت', 'تشک', 'میز', 'صندلی', 'کمد', 'میز ناهارخوری', 'کاناپه'],
  },
  home: {
    label: 'ظروف و دکوراسیون', short: 'ظروف و دکور', icon: '🍽️', color: '#4f9e63',
    keywords: ['ظروف', 'آشپزخانه', 'دکوراسیون', 'چینی', 'کریستال', 'قابلمه', 'تابلو', 'کادو', 'هدیه', 'پرده', 'شیرآلات', 'کاشی', 'سرامیک', 'جهیزیه'],
  },
  textile: {
    label: 'فرش، پارچه و خرازی', short: 'فرش و پارچه', icon: '🧵', color: '#a2502a',
    keywords: ['فرش', 'گلیم', 'تابلو فرش', 'پارچه', 'خیاطی', 'چادر', 'نخ', 'خرازی', 'دکمه', 'روتختی'],
  },
  tools: {
    label: 'ابزار و یراق', short: 'ابزار', icon: '🔧', color: '#5d6f80',
    keywords: ['ابزار', 'یراق', 'دریل', 'پیچ', 'رنگ', 'قفل', 'لولا', 'ابزارآلات', 'جوش', 'شیشه'],
  },
  auto: {
    label: 'لوازم یدکی خودرو و موتور', short: 'لوازم یدکی', icon: '🚗', color: '#4a5a6a',
    keywords: ['لوازم یدکی', 'یدکی', 'خودرو', 'ماشین', 'موتور', 'لاستیک', 'باتری', 'روغن', 'پژو', 'پراید', 'سمند', 'لنت'],
  },
  sports: {
    label: 'ورزشی و دوچرخه', short: 'ورزشی', icon: '⚽', color: '#22a58e',
    keywords: ['ورزش', 'ورزشی', 'کوهنوردی', 'دوچرخه', 'توپ', 'لباس ورزشی', 'بدنسازی', 'کمپینگ', 'چادر مسافرتی', 'اسکی'],
  },
  toys: {
    label: 'اسباب‌بازی و سیسمونی', short: 'کودک', icon: '🧸', color: '#e07b39',
    keywords: ['اسباب بازی', 'کودک', 'بچه', 'نوزاد', 'سیسمونی', 'کالسکه'],
  },
  books: {
    label: 'کتاب، لوازم‌التحریر و ساز', short: 'کتاب', icon: '📚', color: '#8a7f55',
    keywords: ['کتاب', 'لوازم التحریر', 'نوشت افزار', 'دفتر', 'خودکار', 'ساز', 'گیتار', 'موسیقی', 'لوازم هنری', 'کتاب کنکور'],
  },
  optics: {
    label: 'عینک', short: 'عینک', icon: '👓', color: '#5a7bd9',
    keywords: ['عینک', 'لنز', 'عینک آفتابی', 'فریم'],
  },
  medical: {
    label: 'تجهیزات پزشکی و دارو', short: 'پزشکی', icon: '🩺', color: '#d9534f',
    keywords: ['تجهیزات پزشکی', 'دارو', 'داروخانه', 'فشارسنج', 'ویلچر', 'دندانپزشکی', 'ارتوپدی'],
  },
  spice: {
    label: 'آجیل، خشکبار و ادویه', short: 'آجیل', icon: '🌰', color: '#b5762a',
    keywords: ['خشکبار', 'ادویه', 'آجیل', 'زعفران', 'عطاری', 'خرما'],
  },
  food: {
    label: 'رستوران، کافه و سوپرمارکت', short: 'خوراکی', icon: '☕', color: '#e05a47', shop: false,
    keywords: ['غذا', 'رستوران', 'کافه', 'قهوه', 'شیرینی', 'بستنی', 'فست فود', 'سوپرمارکت', 'نان'],
  },
  services: {
    label: 'بانک و خدمات', short: 'خدمات', icon: '🏦', color: '#607489', shop: false,
    keywords: ['بانک', 'تعمیر', 'خدمات', 'بیمه', 'صرافی', 'آژانس', 'خشکشویی', 'عکاسی'],
  },
  cinema: {
    label: 'سینما', short: 'سینما', icon: '🎬', color: '#9c3848', shop: false,
    keywords: ['سینما', 'فیلم'],
  },
  other: {
    label: 'سایر', short: 'سایر', icon: '🛍️', color: '#7d8a99', shop: false,
    keywords: [],
  },
};

// Categories offered in the "what do you want to buy?" grid, in this order.
export const SHOP_CATEGORIES = Object.keys(CATEGORIES).filter((k) => CATEGORIES[k].shop !== false);

// What a free-text query is about ("گوشی سامسونگ" → mobile), as [category, score] pairs, best first.
// 3 = the query is a keyword, 2 = it contains one, 1.5 = it's the start of one (still typing).
export function detectCategories(q) {
  const nq = norm(q);
  if (nq.length < 2) return [];
  const out = [];
  for (const [key, c] of Object.entries(CATEGORIES)) {
    let score = 0;
    for (const w of [c.label, c.short, ...c.keywords].map(norm)) {
      if (!w) continue;
      if (nq === w) score = 3;
      else if (` ${nq} `.includes(` ${w} `)) score = Math.max(score, 2 + w.length / 100);
      else if (w.startsWith(nq) && nq.length >= 3) score = Math.max(score, 1.5);
    }
    if (score) out.push([key, score]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

// OpenStreetMap tags → category. https://wiki.openstreetmap.org/wiki/Key:shop
const OSM = {
  mobile: 'mobile_phone telecommunication',
  computer: 'computer electronics_repair video_games camera printer_ink',
  appliance: 'appliance hifi sewing_machine vacuum_cleaner air_conditioning',
  lighting: 'lighting electrical electronics energy',
  fashion: 'clothes fashion boutique fashion_accessories tailor second_hand wedding uniform',
  shoes: 'shoes bag leather',
  jewelry: 'jewelry watches gold pawnbroker',
  cosmetics: 'cosmetics perfumery chemist hairdresser_supply herbalist_cosmetics',
  furniture: 'furniture bed',
  home: 'houseware kitchen interior_decoration curtain gift antiques frame bathroom_furnishing tiles flooring',
  textile: 'fabric carpet sewing haberdashery wool',
  tools: 'hardware doityourself tools paint glaziery locksmith',
  auto: 'car_parts car tyres motorcycle',
  sports: 'sports outdoor bicycle fishing hunting scuba_diving',
  toys: 'toys baby_goods games party model',
  books: 'books stationery art music musical_instrument copyshop',
  optics: 'optician',
  medical: 'medical_supply pharmacy hearing_aids orthopaedics',
  spice: 'spices nuts herbalist dried_fruit',
  food: 'cafe restaurant fast_food ice_cream confectionery pastry bakery coffee tea supermarket convenience deli chocolate beverages dairy butcher',
  cinema: 'cinema',
  services: 'bank atm money_lender bureau_de_change insurance travel_agency repair craft dry_cleaning laundry photo beauty hairdresser car_repair',
};
const OSM_LOOKUP = new Map(Object.entries(OSM).flatMap(([cat, keys]) => keys.split(' ').map((k) => [k, cat])));

// Category of a raw OpenStreetMap value (the `shop`, `amenity` or `craft` tag).
export const categoryOfKind = (kind) => OSM_LOOKUP.get(kind) ?? 'other';

export function osmCategory(tags) {
  for (const v of [tags.shop, tags.amenity, tags.craft && 'craft']) {
    if (v && OSM_LOOKUP.has(v)) return OSM_LOOKUP.get(v);
  }
  return 'other';
}

// Every OSM shop value that maps to a shopping category (for the hotspot import).
export const OSM_SHOP_VALUES = Object.entries(OSM).filter(([cat]) => CATEGORIES[cat].shop !== false).flatMap(([, keys]) => keys.split(' '));

// Points drawn on real floor plans.
export const AMENITIES = {
  entrance: { label: 'ورودی', icon: '🚪' },
  elevator: { label: 'آسانسور', icon: '🛗' },
  stairs: { label: 'پله', icon: '🪜' },
  escalator: { label: 'پله برقی', icon: '↗' },
  wc: { label: 'سرویس بهداشتی', icon: '🚻' },
  prayer: { label: 'نمازخانه', icon: '🕌' },
  atm: { label: 'خودپرداز', icon: '🏧' },
  info: { label: 'اطلاعات', icon: 'ℹ️' },
  fireexit: { label: 'خروج اضطراری', icon: '🚨' },
  kids: { label: 'شهربازی کودک', icon: '🎠' },
  firstaid: { label: 'کمک‌های اولیه', icon: '⛑️' },
  foodcourt: { label: 'فودکورت', icon: '🍽️' },
};
