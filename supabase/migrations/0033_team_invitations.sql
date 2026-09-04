-- ============================================================
-- 0033_team_invitations.sql
-- Lot L, Partie 1 — invitation d'équipe (master prompt section 8).
-- ============================================================

create table team_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role member_role not null,
  invited_by uuid references auth.users(id),
  -- randomBytes(32).toString("hex") côté application (team-service.ts) —
  -- 256 bits d'entropie, jamais un crypto.randomUUID() seul (cahier,
  -- section "Sécurité" : trop court/prévisible pour un lien capacitaire).
  token text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_team_invitations_updated_at
  before update on team_invitations
  for each row execute function set_updated_at();

create index idx_team_invitations_org on team_invitations(organization_id);
-- Le lookup de acceptInvitation(token, userId) se fait uniquement par
-- token (jamais organization_id, inconnu tant que l'invitation n'est pas
-- résolue) — `unique` ci-dessus crée déjà l'index nécessaire, mais on le
-- documente explicitement puisque c'est le chemin d'accès principal.
comment on column team_invitations.token is
  'Chemin d''accès principal (acceptInvitation) : unique() fournit déjà '
  'l''index. Revérifié à CHAQUE usage (status=pending ET expires_at>now()), '
  'jamais mis en cache après la première vérification.';

-- Une seule invitation EN ATTENTE par (org, email) — garde-fou DB en plus
-- de la logique applicative (inviteMember révoque l'ancienne avant d'en
-- créer une nouvelle) : index partiel, pas une contrainte unique globale,
-- pour permettre plusieurs invitations historiques (revoked/expired/accepted)
-- pour la même adresse au fil du temps (jamais de suppression d'historique).
create unique index idx_team_invitations_org_email_pending
  on team_invitations(organization_id, email)
  where status = 'pending';

alter table team_invitations enable row level security;

-- Mêmes règles que memberships/ai_config (0001/0002/0005) : tous les
-- membres peuvent VOIR les invitations de leur org (transparence
-- d'équipe), seuls owner/admin peuvent les créer/modifier. L'acceptation
-- elle-même (acceptInvitation) passe TOUJOURS par le service-role côté
-- serveur — l'utilisateur qui accepte n'est par définition pas encore
-- membre de l'organisation au moment de l'appel, donc `is_member_of_org`
-- ne pourrait de toute façon pas l'autoriser via une policy classique.
create policy "members can read team_invitations of their org"
  on team_invitations for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can manage team_invitations"
  on team_invitations for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
