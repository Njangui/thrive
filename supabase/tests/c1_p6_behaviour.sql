-- Scénarios C1 P6 (migration 0108, pgvector). Prérequis : stubs auth/rôles, 0001, 0002, extension vector.
\set ON_ERROR_STOP off
grant all on all tables in schema public to service_role;
grant select on all tables in schema public to authenticated;
create or replace function pg_temp.e(i int) returns vector language sql as $$
  select ('[' || array_to_string(array(select case when g = i then 1 else 0 end from generate_series(0,1023) g), ',') || ']')::vector $$;
-- vecteur proche de e(0) : 0.9 sur l'axe 0 et 0.1 sur l'axe 1
create or replace function pg_temp.near0() returns vector language sql as $$
  select ('[' || array_to_string(array(select case when g = 0 then 0.9 when g = 1 then 0.1 else 0 end from generate_series(0,1023) g), ',') || ']')::vector $$;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000e1','o@x'),('00000000-0000-0000-0000-0000000000e2','s@x'),('00000000-0000-0000-0000-0000000000e9','ob@x') on conflict do nothing;
insert into organizations(id,name,slug) values ('eeeeeeee-1111-0000-0000-000000000001','H','h'),('eeeeeeee-1111-0000-0000-000000000002','I','i') on conflict do nothing;
insert into memberships(organization_id,user_id,role) values
 ('eeeeeeee-1111-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','owner'),
 ('eeeeeeee-1111-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2','sales'),
 ('eeeeeeee-1111-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e9','owner') on conflict do nothing;
\set H '''eeeeeeee-1111-0000-0000-000000000001'''
\set I '''eeeeeeee-1111-0000-0000-000000000002'''
\set U '''00000000-0000-0000-0000-0000000000e1'''
\echo '--- M1 création, puis doublon (attendu created, duplicate même id)'
select * from memory_upsert(:H::uuid,'fact','Livraison gratuite à Douala',repeat('a',64),pg_temp.e(0),'mistral-embed','user',:U::uuid,null,500);
select * from memory_upsert(:H::uuid,'fact','Livraison gratuite à Douala',repeat('a',64),pg_temp.e(0),'mistral-embed','user',:U::uuid,null,500);
select * from memory_upsert(:H::uuid,'faq','Horaires 8h-18h',repeat('b',64),pg_temp.e(1),'mistral-embed','agent',:U::uuid,null,500);
select * from memory_upsert(:I::uuid,'fact','Secret autre org',repeat('c',64),pg_temp.e(0),'mistral-embed','user',null,null,500);
\echo '--- M2 quota (attendu quota_exceeded avec max 2)'
select out_status from memory_upsert(:H::uuid,'fact','Troisième',repeat('d',64),pg_temp.e(2),'mistral-embed','user',:U::uuid,null,2);
\echo '--- M3 recherche : vecteur proche de e(0) => « Livraison » en premier ; l''autre org JAMAIS'
select content, round(similarity::numeric,3) from memory_search(:H::uuid, pg_temp.near0(), 5, 0.0);
\echo '--- M4 seuil : min 0.9 ne garde que le plus proche (attendu 1 ligne)'
select content from memory_search(:H::uuid, pg_temp.near0(), 5, 0.9);
\echo '--- M5 limites invalides (ERREUR x2) ; mauvaise dimension (ERREUR)'
select * from memory_search(:H::uuid, pg_temp.near0(), 0, 0);
select * from memory_search(:H::uuid, pg_temp.near0(), 50, 0);
select * from memory_search(:H::uuid, '[1,2,3]'::vector, 5, 0);
\echo '--- M6 expirée exclue ; archivée exclue ; recréation possible après archivage'
select * from memory_upsert(:H::uuid,'fact','Promo périmée',repeat('e',64),pg_temp.e(3),'mistral-embed','user',:U::uuid,now()-interval '1 hour',500);
select count(*) as attendu_0 from memory_search(:H::uuid, pg_temp.e(3), 5, 0.5);
select memory_archive(:H::uuid, (select id from tenant_memory where content_hash=repeat('b',64)));
select count(*) as attendu_0 from memory_search(:H::uuid, pg_temp.e(1), 5, 0.5);
select out_status as attendu_created from memory_upsert(:H::uuid,'faq','Horaires 8h-18h',repeat('b',64),pg_temp.e(1),'mistral-embed','agent',:U::uuid,null,500);
select memory_archive(:I::uuid, (select id from tenant_memory where content_hash=repeat('a',64) and organization_id=:H::uuid)) as archivage_autre_org_attendu_not_found;
\echo '--- M7 contenu immuable (ERREUR) ; contraintes (hash court, contenu vide, kind inconnu : ERREUR x3)'
update tenant_memory set content='piraté' where content_hash=repeat('a',64);
select * from memory_upsert(:H::uuid,'fact','x','court',pg_temp.e(4),'m','user',null,null,500);
select * from memory_upsert(:H::uuid,'fact','','repeat',pg_temp.e(4),'m','user',null,null,500);
select * from memory_upsert(:H::uuid,'secret','x',repeat('f',64),pg_temp.e(4),'m','user',null,null,500);
\echo '--- M8 RLS : vendeur ne lit rien, owner lit son org seulement (attendu 0 puis 3 lignes max org H)'
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',true); select count(*) from tenant_memory; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',true); select count(*) as owner_voit, count(*) filter (where organization_id = :I::uuid) as autre_org_attendu_0 from tenant_memory; rollback;
\echo '--- M9 écriture directe et appel RPC refusés pour authenticated'
set role authenticated; insert into tenant_memory(organization_id,kind,content,content_hash,embedding,embedding_model,source) values (:H::uuid,'fact','x',repeat('9',64),pg_temp.e(5),'m','user'); reset role;
set role authenticated; select * from memory_search(:H::uuid, pg_temp.e(0), 5, 0); reset role;
\echo '--- M10 effacement définitif ; purge (date récente refusée)'
select memory_erase(:H::uuid, (select id from tenant_memory where content_hash=repeat('a',64) and organization_id=:H::uuid));
select count(*) as attendu_0 from tenant_memory where content_hash=repeat('a',64) and organization_id=:H::uuid;
select memory_purge(now());
select memory_purge(now() - interval '2 days') as purgees;
\echo '--- M11 suppression de l''organisation : cascade'
delete from organizations where id in (:H::uuid,:I::uuid);
select count(*) as attendu_0 from tenant_memory;
