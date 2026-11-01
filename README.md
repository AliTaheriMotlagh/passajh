# پاساژ · Passajh

GTA-style interactive maps of Tehran shopping malls. Find a mall on the city map, walk inside it floor by floor, collect discount coupons as you pass stores, browse every store's products, and broadcast "I want X" to every store that has it, so they can call you or send an offer.

## Run

```bash
npm start            # or: node server.js   (Node 20+; no install needed locally)
```

- Shopper app: http://localhost:3000
- Seller panel: http://localhost:3000/seller

## Features

Works on iPhone (Safari) and Android (Chrome) and installs to the home screen as a PWA. Location features need HTTPS (or `localhost`).

**Real location (`public/js/geo.js`)**
- Live GPS tracking with an accuracy circle and a compass heading cone. The locate button cycles through: start tracking, follow me, stop.
- Turn-by-turn navigation to any mall, a friend or your parked car, by car or on foot, using OSRM routing on OpenStreetMap (Persian instructions, live ETA, re-route when you leave the route, the screen kept awake). If no router answers, it falls back to a straight line. Can hand off to Google Maps, Waze or the phone's own maps app (`geo:`), e.g. Neshan or Balad.
- Arrival detection: stepping inside a mall's real building outline offers to open its indoor map.
- Inside the mall, the indoor grid is fitted onto the real building outline. Your GPS shows as a blue dot, the player can follow your real walking (📡), the radar's N points to real north, and arriving from outside starts you at the nearest entrance. GPS can't tell floors, so you pick the floor.
- Nearby alerts: the closest mall with discounts, and new live discounts within 3 km.
- Mall list, search results and price comparisons are sorted by distance. Open/closed status uses Tehran time.

**Malls anywhere in Iran**
- Tehran is served from the OpenStreetMap snapshot, so it works even when Overpass is blocked inside Iran. Outside Tehran, panning the map (zoom ≥ 11) or moving more than 5 km asks the server for malls in that area (`GET /api/discover`); it reads OpenStreetMap once per ~30 km area and stores the results in the db. Outlines come from the server (`GET /api/footprint/:mallId`, `GET /api/footprints?lat=&lng=`).

**Inside a mall (`#/mall/<id>`)**
- Floor-by-floor map: stores colored by category, atriums, escalators (پله برقی, animated, up and down), elevators, stairs, restrooms, prayer room, ATM, info desk, first aid, fire exits, food court, cinema, kids area, and parking levels with numbered spots.
- Walk with WASD or the arrow keys (Shift runs), the touch joystick, or by tapping any corridor. Step onto an escalator, elevator or stairs to change floors.
- A quick bar routes to the nearest restroom, prayer room, ATM, food court, exit, elevator and so on, on any floor.
- A purple GPS route to any store on any floor, with an "auto-walk" option. Discount coupons are collected as you walk past stores.

**Parking (`parking.js`)**: save the parking floor and spot number (tap the spot or type it, e.g. `B14`), a note and a photo of the pillar sign. Shows how long you've been parked and routes back to the car. Outdoors, 🚗 saves the car's GPS point and navigates back on foot.

**Shopping (`shopping.js`)**: a shopping list that finds the cheapest matching store in the mall and plans one route through all of them; the best malls for your list; favorite stores and products with price-drop tracking; price comparison across every mall; recently viewed stores.

**Friends (`friends.js`)**: a private group with a 6-character code or invite link. Location sharing is opt-in and shows an indicator while it's on. Members see each other on the city map and inside a mall (floor and position) and can route to each other. The server only ever sees a hashed member id, and presence expires after 2 minutes.

**Product requests**
1. The shopper enters what they want, an optional budget and details, and chooses this mall, malls near them (3 to 25 km) or all malls. They agree to share their phone number and can optionally share their approximate location, rounded to about 100 m.
2. Every store with a matching product (Persian-aware fuzzy match) is notified live (SSE) in the seller panel, with a sound. The seller sees how far the shopper is if they shared their location.
3. The store calls the shopper (`tel:`) or sends a price offer, which arrives live with call and directions buttons.
4. Sellers can also set a discount, which is announced live to shoppers in or near the mall, and add products.

## Data: all real, nothing generated

