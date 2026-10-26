-- ============================================================
-- 0140_c3_product_search.sql
-- C3 (assistant client) — recherche produit hybride, étape 1 :
-- texte français sans accent + tolérance aux fautes (pg_trgm) + filtres
-- (actif, prix, catégorie) + classement par règles métier, TOUT en SQL
-- (principe 3 : le LLM ne calcule pas ; principe 2 : règles avant IA).
--
-- Les embeddings (pgvector) arrivent en 0141, séparément, pour ne pas
-- bloquer cette étape si l'extension `vector` n'est pas disponible sur
-- l'offre Supabase (question ouverte).
--
-- Aucune nouvelle table : `products` est déjà sous RLS (0007). La fonction
-- de recherche est `security invoker` ET filtre explicitement sur
-- `p_organization_id` : l'isolation ne dépend jamais du seul client
-- service-role (principe 5).
-- ============================================================

create schema if not exists extensions;
create extension if not exists unaccent;
create extension if not exists pg_trgm with schema extensions;

-- ------------------------------------------------------------
-- Normalisation : minuscules, sans accents, ponctuation → espaces.
-- `unaccent()` est STABLE ; on l'enveloppe en IMMUTABLE (usage standard)
-- car le dictionnaire ne change pas en pratique.
-- ------------------------------------------------------------
create or replace function public.assistant_normalize(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select trim(regexp_replace(lower(unaccent('unaccent', coalesce(p_text, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;

-- ------------------------------------------------------------
-- Document de recherche d'un produit : nom, catégorie, SKU, description,
-- spécifications (libellé + valeur : c'est là que vit « Couleur : noir »).
-- ------------------------------------------------------------
alter table public.products
  add column if not exists search_document text not null default '';

comment on column public.products.search_document is
  'C3 — texte normalisé (sans accent, minuscule) alimentant la recherche de '
  'l''assistant client. Maintenu par trigger : ne jamais écrire à la main.';

create or replace function public.product_search_document(p_product public.products)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select public.assistant_normalize(concat_ws(' ',
    p_product.name,
    (select c.name from public.categories c
      where c.id = p_product.category_id and c.organization_id = p_product.organization_id),
    p_product.sku,
    p_product.description,
    (select string_agg(concat_ws(' ', s ->> 'label', s ->> 'value'), ' ')
       from jsonb_array_elements(
              case when jsonb_typeof(p_product.specifications) = 'array'
                   then p_product.specifications else '[]'::jsonb end) as s)
  ))
$$;

create or replace function public.products_search_document_trigger()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.search_document := public.product_search_document(new);
  return new;
end;
$$;

drop trigger if exists trg_products_search_document on public.products;
create trigger trg_products_search_document
  before insert or update of name, description, sku, category_id, specifications
  on public.products
  for each row execute function public.products_search_document_trigger();

-- Renommer une catégorie doit rafraîchir les produits qui en dépendent.
-- Effet de bord assumé : `updated_at` de ces produits est mis à jour
-- (trigger existant trg_products_updated_at).
create or replace function public.categories_refresh_product_search()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.name is distinct from old.name then
    update public.products p
       set search_document = public.product_search_document(p)
     where p.category_id = new.id
       and p.organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_categories_refresh_product_search on public.categories;
create trigger trg_categories_refresh_product_search
  after update of name on public.categories
  for each row execute function public.categories_refresh_product_search();

-- Rattrapage des produits existants SANS toucher à `updated_at`.
alter table public.products disable trigger trg_products_updated_at;
update public.products p set search_document = public.product_search_document(p);
alter table public.products enable trigger trg_products_updated_at;

-- ------------------------------------------------------------
-- Index : texte français (stemming) + trigrammes (fautes de frappe).
-- L'opclass pg_trgm est résolue dans le schéma réel de l'extension
-- (`extensions` sur Supabase, `public` si déjà installée ailleurs).
-- ------------------------------------------------------------
create index if not exists idx_products_search_fts
  on public.products using gin (to_tsvector('french', search_document));

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  execute format(
    'create index if not exists idx_products_search_trgm on public.products using gin (search_document %I.gin_trgm_ops)',
    v_schema
  );
end;
$$;

-- ------------------------------------------------------------
-- Recherche classée pour l'assistant.
--
--  p_terms : mots significatifs DÉJÀ extraits côté application (singulier,
--            sans mots vides, sans montants). Vide = mode « parcourir le
--            catalogue » : seules les règles métier classent.
--  Un produit est retenu s'il couvre au moins la moitié des mots (arrondi
--  au supérieur) — par texte français OU par similarité trigramme (fautes).
--  Le prix n'est JAMAIS déduit du texte ici : filtres numériques stricts.
--
-- Poids du classement (un seul endroit pour les ajuster) :
--   couverture des mots ×3 · mots présents dans le nom ×1,5 · rang FTS ×1
--   promo en cours +0,3 · mis en avant +0,2 · marge (départage) jusqu'à +0,2
-- Statut : `status = 'active'` seulement (source de vérité du stock : le
-- statut bascule en out_of_stock via adjust_product_stock, voir 0038).
-- ------------------------------------------------------------
create or replace function public.search_products_for_assistant(
  p_organization_id uuid,
  p_terms text[] default '{}',
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_category_slug text default null,
  p_limit integer default 5
)
returns table (
  id uuid,
  name text,
  slug text,
  unit_price numeric,
  compare_at_price numeric,
  description text,
  category_name text,
  is_promo boolean,
  image_url text,
  score real
)
language plpgsql
stable
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_terms text[];
  v_count integer;
  v_tsq tsquery;
  v_min_hits integer;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
begin
  select coalesce(array_agg(x.t), '{}'::text[]) into v_terms
  from (
    select distinct left(public.assistant_normalize(raw), 40) as t
    from unnest(coalesce(p_terms, '{}'::text[])) as raw
    limit 8
  ) x
  where x.t <> '';

  v_count := cardinality(v_terms);
  v_min_hits := case when v_count = 0 then 0 else ceil(v_count / 2.0)::integer end;

  if v_count > 0 then
    select nullif(string_agg('(' || q.q::text || ')', ' | '), '')::tsquery into v_tsq
    from (select plainto_tsquery('french', t) as q from unnest(v_terms) as t) q
    where q.q::text <> '';
  end if;

  return query
  with cand as (
    select pr.id, pr.name, pr.slug, pr.unit_price, pr.compare_at_price, pr.description,
           pr.cost_price, pr.is_featured, pr.created_at, pr.promotion_ends_at,
           pr.search_document, c.name as category_name,
           to_tsvector('french', pr.search_document) as doc,
           public.assistant_normalize(pr.name) as nname
      from public.products pr
      left join public.categories c
        on c.id = pr.category_id and c.organization_id = pr.organization_id
     where pr.organization_id = p_organization_id
       and pr.status = 'active'
       and (p_min_price is null or pr.unit_price >= p_min_price)
       and (p_max_price is null or pr.unit_price <= p_max_price)
       and (p_category_slug is null or c.slug = p_category_slug)
  ),
  scored as (
    select cd.*,
           (select count(*) from unnest(v_terms) as t
             where cd.doc @@ plainto_tsquery('french', t)
                or word_similarity(t, cd.search_document) >= 0.5)::integer as hits,
           (select count(*) from unnest(v_terms) as t
             where word_similarity(t, cd.nname) >= 0.5)::integer as name_hits,
           (cd.compare_at_price is not null
              and cd.compare_at_price > cd.unit_price
              and (cd.promotion_ends_at is null or cd.promotion_ends_at > now())) as promo
      from cand cd
  ),
  ranked as (
    select s.*,
           (
             case when v_count > 0 then
               (s.hits::real / v_count) * 3.0
               + (s.name_hits::real / v_count) * 1.5
               + case when v_tsq is null then 0 else ts_rank_cd(s.doc, v_tsq) end
             else 0 end
             + case when s.promo then 0.3 else 0 end
             + case when s.is_featured then 0.2 else 0 end
             + case when s.cost_price is not null and s.unit_price > 0 and s.cost_price < s.unit_price
                    then ((s.unit_price - s.cost_price) / s.unit_price)::real * 0.2 else 0 end
           )::real as rank_score
      from scored s
     where v_count = 0 or s.hits >= v_min_hits
  )
  select r.id, r.name, r.slug, r.unit_price, r.compare_at_price, r.description,
         r.category_name, r.promo,
         (select pi.url from public.product_images pi
           where pi.product_id = r.id and pi.organization_id = p_organization_id
           order by pi.position asc limit 1),
         r.rank_score
    from ranked r
   order by r.rank_score desc, r.created_at desc
   limit v_limit;
end;
$$;

-- Appelée uniquement côté serveur (client service-role) : ni anon ni authentifié.
revoke all on function public.search_products_for_assistant(uuid, text[], numeric, numeric, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_products_for_assistant(uuid, text[], numeric, numeric, text, integer)
  to service_role;
