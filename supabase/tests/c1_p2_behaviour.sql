-- Scénarios comportementaux C1 P2 (migration 0103). Prérequis : stubs auth/rôles Supabase + migrations 0001, 0002, 0100-0103.
\set ON_ERROR_STOP off
grant all on all tables in schema public to authenticated, service_role;
grant select on auth.users to authenticated, service_role;
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','owner-a@x'),('00000000-0000-0000-0000-0000000000a2','sales-a@x'),
 ('00000000-0000-0000-0000-0000000000b1','owner-b@x');
insert into organizations(id,name,slug) values
 ('aaaaaaaa-0000-0000-0000-000000000001','A','a'),('bbbbbbbb-0000-0000-0000-000000000001','B','b');
insert into memberships(organization_id,user_id,role) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','owner'),
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','sales'),
 ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','owner');

\echo '--- R1 agent_runs : insertion et profondeur'
insert into agent_runs(id,organization_id,agent_name,prompt_version,actor_user_id,channel,model_tier)
 values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','orchestrator','v1','00000000-0000-0000-0000-0000000000a2','dashboard','small');
\echo 'depth=3 (attendu ERREUR)'
insert into agent_runs(organization_id,agent_name,prompt_version,actor_user_id,channel,model_tier,depth)
 values ('aaaaaaaa-0000-0000-0000-000000000001','x','v1','00000000-0000-0000-0000-0000000000a2','dashboard','small',3);
\echo 'sous-run depth=1 (attendu OK)'
insert into agent_runs(id,organization_id,agent_name,prompt_version,actor_user_id,channel,model_tier,depth,parent_run_id)
 values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','catalog','v1','00000000-0000-0000-0000-0000000000a2','dashboard','small',1,'11111111-1111-1111-1111-111111111111');

\echo '--- R2 gardes de mise à jour'
\echo 'changer agent_name (attendu ERREUR)'
update agent_runs set agent_name='autre' where id='11111111-1111-1111-1111-111111111111';
\echo 'changer organization_id (attendu ERREUR)'
update agent_runs set organization_id='bbbbbbbb-0000-0000-0000-000000000001' where id='11111111-1111-1111-1111-111111111111';
\echo 'compteurs en hausse (attendu OK)'
update agent_runs set steps_count=2, units_used=3, input_tokens=100, output_tokens=40 where id='11111111-1111-1111-1111-111111111111';
\echo 'compteurs en baisse (attendu ERREUR)'
update agent_runs set steps_count=1 where id='11111111-1111-1111-1111-111111111111';
\echo 'running -> awaiting_approval -> running (attendu OK)'
update agent_runs set status='awaiting_approval' where id='11111111-1111-1111-1111-111111111111';
update agent_runs set status='running' where id='11111111-1111-1111-1111-111111111111';
\echo 'running -> completed (attendu OK)'
update agent_runs set status='completed', finished_at=now() where id='11111111-1111-1111-1111-111111111111';
\echo 'modifier une exécution terminée (attendu ERREUR)'
update agent_runs set units_used=99 where id='11111111-1111-1111-1111-111111111111';
update agent_runs set status='running' where id='11111111-1111-1111-1111-111111111111';

\echo '--- R3 agent_steps immuables'
insert into agent_steps(run_id,organization_id,step_index,kind,model,prompt_version,status)
 values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',0,'llm','m','v1','ok');
\echo 'doublon (run_id, step_index) (attendu ERREUR)'
insert into agent_steps(run_id,organization_id,step_index,kind,status) values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',0,'llm','ok');
\echo 'UPDATE step (attendu ERREUR)'
update agent_steps set units=5;
\echo 'DELETE step (attendu ERREUR)'
delete from agent_steps;

\echo '--- R4 coupe-circuit : un seul actif par (tenant, agent)'
insert into agent_circuit_breakers(organization_id,agent_name,tripped_by) values ('aaaaaaaa-0000-0000-0000-000000000001',null,'00000000-0000-0000-0000-0000000000a1');
\echo 'doublon tenant (attendu ERREUR)'
insert into agent_circuit_breakers(organization_id,agent_name) values ('aaaaaaaa-0000-0000-0000-000000000001',null);
\echo 'autre agent (attendu OK)'
insert into agent_circuit_breakers(organization_id,agent_name) values ('aaaaaaaa-0000-0000-0000-000000000001','catalog');
\echo 'relâcher puis ré-armer (attendu OK)'
update agent_circuit_breakers set released_at=now() where agent_name is null;
insert into agent_circuit_breakers(organization_id,agent_name) values ('aaaaaaaa-0000-0000-0000-000000000001',null);
\echo 'modifier reason (attendu ERREUR)'
update agent_circuit_breakers set reason='autre' where agent_name='catalog';

\echo '--- R5 RLS'
insert into agent_runs(id,organization_id,agent_name,prompt_version,actor_user_id,channel,model_tier)
 values ('33333333-3333-3333-3333-333333333333','bbbbbbbb-0000-0000-0000-000000000001','orchestrator','v1','00000000-0000-0000-0000-0000000000b1','dashboard','small');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
\echo 'owner A : runs=2 steps=1 breakers=3'
select (select count(*) from agent_runs) r, (select count(*) from agent_steps) s, (select count(*) from agent_circuit_breakers) b;
\echo 'owner A INSERT run (attendu ERREUR RLS)'
insert into agent_runs(organization_id,agent_name,prompt_version,actor_user_id,channel,model_tier) values ('aaaaaaaa-0000-0000-0000-000000000001','x','v1','00000000-0000-0000-0000-0000000000a1','dashboard','small');
\echo 'owner A arme un coupe-circuit pour le tenant B (attendu ERREUR RLS)'
insert into agent_circuit_breakers(organization_id,agent_name) values ('bbbbbbbb-0000-0000-0000-000000000001','x');
\echo 'owner A arme pour son tenant (attendu OK)'
insert into agent_circuit_breakers(organization_id,agent_name) values ('aaaaaaaa-0000-0000-0000-000000000001','media');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
\echo 'sales A : runs=2 (les siens) steps=0 breakers=4 (lecture membres)'
select (select count(*) from agent_runs) r, (select count(*) from agent_steps) s, (select count(*) from agent_circuit_breakers) b;
\echo 'sales A arme un coupe-circuit (attendu ERREUR RLS)'
insert into agent_circuit_breakers(organization_id,agent_name) values ('aaaaaaaa-0000-0000-0000-000000000001','y');
\echo 'sales A relâche (attendu 0 ligne)'
update agent_circuit_breakers set released_at=now() where agent_name='media';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
\echo 'owner B : runs=1 steps=0 breakers=0'
select (select count(*) from agent_runs) r, (select count(*) from agent_steps) s, (select count(*) from agent_circuit_breakers) b;
