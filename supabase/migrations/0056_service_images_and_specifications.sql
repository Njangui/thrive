-- ============================================================
-- 0055_service_images_and_specifications.sql
-- Catalogue riche (chantier « catalogue V2 », sept. 2026) — deux écarts
-- identifiés par audit du code réel (pas seulement du schéma) :
--
-- 1. Les PRODUITS ont une galerie multi-photos complète depuis
--    0008_catalog_faq_business.sql (`product_images`) et un écran
--    d'édition qui la gère (ajout/suppression/réordonnancement/photo
--    principale). Les SERVICES n'ont RIEN de tout ça : ni table, ni
--    champ, ni bouton. `src/app/(site)/services/[slug]/page.tsx`
--    n'affiche donc aujourd'hui aucune photo pour une prestation — un
--    salon de coiffure ou un cabinet de conseil ne peut illustrer aucune
--    de ses prestations, alors qu'un commerçant retail le peut pour
--    chaque produit. `service_images` comble cet écart à l'identique
--    (même colonnes, même politique de position) plutôt que de fusionner
--    les deux tables : `products`/`services` restent deux entités
--    distinctes dans tout le reste du code (voir service-service.ts,
--    en-tête), une table de médias commune romprait cette convention
--    pour un bénéfice nul.
--
-- 2. Ni l'un ni l'autre n'a de zone « informations complémentaires »
--    libre (matière, garantie, zone desservie, durée de validité...).
--    `specifications` est volontairement un JSONB — même famille que
--    `organization_landing_config.highlights`/`payment_methods`
--    (0054_storefront_v2.sql) : une LISTE ORDONNÉE de paires
--    libellé/valeur choisies par le commerçant, jamais des colonnes
--    figées qui supposeraient un secteur particulier (une "matière"
--    n'a aucun sens pour une prestation de conseil, une "zone desservie"
--    n'en a aucun pour un t-shirt).
-- ============================================================

-- ------------------------------------------------------------
-- service_images — même structure, même politique de position que
-- product_images : position 0 = photo principale (site public,
-- WhatsApp, publications), contigu après toute suppression (voir
-- renumberServiceImages, service-service.ts).
-- ------------------------------------------------------------
create table service_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  url text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_service_images_service on service_images(service_id, position);

alter table service_images enable row level security;

create policy "members can access service_images of their org" on service_images for all
  using (is_member_of_org(organization_id));

-- ------------------------------------------------------------
-- specifications — "informations complémentaires" éditables depuis la
-- fiche produit/service, affichées en tableau libellé/valeur sur la
-- page publique correspondante. NULL et [] sont deux états distincts :
-- NULL = jamais configuré (bloc masqué), [] = configuré puis vidé
-- explicitement (bloc masqué aussi, mais l'historique diffère si on a
-- un jour besoin de le distinguer — même principe que
-- organization_landing_config.highlights, voir 0054).
-- ------------------------------------------------------------
alter table products add column if not exists specifications jsonb;
alter table services add column if not exists specifications jsonb;

comment on column products.specifications is
  'Informations complémentaires libres (ex: [{"label":"Matière","value":"Coton"}]) '
  'affichées en tableau sur la fiche produit publique, section '
  '"Informations complémentaires". NULL = aucune configurée, jamais '
  'inventé automatiquement. Validé côté application par '
  'CatalogSpecificationsSchema (domain/entities/catalog.ts), max 12 lignes.';

comment on column services.specifications is
  'Même principe que products.specifications — voir ce commentaire. '
  'Ex: [{"label":"Zone desservie","value":"Yaoundé et environs"}].';
