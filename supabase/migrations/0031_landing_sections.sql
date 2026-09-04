-- ============================================================
-- 0031_landing_sections.sql
-- Lot K — Landing page configurable par section et par secteur (master
-- prompt sections 15-18). Deux tables :
--  - organization_landing_config : quelles sections sont activées, dans
--    quel ordre, + personnalisation couleurs/police.
--  - testimonials : donnée manquante identifiée par le cahier Lot K
--    (aucune table de témoignages n'existait avant ce lot).
-- ============================================================

-- ------------------------------------------------------------
-- organization_landing_config
-- Une ligne par organisation, créée seulement quand le commerçant modifie
-- sa configuration pour la première fois (voir
-- application/services/landing-config-service.ts::getLandingConfig — tant
-- qu'aucune ligne n'existe, le preset du secteur est calculé à la volée,
-- jamais persisté d'office). Clé primaire = organization_id (pas de uuid
-- dédié : au plus une ligne par organisation, même logique que
-- organization_subscriptions, 0012_plans_entitlements.sql).
-- ------------------------------------------------------------
create table organization_landing_config (
  organization_id uuid primary key references organizations(id) on delete cascade,
  -- Tableau de { type, enabled, order, config? } — voir
  -- domain/entities/landing.ts::LandingSectionSchema pour la forme
  -- validée côté application. Pas de contrainte jsonb schema au niveau
  -- SQL (comme sections/opening_hours/social_links ailleurs dans ce
  -- projet) : la validation vit dans landing-config-service.ts, pas ici.
  sections jsonb not null default '[]'::jsonb,
  brand_color_primary text,
  brand_color_secondary text,
  font_choice text check (font_choice in ('modern', 'classic', 'friendly')),
  updated_at timestamptz not null default now()
);

create trigger trg_organization_landing_config_updated_at
  before update on organization_landing_config
  for each row execute function set_updated_at();

comment on table organization_landing_config is
  'Lot K — sections activées/désactivées/réordonnées de la vitrine '
  'publique (master prompt section 15-16), + personnalisation couleurs/'
  'police (section 13). Absence de ligne = le commerçant n''a jamais '
  'personnalisé sa page : le preset par défaut de son secteur '
  '(application/config/landing-presets.ts) s''applique, calculé à la '
  'volée par getLandingConfig(), jamais écrit ici tant qu''aucune '
  'modification explicite n''a eu lieu.';

comment on column organization_landing_config.sections is
  'Tableau ordonné de sections : [{ "type": "hero", "enabled": true, '
  '"order": 0 }, ...]. "footer" n''apparaît JAMAIS ici — toujours rendu, '
  'non désactivable (cohérence de marque, cahier Lot K).';

comment on column organization_landing_config.brand_color_primary is
  'Couleur hex (#rrggbb, contrôlée par un <input type="color">) injectée '
  'en variable CSS --brand-primary (voir tailwind.config.ts et '
  'src/lib/tenant-branding.ts). NULL = repli sur la valeur par défaut de '
  'la plateforme définie dans tailwind.config.ts.';

comment on column organization_landing_config.font_choice is
  'Un des 3 choix prédéfinis (src/app/fonts.ts) — jamais une police '
  'arbitraire (pas de chargement dynamique de police non vérifiée). '
  'NULL = "modern" par défaut, qui reprend exactement la police globale '
  'actuelle de la plateforme (Space Grotesk / Inter).';

-- ------------------------------------------------------------
-- testimonials — donnée manquante identifiée par le cahier Lot K.
-- Gérée depuis /dashboard/site (section "Sections de ma page").
-- ------------------------------------------------------------
create table testimonials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  author_name text not null,
  content text not null,
  -- Note optionnelle : un témoignage recopié depuis WhatsApp/Google n'a
  -- pas toujours de note chiffrée associée.
  rating smallint check (rating is null or (rating between 1 and 5)),
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_testimonials_org_order on testimonials(organization_id, display_order);

comment on table testimonials is
  'Lot K — témoignages clients affichés par la section "testimonials" de '
  'la landing page. Saisie manuelle par le commerçant (pas de connecteur '
  'd''avis Google/Facebook en V1 — hors scope, non demandé par le '
  'cahier).';

-- ------------------------------------------------------------
-- RLS — même pattern que les tables récentes du projet (0023, 0026) :
-- la policy ne vérifie que l'appartenance au tenant (is_member_of_org).
-- La restriction fine par rôle (owner/admin/manager en écriture) est la
-- seconde barrière, appliquée en application layer via
-- requireMembership() dans les Server Actions de /dashboard/site — pas
-- dupliquée ici en SQL, cohérent avec categories/services/faqs/
-- social_comments (pas avec l'ancien pattern owner/admin de
-- 0002_rls_policies.sql, qui ne s'applique plus aux tables ajoutées après
-- Lot H, voir docs/DATABASE.md).
-- ------------------------------------------------------------
alter table organization_landing_config enable row level security;
alter table testimonials enable row level security;

create policy "members can access organization_landing_config of their org"
  on organization_landing_config for all
  using (is_member_of_org(organization_id));

create policy "members can access testimonials of their org"
  on testimonials for all
  using (is_member_of_org(organization_id));
