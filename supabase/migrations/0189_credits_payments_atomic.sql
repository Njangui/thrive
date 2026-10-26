-- ============================================================
-- 0189_credits_payments_atomic.sql
-- Corrections d'audit : P9/Q14 (effet appliqué avant « terminé »), P10/Q15 (crédits d'add-on
-- conservés au changement de plan), P11 (ajout de crédits atomique), retrait de l'essai Pro
-- offert (Q12), statut d'événement `release`.
--
-- Modèle de crédits : disponible = included_credits (plan) + addon_credits (achetés) − used_credits.
--  - un changement de plan remet `used_credits` à 0 et recalcule `included_credits`, mais les
--    crédits d'add-on NON CONSOMMÉS sont conservés (la part déjà consommée est déduite) ;
--  - ajouter des crédits = UPDATE atomique (plus de lecture-puis-écriture).
-- ============================================================

-- Essai Pro offert retiré -------------------------------------------------------
delete from platform_settings where key = 'free_pro_promo';
alter table ai_credit_balances drop column if exists promo_bonus_credits;

-- Crédits d'add-on -----------------------------------------------------------------
alter table ai_credit_balances add column if not exists addon_credits integer not null default 0 check (addon_credits >= 0);

create or replace function public.consume_ai_credit(p_organization_id uuid, p_amount integer)
returns table (used_credits integer, included_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.ai_credit_balances
  set used_credits = ai_credit_balances.used_credits + p_amount
  where ai_credit_balances.organization_id = p_organization_id
    and (
      ai_credit_balances.included_credits = -1
      or ai_credit_balances.used_credits + p_amount <= ai_credit_balances.included_credits + ai_credit_balances.addon_credits
    )
  returning ai_credit_balances.used_credits, ai_credit_balances.included_credits;
end;
$$;

-- Ajout atomique de crédits achetés (ou geste commercial). Sans effet pour un plan illimité (-1).
create or replace function public.grant_ai_credit(p_organization_id uuid, p_amount integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'grant_ai_credit: montant invalide';
  end if;
  update public.ai_credit_balances
  set addon_credits = ai_credit_balances.addon_credits + p_amount
  where ai_credit_balances.organization_id = p_organization_id
    and ai_credit_balances.included_credits <> -1;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

-- Changement de palier : nouveau plafond, consommation remise à 0, crédits achetés non consommés conservés.
create or replace function public.reset_ai_credits_for_plan(p_organization_id uuid, p_included integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ai_credit_balances (organization_id, included_credits, used_credits, addon_credits)
  values (p_organization_id, p_included, 0, 0)
  on conflict (organization_id) do update
  set addon_credits = case
        when ai_credit_balances.included_credits = -1 then ai_credit_balances.addon_credits
        else greatest(0, ai_credit_balances.addon_credits - greatest(0, ai_credit_balances.used_credits - ai_credit_balances.included_credits))
      end,
      included_credits = excluded.included_credits,
      used_credits = 0;
end;
$$;

alter table ai_usage_events drop constraint if exists ai_usage_events_type_check;
alter table ai_usage_events add constraint ai_usage_events_type_check check (type in ('consumption', 'grant', 'release'));

-- Paiements : états intermédiaires ------------------------------------------------------
-- processing    : effet en cours d'application (un seul traitement à la fois)
-- effect_failed : paiement encaissé mais effet non appliqué → rejoué automatiquement
alter table subscription_payments drop constraint if exists subscription_payments_status_check;
alter table subscription_payments add constraint subscription_payments_status_check
  check (status in ('pending', 'processing', 'effect_failed', 'completed', 'failed', 'refunded', 'cancelled'));

-- Achat d'add-on : TOUT dans une transaction (quantité, crédits, statut du paiement). Un échec
-- n'applique rien et laisse le paiement `pending` : il sera repris, sans double comptage.
create or replace function public.apply_addon_purchase(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay record;
  addon_row record;
  bonus integer;
begin
  select * into pay from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'apply_addon_purchase: paiement introuvable';
  end if;
  if pay.status = 'completed' then
    return jsonb_build_object('status', 'already');
  end if;
  if pay.status not in ('pending', 'processing', 'effect_failed') then
    return jsonb_build_object('status', 'ignored', 'payment_status', pay.status);
  end if;
  if pay.payment_type <> 'addon' or pay.addon_key is null or pay.addon_quantity is null then
    raise exception 'apply_addon_purchase: ce paiement n''est pas un add-on';
  end if;

  select * into addon_row from public.addons where key = pay.addon_key;
  if not found then
    raise exception 'apply_addon_purchase: add-on % introuvable', pay.addon_key;
  end if;

  bonus := pay.addon_quantity * addon_row.increment_value;

  insert into public.organization_addons (organization_id, addon_key, quantity, total_increment_granted, subscription_payment_id, purchased_at)
  values (pay.organization_id, pay.addon_key, pay.addon_quantity, bonus, pay.id, now())
  on conflict (organization_id, addon_key) do update
  set quantity = public.organization_addons.quantity + excluded.quantity,
      total_increment_granted = public.organization_addons.total_increment_granted + excluded.total_increment_granted,
      subscription_payment_id = excluded.subscription_payment_id,
      purchased_at = excluded.purchased_at;

  if addon_row.entitlement_key = 'ai_credits' then
    perform public.grant_ai_credit(pay.organization_id, bonus);
    insert into public.ai_usage_events (organization_id, type, amount, reason)
    values (pay.organization_id, 'grant', bonus, 'addon_purchase');
  end if;

  update public.subscription_payments
  set status = 'completed', webhook_received_at = now()
  where id = pay.id;

  return jsonb_build_object('status', 'applied', 'name', addon_row.name, 'quantity', pay.addon_quantity, 'organization_id', pay.organization_id);
end;
$$;

revoke all on function public.grant_ai_credit(uuid, integer) from public, anon, authenticated;
revoke all on function public.reset_ai_credits_for_plan(uuid, integer) from public, anon, authenticated;
revoke all on function public.apply_addon_purchase(uuid) from public, anon, authenticated;
grant execute on function public.grant_ai_credit(uuid, integer) to service_role;
grant execute on function public.reset_ai_credits_for_plan(uuid, integer) to service_role;
grant execute on function public.apply_addon_purchase(uuid) to service_role;
