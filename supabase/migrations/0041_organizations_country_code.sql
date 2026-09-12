-- ============================================================
-- 0041_organizations_country_code.sql
-- Country Engine, partie 2 — rattache chaque organisation à un pays
-- (section 12). Migration en 3 temps (ajout nullable -> backfill ->
-- contrainte NOT NULL) pour rester sûre sur une table qui contient
-- déjà des lignes de production potentielles — jamais de NOT NULL
-- direct sur une colonne ajoutée à une table non vide.
--
-- IMPORTANT (section 41) : les organisations existantes sont
-- antérieures au Country Engine, donc implicitement camerounaises
-- (organizations.currency défaut 'XAF', timezone défaut
-- 'Africa/Douala' depuis 0001_core_tenancy.sql) — le backfill vers
-- 'CM' est donc une clarification du modèle, pas une supposition
-- risquée. Idempotent : la clause `where country_code is null`
-- protège une ré-exécution accidentelle (aucun effet si déjà appliquée).
-- ============================================================

alter table organizations
  add column country_code text references countries(iso_code);

update organizations
set country_code = 'CM'
where country_code is null;

alter table organizations
  alter column country_code set not null,
  alter column country_code set default 'CM';

comment on column organizations.country_code is
  'Pays de l''organisation (Country Engine, section 12) — détermine la '
  'devise par défaut (organizations.currency, colonne pré-existante '
  '0001_core_tenancy.sql), les prix de plan applicables '
  '(plan_prices.country_code) et les canaux de paiement disponibles au '
  'checkout (payment_channels.country_code). Valeur DÉRIVÉE du pays '
  'sélectionné à l''onboarding (onboarding-service.ts::createOrganization), '
  'jamais modifiable librement par un utilisateur sans passer par '
  'country-service.ts (section 12 : "Cameroon + Currency=GHS sans '
  'raison métier explicite" est interdit).';

create index idx_organizations_country_code on organizations(country_code);
