-- ============================================================
-- 0012_plans_entitlements.sql
-- Lot B — Plans, Entitlements & Feature Gating (sections 34-36, 62-63, 78
-- du master prompt produit).
--
-- ⚠️ CHIFFRES PLACEHOLDER — voir rapport de livraison Lot B.
-- Le cahier des charges demande de reprendre "les limites exactes du
-- master prompt, section 34" et les prix des plans. Ce document ("doc 2"
-- / master prompt produit) n'a PAS été fourni avec ce lot (seuls
-- 00_CONVENTIONS_COMMUNES.md, 02_LOT_B_plans_entitlements.md et le code
-- source ont été transmis — vérifié : docs/GAP_ANALYSIS.md du projet en
-- parle mais ne le contient pas). Les valeurs ci-dessous sont donc des
-- valeurs d'illustration raisonnables, PAS les chiffres officiels.
-- Elles sont regroupées dans le seul bloc `insert` en bas de fichier pour
-- qu'un remplacement par les vrais chiffres soit un diff d'une seule
-- section, sans toucher au schéma ni au code applicatif.
-- ============================================================

create table plans (
  key text primary key check (key in ('starter', 'business', 'pro')),
  name text not null,
  price_fcfa integer not null default 0 check (price_fcfa >= 0),
  description text,
  created_at timestamptz not null default now()
);

create table plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null references plans(key) on delete cascade,
  -- Volontairement `text` libre (pas un enum fermé) : section 32 doc 2,
  -- même logique que organizations.industry — un nouveau lot ne doit pas
  -- avoir besoin d'une migration ALTER TYPE pour ajouter une clé
  -- d'entitlement (ex: un futur module).
  entitlement_key text not null,
  -- -1 = illimité. Sémantique à deux natures selon la clé (voir
  -- entitlements-service.ts) : cumulative (ex: whatsapp_groups) ou
  -- "par action"/booléenne (ex: broadcast_contacts, linkedin — 0/1 dans
  -- ce dernier cas).
  limit_value integer not null,
  unique (plan_key, entitlement_key)
);

create index idx_plan_entitlements_plan on plan_entitlements(plan_key);

comment on table plan_entitlements is
  'Lot B : source de vérité unique des limites par plan. Ne JAMAIS coder '
  'un "if plan === ...'' dispersé ailleurs dans le code — tout passe par '
  'canUseFeature() (application/services/entitlements-service.ts).';

create table organization_subscriptions (
  organization_id uuid primary key references organizations(id) on delete cascade,
  plan_key text not null default 'starter' references plans(key),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'cancelled')),
  trial_start timestamptz,
  trial_end timestamptz,
  -- Hors scope Lot B (section 35 : "préparer la structure pour les
  -- paiements... ne pas implémenter le paiement des commandes clients") —
  -- champ posé pour un futur branchement CinetPay/NotchPay, jamais
  -- renseigné par ce lot en dehors de trial_end.
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_organization_subscriptions_updated_at
  before update on organization_subscriptions
  for each row execute function set_updated_at();

comment on table organization_subscriptions is
  'Lot B : abonnement effectif d''un tenant. organizations.status/plan/'
  'trial_start/trial_end (0001_core_tenancy.sql) restent en place mais ne '
  'sont plus la source de vérité pour le gating — cette table l''est. '
  'Un tenant sans ligne ici est traité comme plan "starter" par '
  'entitlements-service.ts, jamais comme une erreur (critère '
  'd''acceptation Lot B).';

alter table plans enable row level security;
alter table plan_entitlements enable row level security;
alter table organization_subscriptions enable row level security;

-- plans/plan_entitlements = données de référence non sensibles (grille
-- tarifaire), lisibles publiquement — nécessaire pour afficher une
-- comparaison de plans même avant qu'un compte existe. Aucune policy
-- INSERT/UPDATE/DELETE : la gestion des plans se fait en service_role
-- (Lot C / Super Admin, cf. cahier Lot B "Hors scope").
create policy "anyone can read plans" on plans for select using (true);
create policy "anyone can read plan_entitlements" on plan_entitlements for select using (true);

create policy "members can read their subscription"
  on organization_subscriptions for select
  using (is_member_of_org(organization_id));

-- ------------------------------------------------------------
-- Seed — PLACEHOLDER, voir avertissement en tête de fichier.
-- Clés d'entitlement définies par le cahier Lot B :
--   whatsapp_groups, broadcast_contacts, ai_credits, social_accounts,
--   facebook_messenger, instagram_messages (booléens), linkedin, tiktok
--   (booléens, Pro uniquement).
-- ------------------------------------------------------------

insert into plans (key, name, price_fcfa, description) values
  ('starter', 'Starter', 0, 'Pour démarrer et tester WhatsApp + IA sans engagement.'),
  ('business', 'Business', 15000, 'Pour un commerce actif qui automatise ses ventes au quotidien.'),
  ('pro', 'Pro', 35000, 'Pour une équipe qui gère plusieurs canaux et un volume important.')
on conflict (key) do nothing;

insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  -- Starter
  ('starter', 'whatsapp_groups',    3),
  ('starter', 'broadcast_contacts', 50),
  ('starter', 'ai_credits',         150),
  ('starter', 'social_accounts',    1),
  ('starter', 'facebook_messenger', 0),
  ('starter', 'instagram_messages', 0),
  ('starter', 'linkedin',           0),
  ('starter', 'tiktok',             0),
  -- Business
  ('business', 'whatsapp_groups',    10),
  ('business', 'broadcast_contacts', 100),
  ('business', 'ai_credits',         500),
  ('business', 'social_accounts',    3),
  ('business', 'facebook_messenger', 1),
  ('business', 'instagram_messages', 1),
  ('business', 'linkedin',           0),
  ('business', 'tiktok',             0),
  -- Pro
  ('pro', 'whatsapp_groups',    -1), -- illimité, démontre le code path -1
  ('pro', 'broadcast_contacts', 200),
  ('pro', 'ai_credits',         1500),
  ('pro', 'social_accounts',    6),
  ('pro', 'facebook_messenger', 1),
  ('pro', 'instagram_messages', 1),
  ('pro', 'linkedin',           1),
  ('pro', 'tiktok',             1)
on conflict (plan_key, entitlement_key) do nothing;
