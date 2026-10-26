-- 0192 — Décisions Q19 (versement affilié atomique) et Q25 (remboursement enregistré, commission annulée).
--
-- Avant : « marquer payé » et « rejeter » étaient des suites d'appels non atomiques, et le rejet détachait
-- les commissions AVANT de vérifier le statut → rejeter une demande déjà PAYÉE rendait ses commissions
-- de nouveau payables (double paiement possible).

create or replace function public.settle_affiliate_payout(p_payout_id uuid, p_admin uuid, p_reference text)
returns table (out_amount integer, out_affiliate uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout record;
begin
  select * into v_payout from public.affiliate_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'payout_not_found' using errcode = 'P0002';
  end if;
  if v_payout.status not in ('requested', 'approved') then
    raise exception 'payout_already_processed' using errcode = 'P0001';
  end if;
  if p_reference is null or length(btrim(p_reference)) = 0 then
    raise exception 'payment_reference_required' using errcode = 'P0001';
  end if;

  update public.affiliate_conversions
  set status = 'paid'
  where id in (select conversion_id from public.affiliate_payout_items where payout_id = p_payout_id)
    and status = 'approved';

  update public.affiliate_payouts
  set status = 'paid', processed_at = now(), processed_by = p_admin, payment_reference = btrim(p_reference)
  where id = p_payout_id;

  return query select v_payout.amount_fcfa, v_payout.affiliate_id;
end;
$$;

create or replace function public.reject_affiliate_payout(p_payout_id uuid, p_admin uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout record;
begin
  select * into v_payout from public.affiliate_payouts where id = p_payout_id for update;
  if not found then
    raise exception 'payout_not_found' using errcode = 'P0002';
  end if;
  -- Une demande déjà payée (ou déjà rejetée) ne peut JAMAIS être rejetée : ses commissions resteraient
  -- ou redeviendraient payables.
  if v_payout.status not in ('requested', 'approved') then
    raise exception 'payout_already_processed' using errcode = 'P0001';
  end if;

  delete from public.affiliate_payout_items where payout_id = p_payout_id;
  update public.affiliate_payouts
  set status = 'rejected', admin_notes = p_reason, processed_at = now(), processed_by = p_admin
  where id = p_payout_id;
end;
$$;

-- Remboursement d'un paiement d'abonnement/add-on (action admin) : enregistre `refunded` et annule la
-- commission d'affiliation liée tant qu'elle n'est pas versée.
create or replace function public.refund_subscription_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_conv record;
  v_commission text := 'none';
begin
  select * into v_payment from public.subscription_payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_payment.status <> 'completed' then
    raise exception 'payment_not_refundable' using errcode = 'P0001';
  end if;

  select * into v_conv from public.affiliate_conversions where subscription_payment_id = p_payment_id for update;
  if found then
    if v_conv.status = 'paid' then
      v_commission := 'already_paid'; -- déjà versée : récupération à gérer à la main avec l'affilié
    elsif v_conv.status in ('pending_hold', 'approved') then
      if exists (
        select 1 from public.affiliate_payout_items i
        join public.affiliate_payouts p on p.id = i.payout_id
        where i.conversion_id = v_conv.id and p.status in ('requested', 'approved')
      ) then
        raise exception 'commission_in_open_payout' using errcode = 'P0001'; -- rejeter d'abord la demande de versement
      end if;
      update public.affiliate_conversions set status = 'reversed' where id = v_conv.id;
      v_commission := 'reversed';
    end if;
  end if;

  update public.subscription_payments set status = 'refunded' where id = p_payment_id;

  return jsonb_build_object('status', 'refunded', 'commission', v_commission, 'organization_id', v_payment.organization_id, 'amount_fcfa', v_payment.amount_fcfa);
end;
$$;

revoke all on function public.settle_affiliate_payout(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reject_affiliate_payout(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.refund_subscription_payment(uuid) from public, anon, authenticated;
grant execute on function public.settle_affiliate_payout(uuid, uuid, text) to service_role;
grant execute on function public.reject_affiliate_payout(uuid, uuid, text) to service_role;
grant execute on function public.refund_subscription_payment(uuid) to service_role;
