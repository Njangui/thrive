-- ============================================================
-- 0043_ai_credits_atomic.sql
-- Renommée 0038 -> 0043 lors de la fusion (07/09/2026) : le numéro 0038
-- était déjà pris par 0038_atomic_order_stock_transaction.sql (Lot 1,
-- présent dans la base commune dont ce lot est parti) — collision de
-- numérotation entre lots parallèles, contenu SQL inchangé.
-- Lot 3 (audit master prompt §30/§71) — corrige une race condition
-- explicitement auto-documentée dans ai-credits-service.ts::consumeCredit
-- depuis sa toute première version : lecture-puis-écriture applicative,
-- non atomique. Deux générations IA quasi simultanées pour la même
-- organisation pouvaient consommer le même crédit deux fois (au sens où
-- les DEUX appels LLM étaient facturés, mais le solde en base ne
-- reflétait qu'UNE seule consommation).
--
-- `consume_ai_credit` remplace le "lire used_credits, calculer, écrire"
-- par un UPDATE ... WHERE unique et atomique : la vérification de
-- disponibilité ET l'incrément se font dans la MÊME opération, protégée
-- par le verrou de ligne implicite de Postgres — deux appels concurrents
-- sur la même organisation se sérialisent automatiquement, le second
-- voit forcément le solde déjà mis à jour par le premier.
--
-- `release_ai_credit` (symétrique) permet de rembourser un crédit
-- réservé si la génération IA échoue malgré tout après la réservation
-- (voir ai-response-service.ts — section 30 : "consommer un crédit
-- uniquement si une génération est réellement effectuée").
-- ============================================================

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
      or ai_credit_balances.used_credits + p_amount <= ai_credit_balances.included_credits
    )
  returning ai_credit_balances.used_credits, ai_credit_balances.included_credits;
end;
$$;

comment on function public.consume_ai_credit(uuid, integer) is
  'Consommation atomique : renvoie ZÉRO ligne si le solde est insuffisant '
  'OU si aucune ligne ai_credit_balances n''existe encore pour cette '
  'organisation (les deux cas sont volontairement indistingables ici — '
  'ai-credits-service.ts::consumeCredit distingue les deux en relisant '
  'getCreditStatus() avant de retenter après initializeCreditBalance()).';

create or replace function public.release_ai_credit(p_organization_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_credit_balances
  set used_credits = greatest(ai_credit_balances.used_credits - p_amount, 0)
  where ai_credit_balances.organization_id = p_organization_id;
end;
$$;

comment on function public.release_ai_credit(uuid, integer) is
  'Remboursement atomique — appelé quand consume_ai_credit a réservé un '
  'crédit mais que la génération IA a finalement échoué (primary ET '
  'fallback), pour respecter "consommer un crédit uniquement si une '
  'génération est réellement effectuée" (section 30).';

revoke all on function public.consume_ai_credit(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_ai_credit(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_credit(uuid, integer) to service_role;
grant execute on function public.release_ai_credit(uuid, integer) to service_role;
