-- ============================================================
-- 0197_site_revisions.sql
-- Site libre — historique fin des modifications d'un brouillon.
--
-- `site_versions` garde les VERSIONS (brouillon / publié / archivé). Cette table garde, pour une version, chaque
-- MODIFICATION successive (une ligne = l'état du site APRÈS une modification, avec la liste lisible de ce qui a
-- changé). On peut ainsi revenir à n'importe quelle étape sans publier : le retour en arrière ajoute lui-même une
-- révision, donc il reste annulable. Les révisions ne sont jamais modifiées ; seul le service (service-role) élague
-- les plus anciennes au-delà de 100 par version.
-- ============================================================

create table site_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  version_id uuid not null references site_versions(id) on delete cascade,
  revision_number integer not null,
  snapshot jsonb not null,
  source text not null check (source in ('baseline', 'manual', 'agent', 'revert')),
  summary text not null check (char_length(summary) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (version_id, revision_number),
  constraint ck_site_revisions_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint ck_site_revisions_snapshot_size check (pg_column_size(snapshot) <= 1048576)
);

create index idx_site_revisions_version on site_revisions (version_id, revision_number desc);
create index idx_site_revisions_org on site_revisions (organization_id);

comment on table site_revisions is
  'Historique fin d''une version du site : une ligne = l''état après une modification. Permet de revenir à une étape précédente du brouillon.';

-- Numéro séquentiel par version, sans collision entre écritures concurrentes.
create or replace function set_site_revision_number()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.version_id::text, 1));
  select coalesce(max(revision_number), 0) + 1
    into new.revision_number
    from site_revisions
   where version_id = new.version_id;
  return new;
end;
$$;

create trigger trg_site_revisions_number
  before insert on site_revisions
  for each row execute function set_site_revision_number();

-- Une révision ne change jamais (vaut aussi pour le service-role) ; seule la suppression (élagage, cascade) reste possible.
create or replace function protect_site_revision()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Une révision du site est immuable' using errcode = 'P0001';
end;
$$;

create trigger trg_site_revisions_immutable
  before update on site_revisions
  for each row execute function protect_site_revision();

alter table site_revisions enable row level security;

create policy "members can read site_revisions of their org"
  on site_revisions for select
  using (is_member_of_org(organization_id));

create policy "editors can add site_revisions of their org"
  on site_revisions for insert
  with check (
    is_member_of_org(organization_id)
    and current_org_role(organization_id) in ('owner', 'admin', 'manager')
  );
