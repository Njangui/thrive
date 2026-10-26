// Applique les migrations C5 (0180, 0181, 0182, 0184, 0185) sur Postgres en WASM (PGlite) avec un schéma
// de base réduit, puis vérifie contraintes et RLS (membres, rôles, isolation entre tenants).
//   npm i --no-save @electric-sql/pglite && node tests/sql/c5-migrations-rls.pglite.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
const mig = (n) => readFileSync(new URL(`../../supabase/migrations/${n}.sql`, import.meta.url), "utf8");
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const OWNER = "00000000-0000-0000-0000-0000000000a1";
const EMPLOYEE = "00000000-0000-0000-0000-0000000000a2";
const C = "00000000-0000-0000-0000-00000000000c";
const OUTSIDER = "00000000-0000-0000-0000-0000000000b1";

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users (id uuid primary key);
create table organizations (id uuid primary key);
create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create table memberships (organization_id uuid not null, user_id uuid not null, role text not null);
-- Stubs des helpers RLS du projet : l'utilisateur courant vient du réglage de session app.uid.
create function is_member_of_org(target uuid) returns boolean language sql stable as $$
  select exists (select 1 from memberships m where m.organization_id = target and m.user_id = nullif(current_setting('app.uid', true), '')::uuid) $$;
create function current_org_role(target uuid) returns text language sql stable as $$
  select m.role from memberships m where m.organization_id = target and m.user_id = nullif(current_setting('app.uid', true), '')::uuid $$;
