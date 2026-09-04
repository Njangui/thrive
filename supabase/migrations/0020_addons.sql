-- ============================================================
-- 0020_addons.sql
-- Lot G, Partie 2 — Add-ons (compléments payants aux plans) +
-- réglage plateforme "durée d'essai" (platform_settings, minimal,
-- réutilisable par de futurs réglages globaux).
-- ============================================================

create table addons (
  key text primary key,
  name text not null,
  description text,
  price_fcfa integer not null check (price_fcfa >= 0),
  -- Clé fonctionnelle à laquelle cet add-on ajoute de la capacité —
  -- même vocabulaire que plan_entitlements.entitlement_key
  -- (0012_plans_entitlements.sql), volontairement non contraint par FK
  -- car plan_entitlements n'a pas de table de clés canonique séparée
  -- (juste une colonne text) — voir entitlements-service.ts pour la
  -- liste des clés réellement branchées.
  entitlement_key text not null,
  increment_value integer not null check (increment_value > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_addons_updated_at
  before update on addons
  for each row execute function set_updated_at();

comment on table addons is
  'Catalogue plateforme (pas de organization_id — un add-on est une SKU '
  'globale, gérée par le Super Admin, section 45/Lot C). "active=false" '
  'retire l''add-on de la vente sans affecter les achats déjà faits '
  '(organization_addons n''a pas de FK ON DELETE — jamais de suppression '
  'dure d''un add-on déjà vendu, seulement une désactivation).';

create table organization_addons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  addon_key text not null references addons(key),
  quantity integer not null default 0 check (quantity >= 0),
  purchased_at timestamptz not null default now(),
  subscription_payment_id uuid references subscription_payments(id),
  updated_at timestamptz not null default now(),
  unique (organization_id, addon_key)
);

create trigger trg_organization_addons_updated_at
  before update on organization_addons
  for each row execute function set_updated_at();

create index idx_organization_addons_org on organization_addons(organization_id);

comment on column organization_addons.quantity is
  'Quantité cumulée de cet add-on pour cette organisation (une ligne par '
  'couple org/add-on, incrémentée à chaque achat confirmé — pas une ligne '
  'par achat). `subscription_payment_id` référence alors le DERNIER '
  'paiement ayant fait évoluer cette ligne, à titre de traçabilité — '
  'l''historique complet des paiements reste dans subscription_payments '
  '(payment_type=''addon''), pas ici. '
  'HYPOTHÈSE ASSUMÉE (voir RAPPORT_LOT_G.md) : `increment_value` de '
  '`addons` n''est PAS snapshoté ici. Si le Super Admin modifie '
  'increment_value après coup, la capacité déjà accordée via '
  'entitlements-service.ts est recalculée avec la NOUVELLE valeur — '
  'cohérent avec le choix "ne pas sur-engineer pour V1" du projet, mais à '
  'corriger si des add-ons à prix/incrément variable dans le temps sont '
  'introduits.';

-- FK différée : `subscription_payments.addon_key` référence cette table,
-- qui n'existait pas encore en 0019 (voir commentaire de tête de ce
-- fichier dans 0019_subscription_payments.sql). Même pattern que l'ALTER
-- différé de provider_connections en 0010_marketing_social_publishing.sql.
alter table subscription_payments
  add constraint subscription_payments_addon_key_fkey
  foreign key (addon_key) references addons(key);

-- ------------------------------------------------------------
-- Réglages plateforme génériques (clé/valeur), pour éviter une table
-- dédiée par réglage. Premier usage : durée d'essai par défaut,
-- consommée par plans-repository.ts::createTrialSubscription() (Lot B,
-- modifié par ce lot — voir RAPPORT_LOT_G.md).
-- ------------------------------------------------------------
create table platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger trg_platform_settings_updated_at
  before update on platform_settings
  for each row execute function set_updated_at();

comment on table platform_settings is
  'Réglages globaux plateforme, jamais scopés par organization_id — table '
  'interne (RLS activé, aucune policy pour les rôles clients : accès '
  'service-role uniquement, même posture que platform_admins).';

insert into platform_settings (key, value) values ('trial_days', '14'::jsonb);

alter table addons enable row level security;
alter table organization_addons enable row level security;
alter table platform_settings enable row level security;

-- addons : catalogue public en LECTURE pour tout utilisateur authentifié
-- membre d'AU MOINS une organisation (pas de organization_id à filtrer
-- ici — c'est un catalogue plateforme). Écriture réservée service-role
-- (Super Admin, admin-addons-service.ts).
create policy "authenticated users can read active addons catalogue"
  on addons for select
  to authenticated
  using (active = true);

create policy "members can read organization_addons of their org"
  on organization_addons for select
  using (is_member_of_org(organization_id));

-- platform_settings : aucune policy pour les rôles clients (accès
-- service-role uniquement, RLS activé = refusé par défaut).
