// Persistence for what people add: shops (added by shoppers, or registered and kept up to date by their
// owner), votes (a shop is still there or gone, what a mall sells, its real opening hours), floor plans
// drawn in the editor, and malls discovered on OpenStreetMap outside Tehran.
// Uses Neon Postgres when DATABASE_URL is set (e.g. on Vercel), otherwise a local JSON file.
// Both backends expose the same async API, so server.js doesn't care which one runs.
//
// Edits and votes are never deleted, only overwritten (a withdrawn vote has value null), so every server
// instance can catch up by reading the rows changed since it last looked.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export async function openDb({ dir }) {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return url ? neonDb(url) : fileDb(dir);
}

// ---------- local JSON file (single process) ----------

async function fileDb(dir) {
  const file = path.join(dir, 'db.json');
  await mkdir(dir, { recursive: true });
  const data = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
  data.edits ??= {};
  data.votes ??= {};
  data.discovered ??= [];
  data.tiles ??= [];
  data.plans ??= {};

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeFile(file, JSON.stringify(data)).catch(console.error), 200);
  }

  return {
    kind: 'file',
    async changes(since = 0) {
      return {
        edits: Object.entries(data.edits).filter(([, e]) => e.at >= since).map(([shopId, e]) => ({ shopId, ...e })),
        votes: Object.entries(data.votes).filter(([, v]) => v.at >= since).map(([key, v]) => ({ key, ...v })),
      };
    },
    async getEdit(shopId) { return data.edits[shopId] ? { shopId, ...data.edits[shopId] } : null; },
    async setEdit(shopId, mallId, shop, tokenHash) {
      data.edits[shopId] = { mallId, data: shop, tokenHash, at: Date.now() };
      save();
    },
    async setVote(key, target, kind, user, value) {
      data.votes[key] = { target, kind, user, value, at: Date.now() };
      save();
    },
    async discovered(after = 0) { return data.discovered.slice(after); },
    async addDiscovered(defs, tiles) {
      const known = new Set(data.discovered.map((d) => d.id));
      for (const d of defs) if (!known.has(d.id)) data.discovered.push(d);
      for (const t of tiles) if (!data.tiles.includes(t)) data.tiles.push(t);
      save();
    },
    async missingTiles(tiles) { return tiles.filter((t) => !data.tiles.includes(t)); },
    async plans(since = 0) {
      return Object.entries(data.plans).filter(([, p]) => p.at > since).map(([mallId, p]) => ({ mallId, plan: p.plan, at: p.at }));
    },
    async setPlan(mallId, plan) { data.plans[mallId] = { plan, at: Date.now() }; save(); },
  };
}

// ---------- Neon Postgres (shared by every serverless instance) ----------

async function neonDb(url) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);

  const setup = () => sql.transaction([
    sql`create table if not exists shop_edits (
      shop_id text primary key, mall_id text not null, data jsonb not null, token_hash text,
      updated_at timestamptz not null default now())`,
    sql`create index if not exists shop_edits_updated_idx on shop_edits (updated_at)`,
    sql`create table if not exists votes (
      key text primary key, target text not null, kind text not null, user_hash text not null, value jsonb,
      updated_at timestamptz not null default now())`,
    sql`create index if not exists votes_updated_idx on votes (updated_at)`,
    sql`create table if not exists discovered (seq bigserial, id text primary key, data jsonb not null)`,
    sql`create table if not exists tiles (key text primary key)`,
    sql`create table if not exists plans (mall_id text primary key, data jsonb not null, updated_at timestamptz not null default now())`,
  ]);
  // Instances cold-starting together can race on "create table"; the retry sees the tables.
  await setup().catch(setup);

  const edit = (r) => ({ shopId: r.shop_id, mallId: r.mall_id, data: r.data, tokenHash: r.token_hash, at: Number(r.at) });

  return {
    kind: 'neon',
    async changes(since = 0) {
      const after = new Date(since).toISOString();
      const [edits, votes] = await Promise.all([
        sql`select shop_id, mall_id, data, token_hash, extract(epoch from updated_at) * 1000 as at from shop_edits where updated_at >= ${after}`,
        sql`select key, target, kind, user_hash, value, extract(epoch from updated_at) * 1000 as at from votes where updated_at >= ${after}`,
      ]);
      return {
        edits: edits.map(edit),
        votes: votes.map((r) => ({ key: r.key, target: r.target, kind: r.kind, user: r.user_hash, value: r.value, at: Number(r.at) })),
      };
    },
    async getEdit(shopId) {
      const [row] = await sql`select shop_id, mall_id, data, token_hash, extract(epoch from updated_at) * 1000 as at from shop_edits where shop_id = ${shopId}`;
      return row ? edit(row) : null;
    },
    async setEdit(shopId, mallId, shop, tokenHash) {
      await sql`insert into shop_edits (shop_id, mall_id, data, token_hash, updated_at)
        values (${shopId}, ${mallId}, ${JSON.stringify(shop)}::jsonb, ${tokenHash}, now())
        on conflict (shop_id) do update set data = excluded.data, token_hash = excluded.token_hash, updated_at = now()`;
    },
    async setVote(key, target, kind, user, value) {
      await sql`insert into votes (key, target, kind, user_hash, value, updated_at)
        values (${key}, ${target}, ${kind}, ${user}, ${JSON.stringify(value)}::jsonb, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()`;
    },
    // `after` counts rows already loaded, so each instance only reads newly discovered malls.
    async discovered(after = 0) {
      return (await sql`select data from discovered order by seq offset ${after}`).map((r) => r.data);
    },
    async addDiscovered(defs, tiles) {
      if (defs.length) {
        await sql`insert into discovered (id, data)
          select d->>'id', d from jsonb_array_elements(${JSON.stringify(defs)}::jsonb) d on conflict (id) do nothing`;
      }
      if (tiles.length) await sql`insert into tiles (key) select unnest(${tiles}::text[]) on conflict do nothing`;
    },
    async missingTiles(tiles) {
      const have = new Set((await sql`select key from tiles where key = any (${tiles}::text[])`).map((r) => r.key));
      return tiles.filter((t) => !have.has(t));
    },
    // Floor plans drawn in the editor; `since` (ms) returns only the ones saved after it.
    async plans(since = 0) {
      const rows = await sql`select mall_id, data, extract(epoch from updated_at) * 1000 as at from plans
        where updated_at > to_timestamp(${since / 1000})`;
      return rows.map((r) => ({ mallId: r.mall_id, plan: r.data, at: Number(r.at) }));
    },
    async setPlan(mallId, plan) {
      await sql`insert into plans (mall_id, data, updated_at) values (${mallId}, ${JSON.stringify(plan)}::jsonb, now())
        on conflict (mall_id) do update set data = excluded.data, updated_at = now()`;
    },
  };
}
