-- ============================================================
-- 0038_atomic_order_stock_transaction.sql
-- Lot 1 (audit sécurité/architecture/DB/stock/multi-tenant, nouveau
-- master prompt) — corrige une race condition réelle trouvée en lisant
-- le code, pas supposée : `order-service.ts::markOrderCompleted` faisait
-- (1) SELECT orders.status pour vérifier l'idempotence, (2) une boucle de
-- décréments de stock chacun en lecture-puis-écriture séparée
-- (`catalog-service.ts::decrementStock`), (3) UPDATE orders.status,
-- (4) INSERT revenues — quatre à N étapes non atomiques. Deux appels
-- concurrents à `markOrderCompleted` pour la MÊME commande pouvaient
-- tous les deux lire status != 'completed' avant que l'un des deux
-- n'écrive, aboutissant à un double décrément de stock et un double
-- revenu. Même défaut dans `decrementStock` seul : lecture de
-- `current_stock`, calcul en mémoire applicative, écriture — deux ventes
-- concurrentes sur un produit à stock=1 pouvaient toutes les deux
-- réussir.
--
-- Cette migration introduit deux fonctions SQL, `security definer` +
-- `search_path` figé (même durcissement que les wrappers Vault de
-- 0037_tenant_credentials.sql) et réservées à `service_role` (jamais un
-- rôle authentifié normal, jamais anon — même posture) :
--
-- 1. `adjust_product_stock(product_id, organization_id, delta)` —
--    primitif atomique unique pour TOUT ajustement de stock (delta
--    négatif = décrément vente, positif = réapprovisionnement),
--    verrouillage de ligne (`FOR UPDATE`) pour sérialiser les appels
--    concurrents sur le MÊME produit. Bascule le statut
--    active<->out_of_stock selon les mêmes règles que le code
--    applicatif préexistant (section 10/18) : jamais force `inactive`/
--    `draft` vers `active`. Remplace la logique dupliquée qui existait
--    séparément dans `decrementStock` et `restockProduct`
--    (catalog-service.ts) — une seule source de vérité pour ce calcul
--    (section 100/101 du master prompt).
--
-- 2. `complete_order_transaction(order_id, organization_id, actor_user_id)`
--    — verrouille la ligne `orders` (`FOR UPDATE`), vérifie
--    l'idempotence SOUS ce verrou (pas avant), décrémente le stock de
--    chaque article via `adjust_product_stock` (donc chaque produit est
--    lui-même verrouillé le temps de son propre ajustement), termine la
--    commande, crée le revenu — tout dans UNE seule transaction
--    Postgres. Retourne la liste des produits qui viennent de basculer
--    vers `out_of_stock` PAR CET APPEL : les effets de bord qui ne sont
--    pas des mutations de données (notifier les admins, mettre en
--    pause des publications programmées) restent en couche application
--    (order-service.ts), déclenchés APRÈS le commit, pas dans le SQL.
-- ============================================================

create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_organization_id uuid,
  p_delta numeric
)
returns table (
  new_stock numeric,
  new_status product_status,
  previous_status product_status,
  product_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_new_stock numeric;
  v_new_status product_status;
begin
  select id, name, current_stock, status
  into v_product
  from public.products
  where id = p_product_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Produit introuvable: % (organisation %)', p_product_id, p_organization_id
      using errcode = 'P0002';
  end if;

  v_new_stock := greatest(0, v_product.current_stock + p_delta);
  v_new_status := v_product.status;

  -- Mêmes règles que le code applicatif préexistant (section 10 doc 2) :
  -- active -> out_of_stock uniquement en atteignant 0 depuis 'active' ;
  -- out_of_stock -> active uniquement en redevenant > 0 depuis
  -- 'out_of_stock'. Ne touche jamais 'draft'/'inactive'.
  if v_new_stock = 0 and v_product.status = 'active' then
    v_new_status := 'out_of_stock';
  elsif v_new_stock > 0 and v_product.status = 'out_of_stock' then
    v_new_status := 'active';
  end if;

  update public.products
  set current_stock = v_new_stock, status = v_new_status
  where id = p_product_id;

  return query select v_new_stock, v_new_status, v_product.status, v_product.name;
end;
$$;

create or replace function public.complete_order_transaction(
  p_order_id uuid,
  p_organization_id uuid,
  p_actor_user_id uuid default null
)
returns table (
  already_completed boolean,
  result_order_id uuid,
  total_amount numeric,
  currency text,
  newly_out_of_stock_product_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_item record;
  v_adjust record;
  v_out_of_stock_ids uuid[] := '{}';
begin
  select id, status, total_amount, currency
  into v_order
  from public.orders
  where id = p_order_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Commande introuvable: % (organisation %)', p_order_id, p_organization_id
      using errcode = 'P0002';
  end if;

  -- Idempotence VÉRIFIÉE SOUS LE VERROU ci-dessus, pas avant (c'est
  -- précisément ce qui manquait : la version applicative lisait le
  -- statut, puis le réécrivait plus tard, sans rien entre les deux qui
  -- empêche un second appel concurrent de lire le même statut "pas
  -- encore complété").
  if v_order.status = 'completed' then
    return query select true, v_order.id, v_order.total_amount, v_order.currency, '{}'::uuid[];
    return;
  end if;

  for v_item in
    select oi.product_id, oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
  loop
    select * into v_adjust
    from public.adjust_product_stock(v_item.product_id, p_organization_id, -v_item.quantity);

    insert into public.inventory_movements (organization_id, product_id, movement_type, quantity, reason, created_by)
    values (p_organization_id, v_item.product_id, 'out', v_item.quantity, 'Vente — commande ' || p_order_id, p_actor_user_id);

    if v_adjust.new_status = 'out_of_stock' and v_adjust.previous_status <> 'out_of_stock' then
      v_out_of_stock_ids := array_append(v_out_of_stock_ids, v_item.product_id);
    end if;
  end loop;

  update public.orders set status = 'completed' where id = p_order_id;

  insert into public.revenues (organization_id, order_id, amount, currency, category, source, reference, created_by)
  values (p_organization_id, p_order_id, v_order.total_amount, v_order.currency, 'vente', 'order', p_order_id::text, p_actor_user_id);

  return query select false, v_order.id, v_order.total_amount, v_order.currency, v_out_of_stock_ids;
end;
$$;

-- Réservé service_role — même posture que 0037_tenant_credentials.sql.
-- Ces fonctions font des écritures financières/stock sans revérifier
-- elles-mêmes l'appartenance de l'appelant à l'organisation (elles font
-- confiance à p_organization_id) : elles ne doivent JAMAIS être
-- exposées à un rôle authentifié normal ni à anon via PostgREST — c'est
-- au code applicatif serveur (order-service.ts, déjà derrière
-- requireMembership) de garantir que p_organization_id correspond bien
-- à l'appelant AVANT d'appeler cette fonction, exactement comme pour
-- toute autre mutation de ce projet passant par service_role.
revoke all on function public.adjust_product_stock(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.complete_order_transaction(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.adjust_product_stock(uuid, uuid, numeric) to service_role;
grant execute on function public.complete_order_transaction(uuid, uuid, uuid) to service_role;

comment on function public.complete_order_transaction(uuid, uuid, uuid) is
  'Section 19 du master prompt : complétion de commande atomique '
  '(verrouillage orders + products FOR UPDATE, idempotente sous ce '
  'verrou). Appelée exclusivement depuis order-service.ts::markOrderCompleted, '
  'jamais directement depuis le client.';
