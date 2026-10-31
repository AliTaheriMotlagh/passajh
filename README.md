# پاساژ · Passajh

GTA-style interactive maps of Tehran shopping malls. Find a mall on the city map, walk inside it floor by floor, collect discount coupons as you pass stores, browse every store's products, and broadcast "I want X" to every store that has it, so they can call you or send an offer.

## Run

```bash
npm start            # or: node server.js   (Node 20+; no install needed locally)
```

- Shopper app: http://localhost:3000
- Seller panel: http://localhost:3000/seller

## Features

**City map (`#/`)**
- Dark "GTA" map of Tehran (also street and satellite layers) with a blip for each mall.
- The real building outline and center of each mall are pulled live from OpenStreetMap (Overpass API) by name. If OSM has no match, an approximate circle is drawn.
- Mall card: floors, stores, discounts, products, center coordinates, and a directions link.
- "My location" finds the nearest mall. A product search covers every mall.

**Inside a mall (`#/mall/<id>`)**
- Floor-by-floor map: stores colored by category, atriums, escalators (پله برقی, animated, up and down), elevators, stairs, restrooms, prayer room, ATM, info desk, first aid, fire exits, food court, cinema, kids area, and parking levels with numbered spots.
- Walk with WASD or the arrow keys (Shift runs), the touch joystick, or by tapping any corridor. Step onto an escalator, elevator or stairs to change floors.
- GTA-style minimap with blips, a location label, and a floor picker.
- A purple GPS route to any store on any floor, with an "auto-walk" option.
- Walk past a store with a discount and you get a pop-up, a coupon in your wallet, and a running savings counter.
- Store panel: products, prices before and after the discount, phone number, directions.
- "My car is here" on parking levels, with a route back to the car.
- Legend with category filters, and a list of all discounts in the mall.

**Product requests**
1. The shopper enters what they want, plus an optional budget and details, chooses this mall or all malls, and agrees to share their phone number.
2. Every store with a matching product (Persian-aware fuzzy match) is notified live (SSE) in the seller panel, with a sound.
3. The store calls the customer (`tel:`) or sends a price offer. The shopper gets it live, with call and directions buttons.
4. Sellers can also set a discount, which is announced live to shoppers inside the mall, and add products.

## Data: what's real and what's sample

| Data | Source |
|---|---|
| Mall list, approximate centers | `lib/seed.js` (`MALL_DEFS`). Corrected from OpenStreetMap in the browser |
| Building outlines | OpenStreetMap, live |
| Indoor layouts, stores, products, prices, discounts, phone numbers | **Generated sample data** (deterministic per mall). Phone numbers use the fake `021-0000-xxxx` range |
| Requests, offers, seller edits | Neon Postgres when `DATABASE_URL` is set (Vercel), otherwise `data/db.json` (created on first use) |

Real indoor floor plans of Tehran malls aren't public. To use a surveyed plan, put it in `data/layouts/<mallId>.json` as `{ "floors": [...] }`. It replaces the generated layout. Copy the shape from `GET /api/malls/<mallId>`: each floor has `walk`, `stores` (with `door` and `entry`), `voids`, `escalators`, `elevators`, `stairs` and `amenities`, in 1 m grid cells.

To add a mall, append it to `MALL_DEFS` in `lib/seed.js`, with `osm` set to a name regex used to find it on OpenStreetMap.

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
