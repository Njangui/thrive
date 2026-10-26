-- ============================================================
-- 0186_c5_product_demand.sql
-- C5 — demande réelle des clients, par produit, calculée EN SQL à partir des statistiques du site
-- (aucune conversation lue, aucune donnée personnelle : des compteurs par produit).
--
-- Signal d'intérêt = `product_click` (clic sur une carte produit, déclenché par du JavaScript côté
-- visiteur : les robots n'y passent quasiment pas). `product_view` est AUSSI renvoyé mais N'EST PAS
-- FIABLE : il est enregistré au rendu serveur de la page produit, donc compte aussi les robots
-- (Google, aperçus de lien Meta/WhatsApp). Les alertes n'utilisent que les clics.
--
-- Même modèle de sécurité que 0183 : service-role uniquement, filtrage strict par `p_org`
-- (l'événement ET le produit doivent appartenir à ce tenant).
-- ============================================================
create or replace function c5_product_demand(p_org uuid, p_days integer default 14)
returns table (
  product_id uuid, name text, current_stock numeric, min_stock numeric, unit_price numeric,
  clicks integer, clicks_prev integer, views integer, units_sold numeric
)
language sql stable security invoker set search_path = public as $$
  with ev as (
    select e.entity_id as product_id, e.event_type, e.created_at
    from analytics_events e
    where e.organization_id = p_org
      and e.entity_type = 'product'
      and e.entity_id is not null
      and e.event_type in ('product_click', 'product_view')
      and e.created_at >= now() - make_interval(days => 2 * greatest(p_days, 1))
  ),
  agg as (
    select ev.product_id,
           count(*) filter (where ev.event_type = 'product_click' and ev.created_at >= now() - make_interval(days => greatest(p_days, 1)))::integer as clicks,
           count(*) filter (where ev.event_type = 'product_click' and ev.created_at <  now() - make_interval(days => greatest(p_days, 1)))::integer as clicks_prev,
           count(*) filter (where ev.event_type = 'product_view'  and ev.created_at >= now() - make_interval(days => greatest(p_days, 1)))::integer as views
    from ev group by ev.product_id
  ),
  sold as (
    select oi.product_id, sum(oi.quantity) as units
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.organization_id = p_org and oi.organization_id = p_org
      and o.status = 'completed'
      and oi.product_id is not null
      and o.created_at >= now() - make_interval(days => greatest(p_days, 1))
    group by oi.product_id
  )
  select p.id, p.name, p.current_stock, p.min_stock, p.unit_price,
         coalesce(a.clicks, 0), coalesce(a.clicks_prev, 0), coalesce(a.views, 0), coalesce(s.units, 0)
  from products p
  left join agg a on a.product_id = p.id
  left join sold s on s.product_id = p.id
  where p.organization_id = p_org
    and p.status in ('active', 'out_of_stock')
    and (coalesce(a.clicks, 0) > 0 or coalesce(a.clicks_prev, 0) > 0 or coalesce(a.views, 0) > 0 or coalesce(s.units, 0) > 0)
  order by 6 desc, 8 desc
  limit 500
$$;

revoke all on function c5_product_demand(uuid, integer) from public, anon, authenticated;
grant execute on function c5_product_demand(uuid, integer) to service_role;
