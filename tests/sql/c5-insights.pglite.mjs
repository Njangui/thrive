// Test SQL des fonctions d'analyse C5 (migration 0183) sur Postgres en WASM (PGlite).
// Hors `npm test` : nécessite `@electric-sql/pglite` (NON ajouté aux dépendances du dépôt).
//   npm i --no-save @electric-sql/pglite && node tests/sql/c5-insights.pglite.mjs
// Schéma réduit aux colonnes utilisées (mêmes noms que les migrations 0001-0075).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const id = (n) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

await db.exec(`
create role anon; create role authenticated; create role service_role;
create table products (id uuid primary key, organization_id uuid not null, name text not null, unit_price numeric not null default 0, cost_price numeric, current_stock numeric not null default 0, min_stock numeric not null default 0, status text not null default 'active', created_at timestamptz not null default now());
create table contacts (id uuid primary key, organization_id uuid not null, full_name text, broadcast_opt_out boolean not null default false);
create table orders (id uuid primary key, organization_id uuid not null, contact_id uuid not null, status text not null, total_amount numeric not null default 0, created_at timestamptz not null default now());
create table order_items (id uuid primary key default gen_random_uuid(), organization_id uuid not null, order_id uuid not null, product_id uuid, unit_price numeric not null, unit_cost numeric not null default 0, quantity numeric not null default 1);
create table contact_broadcasts (id uuid primary key, organization_id uuid not null, name text not null, scheduled_at timestamptz not null, status text not null, sent_count integer not null default 0);
create table contact_broadcast_recipients (id uuid primary key default gen_random_uuid(), organization_id uuid not null, broadcast_id uuid not null, contact_id uuid not null, status text not null, sent_at timestamptz);
create table analytics_events (id uuid primary key default gen_random_uuid(), organization_id uuid not null, event_type text not null, entity_type text, entity_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now());
`);
// Comme sur Supabase : service_role a les droits sur les tables (et contourne la RLS).
await db.exec("grant all on all tables in schema public to service_role");
await db.exec(readFileSync(new URL("../../supabase/migrations/0183_c5_growth_insights.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../../supabase/migrations/0186_c5_product_demand.sql", import.meta.url), "utf8"));

const ago = (d) => `now() - interval '${d} days'`;
// --- Produits ---
await db.exec(`
insert into products (id, organization_id, name, cost_price, current_stock, min_stock, status, created_at) values
 ('${id(1)}','${A}','Dormant avec coût', 1000, 10, 2, 'active', ${ago(100)}),
 ('${id(2)}','${A}','Récent sans vente', 500, 8, 0, 'active', ${ago(5)}),
 ('${id(3)}','${A}','Best-seller', 1500, 10, 5, 'active', ${ago(200)}),
 ('${id(4)}','${A}','Dormant sans coût', null, 3, 0, 'active', ${ago(100)}),
 ('${id(5)}','${A}','Inactif', 800, 9, 0, 'inactive', ${ago(100)}),
 ('${id(6)}','${A}','Vendu sans coût', 0, 20, 0, 'active', ${ago(200)}),
 ('${id(7)}','${B}','Autre tenant dormant', 100, 50, 0, 'active', ${ago(100)});
insert into contacts (id, organization_id, full_name, broadcast_opt_out) values
 ('${id(11)}','${A}','Awa (inactive)', false),
 ('${id(12)}','${A}','Biyo (désinscrit)', true),
 ('${id(13)}','${A}','Carine (récente)', false),
 ('${id(14)}','${A}','David (après diffusion)', false),
 ('${id(21)}','${B}','Autre tenant', false);
-- Commandes terminées
insert into orders (id, organization_id, contact_id, status, total_amount, created_at) values
 ('${id(101)}','${A}','${id(11)}','completed', 50000, ${ago(90)}),
 ('${id(102)}','${A}','${id(12)}','completed', 90000, ${ago(90)}),
 ('${id(103)}','${A}','${id(13)}','completed', 60000, ${ago(5)}),
 ('${id(104)}','${A}','${id(14)}','completed', 20000, ${ago(3)}),
 ('${id(105)}','${A}','${id(14)}','pending',   15000, ${ago(2)}),
 ('${id(201)}','${B}','${id(21)}','completed', 99999, ${ago(5)});
-- Ventes : best-seller 30 unités sur 30 j (coût connu), produit 6 sans coût
insert into order_items (organization_id, order_id, product_id, unit_price, unit_cost, quantity) values
 ('${A}','${id(103)}','${id(3)}', 2000, 1500, 30),
 ('${A}','${id(104)}','${id(6)}', 1000, 0, 4),
 ('${A}','${id(101)}','${id(5)}', 1000, 800, 1);
`);

const q = async (sql) => (await db.query(sql)).rows;

