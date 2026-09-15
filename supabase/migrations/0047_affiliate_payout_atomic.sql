-- ============================================================
-- 0047_affiliate_payout_atomic.sql
-- Création atomique d'une demande de paiement affilié.
--
-- Pourquoi une fonction plpgsql plutôt qu'une séquence d'appels
-- supabase-js (lire les conversions approuvées -> créer affiliate_payouts
-- -> créer affiliate_payout_items) : deux clics rapides sur "Demander un
-- paiement" (double-clic, ou deux onglets) exécutés en séquence
-- applicative pourraient tous les deux lire le MÊME solde disponible
-- avant qu'aucun des deux n'ait encore écrit `affiliate_payout_items`,
-- puis créer DEUX demandes de paiement qui couvrent partiellement les
-- MÊMES commissions (l'affilié se verrait promettre plus que son solde
-- réel une seule fois). `for update skip locked` + une seule transaction
-- (portée automatiquement par l'exécution de la fonction) éliminent ce
-- risque : le second appel concurrent ne voit tout simplement plus les
-- lignes déjà verrouillées par le premier.
-- ============================================================

create or replace function public.request_affiliate_payout(p_affiliate_id uuid, p_payout_method jsonb)
returns table (payout_id uuid, amount_fcfa integer, currency_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout_id uuid;
  v_amount integer;
  v_currency text;
  v_conversion_ids uuid[];
begin
  -- CTE verrouillant (FOR UPDATE SKIP LOCKED) puis agrégation dans la
  -- requête englobante — la restriction Postgres sur les clauses de
  -- verrouillage ("pas de GROUP BY/agrégat au MÊME niveau de requête")
  -- porte sur le CTE lui-même (une simple sélection filtrée ici),
  -- jamais sur la requête qui le consomme : pattern standard pour
  -- "réclamer" un lot de lignes sans course concurrente (le même que
  -- pour une file de jobs).
  with payable as (
    select c.id, c.commission_amount_fcfa, c.currency_code
    from public.affiliate_conversions c
    where c.affiliate_id = p_affiliate_id
      and c.status = 'approved'
      and not exists (
        select 1 from public.affiliate_payout_items i where i.conversion_id = c.id
      )
    for update of c skip locked
  )
  select coalesce(sum(commission_amount_fcfa), 0), min(currency_code), array_agg(id)
  into v_amount, v_currency, v_conversion_ids
  from payable;

  if v_amount is null or v_amount <= 0 then
    raise exception 'no_payable_balance' using errcode = 'P0001';
  end if;

  insert into public.affiliate_payouts (affiliate_id, amount_fcfa, currency_code, payout_method_snapshot, status)
  values (p_affiliate_id, v_amount, coalesce(v_currency, 'XAF'), p_payout_method, 'requested')
  returning id into v_payout_id;

  insert into public.affiliate_payout_items (payout_id, conversion_id)
  select v_payout_id, unnest(v_conversion_ids);

  return query select v_payout_id, v_amount, coalesce(v_currency, 'XAF');
end;
$$;

comment on function public.request_affiliate_payout(uuid, jsonb) is
  'Lève l''exception applicative ''no_payable_balance'' (errcode P0001) '
  'si aucune commission approuvée n''est disponible — '
  'affiliate-payout-service.ts::requestPayout la traduit en '
  'ValidationError avant même d''appeler cette fonction (vérification '
  'préalable via getAffiliateBalance/canRequestPayout, pour un message '
  'utilisateur clair), cette garde ici n''est qu''un filet de sécurité '
  'contre une course concurrente.';

revoke all on function public.request_affiliate_payout(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.request_affiliate_payout(uuid, jsonb) to service_role;
