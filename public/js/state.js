// Shared app state: this device's private user id, the open mall and its engine, and the city view.

import { store, persist } from './ui.js';

export const uid = store('uid', null) ?? crypto.randomUUID();
persist('uid', uid);

export const state = {
  mall: null, // full mall data (floors, stores) while inside one
  engine: null, // MallEngine
  city: null, // CityView
  frame: null, // grid ↔ real-world mapping for the open mall
  unread: 0,
  tour: null, // shopping-list route: { stops: [{ store, items }], i }
  friends: [],
};
window.passajh = state; // handy for debugging from the console

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function findStore(id) {
  for (const f of state.mall?.floors ?? []) for (const s of f.stores) if (s.id === id) return s;
  return null;
}

export const floorOf = (s) => state.mall.floors.find((f) => f.id === s.floor);
