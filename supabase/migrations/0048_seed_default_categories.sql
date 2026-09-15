-- Chantier "catégories par secteur d'activité, pas retapées à chaque
-- produit" (section design, sept. 2026). `seedDefaultCategories()`
-- (catalog-service.ts) couvre désormais les organisations créées à
-- partir de maintenant (appelée dans `createOrganization`) — cette
-- migration comble le même besoin pour les organisations créées AVANT ce
-- chantier, qui n'ont jamais reçu ce seed.
--
-- Purement additif et idempotent : ne touche que les organisations sans
-- AUCUNE catégorie existante (jamais une catégorie déjà créée par un
-- commerçant, jamais un produit/service déjà catégorisé). Rejouer cette
-- migration sur une base déjà migrée n'insère rien de plus (la garde
-- `not exists (... where organization_id = org.id)` redevient fausse dès
-- la première exécution).

create extension if not exists "unaccent";

do $$
declare
  org record;
  preset text[];
  cat_name text;
  cat_slug text;
begin
  for org in select id, industry from organizations loop
    if exists (select 1 from categories where organization_id = org.id) then
      continue;
    end if;

    preset := case org.industry
      when 'retail' then array['Vêtements Femme', 'Vêtements Homme', 'Chaussures', 'Accessoires', 'Enfants', 'Autres']
      when 'restaurant' then array['Entrées', 'Plats', 'Desserts', 'Boissons', 'Menus', 'Autres']
      when 'beauty' then array['Soins du visage', 'Soins du corps', 'Maquillage', 'Cheveux', 'Parfums', 'Autres']
      when 'professional_services' then array['Consultations', 'Formations', 'Abonnements', 'Autres']
      when 'real_estate' then array['Appartements', 'Maisons', 'Terrains', 'Bureaux', 'Commerces', 'Autres']
      else array['Général', 'Autres']
    end;

    foreach cat_name in array preset loop
      -- Même algorithme d'esprit que `slugify()` (src/domain/entities/catalog.ts) :
      -- normalise les accents, minuscule, tirets — pas identique caractère
      -- pour caractère mais suffisant ici (le slug ne sert qu'à l'unicité
      -- par organisation, jamais affiché ni comparé à un slug produit ailleurs).
      cat_slug := trim(both '-' from regexp_replace(lower(unaccent(cat_name)), '[^a-z0-9]+', '-', 'g'));

      insert into categories (organization_id, name, slug)
      values (org.id, cat_name, cat_slug)
      on conflict (organization_id, slug) do nothing;
    end loop;
  end loop;
end $$;