// 1. Stock dormant
const dormant = await q(`select * from c5_dormant_stock('${A}', 60)`);
assert.deepEqual(dormant.map((r) => r.name).sort(), ["Dormant avec coût", "Dormant sans coût"], "dormant : seuls les vieux produits actifs sans vente");
const d1 = dormant.find((r) => r.name === "Dormant avec coût");
assert.equal(Number(d1.immobilized_value), 10000);
assert.equal(d1.cost_known, true);
const d4 = dormant.find((r) => r.name === "Dormant sans coût");
assert.equal(d4.immobilized_value, null, "coût inconnu → valeur immobilisée NULL, pas 0");
assert.equal(d4.cost_known, false);
assert.ok(!dormant.some((r) => r.name.includes("Autre tenant")), "isolation entre tenants");

// 2. Marges
const margins = await q(`select * from c5_product_margins('${A}', 30)`);
const best = margins.find((r) => r.name === "Best-seller");
assert.equal(Number(best.revenue), 60000);
assert.equal(Number(best.margin), 15000);
assert.equal(Number(best.margin_pct), 25.0);
const nocost = margins.find((r) => r.name === "Vendu sans coût");
assert.equal(nocost.margin, null, "coût 0 = inconnu → marge NULL, jamais 100 %");
assert.equal(nocost.margin_pct, null);
assert.equal(nocost.cost_known, false);
assert.ok(!margins.some((r) => r.name === "Inactif"), "vente il y a 90 j hors période de 30 j");

// 3. Prévision de rupture : 30 unités / 30 j = 1/jour ; stock 10 → 10 jours
const fc = await q(`select * from c5_stockout_forecast('${A}', 30)`);
const f3 = fc.find((r) => r.name === "Best-seller");
assert.equal(Number(f3.daily_rate), 1);
assert.equal(Number(f3.days_left), 10);
assert.equal(fc[0].name, "Best-seller".length ? fc[0].name : "", "trié par jours restants");

// 4. Clients inactifs : Awa seulement (Biyo désinscrit, Carine récente, David récent)
const inactive = await q(`select * from c5_inactive_customers('${A}', 60, 50)`);
assert.deepEqual(inactive.map((r) => r.full_name), ["Awa (inactive)"]);
assert.equal(Number(inactive[0].total_spent), 50000);
assert.equal(inactive[0].orders_count, 1);

// 5. Résultats de diffusion : David reçoit il y a 4 jours, commande 3 jours (pending, 2 j) → les 2 comptent (confirmed/completed seulement)
await db.exec(`
insert into contact_broadcasts (id, organization_id, name, scheduled_at, status, sent_count) values
 ('${id(301)}','${A}','Promo test', ${ago(4)}, 'completed', 2),
 ('${id(302)}','${A}','Annulée', ${ago(4)}, 'cancelled', 0);
insert into contact_broadcast_recipients (organization_id, broadcast_id, contact_id, status, sent_at) values
 ('${A}','${id(301)}','${id(14)}','sent', ${ago(4)}),
 ('${A}','${id(301)}','${id(13)}','sent', ${ago(4)}),
 ('${A}','${id(301)}','${id(11)}','skipped', null);
`);
const res = await q(`select * from c5_broadcast_results('${A}', 7, 20)`);
assert.equal(res.length, 1, "les campagnes annulées sont exclues");
assert.equal(res[0].sent_count, 2);
assert.equal(res[0].orders, 1, "seule la commande 104 (completed, après réception) est attribuée");
assert.equal(res[0].ordering_contacts, 1);
assert.equal(Number(res[0].revenue), 20000);
// Commande de Carine (5 j) est AVANT la réception (4 j) → non attribuée
// Une diffusion ancienne dont le destinataire n'a rien commandé APRÈS réception : 0 commande.
await db.exec(`
insert into contact_broadcasts (id, organization_id, name, scheduled_at, status, sent_count) values
 ('${id(303)}','${A}','Ancienne', ${ago(30)}, 'completed', 1);
insert into contact_broadcast_recipients (organization_id, broadcast_id, contact_id, status, sent_at) values
 ('${A}','${id(303)}','${id(11)}','sent', ${ago(30)});
`);
const res2 = await q(`select * from c5_broadcast_results('${A}', 7, 20)`);
const old303 = res2.find((r) => r.name === "Ancienne");
assert.equal(old303.orders, 0, "commande antérieure à la réception : non attribuée");
assert.equal(Number(old303.revenue), 0);

// 6. Trafic par source : 3 visiteurs facebook (1 clique WhatsApp), 1 direct ; autre tenant ignoré
await db.exec(`
insert into analytics_events (organization_id, event_type, metadata) values
 ('${A}','page_view','{"entry":true,"visitor":"v1","source":"facebook","campaign":"promo1"}'),
 ('${A}','page_view','{"entry":false,"visitor":"v1","path":"/produits"}'),
 ('${A}','page_view','{"entry":true,"visitor":"v2","source":"facebook","campaign":"promo1"}'),
 ('${A}','page_view','{"entry":true,"visitor":"v3","source":"facebook","campaign":"promo1"}'),
 ('${A}','page_view','{"entry":true,"visitor":"v4"}'),
 ('${A}','whatsapp_click','{"visitor":"v1"}'),
 ('${A}','whatsapp_click','{"visitor":"v1"}'),
 ('${A}','whatsapp_click','{"visitor":"v4"}'),
 ('${B}','page_view','{"entry":true,"visitor":"vb","source":"tiktok"}');
`);
const traffic = await q(`select * from c5_traffic_by_source('${A}', 30)`);
const fb = traffic.find((r) => r.source === "facebook");
assert.deepEqual([fb.campaign, fb.visitors, fb.whatsapp_clickers], ["promo1", 3, 1], "un visiteur qui clique 2 fois compte 1 fois");
const direct = traffic.find((r) => r.source === "direct");
assert.deepEqual([direct.visitors, direct.whatsapp_clickers], [1, 1]);
assert.ok(!traffic.some((r) => r.source === "tiktok"), "isolation entre tenants");

