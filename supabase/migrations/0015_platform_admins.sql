-- ============================================================
-- 0015_platform_admins.sql
-- Lot C — Console Super Admin (sections 44-49, 79 du master prompt).
-- Le Super Admin représente le PROPRIÉTAIRE de la plateforme SME-OS,
-- pas une entreprise cliente : ceci n'est PAS une extension de
-- `memberships`/`is_member_of_org()` (migration 0002), c'est un
-- mécanisme d'autorisation entièrement séparé. La console `/admin/*`
-- doit pouvoir lire/agir sur TOUTES les organisations.
-- ============================================================

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'super_admin',
  created_at timestamptz not null default now()
);

comment on table platform_admins is
  'Propriétaires de la plateforme SME-OS (Lot C) — jamais une entreprise '
  'cliente. V1 : devenir super admin = insertion manuelle en base (voir '
  'docs/DEPLOYMENT.md, section "Console Super Admin"), aucune UI de '
  'self-service volontairement.';

alter table platform_admins enable row level security;

-- Volontairement AUCUNE policy select/insert/update/delete pour les rôles
-- `authenticated`/`anon` : RLS activée + zéro policy = accès refusé par
-- défaut à tout rôle autre que service_role. Même une simple lecture
-- "suis-je admin ?" depuis un client authentifié serait un vecteur
-- d'énumération (tester des user_id un par un) — cette table n'est donc
-- lisible QUE par le service-role, exclusivement via
-- `requirePlatformAdmin()` côté serveur
-- (application/services/platform-admin-service.ts), jamais via une query
-- RLS-protégée classique comme `is_member_of_org()`.
