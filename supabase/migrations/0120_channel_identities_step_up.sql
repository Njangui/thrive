-- ============================================================
-- 0120_channel_identities_step_up.sql
-- C2 (canaux back-office) — étape 1 : identités de canal + authentification
-- renforcée (StepUp).
--
-- Plage de migrations C2 : 0120-0139 (voir CONTEXTE COMMUN §3).
--
-- Objet :
--   1. `channel_identities`   : lie un identifiant de canal (Telegram user id,
--      numéro WhatsApp E.164) à UN membership. C'est la seule source de
--      vérité pour transformer un message entrant en `Actor`.
--   2. `channel_link_codes`   : codes à usage unique (hachés) générés depuis le
--      dashboard connecté, consommés par `/start CODE` (Telegram).
--   3. `step_up_pins`         : PIN haché par membership, avec compteur
--      d'échecs et verrouillage progressif.
--   4. `step_up_challenges`   : défis d'authentification renforcée, liés à
--      l'empreinte exacte de l'action à valider, avec expiration courte.
--
-- Principe de sécurité : TOUTES les écritures passent par service_role (via
-- les services applicatifs, qui vérifient acteur + tenant) ou par les
-- fonctions SECURITY DEFINER ci-dessous, révoquées pour anon/authenticated.
-- Les policies authenticated sont en LECTURE seule, et ne donnent jamais accès
-- aux hachages (PIN, codes) : ces tables n'ont volontairement aucune policy
-- select pour `step_up_pins` et `channel_link_codes`.
-- ============================================================

-- ------------------------------------------------------------
-- 1. channel_identities
-- ------------------------------------------------------------
create table channel_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  membership_id uuid not null references memberships(id) on delete cascade,
  -- Dénormalisé pour les policies (auth.uid()) sans jointure ; cohérence
  -- garantie par le trigger ci-dessous.
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'whatsapp')),
  -- Telegram : identifiant utilisateur numérique (PAS le username, modifiable).
  -- WhatsApp : numéro E.164 normalisé.
  external_id text not null check (length(external_id) between 3 and 64),
  display_label text,
  -- 'pending' : numéro enregistré mais pas encore vérifié (WhatsApp, étape 5) ;
  -- ne résout JAMAIS en acteur.
  status text not null default 'active' check (status in ('pending', 'active', 'revoked')),
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_identities_revoked_fields_check check (
    (status = 'revoked' and revoked_at is not null)
    or (status <> 'revoked' and revoked_at is null)
  )
);

create trigger trg_channel_identities_updated_at
  before update on channel_identities
  for each row execute function set_updated_at();

-- Une identité de canal ne peut être active que pour UN membership par tenant
-- (un consultant présent dans deux tenants peut réutiliser son Telegram ;
-- l'ambiguïté est gérée côté application, voir resolveActor).
create unique index uq_channel_identities_active_external
  on channel_identities(organization_id, channel, external_id)
  where status in ('active', 'pending');

-- Un membership n'a qu'UNE identité active par canal (re-liaison = remplacement
-- explicite, tracé dans l'audit).
create unique index uq_channel_identities_active_membership
  on channel_identities(membership_id, channel)
  where status in ('active', 'pending');

-- Résolution entrante : (channel, external_id) -> identités actives.
create index idx_channel_identities_lookup
  on channel_identities(channel, external_id)
  where status = 'active';
create index idx_channel_identities_org on channel_identities(organization_id);
create index idx_channel_identities_user on channel_identities(user_id);

-- Garde-fou : user_id et organization_id doivent correspondre au membership.
create or replace function enforce_channel_identity_membership()
returns trigger
language plpgsql
as $$
declare
  m_org uuid;
  m_user uuid;
begin
  select organization_id, user_id into m_org, m_user
    from memberships where id = new.membership_id;
  if m_org is null then
    raise exception 'membership % introuvable', new.membership_id;
  end if;
  if m_org <> new.organization_id or m_user <> new.user_id then
    raise exception 'channel_identities incohérente avec le membership %', new.membership_id;
  end if;
  return new;
end;
$$;

create trigger trg_channel_identities_membership
  before insert or update of membership_id, organization_id, user_id on channel_identities
  for each row execute function enforce_channel_identity_membership();

comment on table channel_identities is
  'Liaison canal -> membership (C2). Écriture réservée service_role / fonctions '
  'SECURITY DEFINER ; lecture authenticated : son propre lien, ou tous ceux du '
  'tenant pour owner/admin (révocation depuis le dashboard).';

alter table channel_identities enable row level security;

create policy "member reads own channel identities, owner/admin read tenant ones"
  on channel_identities for select
  using (
    user_id = auth.uid()
    or current_org_role(organization_id) in ('owner', 'admin')
  );

-- ------------------------------------------------------------
-- 2. channel_link_codes (usage unique, hachés)
-- ------------------------------------------------------------
create table channel_link_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  membership_id uuid not null references memberships(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'whatsapp')),
  -- SHA-256 hex du code ; le code en clair n'est JAMAIS stocké (affiché une
  -- seule fois dans le dashboard).
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_external_id text,
  created_at timestamptz not null default now()
);

