// Store categories (labels, icons, colors, search keywords) and the mapping from OpenStreetMap tags.
// Shared by the server (real-data import + matching) and the browser (colors, icons, labels).

export const CATEGORIES = {
  fashion: {
    label: 'پوشاک', icon: '👕', color: '#8e5cd9',
    keywords: ['لباس', 'پوشاک', 'مد', 'مانتو', 'شلوار', 'پیراهن', 'کت', 'شال', 'روسری', 'تیشرت', 'کاپشن'],
  },
  shoes: {
    label: 'کیف و کفش', icon: '👟', color: '#c2577a',
    keywords: ['کفش', 'کیف', 'چرم', 'کتانی', 'بوت', 'کمربند'],
  },
  mobile: {
    label: 'موبایل و دیجیتال', icon: '📱', color: '#3b8fd9',
    keywords: ['موبایل', 'گوشی', 'دیجیتال', 'لوازم جانبی', 'آیفون', 'سامسونگ', 'شیائومی', 'لپ تاپ', 'کامپیوتر', 'هندزفری', 'شارژر', 'تبلت'],
  },
  appliance: {
    label: 'لوازم خانگی و صوتی‌تصویری', icon: '📺', color: '#2f9fb0',
    keywords: ['لوازم خانگی', 'برقی', 'تلویزیون', 'یخچال', 'لباسشویی', 'ظرفشویی', 'جاروبرقی', 'کولر', 'اجاق', 'مایکروویو', 'صوتی', 'تصویری', 'ال جی', 'سامسونگ', 'بوش', 'اسنوا'],
  },
  lighting: {
    label: 'روشنایی و الکتریکی', icon: '💡', color: '#c9a227',
    keywords: ['چراغ', 'لوستر', 'لامپ', 'روشنایی', 'ال ای دی', 'الکتریکی', 'سیم', 'کابل', 'کلید', 'پریز'],
  },
  cosmetics: {
    label: 'آرایشی و بهداشتی', icon: '💄', color: '#d97ab0',
    keywords: ['آرایشی', 'بهداشتی', 'عطر', 'ادکلن', 'کرم', 'رژ', 'داروخانه'],
  },
  jewelry: {
    label: 'طلا، جواهر و ساعت', icon: '💍', color: '#d9b23b',
    keywords: ['طلا', 'جواهر', 'زیورآلات', 'ساعت', 'النگو', 'انگشتر', 'گردنبند'],
  },
  home: {
    label: 'خانه و دکوراسیون', icon: '🏠', color: '#5fae6e',
    keywords: ['آشپزخانه', 'دکوراسیون', 'مبل', 'فرش', 'پرده', 'ظروف', 'چینی', 'کریستال', 'سرویس خواب'],
  },
  toys: {
    label: 'اسباب‌بازی و کودک', icon: '🧸', color: '#e07b39',
    keywords: ['اسباب بازی', 'کودک', 'بچه', 'نوزاد', 'سیسمونی'],
  },
  sports: {
    label: 'ورزشی', icon: '⚽', color: '#3bbfa8',
    keywords: ['ورزش', 'ورزشی', 'کوهنوردی', 'دوچرخه', 'کتانی'],
  },
  books: {
    label: 'کتاب و لوازم‌التحریر', icon: '📚', color: '#9a8f6a',
    keywords: ['کتاب', 'لوازم التحریر', 'نوشت افزار', 'ساز', 'موسیقی'],
  },
  optics: {
    label: 'عینک', icon: '👓', color: '#5a7bd9',
    keywords: ['عینک', 'لنز', 'آفتابی'],
  },
  food: {
    label: 'رستوران و کافه', icon: '🍔', color: '#e05a47',
    keywords: ['غذا', 'رستوران', 'کافه', 'قهوه', 'شیرینی', 'بستنی', 'فست فود'],
  },
  fabric: {
    label: 'پارچه و خیاطی', icon: '🧵', color: '#a0522d',
    keywords: ['پارچه', 'خیاطی', 'چادر', 'نخ', 'خرازی'],
  },
  spice: {
    label: 'خشکبار و ادویه', icon: '🌰', color: '#b5762a',
    keywords: ['خشکبار', 'ادویه', 'آجیل', 'زعفران', 'عطاری'],
  },
  cinema: {
    label: 'سینما', icon: '🎬', color: '#9c3848',
    keywords: ['سینما', 'فیلم'],
  },
  services: {
    label: 'خدمات و بانک', icon: '🏦', color: '#607489',
    keywords: ['بانک', 'تعمیر', 'خدمات', 'بیمه', 'صرافی'],
  },
  other: {
    label: 'سایر فروشگاه‌ها', icon: '🛍️', color: '#7d8a99',
    keywords: [],
  },
  // A unit in the schematic floor plan with no shop known yet. The seller panel lets a shop claim it.
  vacant: {
    label: 'واحد ثبت‌نشده', icon: '', color: '#3a4553',
    keywords: [],
  },
};

