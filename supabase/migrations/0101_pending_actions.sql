-- ============================================================
-- 0101_pending_actions.sql
-- C1 — cartes d'approbation. Une approbation est liée à l'EMPREINTE
-- (SHA-256 hex) des paramètres exacts, avec expiration.
--
-- Garanties au niveau base (valables aussi pour service-role) :
--   * tenant, outil, paramètres, empreinte et demandeur sont IMMUABLES
--     après insertion : un « oui » ne peut jamais couvrir autre chose ;
--   * le statut n'avance que dans un sens (pending -> approved|rejected|
--     expired ; approved -> executed|expired) ; `executed` est terminal,
--     donc une approbation ne sert qu'UNE fois.
-- Écriture : service-role uniquement (aucune policy INSERT/UPDATE/DELETE).
-- `params` contient les paramètres complets (nécessaires à l'exécution) :
-- lecture réservée au demandeur et à owner/admin.
-- ============================================================

create table pending_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tool_name text not null,
  params jsonb not null,
  params_hash text not null check (params_hash ~ '^[0-9a-f]{64}$'),
  params_preview jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'executed')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  approved_by uuid references auth.users(id) on delete set null,
  channel text not null
    check (channel in ('dashboard', 'telegram', 'whatsapp', 'scheduler', 'customer')),
  run_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  executed_at timestamptz,
  constraint pending_actions_expiry_after_creation check (expires_at > created_at)
);

create index idx_pending_actions_org_status on pending_actions(organization_id, status, expires_at);
create index idx_pending_actions_org_created on pending_actions(organization_id, created_at desc);
create index idx_pending_actions_requester on pending_actions(requested_by);

create or replace function guard_pending_action_update()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.tool_name is distinct from old.tool_name
     or new.params is distinct from old.params
     or new.params_hash is distinct from old.params_hash
     or new.requested_by is distinct from old.requested_by
     or new.channel is distinct from old.channel
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'pending_actions: tenant, outil, paramètres, empreinte, demandeur, canal et dates sont immuables';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending' and new.status in ('approved', 'rejected', 'expired'))
      or (old.status = 'approved' and new.status in ('executed', 'expired'))
    ) then
      raise exception 'pending_actions: transition de statut interdite (% -> %)', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_pending_actions_guard_update
  before update on pending_actions
  for each row execute function guard_pending_action_update();

alter table pending_actions enable row level security;

create policy "requester or owner/admin can read pending_actions"
  on pending_actions for select
  using (
    is_member_of_org(organization_id)
    and (requested_by = auth.uid() or current_org_role(organization_id) in ('owner', 'admin'))
  );