create index idx_channel_link_codes_membership on channel_link_codes(membership_id, channel);
create index idx_channel_link_codes_org on channel_link_codes(organization_id);

comment on table channel_link_codes is
  'Codes de liaison à usage unique (hachés). Aucune policy : service_role uniquement.';

alter table channel_link_codes enable row level security;
-- Volontairement AUCUNE policy : RLS activée sans policy = refus pour tout
-- rôle autre que service_role (même mécanique que webhook_events, 0006).

-- ------------------------------------------------------------
-- 3. step_up_pins
-- ------------------------------------------------------------
create table step_up_pins (
  membership_id uuid primary key references memberships(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Format `scrypt$N$r$p$saltB64$hashB64` (voir pin-hasher.ts) ; jamais le PIN.
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  -- Nombre de verrouillages successifs sans succès intermédiaire : sert au
  -- verrouillage progressif (durée doublée à chaque palier).
  lockout_count integer not null default 0 check (lockout_count >= 0),
  locked_until timestamptz,
  set_at timestamptz not null default now(),
  last_success_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger trg_step_up_pins_updated_at
  before update on step_up_pins
  for each row execute function set_updated_at();

create index idx_step_up_pins_org on step_up_pins(organization_id);

comment on table step_up_pins is
  'PIN haché par membership. Aucune policy : service_role uniquement (le hachage '
  'ne doit jamais être lisible côté client).';

alter table step_up_pins enable row level security;
-- Aucune policy (voir ci-dessus).

-- ------------------------------------------------------------
-- 4. step_up_challenges
-- ------------------------------------------------------------
create table step_up_challenges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  membership_id uuid not null references memberships(id) on delete cascade,
  channel text not null check (channel in ('dashboard', 'telegram', 'whatsapp')),
  -- Libellé métier de l'action ('refund', 'price_change', ...) : affichage + audit.
  purpose text not null check (length(purpose) between 1 and 64),
  -- Empreinte exacte (sha256 hex) des paramètres de l'action : le défi ne vaut
  -- QUE pour cette action. Null = défi de session (ex. changement de PIN).
  action_fingerprint text check (action_fingerprint is null or length(action_fingerprint) = 64),
  -- Lien éventuel vers la carte d'approbation de C1 (`pending_actions`) ; pas de
  -- FK volontaire : cette table appartient à C1 (0100-0119) et peut ne pas
  -- exister au moment de cette migration.
  pending_action_id uuid,
  -- Méthodes de validation acceptées pour CE défi (décidées par le moteur de
  -- règles : un remboursement n'accepte pas « bouton Telegram » seul).
  allowed_methods text[] not null
    check (allowed_methods <> '{}' and allowed_methods <@ array['pin', 'dashboard_link', 'telegram_button']),
  -- SHA-256 hex du jeton du lien dashboard ; le jeton en clair n'est jamais stocké.
  link_token_hash text unique,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'consumed')),
  approved_method text check (approved_method in ('pin', 'dashboard_link', 'telegram_button')),
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint step_up_challenges_approved_check check (
    (status in ('approved', 'consumed') and approved_method is not null and approved_at is not null)
    or status in ('pending', 'rejected', 'expired')
  )
);