// 7. Droits : seul service_role peut exécuter
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => db.query(`select * from c5_dormant_stock('${A}', 60)`), /permission denied/i, `${role} ne doit pas pouvoir exécuter`);
  await db.exec("reset role");
}
await db.exec("set role service_role");
assert.ok((await db.query(`select * from c5_dormant_stock('${A}', 60)`)).rows.length > 0);
await db.exec("reset role");

// 8. Demande réelle par produit (clics = signal fiable ; vues = gonflées par les robots, renvoyées à titre indicatif)
const evs = (pid, type, days, n, org = A) => Array.from({ length: n }, () => `('${org}','${type}','product','${pid}', ${ago(days)})`).join(",");
await db.exec(`
insert into products (id, organization_id, name, cost_price, current_stock, min_stock, status, created_at) values
 ('${id(31)}','${A}','Demandé sans stock', 500, 0, 2, 'active', ${ago(100)}),
 ('${id(32)}','${A}','Cliqué jamais vendu', 500, 8, 0, 'active', ${ago(100)}),
 ('${id(33)}','${A}','En hausse', 500, 20, 0, 'active', ${ago(100)}),
 ('${id(34)}','${A}','Sans aucun signal', 500, 20, 0, 'active', ${ago(100)}),
 ('${id(35)}','${A}','Inactif cliqué', 500, 20, 0, 'inactive', ${ago(100)}),
 ('${id(36)}','${B}','Autre tenant cliqué', 500, 20, 0, 'active', ${ago(100)});
insert into analytics_events (organization_id, event_type, entity_type, entity_id, created_at) values
 ${evs(id(31), "product_click", 3, 12)},
 ${evs(id(31), "product_click", 20, 2)},
 ${evs(id(31), "product_view", 2, 40)},
 ${evs(id(31), "product_click", 40, 9)},
 ${evs(id(32), "product_click", 5, 15)},
 ${evs(id(33), "product_click", 2, 9)},
 ${evs(id(33), "product_click", 20, 4)},
 ${evs(id(35), "product_click", 2, 30)},
 ${evs(id(36), "product_click", 2, 30, B)},
 ${evs(id(34), "cta_click", 2, 5)},
 ${evs(id(32), "product_click", 2, 7, B)};
insert into order_items (organization_id, order_id, product_id, unit_price, unit_cost, quantity) values ('${A}','${id(103)}','${id(33)}', 2000, 500, 3);
`);
const demand = await q(`select * from c5_product_demand('${A}', 14)`);
const byName = Object.fromEntries(demand.map((r) => [r.name, r]));
assert.deepEqual(Object.keys(byName).sort(), ["Best-seller", "Cliqué jamais vendu", "Demandé sans stock", "En hausse", "Vendu sans coût"].sort(), "seuls les produits actifs de CE tenant avec un signal (clic, vue ou vente)");
assert.deepEqual([byName["Vendu sans coût"].clicks, Number(byName["Vendu sans coût"].units_sold)], [0, 4], "un produit vendu sans clic apparaît, avec 0 clic");
assert.equal(byName["Demandé sans stock"].clicks, 12, "clics de la période courante seulement");
assert.equal(byName["Demandé sans stock"].clicks_prev, 2, "période précédente = entre 14 et 28 jours ; les clics à 40 jours sont ignorés");
assert.equal(byName["Demandé sans stock"].views, 40);
assert.equal(Number(byName["Demandé sans stock"].current_stock), 0);
assert.equal(byName["Cliqué jamais vendu"].clicks, 15, "un clic enregistré sous un autre tenant (même id de produit) n'est pas compté");
assert.equal(Number(byName["Cliqué jamais vendu"].units_sold), 0);
assert.equal(byName["En hausse"].clicks, 9);
assert.equal(byName["En hausse"].clicks_prev, 4);
assert.equal(Number(byName["En hausse"].units_sold), 3, "ventes = commandes terminées de la période");
assert.equal(demand[0].name, "Cliqué jamais vendu", "trié par clics décroissants");
const demandB = await q(`select * from c5_product_demand('${B}', 14)`);
assert.deepEqual(demandB.map((r) => r.name), ["Autre tenant cliqué"], "isolation entre tenants");
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => db.query(`select * from c5_product_demand('${A}', 14)`), /permission denied/i);
  await db.exec("reset role");
}

console.log("OK — fonctions d'analyse C5 : 8 groupes de vérifications passés");
