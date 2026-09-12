-- ============================================================
-- 0040_country_engine.sql
-- Country Engine — expansion multi-pays africaine (voir
-- docs/country-engine.md pour l'architecture complète).
--
-- RÈGLE ABSOLUE respectée : migration strictement ADDITIVE, aucune
-- migration existante (0001-0039) n'est modifiée. Le Cameroun reste le
-- seul marché ACTIF après cette migration — activer un nouveau pays est
-- désormais une opération de configuration Super Admin
-- (admin-countries-service.ts), jamais une migration.
--
-- Source de vérité (section 7 du master prompt) :
--   NotchPay (capacité technique) -> countries.notchpay_supported
--   Super Admin (décision commerciale) -> countries.launch_status
--   countries.notchpay_supported = true N'IMPLIQUE JAMAIS
--   countries.launch_status = 'active'.
-- ============================================================

-- ------------------------------------------------------------
-- countries — table centralisée, seule source de vérité pour la
-- disponibilité pays/devise/indicatif (section 5).
--
-- ÉCART DOCUMENTÉ vs le cahier : le cahier liste séparément
-- `sme_os_enabled`, `launch_status` et `is_active` (section 5/6). Trois
-- booléens/statuts qui se recouvrent partiellement auraient créé un
-- risque réel de désynchronisation (ex: sme_os_enabled=true mais
-- launch_status='disabled'). `launch_status` seul (disabled |
-- coming_soon | waitlist | active) est l'unique source de vérité
-- commerciale — `isCountryActive()`/`isSmeOsEnabled()` dans
-- country-service.ts sont dérivés de cette seule colonne, jamais
-- stockés en double. Cohérent avec la philosophie déjà présente dans
-- ce projet (ex: organization_subscriptions comme SEULE source de
-- vérité d'abonnement, jamais organizations.plan/status en parallèle).
-- ------------------------------------------------------------
create table countries (
  id uuid primary key default gen_random_uuid(),
  iso_code text not null unique,              -- ISO 3166-1 alpha-2, ex: 'CM' — clé fonctionnelle référencée ailleurs
  name text not null,                         -- nom d'affichage commercial (français), ex: 'Cameroun'
  native_name text,                           -- nom local optionnel
  currency_code text not null,                -- ISO 4217, ex: 'XAF' — voir currency-service.ts pour les métadonnées (symbole, décimales)
  currency_name text,
  currency_symbol text,
  phone_code text not null,                   -- ex: '+237'
  flag_url text,                               -- URL du drapeau fournie par NotchPay (GET /resources/countries) — jamais un emoji stocké : calculé à l'affichage si absent (voir country-service.ts::isoCodeToFlagEmoji)
  notchpay_supported boolean not null default false,  -- capacité TECHNIQUE (dernière sync NotchPay), jamais modifiée manuellement
  launch_status text not null default 'disabled'
    check (launch_status in ('disabled', 'coming_soon', 'waitlist', 'active')),
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb, -- ex: channels bruts NotchPay, notes Super Admin
  last_synced_at timestamptz,                  -- dernière fois que la sync NotchPay a touché cette ligne (jamais mis à jour par une action Super Admin de statut commercial)
  activated_at timestamptz,                    -- horodatage du dernier passage à 'active' (section 51, utile pour l'audit/analytics section 66)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint countries_iso_code_format check (iso_code ~ '^[A-Z]{2}$'),
  constraint countries_currency_code_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint countries_phone_code_format check (phone_code ~ '^\+[0-9]{1,4}$')
);

create trigger trg_countries_updated_at
  before update on countries
  for each row execute function set_updated_at();

create index idx_countries_launch_status on countries(launch_status);
create index idx_countries_display_order on countries(display_order);

comment on table countries is
  'Country Engine — table de référence plateforme (pas de organization_id, '
  'jamais scopée par tenant). Synchronisée depuis NotchPay '
  '(notchpay-resources-service.ts) mais la décision commerciale '
  '(launch_status) reste EXCLUSIVEMENT entre les mains du Super Admin '
  '(admin-countries-service.ts) — une synchronisation NotchPay ne '
  'modifie jamais launch_status, uniquement notchpay_supported/'
  'currency_code/phone_code/flag_url/metadata/last_synced_at.';

comment on column countries.launch_status is
  'Unique source de vérité commerciale (voir ÉCART DOCUMENTÉ en tête de '
  'fichier) : disabled (invisible, inscription impossible) | coming_soon '
  '(visible sur la landing, inscription impossible, section 22) | '
  'waitlist (formulaire de liste d''attente uniquement, section 54) | '
  'active (inscription normale, section 13).';

-- ------------------------------------------------------------
-- payment_channels — canaux de paiement synchronisés depuis NotchPay
-- (GET /resources/channels, confirmé via developer.notchpay.co le
-- 06/09/2026 : `{id, name, country, currency, type, logo, minimum,
-- maximum}` — champs `minimum`/`maximum` conservés dans `metadata`,
-- non dupliqués en colonnes dédiées, section 49 : ne pas sur-engineer).
-- ------------------------------------------------------------
create table payment_channels (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references countries(iso_code) on delete cascade,
  provider text not null default 'notchpay',
  channel_code text not null,                 -- identifiant NotchPay, ex: 'cm.mtn'
  channel_name text not null,
  type text,                                  -- 'mobile_money' | 'bank' | 'ussd' | 'qr' | 'wallet' (texte libre, catalogue NotchPay évolutif — section 60 : pas d'enum fermé pour une valeur fournie par un tiers)
  currency_code text not null,
  is_available boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (provider, channel_code)
);

create trigger trg_payment_channels_updated_at
  before update on payment_channels
  for each row execute function set_updated_at();

create index idx_payment_channels_country on payment_channels(country_code);

comment on table payment_channels is
  'Canaux de paiement par pays, synchronisés depuis NotchPay (section 11). '
  'NE JAMAIS supposer que MTN/Orange sont les seuls moyens de paiement '
  '(section 11) : cette table est la SEULE source pour peupler un '
  'sélecteur de canal, jamais une liste en dur.';

-- ------------------------------------------------------------
-- plan_prices — prix par (plan, pays), indépendants entre marchés
-- (section 17). Le prix par défaut d'un plan (plans.price_fcfa, en
-- XAF, existant depuis 0012) reste le REPLI utilisé quand aucune ligne
-- country-specific n'existe pour un pays donné — voir
-- plans-repository.ts::resolvePlanPriceForCountry. C'est ce qui
-- garantit que le Cameroun continue de fonctionner EXACTEMENT comme
-- avant même sans seed explicite (bien qu'on seed quand même CM
-- ci-dessous, par souci d'exhaustivité et de cohérence avec le
-- Super Admin /admin/countries qui doit pouvoir l'afficher/l'éditer).
-- ------------------------------------------------------------
create table plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null references plans(key) on delete cascade,
  country_code text not null references countries(iso_code) on delete cascade,
  currency_code text not null,                -- snapshot au moment de la config — DOIT correspondre à countries.currency_code pour ce pays ; invariant vérifié côté application (admin-countries-service.ts), pas en contrainte SQL (une check constraint ne peut pas référencer une autre table)
  amount integer not null check (amount >= 0), -- plus petite unité de la devise (voir currency-service.ts) — jamais un flottant
  billing_interval text not null default 'monthly'
    check (billing_interval in ('monthly')), -- restreint à 'monthly' : seule cadence réellement supportée aujourd'hui (voir docs/PAYMENT_INTEGRATION.md — pas de prélèvement récurrent réel côté NotchPay). Colonne conservée pour extensibilité future (section 17) sans sur-engineer un moteur multi-cadence qui n'existe pas encore.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_plan_prices_updated_at
  before update on plan_prices
  for each row execute function set_updated_at();

-- Section 38 : empêche deux prix ACTIFS identiques pour un même
-- (plan, pays, cadence) — un index unique partiel plutôt qu'une
-- contrainte unique classique, pour autoriser un historique de prix
-- désactivés (is_active = false) sans violer l'unicité.
create unique index uq_plan_prices_active
  on plan_prices(plan_key, country_code, billing_interval)
  where is_active;

create index idx_plan_prices_country on plan_prices(country_code);

comment on table plan_prices is
  'Prix par (plan, pays) — section 17. Une organisation paie le prix de '
  'SON pays, jamais une conversion forex automatique depuis le prix '
  'camerounais (interdit explicitement par le cahier). Repli : en '
  'l''absence de ligne active pour un (plan, pays), '
  'plans-repository.ts::resolvePlanPriceForCountry retombe sur '
  'plans.price_fcfa + la devise du pays (comportement historique '
  'préservé pour tout pays non encore configuré par le Super Admin).';

-- ------------------------------------------------------------
-- country_waitlist — liste d'attente pour les pays en statut
-- 'waitlist' (section 54). Volontairement minimal (pas de mini-CRM).
-- Accès EXCLUSIVEMENT service-role (comme phone_numbers,
-- platform_admins) : la soumission passe toujours par une Server
-- Action qui applique le rate limiting (checkRateLimit) et la
-- validation AVANT l'insert — jamais d'insert direct anon-key
-- côté client, ce qui éviterait le rate limiting.
-- ------------------------------------------------------------
create table country_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  country_code text not null references countries(iso_code) on delete cascade,
  company_name text,
  created_at timestamptz not null default now(),

  unique (email, country_code)
);

create index idx_country_waitlist_country on country_waitlist(country_code);

comment on table country_waitlist is
  'Liste d''attente pré-lancement (section 54). RLS activée, AUCUNE '
  'policy pour les rôles clients (accès service-role uniquement, même '
  'posture que phone_numbers/platform_admins) — la soumission passe '
  'toujours par une Server Action rate-limitée, jamais un insert anon-key '
  'direct depuis le navigateur.';

-- ------------------------------------------------------------
-- notchpay_sync_runs — historique des synchronisations (section 9/10).
-- Permet d'afficher "Dernière synchronisation : ... / Statut : ✓" au
-- Super Admin même quand NotchPay est temporairement indisponible : le
-- DERNIER succès reste consultable indépendamment des échecs suivants.
-- ------------------------------------------------------------
create table notchpay_sync_runs (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('countries', 'channels')),
  resource_scope text,                        -- code pays pour 'channels' (sync ciblée), null pour une sync globale
  status text not null check (status in ('success', 'failed')),
  items_synced integer,
  error_message text,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_notchpay_sync_runs_resource on notchpay_sync_runs(resource_type, finished_at desc);

comment on table notchpay_sync_runs is
  'Historique des synchronisations NotchPay (section 9/10) — jamais '
  'purgée automatiquement dans ce lot (volume faible : quelques lignes '
  'par jour). RLS activée, accès service-role uniquement.';

-- ------------------------------------------------------------
-- Seed : Cameroun, seul marché actif au moment de cette migration
-- (section 41 : les organisations existantes sont camerounaises).
-- notchpay_supported=true car confirmé fonctionnel de longue date dans
-- ce projet (docs/PAYMENT_INTEGRATION.md, canaux cm.mtn/cm.orange).
-- ------------------------------------------------------------
insert into countries (
  iso_code, name, native_name, currency_code, currency_name, currency_symbol,
  phone_code, notchpay_supported, launch_status, display_order, activated_at
) values (
  'CM', 'Cameroun', 'Cameroun', 'XAF', 'Franc CFA (CEMAC)', 'FCFA',
  '+237', true, 'active', 0, now()
);

insert into payment_channels (country_code, provider, channel_code, channel_name, type, currency_code, is_available)
values
  ('CM', 'notchpay', 'cm.mtn', 'MTN Mobile Money', 'mobile_money', 'XAF', true),
  ('CM', 'notchpay', 'cm.orange', 'Orange Money', 'mobile_money', 'XAF', true);

-- Prix Cameroun = valeurs EXACTES de plans.price_fcfa au moment de cette
-- migration (seedées en 0012_plans_entitlements.sql) — garantit qu'un
-- paiement camerounais résout au MÊME montant qu'avant le Country
-- Engine, que la résolution passe par plan_prices ou par le repli
-- plans.price_fcfa (les deux chemins donnent 0/15000/35000 XAF).
insert into plan_prices (plan_key, country_code, currency_code, amount, billing_interval, is_active)
select key, 'CM', 'XAF', price_fcfa, 'monthly', true
from plans
where key in ('starter', 'business', 'pro');

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table countries enable row level security;
alter table payment_channels enable row level security;
alter table plan_prices enable row level security;
alter table country_waitlist enable row level security;
alter table notchpay_sync_runs enable row level security;

-- countries/payment_channels/plan_prices : catalogues plateforme
-- publics en LECTURE (nécessaires avant même la création d'un compte —
-- landing publique section 22, sélecteur pays de l'onboarding section
-- 13) — même posture que `plans`/`plan_entitlements` (0012) et
-- `addons`/`domain_tld_pricing` (0020/0021). Écriture réservée
-- service-role (Super Admin, admin-countries-service.ts /
-- notchpay-resources-service.ts). Ne JAMAIS faire confiance au
-- frontend pour ces mutations (section 62).
create policy "public can read countries catalogue"
  on countries for select
  using (true);

create policy "public can read payment channels catalogue"
  on payment_channels for select
  using (true);

create policy "public can read plan prices catalogue"
  on plan_prices for select
  using (true);

-- country_waitlist / notchpay_sync_runs : aucune policy pour les rôles
-- clients (RLS activée = refusé par défaut, accès service-role
-- uniquement) — voir commentaires des tables ci-dessus.
