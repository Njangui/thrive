-- Scénarios comportementaux C1 P3 (migration 0104). Prérequis : stubs auth/rôles Supabase + migrations 0001, 0002, 0011, 0043, 0100, 0104.
\set ON_ERROR_STOP off
grant all on all tables in schema public to authenticated, service_role;
grant select on auth.users to authenticated, service_role;
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','owner-a@x'),('00000000-0000-0000-0000-0000000000a2','sales-a@x'),
 ('00000000-0000-0000-0000-0000000000a3','acct-a@x'),('00000000-0000-0000-0000-0000000000b1','owner-b@x');
insert into organizations(id,name,slug) values
 ('aaaaaaaa-0000-0000-0000-000000000001','A','a'),('bbbbbbbb-0000-0000-0000-000000000001','B','b');
insert into memberships(organization_id,user_id,role) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','owner'),
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','sales'),
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3','accountant'),
 ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','owner');
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000001'''
\set U '''00000000-0000-0000-0000-0000000000a1'''

\echo '--- W1 portefeuille : sans solde => insufficient'
select * from public.usage_charge(:A::uuid, :U::uuid, 'media', 1, 'w1-a');
\echo '--- W2 recharge idempotente (attendu credited 10 puis duplicate 10)'
select * from public.wallet_topup(:A::uuid, 'media', 10, 'tu-1', :U::uuid);
select * from public.wallet_topup(:A::uuid, 'media', 10, 'tu-1', :U::uuid);
\echo 'units <= 0 (attendu ERREUR)'
select * from public.wallet_topup(:A::uuid, 'media', 0, 'tu-2', :U::uuid);
\echo '--- W3 débit idempotent (attendu charged balance 7, puis duplicate)'
select * from public.usage_charge(:A::uuid, :U::uuid, 'media', 3, 'c-1');
select * from public.usage_charge(:A::uuid, :U::uuid, 'media', 3, 'c-1');
select balance as solde_attendu_7 from public.wallet_balances where organization_id=:A::uuid and kind='media';
\echo '--- W4 solde jamais négatif : 8 > 7 (attendu insufficient, solde 7)'
select * from public.usage_charge(:A::uuid, :U::uuid, 'media', 8, 'c-2');
select balance from public.wallet_balances where organization_id=:A::uuid and kind='media';
\echo 'UPDATE direct négatif (attendu ERREUR check)'
update public.wallet_balances set balance=-1 where organization_id=:A::uuid;

\echo '--- W5 réserve / release / commit'
select * from public.usage_reserve(:A::uuid, :U::uuid, 'media', 2, 'r-1');
\echo 'solde 5 :' 
select balance from public.wallet_balances where organization_id=:A::uuid and kind='media';
select * from public.usage_release(:A::uuid, 'r-1');
select * from public.usage_release(:A::uuid, 'r-1');
\echo 'solde 7 (restitué) ; commit après release => released'
select balance from public.wallet_balances where organization_id=:A::uuid and kind='media';
select public.usage_commit(:A::uuid, 'r-1');
\echo 'commit inconnu => not_found ; release inconnu => not_found'
select public.usage_commit(:A::uuid, 'nope');
select * from public.usage_release(:A::uuid, 'nope');
\echo 'reserve + commit + commit => committed, duplicate ; release après commit => already_committed'
select * from public.usage_reserve(:A::uuid, :U::uuid, 'media', 2, 'r-2');
select public.usage_commit(:A::uuid, 'r-2');
select public.usage_commit(:A::uuid, 'r-2');
select * from public.usage_release(:A::uuid, 'r-2');

\echo '--- W6 refund : avant commit => not_committed ; après => refunded (solde +2) ; 2e => duplicate'
select * from public.usage_reserve(:A::uuid, :U::uuid, 'media', 1, 'r-3');
select * from public.usage_refund(:A::uuid, 'r-3', 'test');
select public.usage_commit(:A::uuid, 'r-3');
select balance as avant_refund from public.wallet_balances where organization_id=:A::uuid and kind='media';
select * from public.usage_refund(:A::uuid, 'r-3', 'échec livraison');
select * from public.usage_refund(:A::uuid, 'r-3', 'échec livraison');
select balance as apres_refund from public.wallet_balances where organization_id=:A::uuid and kind='media';

\echo '--- W7 alerte de solde bas (seuil 4) : 1 seule alerte jusqu''à recharge'
update public.wallet_balances set low_balance_threshold=4 where organization_id=:A::uuid and kind='media';
select balance from public.wallet_balances where organization_id=:A::uuid and kind='media';
select * from public.usage_charge(:A::uuid, :U::uuid, 'media', 2, 'lb-1');
select * from public.usage_charge(:A::uuid, :U::uuid, 'media', 1, 'lb-2');
\echo 'recharge => alerte ré-armée, puis nouveau franchissement => alerte'
select * from public.wallet_topup(:A::uuid, 'media', 20, 'tu-3', :U::uuid);
select low_balance_alerted_at is null as rearmee from public.wallet_balances where organization_id=:A::uuid and kind='media';

\echo '--- P1 IA : crédits du plan d''abord, puis portefeuille'
insert into ai_credit_balances(organization_id, included_credits, used_credits) values (:A::uuid, 3, 0);
select * from public.usage_charge(:A::uuid, :U::uuid, 'ai', 2, 'ai-1');
select used_credits as utilise_2 from ai_credit_balances where organization_id=:A::uuid;
\echo 'plan insuffisant (reste 1 < 2) et pas de portefeuille ai => insufficient, plan intact'
select * from public.usage_charge(:A::uuid, :U::uuid, 'ai', 2, 'ai-2');
select used_credits as utilise_2 from ai_credit_balances where organization_id=:A::uuid;
\echo 'recharge ai 5 puis débit 2 : plan insuffisant => portefeuille (source wallet)'
select * from public.wallet_topup(:A::uuid, 'ai', 5, 'tu-ai', :U::uuid);
select * from public.usage_charge(:A::uuid, :U::uuid, 'ai', 2, 'ai-3');
\echo 'débit 1 : plan (source plan) ; release restitue au PLAN'
select * from public.usage_reserve(:A::uuid, :U::uuid, 'ai', 1, 'ai-4');
select used_credits as utilise_3 from ai_credit_balances where organization_id=:A::uuid;
select * from public.usage_release(:A::uuid, 'ai-4');
select used_credits as utilise_2 from ai_credit_balances where organization_id=:A::uuid;
\echo 'quantité non entière pour ai : plan ignoré, portefeuille utilisé (attendu wallet)'
select * from public.usage_charge(:A::uuid, :U::uuid, 'ai', 0.5, 'ai-5');
\echo 'plan illimité (-1) : charged source plan'
insert into ai_credit_balances(organization_id, included_credits, used_credits) values (:B::uuid, -1, 0);
select * from public.usage_charge(:B::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, 'ai', 50, 'unl-1');

\echo '--- L1 journal append-only'
\echo 'UPDATE (attendu ERREUR)'
update usage_ledger set units=99;
\echo 'DELETE (attendu ERREUR)'
delete from usage_ledger;
\echo 'TRUNCATE (attendu ERREUR)'
truncate usage_ledger;
\echo 'doublon (org, ref, type) (attendu ERREUR)'
insert into usage_ledger(organization_id,kind,entry_type,units,ref) values (:A::uuid,'media','reserve',1,'c-1');
\echo 'nature invalide (attendu ERREUR)'
select * from public.usage_charge(:A::uuid, :U::uuid, 'sms', 1, 'bad-kind');

\echo '--- T1 recharges : règlement après vérification'
insert into wallet_topups(id,organization_id,kind,units,amount_minor,currency,requested_by,provider_reference)
 values ('11111111-1111-1111-1111-111111111111',:A::uuid,'message',100,5000,'XAF',:U::uuid,'prov-1'),
        ('22222222-2222-2222-2222-222222222222',:A::uuid,'message',50,2500,'XAF',:U::uuid,'prov-2');
\echo 'montant 0 (attendu ERREUR)'
insert into wallet_topups(organization_id,kind,units,amount_minor,currency,requested_by) values (:A::uuid,'message',1,0,'XAF',:U::uuid);
\echo 'paid => credited 100 ; rejoué => duplicate ; solde 100'
select * from public.wallet_topup_settle('prov-1','paid');
select * from public.wallet_topup_settle('prov-1','paid');
select balance from public.wallet_balances where organization_id=:A::uuid and kind='message';
\echo 'failed puis paid sur prov-2 => failed puis duplicate (jamais crédité) ; inconnue => not_found'
select * from public.wallet_topup_settle('prov-2','failed');
select * from public.wallet_topup_settle('prov-2','paid');
select * from public.wallet_topup_settle('prov-x','paid');
select balance as toujours_100 from public.wallet_balances where organization_id=:A::uuid and kind='message';
\echo 'modifier units/montant (attendu ERREUR) ; statut terminal (attendu ERREUR)'
update wallet_topups set units=999999 where provider_reference='prov-1';
update wallet_topups set amount_minor=1 where provider_reference='prov-1';
update wallet_topups set status='pending' where provider_reference='prov-1';

\echo '--- R1 RLS (rôle authenticated)'
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
\echo 'owner A : wallets>0, ledger>0, topups=2'
select (select count(*)>0 from wallet_balances) w, (select count(*)>0 from usage_ledger) l, (select count(*) from wallet_topups) t;
\echo 'owner A ne voit jamais B (attendu 0)'
select count(*) from usage_ledger where organization_id=:B::uuid;
\echo 'owner A INSERT wallet (attendu ERREUR RLS)'
insert into wallet_balances(organization_id,kind,balance) values (:A::uuid,'channel',1000000);
\echo 'owner A UPDATE solde (attendu 0 ligne)'
update wallet_balances set balance=999999 where organization_id=:A::uuid;
\echo 'owner A appelle usage_charge (attendu ERREUR droit)'
select * from public.usage_charge(:A::uuid, :U::uuid, 'media', 1, 'hack');
\echo 'owner A appelle wallet_topup (attendu ERREUR droit)'
select * from public.wallet_topup(:A::uuid, 'media', 1000, 'hack', :U::uuid);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
\echo 'comptable A : lecture OK (attendu >0)'
select count(*) from usage_ledger;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
\echo 'sales A : 0 partout'
select (select count(*) from wallet_balances) w, (select count(*) from usage_ledger) l, (select count(*) from wallet_topups) t;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
\echo 'owner B : ne voit que B (ledger B = 2 : réserve + confirmation, topups = 0)'
select (select count(*) from usage_ledger) l, (select count(*) from wallet_topups) t;
