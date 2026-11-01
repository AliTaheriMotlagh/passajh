// Floor ids: G (ground), 1, 2, … above, B1, B2 … basements and P1, P2 … parking levels.

import { toFaDigits } from './text.js';

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
export const FLOOR_ID = /^(P[1-9]|B[1-9]|G|[1-9]\d?)$/;
