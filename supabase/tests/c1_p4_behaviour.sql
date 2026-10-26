-- Scénarios C1 P4 (migrations 0105, 0106). Prérequis : stubs auth/rôles, 0001, 0002, 0103.
\set ON_ERROR_STOP off
grant all on all tables in schema public to service_role;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000d1','d@x') on conflict do nothing;
insert into organizations(id,name,slug) values ('dddddddd-0000-0000-0000-000000000001','D','d') on conflict do nothing;
\set D '''dddddddd-0000-0000-0000-000000000001'''
\set U '''00000000-0000-0000-0000-0000000000d1'''
\echo '--- E1 émission idempotente (attendu emitted puis duplicate, même id)'
select * from emit_domain_event(:D::uuid,'ProductChanged','{"productId":"p1"}','k1');
select * from emit_domain_event(:D::uuid,'ProductChanged','{"productId":"p1"}','k1');
\echo '--- E2 claim (attendu 1 ligne processing attempts=1), second claim vide'
select status, attempts from claim_domain_events(10, 60);
select count(*) as second_claim_attendu_0 from claim_domain_events(10, 60);
\echo '--- E3 échec => retry puis dead après max (attendu retry, retry, dead)'
update domain_events set locked_until = now() - interval '1 second';
select fail_domain_event(id,'boom',3) from domain_events;
update domain_events set next_attempt_at = now() - interval '1 second';
select attempts from claim_domain_events(10,60);
select fail_domain_event(id,'boom',3) from domain_events;
update domain_events set next_attempt_at = now() - interval '1 second';
select attempts from claim_domain_events(10,60);
select fail_domain_event(id,'boom',3) from domain_events;
select status, attempts from domain_events;
\echo '--- E4 bail expiré repris ; complete => done ; limites invalides (ERREUR)'
select * from emit_domain_event(:D::uuid,'ProductChanged','{}',null);
select count(*) as pris_attendu_1 from claim_domain_events(10,60);
update domain_events set locked_until = now() - interval '1 second' where status='processing';
select count(*) as repris_attendu_1 from claim_domain_events(10,60);
select complete_domain_event(id) as attendu_done from domain_events where status='processing';
select * from claim_domain_events(0,60);
\echo '--- E5 RLS : authenticated ne lit/écrit rien (attendu permission denied)'
set role authenticated; select count(*) from domain_events; select * from emit_domain_event(:D::uuid,'x','{}',null); reset role;
\echo '--- S1 tâche once : claim, complete => completed, plus jamais due'
insert into scheduled_tasks(organization_id,created_by,agent_name,instruction,schedule_kind,next_run_at) values (:D::uuid,:U::uuid,'sales','relance','once',now()-interval '1 minute');
select agent_name from claim_scheduled_tasks(10,60);
select count(*) as pas_de_double_claim_attendu_0 from claim_scheduled_tasks(10,60);
select complete_scheduled_task(id,true,'completed',5) as attendu_completed from scheduled_tasks;
select enabled from scheduled_tasks;
\echo '--- S2 interval : prochaine échéance dans le futur ; désactivation après 3 échecs'
insert into scheduled_tasks(organization_id,created_by,agent_name,instruction,schedule_kind,interval_seconds,next_run_at) values (:D::uuid,:U::uuid,'sales','digest','interval',3600,now()-interval '10 days');
select complete_scheduled_task(id,false,'failed',3) as r1 from scheduled_tasks where schedule_kind='interval';
select next_run_at > now() as futur_attendu_t, consecutive_failures from scheduled_tasks where schedule_kind='interval';
select complete_scheduled_task(id,false,'failed',3) as r2 from scheduled_tasks where schedule_kind='interval';
select complete_scheduled_task(id,false,'failed',3) as attendu_disabled from scheduled_tasks where schedule_kind='interval';
select enabled from scheduled_tasks where schedule_kind='interval';
\echo '--- S3 contraintes : intervalle < 300 s, once avec intervalle (attendu ERREUR x2)'
insert into scheduled_tasks(organization_id,created_by,agent_name,instruction,schedule_kind,interval_seconds,next_run_at) values (:D::uuid,:U::uuid,'a','i','interval',60,now());
insert into scheduled_tasks(organization_id,created_by,agent_name,instruction,schedule_kind,interval_seconds,next_run_at) values (:D::uuid,:U::uuid,'a','i','once',600,now());
\echo '--- S4 RLS scheduled_tasks : écriture refusée pour authenticated'
set role authenticated; insert into scheduled_tasks(organization_id,created_by,agent_name,instruction,schedule_kind,next_run_at) values (:D::uuid,:U::uuid,'a','i','once',now()); reset role;
\echo '--- R1 runs bloqués : seul running ancien clos ; awaiting_approval intact'
insert into agent_runs(id,organization_id,agent_name,prompt_version,actor_user_id,channel,model_tier,status,created_at) values
 ('11111111-0000-0000-0000-000000000001',:D::uuid,'a','v1',:U::uuid,'dashboard','small','running',now()-interval '2 hours'),
 ('11111111-0000-0000-0000-000000000002',:D::uuid,'a','v1',:U::uuid,'dashboard','small','running',now()),
 ('11111111-0000-0000-0000-000000000003',:D::uuid,'a','v1',:U::uuid,'dashboard','small','awaiting_approval',now()-interval '2 hours');
select close_stuck_agent_runs(3600) as attendu_1;
select id::text, status, error_code from agent_runs order by id;
select close_stuck_agent_runs(10);
\echo '--- R2 purge : date trop récente refusée ; ne purge ni running ni awaiting_approval'
select purge_agent_runs(now());
alter table agent_runs disable trigger trg_agent_runs_guard_update; -- mise en place du test uniquement
update agent_runs set created_at = now() - interval '400 days' where id in ('11111111-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000003');
alter table agent_runs enable trigger trg_agent_runs_guard_update;
select purge_agent_runs(now() - interval '300 days') as attendu_1;
select id::text, status from agent_runs order by id;
\echo '--- R3 purge événements : seuls les done anciens'
update domain_events set processed_at = now() - interval '400 days' where status='done';
select purge_domain_events(now() - interval '300 days') as attendu_1;
select status from domain_events;
