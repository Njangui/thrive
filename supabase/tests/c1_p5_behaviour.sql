-- Scénarios C1 P5 (migration 0107). Prérequis : stubs auth/rôles, 0001, 0002, 0103.
\set ON_ERROR_STOP off
grant all on all tables in schema public to service_role;
grant select on all tables in schema public to authenticated;
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000f1','owner@x'),('00000000-0000-0000-0000-0000000000f2','sales@x'),
 ('00000000-0000-0000-0000-0000000000f3','sales2@x'),('00000000-0000-0000-0000-0000000000f9','owner-b@x') on conflict do nothing;
insert into organizations(id,name,slug) values ('ffffffff-0000-0000-0000-000000000001','F','f'),('ffffffff-0000-0000-0000-000000000002','G','g') on conflict do nothing;
insert into memberships(organization_id,user_id,role) values
 ('ffffffff-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','owner'),
 ('ffffffff-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f2','sales'),
 ('ffffffff-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f3','sales'),
 ('ffffffff-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000f9','owner') on conflict do nothing;
insert into agent_runs(id,organization_id,agent_name,prompt_version,actor_user_id,channel,model_tier,status) values
 ('22222222-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000001','sales','v1','00000000-0000-0000-0000-0000000000f2','dashboard','small','completed');
\set F '''ffffffff-0000-0000-0000-000000000001'''
\set G '''ffffffff-0000-0000-0000-000000000002'''
\set R '''22222222-0000-0000-0000-000000000001'''
\set O '''00000000-0000-0000-0000-0000000000f1'''
\set S '''00000000-0000-0000-0000-0000000000f2'''
\set S2 '''00000000-0000-0000-0000-0000000000f3'''
\set OB '''00000000-0000-0000-0000-0000000000f9'''
\echo '--- F1 retour : demandeur OK (recorded) ; autre vendeur (forbidden) ; owner OK ; autre org (run_not_found) ; non-membre (forbidden)'
select record_feedback(:F::uuid,:R::uuid,:S::uuid,1::smallint,null,'bien');
select record_feedback(:F::uuid,:R::uuid,:S2::uuid,-1::smallint,'tone',null);
select record_feedback(:F::uuid,:R::uuid,:O::uuid,-1::smallint,'tone','trop sec');
select record_feedback(:G::uuid,:R::uuid,:OB::uuid,1::smallint,null,null);
select record_feedback(:F::uuid,:R::uuid,:OB::uuid,1::smallint,null,null);
\echo '--- F2 un seul retour par (run, auteur) : réécrit, pas dupliqué (attendu 1 ligne rating -1 pour f2)'
select record_feedback(:F::uuid,:R::uuid,:S::uuid,-1::smallint,'wrong_info',null);
select count(*) as nb_f2, min(rating) from feedback_events where actor_user_id=:S::uuid;
\echo '--- F3 contraintes : note 0, raison inconnue, commentaire > 500 (attendu ERREUR x3)'
select record_feedback(:F::uuid,:R::uuid,:O::uuid,0::smallint,null,null);
select record_feedback(:F::uuid,:R::uuid,:O::uuid,1::smallint,'inconnue',null);
insert into feedback_events(organization_id,run_id,actor_user_id,rating,comment) values (:F::uuid,null,:O::uuid,1,repeat('x',501));
\echo '--- F4 identité immuable (attendu ERREUR)'
update feedback_events set actor_user_id=:O::uuid where actor_user_id=:S::uuid;
\echo '--- F5 RLS : f3 ne voit rien ; f2 voit son retour ; owner voit tout (attendu 0, 1, 2)'
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f3',true); select count(*) from feedback_events; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f2',true); select count(*) from feedback_events; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',true); select count(*) from feedback_events; rollback;
\echo '--- F6 écriture directe refusée pour authenticated (attendu permission denied)'
set role authenticated; insert into feedback_events(organization_id,run_id,actor_user_id,rating) values (:F::uuid,:R::uuid,:S::uuid,1); reset role;
\echo '--- C1 consentement : défaut false ; vendeur ne peut pas décider (forbidden) ; owner accorde (granted)'
select has_training_consent(:F::uuid,'feedback_export') as attendu_f;
select record_training_consent(:F::uuid,'feedback_export',true,:S::uuid,'v1');
select has_training_consent(:F::uuid,'feedback_export') as attendu_f;
select record_training_consent(:F::uuid,'feedback_export',true,:O::uuid,'v1');
select has_training_consent(:F::uuid,'feedback_export') as attendu_t, has_training_consent(:F::uuid,'model_improvement') as autre_scope_attendu_f, has_training_consent(:G::uuid,'feedback_export') as autre_org_attendu_f;
\echo '--- C2 owner d''une AUTRE org ne peut pas décider (forbidden)'
select record_training_consent(:F::uuid,'feedback_export',true,:OB::uuid,'v1');
\echo '--- C3 scope inconnu (attendu ERREUR)'
select record_training_consent(:F::uuid,'tout',true,:O::uuid,'v1');
\echo '--- X1 export avec consentement : lignes sans commentaire ni utilisateur'
insert into outcome_events(organization_id,run_id,actor_user_id,kind,tool_name) values (:F::uuid,:R::uuid,:S::uuid,'draft_sent','notes.add');
select run_id::text, agent_name, rating, reason_code, outcomes from training_export_rows(:F::uuid, null, 100) order by rating;
select column_name from information_schema.columns where table_name='training_export_rows' and false;
\echo '--- X2 retrait immédiat => export vide (attendu 0)'
select record_training_consent(:F::uuid,'feedback_export',false,:O::uuid,'v1');
select count(*) as attendu_0 from training_export_rows(:F::uuid, null, 100);
\echo '--- X3 limite invalide (ERREUR) ; authenticated ne peut pas appeler'
select * from training_export_rows(:F::uuid, null, 0);
set role authenticated; select * from training_export_rows(:F::uuid, null, 10); reset role;
\echo '--- A1 append-only : outcome_events et consentements (attendu ERREUR x4)'
update outcome_events set kind='draft_edited';
delete from outcome_events;
update training_consent_events set granted=true;
delete from training_consent_events;
\echo '--- A2 suppression du run : retour et résultat conservés (run_id NULL), pas de blocage'
delete from agent_runs where id=:R::uuid;
select count(*) as feedback_conserves, count(run_id) as run_id_non_nuls from feedback_events;
select count(*) as outcomes_conserves, count(run_id) as run_id_non_nuls from outcome_events;
\echo '--- A3 suppression de l''organisation : tout part en cascade'
delete from organizations where id=:F::uuid;
select (select count(*) from feedback_events) + (select count(*) from outcome_events) + (select count(*) from training_consent_events) as attendu_0;