// OpenStreetMap tags → category. https://wiki.openstreetmap.org/wiki/Key:shop
const OSM = {
  fashion: 'clothes fashion boutique fashion_accessories tailor second_hand wedding uniform',
  shoes: 'shoes bag leather',
  mobile: 'mobile_phone computer telecommunication electronics_repair video_games camera printer_ink',
  appliance: 'electronics appliance hifi kitchen sewing_machine vacuum_cleaner air_conditioning',
  lighting: 'lighting electrical energy',
  cosmetics: 'cosmetics perfumery chemist beauty hairdresser_supply pharmacy herbalist_cosmetics',
  jewelry: 'jewelry watches gold pawnbroker',
  home: 'furniture houseware interior_decoration carpet curtain bed doityourself hardware glaziery tiles bathroom_furnishing flooring paint garden_centre gift antiques frame',
  toys: 'toys baby_goods games party model',
  sports: 'sports outdoor bicycle fishing hunting scuba_diving',
  books: 'books stationery art music musical_instrument copyshop',
  optics: 'optician',
  food: 'cafe restaurant fast_food ice_cream confectionery pastry bakery coffee tea supermarket convenience deli chocolate beverages dairy butcher',
  fabric: 'fabric sewing haberdashery wool',
  spice: 'spices nuts herbalist',
  cinema: 'cinema',
  services: 'bank atm money_lender bureau_de_change insurance travel_agency repair craft dry_cleaning laundry photo locksmith',
};
const OSM_LOOKUP = new Map(Object.entries(OSM).flatMap(([cat, keys]) => keys.split(' ').map((k) => [k, cat])));

export function osmCategory(tags) {
  for (const v of [tags.shop, tags.amenity, tags.craft && 'craft']) {
    if (v && OSM_LOOKUP.has(v)) return OSM_LOOKUP.get(v);
  }
  return 'other';
}

export const AMENITIES = {
  elevator: { label: 'آسانسور', icon: '🛗' },
  stairs: { label: 'پله', icon: '🪜' },
  escalator: { label: 'پله برقی', icon: '↗' },
  wc: { label: 'سرویس بهداشتی', icon: '🚻' },
  prayer: { label: 'نمازخانه', icon: '🕌' },
  atm: { label: 'خودپرداز', icon: '🏧' },
  info: { label: 'اطلاعات', icon: 'ℹ️' },
  entrance: { label: 'ورودی', icon: '🚪' },
  fireexit: { label: 'خروج اضطراری', icon: '🚨' },
  kids: { label: 'شهربازی کودک', icon: '🎠' },
  firstaid: { label: 'کمک‌های اولیه', icon: '⛑️' },
  ramp: { label: 'رمپ خودرو', icon: '🅿️' },
  foodcourt: { label: 'فودکورت', icon: '🍽️' },
};
