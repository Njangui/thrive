-- ============================================================
-- 0011_ai_credits.sql
-- Lot B — Plans, Entitlements & Feature Gating.
--
-- IMPORTANT (voir rapport de livraison Lot B) : le cahier des charges
-- décrit ce système comme déjà construit et fonctionnel ("Un système de
-- crédits IA est déjà construit et fonctionnel : supabase/migrations/
-- 0012_ai_credits.sql (...) Ne recréez pas ce système"). Ce n'est PAS le
-- cas dans le code source fourni : ni cette migration, ni
-- ai-credits-service.ts, ni le moindre branchement dans
-- ai-response-service.ts / conversation-orchestrator.ts n'existaient
-- (vérifié par recherche exhaustive de "credit" sur tout le repo avant
-- d'écrire cette migration). Cette migration RECRÉE donc le socle minimal
-- nécessaire pour que `canUseFeature('ai_credits', ...)` (entitlements-
-- service.ts) ait quelque chose de réel à interroger, conformément au
-- reste du Lot B qui suppose son existence. Si une autre équipe a
-- également produit ce fichier de son côté, réconcilier au moment de la
-- fusion (convention "Intégration entre équipes parallèles",
-- 00_CONVENTIONS_COMMUNES.md) plutôt que d'appliquer les deux.
--
-- Numérotation : le cahier assignait 0014 à la migration plans/
-- entitlements en supposant 0011-0013 déjà occupées par d'autres lots.
-- Le code livré s'arrête à 0010 : on utilise donc 0011/0012, conforme à
-- la clause "en cas de collision au moment de la fusion, elles seront
-- renumérotées, ce n'est pas bloquant".
-- ============================================================

-- Solde de crédits IA par organisation. Une ligne par tenant, créée par
-- `initializeCreditBalance()` (application/services/ai-credits-service.ts)
-- — typiquement à l'onboarding, avec la valeur incluse dans son plan
-- (`plan_entitlements.entitlement_key = 'ai_credits'`, voir
-- 0012_plans_entitlements.sql).
create table ai_credit_balances (
  organization_id uuid primary key references organizations(id) on delete cascade,
  -- Snapshot au moment de l'initialisation/dernier ajustement, PAS une
  -- lecture live de plan_entitlements à chaque appel : un changement de
  -- plan en cours de période ne doit pas réduire silencieusement un solde
  -- déjà consommé. -1 = illimité.
  included_credits integer not null default 0,
  used_credits integer not null default 0 check (used_credits >= 0),
  updated_at timestamptz not null default now()
);

create trigger trg_ai_credit_balances_updated_at
  before update on ai_credit_balances
  for each row execute function set_updated_at();

comment on table ai_credit_balances is
  'Lot B : solde de crédits IA par tenant. Consommé via consumeCredit(), '
  'vérifié via hasCreditsAvailable()/getCreditStatus() (ai-credits-service.ts). '
  'La mise à jour used_credits n''est PAS atomique en V1 (read-then-write, '
  'voir commentaire dans consumeCredit()) — acceptable au volume actuel, '
  'à durcir (fonction SQL d''incrément atomique) si la concurrence augmente.';

-- Historique des mouvements (consommation ET ajout manuel via
-- grantCredits()) — utile pour le Super Admin (Lot C) et pour le support.
create table ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null default 'consumption' check (type in ('consumption', 'grant')),
  amount integer not null check (amount > 0),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_ai_usage_events_org on ai_usage_events(organization_id);
create index idx_ai_usage_events_org_created on ai_usage_events(organization_id, created_at desc);

alter table ai_credit_balances enable row level security;
alter table ai_usage_events enable row level security;

-- Lecture par tous les membres (affichage de la jauge sur /dashboard/
-- subscription) ; écriture réservée au service_role (consumeCredit/
-- grantCredits/initializeCreditBalance tournent côté serveur) — pas de
-- policy INSERT/UPDATE publique, cohérent avec le pattern déjà utilisé
-- pour ai_config (0005_providers_and_ai.sql).
create policy "members can read ai_credit_balances of their org"
  on ai_credit_balances for select
  using (is_member_of_org(organization_id));

create policy "members can read ai_usage_events of their org"
  on ai_usage_events for select
  using (is_member_of_org(organization_id));
