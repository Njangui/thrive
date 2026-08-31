-- ============================================================
-- 0022_seo_fields.sql
-- Lot H, Partie 1 — SEO (master prompt section 18). Extension de colonnes
-- sur des tables existantes, pas de nouvelle table : `organizations` porte
-- déjà tout le branding via logo_url/banner_url/favicon_url (Lot E,
-- 0008/0014), les champs SEO suivent le même principe.
-- ============================================================

alter table organizations
  add column seo_title text,
  add column seo_description text,
  add column seo_og_image_url text;

alter table products
  add column seo_title text,
  add column seo_description text;

comment on column organizations.seo_title is
  'Titre affiché dans les résultats Google et l''onglet du navigateur pour '
  'la vitrine publique (section 18). Optionnel — repli sur le nom de '
  'l''entreprise si non renseigné (voir src/lib/seo.ts::resolveOrganizationSeo — '
  'jamais de balise vide, critère d''acceptation Lot H).';

comment on column organizations.seo_description is
  'Meta description de la vitrine publique. Optionnel — repli sur '
  'organizations.description (texte business existant, section 8) si non '
  'renseigné.';

comment on column organizations.seo_og_image_url is
  'Image Open Graph par défaut (partage réseaux sociaux) pour la landing et '
  'les pages qui n''ont pas leur propre image. Distincte de logo_url/'
  'banner_url (Lot E) : pensée pour le format attendu par les cartes de '
  'partage (1200x630 recommandé côté commerçant), pas imposé en base.';

comment on column products.seo_title is
  'Repli sur "{name} — {organizations.seo_title ou nom}" si non renseigné '
  '(voir src/lib/seo.ts::resolveProductSeo).';

comment on column products.seo_description is
  'Repli sur products.description, puis sur la description SEO/business de '
  'l''entreprise, si non renseigné.';
