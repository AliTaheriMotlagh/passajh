// Persian-aware text normalization and fuzzy matching, shared by server and browser.

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toLatinDigits(s) {
  return String(s ?? '')
    .replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d))
    .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));
}

export function toFaDigits(s) {
  return String(s ?? '').replace(/\d/g, (d) => FA_DIGITS[d]);
}

export function norm(s) {
  return toLatinDigits(s)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ْ]/g, '')
    .replace(/[‌‎‏\-_.,،]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(q) {
  return norm(q).split(' ').filter((t) => t.length > 1 || /\d/.test(t));
}

// Fraction of query tokens found in the haystack (0..1). Spaces are ignored as a
// fallback so "تیشرت" still matches "تی شرت".
export function matchScore(queryTokens, haystack) {
  if (!queryTokens.length) return 0;
  const hay = norm(haystack);
  const compact = hay.replace(/ /g, '');
  let hit = 0;
  for (const t of queryTokens) if (hay.includes(t) || compact.includes(t)) hit++;
  return hit / queryTokens.length;
}

export function formatToman(n) {
  return toFaDigits(Math.round(n).toLocaleString('en-US')).replace(/,/g, '٬') + ' تومان';
}
