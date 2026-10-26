-- ============================================================
-- 0125 — Remboursements de commandes clients (C2, outil `orders.refund`)
--
-- JUGEMENT DE CONCEPTION (à valider avec le comptable du tenant) :
--  - un remboursement est un ENREGISTREMENT : Flexco ne déplace pas d'argent ; le commerçant rend
--    l'argent (Mobile Money, espèces) hors plateforme, puis valide la carte ;
--  - effet comptable = une ligne `revenues` NÉGATIVE (contre-passation) SANS `order_id` : le calcul
--    du coût des ventes (tenant-finance-service) lit le coût via `order_id` ; relier la ligne
--    négative à la commande compterait le coût DEUX fois. Le coût des ventes n'est pas annulé
--    (la marchandise n'est pas forcément revenue en stock : le réapprovisionnement reste une
--    action séparée, `stock.restock`) ;
--  - seule une commande `completed` est remboursable (une commande en attente s'annule) ;
--  - le cumul des remboursements d'une commande ne dépasse jamais son total : contrôle SOUS
--    VERROU de la commande (deux remboursements simultanés ne peuvent pas dépasser le total).
-- Réservée à service_role (même posture que complete_order_transaction).
-- ============================================================

create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null,
  reason text not null check (length(reason) between 3 and 300),
  revenue_id uuid references public.revenues(id) on delete set null,
  created_by_user uuid references auth.users(id) on delete set null,
  created_by_membership uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_order_refunds_order on public.order_refunds (organization_id, order_id);
create index idx_order_refunds_org_date on public.order_refunds (organization_id, created_at desc);

-- RLS activée SANS politique : lecture/écriture uniquement par le serveur (service_role), qui
-- filtre toujours par organisation (order-refund-service.ts).
alter table public.order_refunds enable row level security;

create or replace function public.record_order_refund(
  p_organization_id uuid,
  p_order_id uuid,
  p_amount numeric,
  p_reason text,
  p_actor_user_id uuid,
  p_actor_membership_id uuid
)
returns table (refund_id uuid, order_total numeric, refunded_total numeric, currency text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_already numeric;
  v_refund_id uuid;
  v_revenue_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'REFUND_AMOUNT_INVALID' using errcode = '22023';
  end if;

  -- Verrou de la commande : sérialise les remboursements concurrents sur la même commande.
  select * into v_order from public.orders where id = p_order_id and organization_id = p_organization_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status <> 'completed' then
    raise exception 'ORDER_NOT_COMPLETED' using errcode = '22023';
  end if;

  select coalesce(sum(r.amount), 0) into v_already from public.order_refunds r
    where r.order_id = p_order_id and r.organization_id = p_organization_id;
  if v_already + p_amount > v_order.total_amount then
    raise exception 'REFUND_EXCEEDS_TOTAL' using errcode = '22023';
  end if;

  insert into public.revenues (organization_id, order_id, amount, currency, category, source, reference, revenue_date, note, created_by)
  values (p_organization_id, null, -p_amount, v_order.currency, 'remboursement', 'refund', 'order:' || p_order_id::text,
          current_date, left(p_reason, 300), p_actor_user_id)
  returning id into v_revenue_id;

  insert into public.order_refunds (organization_id, order_id, amount, currency, reason, revenue_id, created_by_user, created_by_membership)
  values (p_organization_id, p_order_id, p_amount, v_order.currency, p_reason, v_revenue_id, p_actor_user_id, p_actor_membership_id)
  returning id into v_refund_id;

  return query select v_refund_id, v_order.total_amount, v_already + p_amount, v_order.currency;
end;
$$;

revoke all on function public.record_order_refund(uuid, uuid, numeric, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_order_refund(uuid, uuid, numeric, text, uuid, uuid) to service_role;

comment on function public.record_order_refund(uuid, uuid, numeric, text, uuid, uuid) is
  'C2 : remboursement atomique (verrou orders FOR UPDATE, plafond cumulé = total, contre-passation en revenues). '
  'Appelée uniquement depuis order-refund-service.ts, derrière l''approbation `sensitive` de l''outil orders.refund.';
