-- ============================================================
-- 0183_c5_growth_insights.sql
-- C5 — analyses et alertes CALCULÉES EN SQL (le LLM ne calcule pas : il
-- rédige et priorise à partir de ces lignes).
--
-- Sécurité (principe 5) : ces fonctions reçoivent `p_org` en paramètre et
-- filtrent TOUT par ce tenant ; elles ne sont donc exécutables que par le
-- service-role. Le service applicatif vérifie d'abord que l'acteur appartient à
-- l'organisation (growth-insights-service.ts). `anon` et `authenticated`
-- n'ont aucun droit d'exécution : un client navigateur ne peut pas lire les
-- chiffres d'un autre tenant en passant un autre `p_org`.
--
-- Conventions : ventes = commandes `completed` (c'est là que le stock est
-- décrémenté, voir 0009) ; date de vente = `orders.created_at`. Un coût à 0
-- (valeur par défaut de `order_items.unit_cost`, 0069) signifie « coût
-- inconnu », JAMAIS « marge de 100 % » : les marges correspondantes sont NULL.
-- ============================================================

-- 1. Stock dormant : en stock, actif, créé depuis assez longtemps, sans vente récente.
create or replace function c5_dormant_stock(p_org uuid, p_days integer default 60)
returns table (
  product_id uuid, name text, current_stock numeric, cost_price numeric,
  immobilized_value numeric, cost_known boolean, last_sale_at timestamptz
)
language sql stable security invoker set search_path = public as $$
  select p.id, p.name, p.current_stock, p.cost_price,
         case when p.cost_price is null or p.cost_price = 0 then null
              else round(p.current_stock * p.cost_price, 2) end,
         (p.cost_price is not null and p.cost_price > 0),
         s.last_sale_at
  from products p
  left join lateral (
    select max(o.created_at) as last_sale_at
    from order_items oi
    join orders o on o.id = oi.order_id
    where oi.product_id = p.id and o.organization_id = p_org and o.status = 'completed'
  ) s on true
  where p.organization_id = p_org
    and p.status = 'active'
    and p.current_stock > 0
    and p.created_at < now() - make_interval(days => greatest(p_days, 1))
    and (s.last_sale_at is null or s.last_sale_at < now() - make_interval(days => greatest(p_days, 1)))
  order by 5 desc nulls last, p.current_stock desc
$$;

-- 2. Marge par produit sur la période (coût inconnu → marge NULL).
create or replace function c5_product_margins(p_org uuid, p_days integer default 30)
returns table (
  product_id uuid, name text, units numeric, revenue numeric, cost numeric,
  margin numeric, margin_pct numeric, cost_known boolean
)
language sql stable security invoker set search_path = public as $$
  select p.id, p.name,
         sum(oi.quantity),
         sum(oi.quantity * oi.unit_price),
         case when bool_and(oi.unit_cost > 0) then sum(oi.quantity * oi.unit_cost) end,
         case when bool_and(oi.unit_cost > 0) then sum(oi.quantity * (oi.unit_price - oi.unit_cost)) end,
         case when bool_and(oi.unit_cost > 0) and sum(oi.quantity * oi.unit_price) > 0
              then round(100 * sum(oi.quantity * (oi.unit_price - oi.unit_cost)) / sum(oi.quantity * oi.unit_price), 1) end,
         bool_and(oi.unit_cost > 0)
  from order_items oi
  join orders o on o.id = oi.order_id
  join products p on p.id = oi.product_id
  where o.organization_id = p_org and oi.organization_id = p_org and p.organization_id = p_org
    and o.status = 'completed'
    and o.created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by p.id, p.name
  order by 6 asc nulls last
$$;

-- 3. Prévision de rupture : cadence de vente moyenne sur la période → jours de stock restants.
create or replace function c5_stockout_forecast(p_org uuid, p_days integer default 30)
returns table (
  product_id uuid, name text, current_stock numeric, min_stock numeric,
  daily_rate numeric, days_left numeric
)
language sql stable security invoker set search_path = public as $$
  with sales as (
    select oi.product_id, sum(oi.quantity) as units
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.organization_id = p_org and oi.organization_id = p_org
      and o.status = 'completed'
      and oi.product_id is not null
      and o.created_at >= now() - make_interval(days => greatest(p_days, 1))
    group by oi.product_id
  )
  select p.id, p.name, p.current_stock, p.min_stock,
         round(s.units / greatest(p_days, 1), 3),
         round(p.current_stock / (s.units / greatest(p_days, 1)), 1)
  from products p
  join sales s on s.product_id = p.id
  where p.organization_id = p_org and p.status in ('active', 'out_of_stock') and s.units > 0
  order by 6 asc
$$;

