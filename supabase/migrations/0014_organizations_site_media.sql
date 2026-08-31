-- ============================================================
-- 0014_organizations_site_media.sql
-- Lot E, Partie 1 — écran "Mon site" (logo, bannière, favicon).
-- `logo_url` existe déjà depuis 0008_catalog_faq_business.sql ; il ne
-- manquait que la bannière et le favicon pour couvrir le scope du cahier.
-- ============================================================

alter table organizations
  add column banner_url text,
  add column favicon_url text;

comment on column organizations.banner_url is
  'Image bannière affichée en tête de la vitrine publique (section 12). '
  'Optionnelle — la vitrine reste fonctionnelle sans (cahier Lot E : '
  '"rien n''empêche un tenant minimal de fonctionner").';

comment on column organizations.favicon_url is
  'Favicon de la vitrine publique du tenant (onglet navigateur). Distinct '
  'du manifest PWA global de l''app dashboard (public/manifest.json), qui '
  'reste neutre et non personnalisable par tenant (cahier Lot E, Partie 3).';