-- Tables pré-existantes modifiées par les migrations C5 (colonnes réduites à ce qui est touché).
create table social_posts (id uuid primary key default gen_random_uuid(), organization_id uuid not null, status text not null default 'draft', scheduled_for timestamptz);
create table social_post_targets (id uuid primary key default gen_random_uuid(), post_id uuid, organization_id uuid, platform text, status text not null default 'pending' check (status in ('pending','published','failed')));
create table telegram_publications (id uuid primary key default gen_random_uuid(), organization_id uuid not null, status text not null default 'scheduled');
create table contact_broadcasts (id uuid primary key default gen_random_uuid(), organization_id uuid not null, status text not null default 'scheduled');
create table analytics_events (id uuid primary key default gen_random_uuid(), organization_id uuid not null, event_type text not null check (event_type in ('page_view','product_view','product_click','cta_click','lead_created','conversation_started','order_created','publication_published','video_play')));
create table orders (id uuid primary key, organization_id uuid not null, status text, created_at timestamptz default now());
create table order_items (id uuid primary key default gen_random_uuid(), product_id uuid);
insert into organizations values ('${A}'), ('${B}'), ('${C}');
insert into auth.users values ('${OWNER}'), ('${EMPLOYEE}'), ('${OUTSIDER}');
insert into memberships values ('${A}','${OWNER}','owner'), ('${A}','${EMPLOYEE}','employee'), ('${B}','${OUTSIDER}','owner'), ('${C}','${EMPLOYEE}','employee');
`);
for (const n of ["0180_c5_publication_scheduling", "0181_c5_broadcast_cost_templates", "0182_c5_track_whatsapp_click", "0184_c5_studio", "0185_c5_ads"]) await db.exec(mig(n));
// Droits de table comme sur Supabase (la RLS fait le tri).
await db.exec("grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated");

const asUser = async (uid, fn) => { await db.exec(`set role authenticated; select set_config('app.uid','${uid}', false)`); try { return await fn(); } finally { await db.exec("reset role"); } };
const q = async (sql) => (await db.query(sql)).rows;
const rejects = (sql, re) => assert.rejects(() => db.exec(sql), re);

// --- 0180 : statut de cible 'cancelled', colonnes d'annulation ---
await db.exec(`insert into social_post_targets (organization_id, platform, status) values ('${A}','instagram','cancelled')`);
await rejects(`insert into social_post_targets (organization_id, platform, status) values ('${A}','instagram','nimportequoi')`, /check/i);
await db.exec(`update telegram_publications set cancelled_by = null, cancelled_at = now()`);

// --- 0182 : whatsapp_click accepté, les 9 anciens types conservés, un type inconnu refusé ---
for (const t of ["page_view","product_view","product_click","cta_click","lead_created","conversation_started","order_created","publication_published","video_play","whatsapp_click"]) {
  await db.exec(`insert into analytics_events (organization_id, event_type) values ('${A}','${t}')`);
}
await rejects(`insert into analytics_events (organization_id, event_type) values ('${A}','inconnu')`, /check/i);

// --- growth_settings (0180 + 0181 + 0184) : RLS ---
await asUser(OWNER, () => db.exec(`insert into growth_settings (organization_id) values ('${A}')`));
await asUser(OWNER, async () => assert.equal((await q(`select publication_autonomy, whatsapp_daily_unique_contacts from growth_settings`))[0].publication_autonomy, "propose"));
await asUser(EMPLOYEE, async () => assert.equal((await q(`select * from growth_settings`)).length, 1, "un membre simple peut lire"));
await asUser(EMPLOYEE, () => assert.rejects(() => db.exec(`update growth_settings set publication_autonomy = 'add' where organization_id = '${A}'`).then(async () => { const r = await q(`select publication_autonomy from growth_settings`); if (r[0].publication_autonomy === "add") throw new Error("employé a pu modifier"); throw new Error("silencieusement ignoré"); }), /ignoré|permission|policy/i));
await asUser(OUTSIDER, async () => assert.equal((await q(`select * from growth_settings`)).length, 0, "autre tenant : aucune ligne visible"));
await asUser(OUTSIDER, () => assert.rejects(() => db.exec(`insert into growth_settings (organization_id) values ('${B}'); insert into growth_settings (organization_id) values ('${A}')`), /row-level security|policy/i));
await asUser(OWNER, () => db.exec(`update growth_settings set publication_autonomy = 'add', whatsapp_daily_unique_contacts = 1000 where organization_id = '${A}'`));
await asUser(OWNER, async () => assert.equal((await q(`select publication_autonomy from growth_settings`))[0].publication_autonomy, "add"));
await rejects(`update growth_settings set publication_autonomy = 'auto'`, /check/i);
await rejects(`update growth_settings set whatsapp_daily_unique_contacts = 0`, /check/i);
await rejects(`update growth_settings set media_monthly_budget_milli_usd = -1`, /check/i);

// --- 0181 : colonnes de diffusion ---
await db.exec(`insert into contact_broadcasts (organization_id) values ('${A}')`);
await db.exec(`update contact_broadcasts set template_name = 'promo_fin_annee', estimated_cost = '{"expectedUsd":0.5}', cancelled_by = '${OWNER}'`);

// --- 0184 : brand_kits ---
await asUser(OWNER, () => db.exec(`insert into brand_kits (organization_id, primary_color) values ('${A}', '#112233')`));
await asUser(EMPLOYEE, async () => assert.equal((await q(`select primary_color from brand_kits`))[0].primary_color, "#112233"));
// Un membre SANS rôle admin ne peut pas créer le kit de SA propre organisation (teste le rôle, pas seulement l'appartenance).
await asUser(EMPLOYEE, () => assert.rejects(() => db.exec(`insert into brand_kits (organization_id) values ('${C}')`), /row-level security|policy/i));
await asUser(EMPLOYEE, () => assert.rejects(() => db.exec(`insert into growth_settings (organization_id) values ('${C}')`), /row-level security|policy/i));
// ... ni modifier celui de son organisation (UPDATE filtré par la RLS : aucune ligne touchée).
await asUser(EMPLOYEE, async () => { await db.exec(`update brand_kits set primary_color = '#FFFFFF' where organization_id = '${A}'`); });
await asUser(OWNER, async () => assert.equal((await q(`select primary_color from brand_kits where organization_id = '${A}'`))[0].primary_color, "#112233", "l'employé n'a pas pu modifier le kit"));
// Le propriétaire de A ne peut rien faire sur l'organisation B.
await asUser(OWNER, () => assert.rejects(() => db.exec(`insert into brand_kits (organization_id) values ('${B}')`), /row-level security|policy/i));
await asUser(OUTSIDER, async () => assert.equal((await q(`select * from brand_kits`)).length, 0));
await rejects(`update brand_kits set primary_color = 'rouge'`, /check/i);
await rejects(`update brand_kits set heading_font = 'Arial;}</style><script>'`, /check/i);
await rejects(`update brand_kits set logo_url = 'http://exemple.cm/l.png'`, /check/i);
await rejects(`update brand_kits set logo_url = 'javascript:alert(1)'`, /check/i);
await rejects(`update brand_kits set tagline = '${"x".repeat(121)}'`, /check/i);

// --- 0184 : media_jobs ---
const job = (extra = "") => `insert into media_jobs (organization_id, capability, request, request_fingerprint, idempotency_key, estimated_milli_usd, cost_basis ${extra ? "," + extra.split("|")[0] : ""}) values ('${A}', 'image.generate', '{}', 'fp', 'k1', 40, 'ceiling' ${extra ? "," + extra.split("|")[1] : ""})`;
await db.exec(job());
await rejects(job(), /unique|duplicate/i); // même clé d'idempotence = une seule tâche
await rejects(`insert into media_jobs (organization_id, capability, request, request_fingerprint, idempotency_key, estimated_milli_usd, cost_basis) values ('${A}','audio.generate','{}','fp','k2',1,'ceiling')`, /check/i);
await rejects(`insert into media_jobs (organization_id, capability, request, request_fingerprint, idempotency_key, estimated_milli_usd, cost_basis) values ('${A}','image.generate','{}','fp','k3',-1,'ceiling')`, /check/i);
await rejects(`insert into media_jobs (organization_id, capability, request, request_fingerprint, idempotency_key, estimated_milli_usd, cost_basis) values ('${A}','image.generate','{}','fp','k4',1,'devine')`, /check/i);
await db.exec(`insert into media_jobs (organization_id, capability, request, request_fingerprint, idempotency_key, estimated_milli_usd, cost_basis) values ('${B}','image.generate','{}','fp','k1',40,'ceiling')`); // même clé, autre tenant : OK
await asUser(EMPLOYEE, async () => assert.deepEqual((await q(`select organization_id from media_jobs`)).map((r) => r.organization_id), [A], "lecture limitée à son organisation"));
await asUser(OUTSIDER, async () => assert.deepEqual((await q(`select organization_id from media_jobs`)).map((r) => r.organization_id), [B]));
// Aucune politique d'écriture : même le propriétaire ne peut pas écrire depuis un client (seul le service-role le peut).
await asUser(OWNER, () => assert.rejects(() => db.exec(`insert into media_jobs (organization_id, capability, request, request_fingerprint, idempotency_key, estimated_milli_usd, cost_basis) values ('${A}','image.generate','{}','fp','k9',1,'ceiling')`), /row-level security|policy/i));
await asUser(OWNER, async () => { await db.exec(`update media_jobs set status = 'completed', usage_units = 0 where organization_id = '${A}'`); assert.equal((await q(`select status from media_jobs where organization_id = '${A}'`))[0].status, "pending_charge", "UPDATE sans politique : aucune ligne modifiée"); });
await asUser(OWNER, async () => { await db.exec(`delete from media_jobs where organization_id = '${A}'`); assert.equal((await q(`select count(*)::int as n from media_jobs where organization_id = '${A}'`))[0].n, 1, "DELETE sans politique : aucune ligne supprimée"); });

// --- 0185 : plafonds de pub (tout ou rien, journalier <= mensuel) ---
await rejects(`update growth_settings set ads_daily_cap = 5000 where organization_id = '${A}'`, /check/i); // plafond seul, sans mensuel ni devise
await rejects(`update growth_settings set ads_daily_cap = 9000, ads_monthly_cap = 5000, ads_cap_currency = 'XAF' where organization_id = '${A}'`, /check/i); // journalier > mensuel
await rejects(`update growth_settings set ads_daily_cap = 0, ads_monthly_cap = 5000, ads_cap_currency = 'XAF' where organization_id = '${A}'`, /check/i);
await rejects(`update growth_settings set ads_daily_cap = 1000, ads_monthly_cap = 5000, ads_cap_currency = 'fcfa' where organization_id = '${A}'`, /check/i);
await db.exec(`update growth_settings set ads_daily_cap = 5000, ads_monthly_cap = 100000, ads_cap_currency = 'XAF' where organization_id = '${A}'`);
await asUser(EMPLOYEE, async () => { await db.exec(`update growth_settings set ads_daily_cap = 999999, ads_monthly_cap = 999999, ads_cap_currency = 'XAF' where organization_id = '${A}'`); });
await asUser(OWNER, async () => assert.equal(Number((await q(`select ads_daily_cap from growth_settings`))[0].ads_daily_cap), 5000, "un employé ne peut pas relever les plafonds"));
await asUser(OWNER, () => db.exec(`update growth_settings set ads_daily_cap = 8000 where organization_id = '${A}'`));
await asUser(OWNER, async () => assert.equal(Number((await q(`select ads_daily_cap from growth_settings`))[0].ads_daily_cap), 8000, "le propriétaire le peut"));
await db.exec(`update growth_settings set ads_daily_cap = null, ads_monthly_cap = null, ads_cap_currency = null where organization_id = '${A}'`); // retour à « aucune pub possible »

// --- 0185 : ad_requests ---
const ad = (key, extra = {}) => {
  const v = { org: A, key, kind: "whatsapp_ad", cur: "XAF", bt: "daily", amount: 2000, start: "2026-10-12", end: "2026-10-16", ...extra };
  return `insert into ad_requests (organization_id, request, request_fingerprint, idempotency_key, kind, account_id, ad_account_id, currency, budget_type, budget_amount, start_date, end_date)
          values ('${v.org}', '{}', 'fp', '${v.key}', '${v.kind}', 'acc1', 'act_1', '${v.cur}', '${v.bt}', ${v.amount}, '${v.start}', '${v.end}')`;
};
await db.exec(ad("k1"));
await rejects(ad("k1"), /unique|duplicate/i); // même clé d'idempotence = une seule demande
await db.exec(ad("k1", { org: B })); // même clé, autre tenant : OK
await rejects(ad("k2", { amount: 0 }), /check/i);
await rejects(ad("k3", { cur: "xaf" }), /check/i);
await rejects(ad("k4", { bt: "monthly" }), /check/i);
await rejects(ad("k5", { kind: "tiktok_ad" }), /check/i);
await rejects(ad("k6", { start: "2026-10-16", end: "2026-10-12" }), /check/i); // fin avant début
await rejects(`update ad_requests set status = 'active' where organization_id = '${A}'`, /check/i);
await asUser(EMPLOYEE, async () => assert.deepEqual((await q(`select organization_id from ad_requests`)).map((r) => r.organization_id), [A], "lecture limitée à son organisation"));
await asUser(OUTSIDER, async () => assert.deepEqual((await q(`select organization_id from ad_requests`)).map((r) => r.organization_id), [B]));
// Aucune politique d'écriture : même le propriétaire ne peut ni créer, ni modifier, ni supprimer une pub depuis un client.
await asUser(OWNER, () => assert.rejects(() => db.exec(ad("k9")), /row-level security|policy/i));
await asUser(OWNER, async () => { await db.exec(`update ad_requests set status = 'submitted' where organization_id = '${A}'`); assert.equal((await q(`select status from ad_requests where organization_id = '${A}'`))[0].status, "pending", "UPDATE sans politique : aucune ligne modifiée"); });
await asUser(OWNER, async () => { await db.exec(`delete from ad_requests where organization_id = '${A}'`); assert.equal((await q(`select count(*)::int as n from ad_requests where organization_id = '${A}'`))[0].n, 1, "DELETE sans politique : aucune ligne supprimée"); });

console.log("OK — migrations 0180, 0181, 0182, 0184, 0185 appliquées ; contraintes et RLS vérifiées");
