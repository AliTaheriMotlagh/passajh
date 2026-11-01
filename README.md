# پاساژ · Passajh

**کجا بخرم؟** Where in Tehran do you go to buy something? Tehran's retail is organised by trade: phones around Jomhouri and Hafez, lighting on Lalehzar, car parts on Mellat, furniture in Yaftabad, gold in the Grand Bazaar. Passajh answers "I want X" with the shopping streets and malls that sell X. For each place it shows whether it's open now, the nearest metro station, and the shops people know about. Shoppers and shop owners fill in the rest.

## Run

```bash
npm start            # Node 20+; http://localhost:4000
```

- App: `/`. Shop owners: `/seller`. Floor plan editor: `/editor` (set `EDITOR_KEY` in production).
- Data is stored in `data/db.json`, or in Neon Postgres when `DATABASE_URL` is set.

## Designed around the limitations

| Limitation | What the app does about it |
|---|---|
| Hardly anything is known about what's *inside* malls: 225 of 778 places have any shops mapped, and there are no prices | It leads with **shopping streets** (راسته). These are clusters of 5,700 real shops from OpenStreetMap, and they're where most Tehran shopping happens. Malls are matched by the shops mapped in them plus visitors' votes. It never shows a made-up floor plan, store or price. |
| No product or price data, and no sellers on the platform yet | Prices and the broadcast "request a product" flow are gone. Shop owners can register for free with what they sell (searchable), their hours, phone and Instagram. |
| Opening hours are known for few places | Hours are shown when OpenStreetMap or visitors know them, and say "unknown" otherwise. Anyone can report hours and Friday closing. |
| Traffic and parking in Tehran | The **nearest metro station** (131 stations, with line colours) and walking time are shown everywhere. A parking note saves your floor and pillar. |
| Indoor GPS can't tell floors and is weak; GPS is spoofed in Tehran | No indoor positioning. Location is only used to sort by distance, and fixes that jump impossibly far are dropped. |
| Google Maps and OSRM routing are unreliable in Iran | Navigation hands off to **Neshan and Balad** (and Google Maps, Waze, Apple Maps, or the phone's own app). |
| International links are slow or filtered; mobile data is expensive | The font and map library are self-hosted. All data loads in one **37 KB** gzipped request, cached on the device and revalidated with an ETag. The app works offline. The map library loads only on the map tab. |
| No accounts | Shoppers vote by device. A shop owner gets a **management code** when registering, and later edits need it. Only owners can remove a shop; everyone else votes "gone". |

## Pages

- **Home**: search, a grid of 19 things people shop for, the shopping streets and malls nearest you, and an honest progress bar of how much is mapped.
- **Where to buy X** (`#/c/<category>`, `#/q/<text>`): the shopping streets for it, then the malls and passages that have it, with filters for open now, near metro and distance. Free-text search detects the category ("قاب گوشی" → phones) and finds shops by name or by what owners say they sell.
- **Mall** (`#/m/<id>`): open now, metro and walking time, parking, which shopping street it's in, what it sells, shops by floor (call, Instagram, "still here?" votes), the real floor plan when one exists, and quick actions to add a shop, report hours or report that it closed.
- **Map** (`#/map`): malls and shopping streets, filtered by category.
- **Shopping list** (`#/list`): each item is matched to a category, and the list plans where to buy each one (nearest street or mall, with the metro).
- **Me** (`#/me`): where I parked, saved and recent places (they open offline), my shops, settings, and where the data comes from.
- **Shop owners** (`/seller`): find your mall, claim your shop or add it, and keep it up to date.

## Data

| Data | Source | Refresh |
|---|---|---|
| 775 malls, passages and bazaars in Tehran, with outlines, hours, phone and the shops mapped inside them | OpenStreetMap → `data/tehran.json` | `node scripts/fetch-tehran.mjs` |
| Shopping streets: clusters of 5,700 shops by trade, named after the street Tehranis use for them | OpenStreetMap → `data/hotspots.json` | `npm run hotspots` |
| 131 metro stations and their lines | OpenStreetMap → `data/metro.json` | `npm run metro` |
| Real indoor floor plans (Iran Mall, Ahura 2, Zeytoon Fars, Morvarid, Almas Iran) | OpenStreetMap indoor tags → `data/plans-osm.json` | `npm run indoor` |
| Floors and facilities of the big malls | `CURATED` in `lib/malls.js` | by hand |
| Shops added by people, owners' edits, votes (still here / gone, what a mall sells, hours, closed down), editor floor plans, malls discovered outside Tehran | the db | live |
| Saved places, shopping list, parking, my votes and management codes | this device (`localStorage`) | n/a |

`npm run data` refreshes all the snapshots. `npm run vendor` re-downloads the self-hosted font and map library into `public/fonts` and `public/vendor`.

## API

- `GET /api/boot`: every mall summary, the shopping streets and the counts (ETag, gzip).
- `GET /api/malls/:id`: a mall with its shops, metro, shopping streets nearby, reports and its floor plan.
- `GET /api/search?q=`: shops by name, brand or "what we sell".
- `POST /api/malls/:id/shops` `{ userId, name, category, floor?, phone?, keywords?, owner? }`: add a shop. With `owner: true` it returns a management `token`.
- `POST /api/shops/:id` `{ token?, name, category, … , remove? }`: an owner claims or edits a shop. The first claim returns a `token`.
- `POST /api/shops/:id/vote` `{ userId, vote: 'here' | 'gone' | null }`
- `POST /api/malls/:id/vote` `{ userId, kind: 'tag', category, on }` | `{ kind: 'hours', open, close, friday }` | `{ kind: 'closed', on }`
- `GET /api/discover?lat=&lng=`: malls elsewhere in Iran, fetched from OpenStreetMap once per area.
- `GET|POST /api/plans/:mallId`: the floor plan editor.

Writes are rate-limited per IP. There are no accounts, so an unclaimed shop can be claimed by whoever asks first. This is a known trade-off for a free, sign-up-free directory.
