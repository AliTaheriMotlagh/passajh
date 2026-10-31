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
- Panning the map (zoom ≥ 11) or moving more than 5 km asks the server for malls in that area (`GET /api/discover`). The server reads OpenStreetMap once per ~30 km area, stores the results in the db, and generates an indoor map for each (floor count from `building:levels`). Overpass is often unreachable from inside Iran, so building outlines also go through the server (`GET /api/footprint/:mallId`).

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

## Data: what's real and what's sample

| Data | Source |
|---|---|
| Mall list, approximate centers | `lib/seed.js` (`MALL_DEFS`). Corrected from OpenStreetMap in the browser |
| Building outlines | OpenStreetMap, live |
| Indoor layouts, stores, products, prices, discounts, phone numbers | **Generated sample data** (deterministic per mall). Phone numbers use the fake `021-0000-xxxx` range |
| Malls outside the curated Tehran list | OpenStreetMap via the server (`shop=mall`), cached in the db |
| Requests, offers, seller edits, discovered malls, outlines | Neon Postgres when `DATABASE_URL` is set (Vercel), otherwise `data/db.json` (created on first use) |
| Friends' live positions | Neon `presence` table, or memory for the file db; expire after 2 minutes |
| Parking, shopping list, favorites | This device only (`localStorage`) |

Real indoor floor plans of Tehran malls aren't public. To use a surveyed plan, put it in `data/layouts/<mallId>.json` as `{ "floors": [...] }`. It replaces the generated layout. Copy the shape from `GET /api/malls/<mallId>`: each floor has `walk`, `stores` (with `door` and `entry`), `voids`, `escalators`, `elevators`, `stairs` and `amenities`, in 1 m grid cells.

`OVERPASS_URL` overrides the Overpass server (useful for tests). To curate a mall by hand, append it to `MALL_DEFS` in `lib/seed.js`, with `osm` set to a name regex used to find it on OpenStreetMap.

## Before going live

- The seller panel has **no authentication**. Anyone can pick any store. Add real seller accounts (for example SMS OTP) before real use.
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