create index idx_step_up_challenges_membership on step_up_challenges(membership_id, status);
create index idx_step_up_challenges_org on step_up_challenges(organization_id, created_at desc);
create index idx_step_up_challenges_expiry on step_up_challenges(expires_at) where status = 'pending';

comment on table step_up_challenges is
  'Défis d''authentification renforcée. Écriture service_role uniquement ; un '
  'membre lit ses propres défis (statut), jamais le hachage du jeton via l''API '
  '(colonne exclue côté application, voir step-up-service).';

alter table step_up_challenges enable row level security;

create policy "member reads own step-up challenges"
  on step_up_challenges for select
  using (
    exists (
      select 1 from memberships m
      where m.id = step_up_challenges.membership_id
        and m.user_id = auth.uid()
        and m.organization_id = step_up_challenges.organization_id
    )
  );

-- ============================================================
-- Fonctions atomiques (SECURITY DEFINER, service_role uniquement)
-- ============================================================

-- Enregistre un échec de PIN de façon atomique (verrou de ligne : deux
-- tentatives parallèles ne peuvent pas contourner le compteur).
-- Après `p_max_attempts` échecs : verrouillage de
-- `p_base_lock_seconds * 2^(lockout_count)` secondes (plafonné à 24 h), et le
-- compteur d'échecs repart à zéro.
create or replace function step_up_record_failure(
  p_membership_id uuid,
  p_max_attempts integer default 5,
  p_base_lock_seconds integer default 300
)
returns table (failed_attempts integer, locked_until timestamptz, lockout_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec step_up_pins%rowtype;
  new_attempts integer;
  new_lockout integer;
  new_locked timestamptz;
begin
  select * into rec from step_up_pins where membership_id = p_membership_id for update;
  if not found then
    raise exception 'PIN introuvable pour le membership %', p_membership_id;
  end if;

  new_attempts := rec.failed_attempts + 1;
  new_lockout := rec.lockout_count;
  new_locked := rec.locked_until;

  if new_attempts >= p_max_attempts then
    new_locked := now() + make_interval(
      secs => least(p_base_lock_seconds::numeric * power(2, rec.lockout_count), 86400)
    );
    new_lockout := rec.lockout_count + 1;
    new_attempts := 0;
  end if;

  update step_up_pins
     set failed_attempts = new_attempts,
         lockout_count = new_lockout,
         locked_until = new_locked
   where membership_id = p_membership_id;

  return query select new_attempts, new_locked, new_lockout;
end;
$$;

-- Réinitialise les compteurs après un PIN correct.
create or replace function step_up_record_success(p_membership_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update step_up_pins
     set failed_attempts = 0,
         lockout_count = 0,
         locked_until = null,
         last_success_at = now()
   where membership_id = p_membership_id;
$$;

-- Consomme un code de liaison de façon atomique et crée l'identité :
--  - le code doit exister, ne pas être consommé, ne pas être expiré ;
--  - une éventuelle identité active du même membership sur ce canal est
--    révoquée (motif 'replaced') ;
--  - une identité active du même (tenant, canal, external_id) pour un AUTRE
--    membership bloque la liaison (jamais de vol silencieux d'identité).
-- Renvoie l'identité créée ; lève une exception explicite sinon.
create or replace function consume_channel_link_code(
  p_code_hash text,
  p_channel text,
  p_external_id text,
  p_label text default null
)
returns channel_identities
language plpgsql
security definer
set search_path = public
as $$
declare
  code_row channel_link_codes%rowtype;
  mem memberships%rowtype;
  existing channel_identities%rowtype;
  created channel_identities%rowtype;
begin
  select * into code_row
    from channel_link_codes
   where code_hash = p_code_hash
   for update;

  if not found then
    raise exception 'CODE_INVALID';
  end if;
  if code_row.channel <> p_channel then
    raise exception 'CODE_INVALID';
  end if;
  if code_row.consumed_at is not null then
    raise exception 'CODE_CONSUMED';
  end if;
  if code_row.expires_at < now() then
    raise exception 'CODE_EXPIRED';
  end if;

  select * into mem from memberships where id = code_row.membership_id;
  if not found then
    raise exception 'CODE_INVALID';
  end if;

  -- Conflit : identité déjà active pour un autre membership du même tenant.
  select * into existing
    from channel_identities
   where organization_id = code_row.organization_id
     and channel = p_channel
     and external_id = p_external_id
     and status in ('active', 'pending')
   for update;
  if found and existing.membership_id <> code_row.membership_id then
    raise exception 'IDENTITY_ALREADY_LINKED';
  end if;

  -- Remplacement de l'identité précédente du même membership sur ce canal
  -- (chaque révocation est auditée dans la même transaction).
  with replaced as (
    update channel_identities
       set status = 'revoked',
           revoked_at = now(),
           revoked_by = mem.user_id,
           revoked_reason = 'replaced'
     where membership_id = code_row.membership_id
       and channel = p_channel
       and status in ('active', 'pending')
    returning id, organization_id, channel, external_id
  )
  insert into audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, before_state, after_state)
  select r.organization_id, mem.user_id, 'CHANNEL_IDENTITY_REVOKED', 'channel_identity', r.id,
         jsonb_build_object('channel', r.channel, 'external_id', r.external_id),
         jsonb_build_object('reason', 'replaced')
    from replaced r;

  insert into channel_identities (
    organization_id, membership_id, user_id, channel, external_id, display_label, status
  ) values (
    code_row.organization_id, code_row.membership_id, mem.user_id, p_channel, p_external_id, p_label, 'active'
  )
  returning * into created;

  update channel_link_codes
     set consumed_at = now(), consumed_external_id = p_external_id
   where id = code_row.id;

  insert into audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, after_state)
  values (
    created.organization_id, mem.user_id, 'CHANNEL_IDENTITY_LINKED', 'channel_identity', created.id,
    jsonb_build_object('channel', created.channel, 'membership_id', created.membership_id)
  );

  return created;
end;
$$;

-- Révoque une identité (par son id, dans un tenant donné) et trace l'action,
-- de façon atomique. L'autorisation de l'appelant (owner/admin du tenant, ou
-- propriétaire de l'identité) est vérifiée par le service applicatif AVANT
-- l'appel ; la fonction re-vérifie le tenant pour éviter toute révocation
-- inter-tenants. Renvoie false si rien n'a été révoqué (déjà révoquée/inconnue).
create or replace function revoke_channel_identity(
  p_identity_id uuid,
  p_organization_id uuid,
  p_revoked_by uuid,
  p_reason text default 'manual'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  rec channel_identities%rowtype;
begin
  update channel_identities
     set status = 'revoked',
         revoked_at = now(),
         revoked_by = p_revoked_by,
         revoked_reason = left(coalesce(p_reason, 'manual'), 200)
   where id = p_identity_id
     and organization_id = p_organization_id
     and status in ('active', 'pending')
  returning * into rec;

  if not found then
    return false;
  end if;

  insert into audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, before_state, after_state)
  values (
    rec.organization_id, p_revoked_by, 'CHANNEL_IDENTITY_REVOKED', 'channel_identity', rec.id,
    jsonb_build_object('channel', rec.channel, 'external_id', rec.external_id),
    jsonb_build_object('reason', rec.revoked_reason)
  );
  return true;
end;
$$;

revoke all on function step_up_record_failure(uuid, integer, integer) from public, anon, authenticated;
revoke all on function step_up_record_success(uuid) from public, anon, authenticated;
revoke all on function consume_channel_link_code(text, text, text, text) from public, anon, authenticated;
grant execute on function step_up_record_failure(uuid, integer, integer) to service_role;
grant execute on function step_up_record_success(uuid) to service_role;
grant execute on function consume_channel_link_code(text, text, text, text) to service_role;
revoke all on function revoke_channel_identity(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function revoke_channel_identity(uuid, uuid, uuid, text) to service_role;
