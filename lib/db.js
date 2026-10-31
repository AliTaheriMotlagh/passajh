// Persistence for product requests, offers, seller edits and live events.
// Uses Neon Postgres when DATABASE_URL is set (e.g. on Vercel), otherwise a local JSON file.
// Both backends expose the same async API, so server.js doesn't care which one runs.

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
  const data = existsSync(file)
    ? JSON.parse(await readFile(file, 'utf8'))
    : { requests: [], offers: [], storeOverrides: {} };

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeFile(file, JSON.stringify(data, null, 2)).catch(console.error), 200);
  }

  const events = []; // kept in memory only; live clients just need what happened since they connected
  let lastId = 0;

  return {
    kind: 'file',
    pollMs: 1000,
    async overrides() { return data.storeOverrides; },
    async setDiscount(storeId, discount) {
      data.storeOverrides[storeId] = { ...data.storeOverrides[storeId], discount };
      save();
    },
    async addProduct(storeId, product) {
      const o = (data.storeOverrides[storeId] ??= {});
      (o.products ??= []).push(product);
      save();
    },
    async addRequest(r) { data.requests.push(r); save(); },
    async getRequest(id) { return data.requests.find((r) => r.id === id); },
    async closeRequest(id) {
      const r = data.requests.find((x) => x.id === id);
      if (r) r.status = 'closed';
      save();
    },
    async userRequests(userId) { return data.requests.filter((r) => r.userId === userId).reverse(); },
    async storeRequests(storeId) {
      return data.requests.filter((r) => r.matches.some((m) => m.storeId === storeId)).reverse();
    },
    async offers(requestIds) {
      const ids = new Set(requestIds);
      return data.offers.filter((o) => ids.has(o.requestId));
    },
    async addOffer(o) { data.offers.push(o); save(); },
    async publish(list) {
      for (const e of list) events.push({ id: ++lastId, ...e });
      if (events.length > 1000) events.splice(0, events.length - 1000);
    },
    async lastEventId() { return lastId; },
    async events(channels, after) {
      return events.filter((e) => e.id > after && channels.includes(e.channel));
    },
  };
}

// ---------- Neon Postgres (shared by every serverless instance) ----------

async function neonDb(url) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);

  const setup = () => sql.transaction([
    sql`create table if not exists requests (
      id text primary key, user_id text not null, store_ids text[] not null,
      data jsonb not null, created_at timestamptz not null default now())`,
    sql`create index if not exists requests_user_idx on requests (user_id)`,
    sql`create index if not exists requests_stores_idx on requests using gin (store_ids)`,
    sql`create table if not exists offers (
      id text primary key, request_id text not null, store_id text not null,
      data jsonb not null, created_at timestamptz not null default now())`,
    sql`create index if not exists offers_request_idx on offers (request_id)`,
    sql`create table if not exists store_overrides (store_id text primary key, data jsonb not null)`,
    sql`create table if not exists events (
      id bigserial primary key, channel text not null, event text not null,
      data jsonb not null, created_at timestamptz not null default now())`,
  ]);
  // Instances cold-starting together can race on "create table"; the retry sees the tables.
  await setup().catch(setup);

  const datas = (rows) => rows.map((r) => r.data);

  return {
    kind: 'neon',
    pollMs: 2000,
    async overrides() {
      const rows = await sql`select store_id, data from store_overrides`;
      return Object.fromEntries(rows.map((r) => [r.store_id, r.data]));
    },
    async setDiscount(storeId, discount) {
      await sql`insert into store_overrides (store_id, data) values (${storeId}, ${JSON.stringify({ discount })}::jsonb)
        on conflict (store_id) do update set data = store_overrides.data || excluded.data`;
    },
    async addProduct(storeId, product) {
      const p = JSON.stringify([product]);
      await sql`insert into store_overrides (store_id, data) values (${storeId}, jsonb_build_object('products', ${p}::jsonb))
        on conflict (store_id) do update set data = jsonb_set(store_overrides.data, '{products}',
          coalesce(store_overrides.data->'products', '[]'::jsonb) || ${p}::jsonb)`;
    },
    async addRequest(r) {
      await sql`insert into requests (id, user_id, store_ids, data)
        values (${r.id}, ${r.userId}, ${r.matches.map((m) => m.storeId)}::text[], ${JSON.stringify(r)}::jsonb)`;
    },
    async getRequest(id) {
      const [row] = await sql`select data from requests where id = ${String(id)}`;
      return row?.data;
    },
    async closeRequest(id) {
      await sql`update requests set data = jsonb_set(data, '{status}', '"closed"') where id = ${id}`;
    },
    async userRequests(userId) {
      return datas(await sql`select data from requests where user_id = ${userId} order by created_at desc limit 100`);
    },
    async storeRequests(storeId) {
      return datas(await sql`select data from requests where ${storeId} = any (store_ids) order by created_at desc limit 100`);
    },
    async offers(requestIds) {
      if (!requestIds.length) return [];
      return datas(await sql`select data from offers where request_id = any (${requestIds}::text[]) order by created_at`);
    },
    async addOffer(o) {
      await sql`insert into offers (id, request_id, store_id, data)
        values (${o.id}, ${o.requestId}, ${o.storeId}, ${JSON.stringify(o)}::jsonb)`;
    },
    async publish(list) {
      if (!list.length) return;
      await sql`insert into events (channel, event, data)
        select e->>'channel', e->>'event', e->'data' from jsonb_array_elements(${JSON.stringify(list)}::jsonb) e`;
      if (Math.random() < 0.02) await sql`delete from events where created_at < now() - interval '1 day'`;
    },
    async lastEventId() {
      const [row] = await sql`select coalesce(max(id), 0) as id from events`;
      return Number(row.id);
    },
    async events(channels, after) {
      const rows = await sql`select id, event, data from events
        where id > ${after} and channel = any (${channels}::text[]) order by id limit 100`;
      return rows.map((r) => ({ ...r, id: Number(r.id) }));
    },
  };
}
