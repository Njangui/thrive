#!/usr/bin/env bash
# Concurrence réelle C1 P4 : dispatchers parallèles (FOR UPDATE SKIP LOCKED).
# Usage : su postgres -c "bash supabase/tests/c1_p4_concurrency.sh <base>"  (base avec migrations 0001, 0002, 0105, 0106)
set -u
DB=${1:-flexco_test}
Q() { psql -qAt -d "$DB" -c "$1"; }
ORG=eeeeeeee-0000-0000-0000-000000000001
Q "insert into organizations(id,name,slug) values ('$ORG','E','e') on conflict do nothing" >/dev/null
Q "delete from domain_events where organization_id='$ORG'" >/dev/null
Q "insert into domain_events(organization_id,type,payload) select '$ORG','ProductChanged','{}' from generate_series(1,200)" >/dev/null
echo "T1: 20 dispatchers parallèles, lots de 25, sur 200 événements"
seq 1 20 | xargs -P 20 -I{} psql -qAt -d "$DB" -c "select id from public.claim_domain_events(25,60)" > /tmp/p4_claims.txt
echo "  ids pris : $(wc -l < /tmp/p4_claims.txt) | distincts : $(sort -u /tmp/p4_claims.txt | wc -l) (attendu égaux, 200 au plus)"
echo "T2: 50 émissions parallèles avec la même clé de déduplication"
seq 1 50 | xargs -P 25 -I{} psql -qAt -d "$DB" -c "select out_status from public.emit_domain_event('$ORG','Dup','{}','same')" | sort | uniq -c
echo "  lignes (attendu 1) : $(Q "select count(*) from domain_events where organization_id='$ORG' and type='Dup'")"
Q "delete from domain_events where organization_id='$ORG'" >/dev/null
