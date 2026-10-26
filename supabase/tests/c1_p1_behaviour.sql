-- Scénarios comportementaux C1 P1 (migrations 0100-0102). Prérequis : stubs auth/rôles Supabase + migrations 0001, 0002, 0100-0102. Chaque ligne « attendu » est vérifiée à la main/CI psql.
\set ON_ERROR_STOP off
grant all on all tables in schema public to authenticated, service_role;
grant select on auth.users to authenticated, service_role;
-- données
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','owner-a@x'),('00000000-0000-0000-0000-0000000000a2','sales-a@x'),
 ('00000000-0000-0000-0000-0000000000b1','owner-b@x');
insert into organizations(id,name,slug) values
 ('aaaaaaaa-0000-0000-0000-000000000001','A','a'),('bbbbbbbb-0000-0000-0000-000000000001','B','b');
insert into memberships(organization_id,user_id,role) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','owner'),
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','sales'),
 ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','owner');

\echo '--- T1 agent_settings: sensitive=allow refusé (attendu ERREUR)'
insert into agent_settings(organization_id,autonomy) values ('aaaaaaaa-0000-0000-0000-000000000001','{"sensitive":"allow"}');
\echo '--- T2 agent_settings valide (attendu INSERT 0 1)'
insert into agent_settings(organization_id,autonomy,enabled_tools) values ('aaaaaaaa-0000-0000-0000-000000000001','{"write_reversible":"allow"}','{catalog.read}');
insert into agent_settings(organization_id) values ('bbbbbbbb-0000-0000-0000-000000000001');

\echo '--- T3 pending_actions: insertion + transitions'
insert into pending_actions(id,organization_id,tool_name,params,params_hash,requested_by,channel,expires_at)
 values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','orders.refund','{"amount":10}',repeat('a',64),'00000000-0000-0000-0000-0000000000a2','dashboard',now()+interval '15 min');
\echo 'modifier params (attendu ERREUR)'
update pending_actions set params='{"amount":99999}' where id='11111111-1111-1111-1111-111111111111';
\echo 'modifier params_hash (attendu ERREUR)'
update pending_actions set params_hash=repeat('b',64) where id='11111111-1111-1111-1111-111111111111';
\echo 'pending -> executed direct (attendu ERREUR)'
update pending_actions set status='executed' where id='11111111-1111-1111-1111-111111111111';
\echo 'pending -> approved sans approbateur (attendu OK: contrainte absente en base, le service renseigne approved_by)'
update pending_actions set status='approved', approved_by='00000000-0000-0000-0000-0000000000a1', decided_at=now() where id='11111111-1111-1111-1111-111111111111';
update pending_actions set status='executed', executed_at=now() where id='11111111-1111-1111-1111-111111111111';
\echo 'executed -> approved (attendu ERREUR)'
update pending_actions set status='approved' where id='11111111-1111-1111-1111-111111111111';
\echo 'executed -> pending (attendu ERREUR)'
update pending_actions set status='pending' where id='11111111-1111-1111-1111-111111111111';

\echo '--- T4 audit append-only'
insert into agent_audit_events(organization_id,actor_user_id,channel,tool_name,risk,event,decision) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','dashboard','orders.refund','sensitive','decision','confirm'),
 ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','dashboard','catalog.read','read','decision','allow');
\echo 'UPDATE (attendu ERREUR)'
update agent_audit_events set reason='x';
\echo 'DELETE direct (attendu ERREUR)'
delete from agent_audit_events;
\echo 'TRUNCATE (INFO: non couvert par trigger row-level)'
\echo 'purge via fonction (attendu 1)'
select purge_agent_audit_events('bbbbbbbb-0000-0000-0000-000000000001', now()+interval '1 day');
\echo 'cascade suppression tenant B (attendu DELETE 1 sans erreur)'
insert into agent_audit_events(organization_id,channel,tool_name,risk,event) values ('bbbbbbbb-0000-0000-0000-000000000001','scheduler','x.y','read','decision');
delete from organizations where id='bbbbbbbb-0000-0000-0000-000000000001';
select count(*) as audit_restants_tenant_B from agent_audit_events where organization_id='bbbbbbbb-0000-0000-0000-000000000001';

\echo '--- T5 RLS (rôle authenticated)'
insert into organizations(id,name,slug) values ('bbbbbbbb-0000-0000-0000-000000000002','B2','b2');
insert into memberships(organization_id,user_id,role) values ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1','owner');
insert into agent_settings(organization_id) values ('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
\echo 'owner A voit settings: attendu 1'
select count(*) from agent_settings;
\echo 'owner A voit audit: attendu 1'
select count(*) from agent_audit_events;
\echo 'owner A voit pending: attendu 1'
select count(*) from pending_actions;
\echo 'owner A UPDATE settings tenant B2 (attendu 0 ligne)'
update agent_settings set budget='{"x":1}' where organization_id='bbbbbbbb-0000-0000-0000-000000000002';
\echo 'owner A INSERT pending_actions (attendu ERREUR RLS)'
insert into pending_actions(organization_id,tool_name,params,params_hash,requested_by,channel,expires_at) values ('aaaaaaaa-0000-0000-0000-000000000001','x.y','{}',repeat('a',64),'00000000-0000-0000-0000-0000000000a1','dashboard',now()+interval '1 min');
\echo 'owner A INSERT audit (attendu ERREUR RLS)'
insert into agent_audit_events(organization_id,channel,tool_name,risk,event) values ('aaaaaaaa-0000-0000-0000-000000000001','dashboard','x.y','read','decision');
\echo 'owner A purge audit (attendu ERREUR droit)'
select purge_agent_audit_events('aaaaaaaa-0000-0000-0000-000000000001', now()+interval '1 day');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
\echo 'sales A voit settings: attendu 1 ; audit: attendu 0 ; pending (demandeur): attendu 1'
select (select count(*) from agent_settings) s, (select count(*) from agent_audit_events) a, (select count(*) from pending_actions) p;
\echo 'sales A UPDATE settings (attendu 0 ligne)'
update agent_settings set budget='{"x":1}' where organization_id='aaaaaaaa-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
\echo 'owner B voit settings (B2 seulement): attendu 1 ; audit: 0 ; pending: 0'
select (select count(*) from agent_settings) s, (select count(*) from agent_audit_events) a, (select count(*) from pending_actions) p;