-- 4. Clients inactifs : déjà acheté (commande terminée), plus rien depuis N jours, non désinscrits.
create or replace function c5_inactive_customers(p_org uuid, p_days integer default 60, p_limit integer default 50)
returns table (
  contact_id uuid, full_name text, last_order_at timestamptz, orders_count integer, total_spent numeric
)
language sql stable security invoker set search_path = public as $$
  select c.id, c.full_name, max(o.created_at), count(*)::integer, sum(o.total_amount)
  from contacts c
  join orders o on o.contact_id = c.id and o.organization_id = p_org and o.status = 'completed'
  where c.organization_id = p_org and not c.broadcast_opt_out
  group by c.id, c.full_name
  having max(o.created_at) < now() - make_interval(days => greatest(p_days, 1))
  order by sum(o.total_amount) desc
  limit least(greatest(p_limit, 1), 200)
$$;

-- 5. Résultats des diffusions : commandes passées par les destinataires dans les N jours
--    SUIVANT la réception. C'est une ATTRIBUTION TEMPORELLE (corrélation), pas une preuve de causalité.
create or replace function c5_broadcast_results(p_org uuid, p_window_days integer default 7, p_limit integer default 20)
returns table (
  broadcast_id uuid, name text, scheduled_at timestamptz, status text, sent_count integer,
  orders integer, ordering_contacts integer, revenue numeric
)
language sql stable security invoker set search_path = public as $$
  with attributed as (
    select distinct r.broadcast_id, o.id as order_id, o.contact_id, o.total_amount
    from contact_broadcast_recipients r
    join orders o on o.contact_id = r.contact_id
                 and o.organization_id = p_org
                 and o.status in ('confirmed', 'completed')
                 and o.created_at >= r.sent_at
                 and o.created_at < r.sent_at + make_interval(days => greatest(p_window_days, 1))
    where r.organization_id = p_org and r.status = 'sent'
  )
  select b.id, b.name, b.scheduled_at, b.status, b.sent_count,
         count(a.order_id)::integer,
         count(distinct a.contact_id)::integer,
         coalesce(sum(a.total_amount), 0)
  from contact_broadcasts b
  left join attributed a on a.broadcast_id = b.id
  where b.organization_id = p_org and b.status in ('completed', 'partial')
  group by b.id, b.name, b.scheduled_at, b.status, b.sent_count
  order by b.scheduled_at desc
  limit least(greatest(p_limit, 1), 100)
$$;

-- 6. Trafic par source : visiteurs (entrée de session) et clics WhatsApp du MÊME visiteur le même jour.
--    `visitor` = empreinte anonyme (hash IP + navigateur + jour, voir landing-analytics-service) ;
--    elle relie l'entrée (source/campagne UTM) au clic sans stocker de donnée personnelle.
create or replace function c5_traffic_by_source(p_org uuid, p_days integer default 30)
returns table (source text, campaign text, visitors integer, whatsapp_clickers integer)
language sql stable security invoker set search_path = public as $$
  with entries as (
    select distinct on (metadata->>'visitor')
           metadata->>'visitor' as visitor,
           coalesce(metadata->>'source', 'direct') as source,
           metadata->>'campaign' as campaign
    from analytics_events
    where organization_id = p_org and event_type = 'page_view'
      and coalesce((metadata->>'entry')::boolean, false)
      and metadata->>'visitor' is not null
      and created_at >= now() - make_interval(days => greatest(p_days, 1))
    order by metadata->>'visitor', created_at asc
  ),
  clicks as (
    select distinct metadata->>'visitor' as visitor
    from analytics_events
    where organization_id = p_org and event_type = 'whatsapp_click'
      and metadata->>'visitor' is not null
      and created_at >= now() - make_interval(days => greatest(p_days, 1))
  )
  select e.source, e.campaign, count(*)::integer, count(c.visitor)::integer
  from entries e
  left join clicks c on c.visitor = e.visitor
  group by e.source, e.campaign
  order by 3 desc
$$;

-- Droits : service-role uniquement (voir en-tête).
revoke all on function c5_dormant_stock(uuid, integer) from public, anon, authenticated;
revoke all on function c5_product_margins(uuid, integer) from public, anon, authenticated;
revoke all on function c5_stockout_forecast(uuid, integer) from public, anon, authenticated;
revoke all on function c5_inactive_customers(uuid, integer, integer) from public, anon, authenticated;
revoke all on function c5_broadcast_results(uuid, integer, integer) from public, anon, authenticated;
revoke all on function c5_traffic_by_source(uuid, integer) from public, anon, authenticated;
grant execute on function c5_dormant_stock(uuid, integer) to service_role;
grant execute on function c5_product_margins(uuid, integer) to service_role;
grant execute on function c5_stockout_forecast(uuid, integer) to service_role;
grant execute on function c5_inactive_customers(uuid, integer, integer) to service_role;
grant execute on function c5_broadcast_results(uuid, integer, integer) to service_role;
grant execute on function c5_traffic_by_source(uuid, integer) to service_role;