| Data | Source |
|---|---|
| Every mall, passage (پاساژ) and bazaar in Tehran: 775, incl. Amin Hozour, Lalehzar, Jomhouri/Alaedin, the Grand Bazaar, Tehranpars, Tajrish | OpenStreetMap snapshot in `data/tehran.json` (`npm run data` refreshes it) |
| Building outlines, opening hours, phone, website, Instagram, neighbourhood | Same snapshot (OpenStreetMap tags) |
| Shops inside malls (~880, with category, floor when tagged, phone, hours) | OpenStreetMap shops inside each mall's outline, placed in the unit nearest their real position |
| **Real indoor floor plans**: Iran Mall, Ahura 2 (Shiraz, 6 floors), Zeytoon Fars, Morvarid (Kish), Almas Iran | OpenStreetMap indoor mapping (`indoor=room/area` + `level`), imported for all of Iran into `data/plans-osm.json` (`npm run indoor`) |
| Real floor plans of any other mall | Drawn in the editor at `/editor`, saved in the db (`plans` table) and applied live |
| Floors and parking of the big malls (Iran Mall, Palladium, Sana, Opal, Kourosh, Arg, Tandis, Charsou, Alaedin, Amin Hozour) | `CURATED` in `lib/seed.js` |
| Malls outside Tehran | OpenStreetMap via the server (`GET /api/discover`), cached in the db |
| Shops that register themselves, products, prices, discounts | The seller panel: pick an empty unit, enter name, category, phone and hours (`POST /api/stores/:id/profile`) |
| Requests, offers, seller edits, discovered malls | Neon Postgres when `DATABASE_URL` is set, otherwise `data/db.json` |
| Parking, shopping list, favorites | This device only (`localStorage`) |

No store names, prices, phone numbers, ratings or discounts are made up. A mall with a real floor plan shows it (real shop shapes, doors where they meet the corridor, exact GPS position); floors it hasn't mapped yet show the building outline with the lifts. Every other mall gets a **schematic** plan sized to its real footprint. Units without a known shop are grey ("ثبت‌نشده") until a shop claims one.

### Adding real floor plans

1. Photograph the **evacuation plan (نقشه فرار اضطراری)** or floor directory on each floor, or get the CAD/PDF plan from the mall's management.
2. Open `/editor`, pick the mall and floor, load the photo and line it up over the real building outline (size, rotation, opacity, drag).
3. Trace shops with the 3-click rectangle (shop front, then depth) or the polygon tool; vertices snap to neighbouring shops. Mark atriums, closed areas, entrances, lifts, stairs, escalators, toilets and the prayer room. Purple dots are shops OpenStreetMap already knows; a unit drawn around one takes its name.
4. For passages where every floor is alike, draw one floor and use «کپی از طبقه…».
5. Save. The mall is rebuilt immediately (on every server instance within a few seconds).

Plan format (lat/lng, so it survives changes to the drawing): `{ floors: [{ id: 'G', units: [{ uid, ring, name, category, phone, hours }], areas: [{ kind: 'void'|'service'|'seating', ring }], points: [{ type, lat, lng, dir }] }] }`. Corridors aren't drawn: inside the outline and outside the units is walkable. `GET/POST /api/plans/:mallId`.

Mapping indoor data in OpenStreetMap itself (JOSM + the Simple Indoor Tagging scheme) is also picked up by `npm run indoor` and benefits every map app.

A hand-made layout in the indoor engine's own grid format can still go in `data/layouts/<mallId>.json` (copy the shape from `GET /api/malls/<mallId>`).

**Map**: MapLibre GL with OpenFreeMap vector tiles (no API key, Persian labels), falling back to the standard OpenStreetMap raster tiles if OpenFreeMap is unreachable. Malls cluster when zoomed out; names and real outlines appear from zoom 14. District chips jump to Amin Hozour, Tehranpars, Jomhouri & Alaedin, Lalehzar, the Grand Bazaar, Tajrish, Sadeghieh and Vanak.

**GPS**: a quick Wi-Fi/cell fix shows the user immediately while GPS locks; fixes that jump faster than 85 m/s beyond their accuracy circles are dropped (GPS spoofing in Tehran); arrival detection uses real outlines and ignores fixes worse than 100 m.

## Before going live

- The seller panel has **no authentication**. Anyone can pick any store or register a shop in any empty unit.
- **Set `EDITOR_KEY`** in production: without it anyone can redraw a mall's floor plan. With it, saving needs the key (entered in the editor's sidebar). Add real seller accounts (for example SMS OTP) before real use.
- Shopper identity is a random ID in `localStorage`.
- Without `DATABASE_URL`, `data/db.json` is a single-process JSON store. On Vercel, connect a Neon database (Storage → Neon) so data is shared and persistent; tables are created automatically.

## API

```
GET  /api/malls                      list with stats
GET  /api/malls/:id                  full mall (floors, layout, stores, products)
GET  /api/search?q=&mall=            product search
POST /api/requests                   { userId, query, details, budget, name, phone, consent, mallId? }
GET  /api/requests?user=             shopper's requests + offers
POST /api/requests/:id/offers        { storeId, price, message }
POST /api/requests/:id/close         { userId }
GET  /api/stores/:id                 store
GET  /api/stores/:id/requests        requests matched to this store
POST /api/stores/:id/discount        { percent, title }
POST /api/stores/:id/products        { name, price, tags }
GET  /api/events?user= | ?store=     live events (SSE): request, offer, closed, discount
```
