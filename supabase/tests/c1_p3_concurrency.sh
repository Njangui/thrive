#!/usr/bin/env bash
# Concurrence réelle C1 P3 : N connexions psql simultanées sur les fonctions du grand livre.
# Usage : su postgres -c "bash supabase/tests/c1_p3_concurrency.sh <base>"   (base avec migrations 0001, 0002, 0011, 0043, 0100, 0104)
set -u
DB=${1:-flexco_test}
Q() { psql -qAt -d "$DB" -c "$1"; }
ORG=cccccccc-0000-0000-0000-000000000001
ACT=00000000-0000-0000-0000-0000000000c1
Q "insert into auth.users(id,email) values ('$ACT','c@x') on conflict do nothing; insert into organizations(id,name,slug) values ('$ORG','C','c') on conflict do nothing;" >/dev/null
Q "select * from public.wallet_topup('$ORG','media',10,'seed-media','$ACT')" >/dev/null

echo "T1: 40 débits parallèles de 1 unité sur un solde de 10 (refs distinctes)"
seq 1 40 | xargs -P 20 -I{} psql -qAt -d "$DB" -c "select out_status from public.usage_charge('$ORG','$ACT','media',1,'par-{}')" | sort | uniq -c
echo "  solde final (attendu 0) : $(Q "select balance from wallet_balances where organization_id='$ORG' and kind='media'")"
echo "  lignes commit (attendu 10) : $(Q "select count(*) from usage_ledger where organization_id='$ORG' and entry_type='commit' and ref like 'par-%'")"

echo "T2: 30 débits parallèles avec la MÊME ref (idempotence sous concurrence)"
Q "select * from public.wallet_topup('$ORG','channel',5,'seed-channel','$ACT')" >/dev/null
seq 1 30 | xargs -P 20 -I{} psql -qAt -d "$DB" -c "select out_status from public.usage_charge('$ORG','$ACT','channel',2,'same-ref')" | sort | uniq -c
echo "  solde final (attendu 3, débité une seule fois) : $(Q "select balance from wallet_balances where organization_id='$ORG' and kind='channel'")"

echo "T3: IA — 5 crédits de plan + 5 unités de portefeuille, 30 débits parallèles (attendu 10 chargés)"
Q "insert into ai_credit_balances(organization_id,included_credits,used_credits) values ('$ORG',5,0) on conflict (organization_id) do update set included_credits=5, used_credits=0"
Q "select * from public.wallet_topup('$ORG','ai',5,'seed-ai','$ACT')" >/dev/null
seq 1 30 | xargs -P 20 -I{} psql -qAt -d "$DB" -c "select out_status || ':' || coalesce(out_source,'-') from public.usage_charge('$ORG','$ACT','ai',1,'ai-par-{}')" | sort | uniq -c
echo "  plan utilisé (attendu 5) : $(Q "select used_credits from ai_credit_balances where organization_id='$ORG'")  portefeuille (attendu 0) : $(Q "select balance from wallet_balances where organization_id='$ORG' and kind='ai'")"

echo "T4: release/commit en course sur la même réservation (une seule issue gagne)"
Q "select * from public.wallet_topup('$ORG','message',1,'seed-msg','$ACT')" >/dev/null
Q "select * from public.usage_reserve('$ORG','$ACT','message',1,'race-1')" >/dev/null
( for i in 1 2 3 4 5 6; do
    psql -qAt -d "$DB" -c "select 'release:' || out_status from public.usage_release('$ORG','race-1')" &
    psql -qAt -d "$DB" -c "select 'commit:' || public.usage_commit('$ORG','race-1')" &
  done; wait ) | sort | uniq -c
echo "  types finaux : $(Q "select string_agg(entry_type, ',' order by entry_type) from usage_ledger where organization_id='$ORG' and ref='race-1'")  solde message : $(Q "select balance from wallet_balances where organization_id='$ORG' and kind='message'")"
echo "  (cohérence : commit => solde 0 ; release => solde 1)"

echo "T5: 20 règlements parallèles du même paiement (un seul crédit)"
Q "insert into wallet_topups(id,organization_id,kind,units,amount_minor,currency,requested_by,provider_reference) values ('cccccccc-1111-1111-1111-111111111111','$ORG','media',7,700,'XAF','$ACT','prov-par')" >/dev/null
seq 1 20 | xargs -P 20 -I{} psql -qAt -d "$DB" -c "select out_status from public.wallet_topup_settle('prov-par','paid')" | sort | uniq -c
echo "  solde media (attendu 7) : $(Q "select balance from wallet_balances where organization_id='$ORG' and kind='media'")"
