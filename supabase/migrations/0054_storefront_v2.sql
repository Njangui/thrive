-- ============================================================
-- 0054_storefront_v2.sql
-- Chantier « vitrine V2 » (sept. 2026) — la vitrine publique d'un tenant
-- passe d'une pile de sections empilées dans une colonne à une véritable
-- boutique en ligne : barre d'annonce, en-tête avec navigation, hero
-- composé, bande de confiance, vignettes de catégories illustrées,
-- cartes produit avec badges et prix barré, pied de page complet.
--
-- Tout ce qui est ajouté ici est OPTIONNEL et NULLABLE : une organisation
-- qui n'a jamais ouvert /dashboard/site continue de rendre exactement
-- comme avant l'application de cette migration, aux défauts de secteur
-- près (calculés à la volée, jamais écrits — même principe que
-- `organization_landing_config.sections`, voir 0031).
-- ============================================================

-- ------------------------------------------------------------
-- organization_landing_config — personnalisation de la vitrine
-- ------------------------------------------------------------
alter table organization_landing_config
  add column if not exists announcement text,
  add column if not exists announcement_enabled boolean not null default true,
  add column if not exists hero_layout text check (hero_layout in ('split', 'centered', 'banner')),
  add column if not exists hero_media_url text,
  add column if not exists highlights jsonb,
  add column if not exists secondary_cta_label text,
  add column if not exists secondary_cta_url text,
  add column if not exists payment_methods jsonb,
  add column if not exists show_stats boolean not null default true;

comment on column organization_landing_config.announcement is
  'Texte de la barre d''annonce fine affichée tout en haut de la vitrine '
  '(ex : « Livraison offerte à Yaoundé dès 15 000 FCFA d''achat »). NULL '
  'ou vide = aucune barre rendue. Jamais de valeur par défaut inventée : '
  'une promesse commerciale n''engage que le commerçant qui l''écrit.';

comment on column organization_landing_config.hero_layout is
  'Composition de l''en-tête : "split" (texte + visuel côte à côte, le '
  'rendu de référence), "centered" (texte centré, sans visuel), "banner" '
  '(bannière pleine largeur avec texte superposé). NULL = choix '
  'automatique selon la présence d''un visuel — voir '
  'resolveHeroLayout() dans landing-config-service.ts.';

comment on column organization_landing_config.hero_media_url is
  'Visuel de l''en-tête, distinct de organizations.banner_url : la '
  'bannière est une image large (ratio 3/1) héritée du Lot E, ce champ '
  'porte le visuel portrait/carré de la composition « split ». NULL = '
  'repli sur banner_url, puis sur la photo du premier produit actif.';

comment on column organization_landing_config.highlights is
  'Bande de confiance sous l''en-tête : [{ "icon": "truck", "title": '
  '"Livraison rapide", "subtitle": "..." }, ...]. NULL = les promesses '
  'par défaut du secteur (application/config/storefront-blueprint.ts) '
  'sont affichées, jamais persistées tant que le commerçant ne les a pas '
  'modifiées. Tableau vide = le commerçant a explicitement retiré la '
  'bande — cas distinct de NULL, et respecté comme tel.';

comment on column organization_landing_config.payment_methods is
  'Moyens de paiement REELLEMENT acceptés, affichés en pied de page : '
  '["mtn","orange","cash","visa","mastercard","bank"]. NULL = rien '
  'affiché (aucun moyen de paiement n''est présumé : afficher un logo '
  'Visa chez un commerçant qui n''accepte que le cash tromperait son '
  'client). Pré-cochés dans /dashboard/site, mais jamais écrits sans '
  'validation explicite.';

comment on column organization_landing_config.show_stats is
  'Affiche la bande de chiffres de la vitrine. Ces chiffres sont TOUS '
  'calculés depuis la base (références actives, catégories, ancienneté, '
  'note moyenne des témoignages) — aucun compteur décoratif type '
  '« 10 000+ clients ». La bande se masque d''elle-même si moins de '
  'trois chiffres réels sont disponibles, voir getStorefrontStats().';

-- ------------------------------------------------------------
-- categories — vignettes illustrées
-- Une grille de catégories sans image (l'état actuel : de simples
-- rectangles de texte) est le principal écart visuel entre la vitrine
-- réelle et une boutique en ligne crédible. `image_url` reste optionnel :
-- sans image, la vignette retombe sur la photo d'un produit RÉEL de la
-- catégorie (voir listCategoriesWithProductCounts) plutôt que sur une
-- illustration générique.
-- ------------------------------------------------------------
alter table categories
  add column if not exists image_url text,
  add column if not exists position integer not null default 0;

comment on column categories.image_url is
  'Vignette de la catégorie sur la vitrine publique. NULL = repli '
  'automatique sur la photo principale d''un produit actif de cette '
  'catégorie (donnée réelle du tenant, jamais une banque d''images).';

comment on column categories.position is
  'Ordre d''affichage sur la vitrine. Égalité -> tri alphabétique, '
  'comportement historique conservé.';

create index if not exists idx_categories_org_position on categories(organization_id, position);

-- ------------------------------------------------------------
-- products — mise en avant manuelle
-- Le badge « best-seller » de la vitrine est calculé depuis order_items
-- (donnée réelle). `is_featured` couvre le cas complémentaire : un
-- commerçant qui vient d'ouvrir n'a aucune vente et veut malgré tout
-- choisir ce qui apparaît en page d'accueil.
-- ------------------------------------------------------------
alter table products
  add column if not exists is_featured boolean not null default false;

comment on column products.is_featured is
  'Produit épinglé en page d''accueil de la vitrine. Complémentaire du '
  'badge « best-seller », lui calculé depuis les ventes réelles '
  '(order_items) : un catalogue neuf n''a aucune vente, ce drapeau '
  'permet quand même une mise en avant choisie.';

create index if not exists idx_products_org_featured
  on products(organization_id)
  where is_featured = true;

-- Tri par nouveauté de la vitrine (badge « Nouveau », section produits
-- de la page d'accueil) — sans cet index, chaque rendu de vitrine trie
-- l'intégralité du catalogue actif du tenant en mémoire.
create index if not exists idx_products_org_status_created
  on products(organization_id, status, created_at desc);
