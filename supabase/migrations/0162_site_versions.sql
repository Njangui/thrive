-- ============================================================
-- 0162_site_versions.sql
-- C4 (Catalogue / Site / SEO) — modèle de pages du site par blocs, versionné.
--
-- Un « site » = un INSTANTANÉ complet (thème + navigation + pages + blocs)
-- stocké en jsonb dans `site_versions.snapshot`, validé côté application par
-- SiteSnapshotSchema (src/domain/entities/site.ts). Un tenant a au plus :
--   - 1 version `draft`      (le brouillon en cours d'édition),
--   - 1 version `published`  (ce que voient les visiteurs),
--   - N versions `archived`  (historique, jamais modifié).
-- Publier = archiver la version publiée + publier le brouillon, en UNE
-- transaction (fonction publish_site_version). Restaurer = recopier une
-- version archivée en nouveau brouillon (source = 'restore'), puis la publier.
-- L'historique n'est jamais réécrit.
--
-- Migration 0162 : plage C4 = 0160-0179. Aucune donnée existante n'est
-- touchée ; l'arbre par défaut d'un tenant existant est généré à la demande
-- depuis organization_landing_config (site-default-tree.ts), pas ici.
-- ============================================================

create table site_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  version_number integer not null,
  status text not null check (status in ('draft', 'published', 'archived')),
  snapshot jsonb not null,
  source text not null check (source in ('default_from_config', 'manual', 'agent', 'restore')),
  restored_from uuid references site_versions(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  unique (organization_id, version_number),
  constraint ck_site_versions_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  -- Garde-fou de taille : un instantané reste léger (≤ 1 Mo) — pas de médias inline.
  constraint ck_site_versions_snapshot_size check (pg_column_size(snapshot) <= 1048576),
  constraint ck_site_versions_published_meta check (status <> 'published' or published_at is not null)
);

-- Au plus un brouillon et une version publiée par tenant.
create unique index uq_site_versions_one_draft on site_versions (organization_id) where status = 'draft';
create unique index uq_site_versions_one_published on site_versions (organization_id) where status = 'published';
create index idx_site_versions_org_number on site_versions (organization_id, version_number desc);

comment on table site_versions is
  'C4 — versions du site par blocs (brouillon / publié / archivé). snapshot = SiteSnapshotSchema '
  '(thème, navigation, pages, blocs). Données uniquement : jamais de HTML ni de script exécutable.';

-- Numéro de version séquentiel par tenant, sans collision entre écritures concurrentes.
create or replace function set_site_version_number()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));
  select coalesce(max(version_number), 0) + 1
    into new.version_number
    from site_versions
   where organization_id = new.organization_id;
  return new;
end;
$$;

create trigger trg_site_versions_number
  before insert on site_versions
  for each row execute function set_site_version_number();

-- Droit de publier : owner et admin par défaut, ou tout membre à qui le propriétaire
-- a accordé la permission supplémentaire `publish_site` (memberships.extra_permissions,
-- ex. {"publish_site": true}). Seule la valeur booléenne `true` compte.
create or replace function can_publish_site(target_org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from memberships m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or (m.extra_permissions -> 'publish_site') = 'true'::jsonb
      )
  );
$$;

-- Publication atomique. SECURITY INVOKER (défaut) : la RLS s'applique à l'appelant ;
-- le contrôle de rôle « seuls owner/admin publient » est AUSSI dans la politique d'UPDATE ci-dessous.
create or replace function publish_site_version(p_organization_id uuid, p_version_id uuid, p_user_id uuid)
returns void
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status
    from site_versions
   where id = p_version_id and organization_id = p_organization_id
   for update;

  if v_status is null then
    raise exception 'Version introuvable pour ce tenant' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'Seul un brouillon peut être publié (statut actuel : %)', v_status using errcode = 'P0001';
  end if;

  update site_versions
     set status = 'archived'
   where organization_id = p_organization_id and status = 'published';

  update site_versions
     set status = 'published', published_at = now(), published_by = p_user_id
   where id = p_version_id and organization_id = p_organization_id;
end;
$$;

-- ------------------------------------------------------------
-- RLS — lecture : tout membre du tenant. Écriture : owner/admin/manager peuvent
-- créer et modifier des BROUILLONS ; publier / archiver (publier, restaurer) exige
-- can_publish_site() : owner, admin, ou un membre à qui le propriétaire a accordé
-- `publish_site`. Un employé sans ce droit ne peut rien publier. Aucune suppression directe (l'historique est conservé ;
-- la suppression du tenant cascade).
-- Seconde barrière applicative : requireMembership + permission de publication
-- (et confirmation `sensitive` côté agent).
-- ------------------------------------------------------------
alter table site_versions enable row level security;

create policy "members can read site_versions of their org"
  on site_versions for select
  using (is_member_of_org(organization_id));

create policy "editors can create draft site_versions of their org"
  on site_versions for insert
  with check (
    is_member_of_org(organization_id)
    and current_org_role(organization_id) in ('owner', 'admin', 'manager')
    and status = 'draft'
  );

create policy "editors can edit drafts, publishers can publish or archive"
  on site_versions for update
  using (
    is_member_of_org(organization_id)
    and (
      current_org_role(organization_id) in ('owner', 'admin', 'manager')
      or can_publish_site(organization_id)
    )
  )
  with check (
    is_member_of_org(organization_id)
    and (
      (status = 'draft' and current_org_role(organization_id) in ('owner', 'admin', 'manager'))
      or can_publish_site(organization_id)
    )
  );

-- ------------------------------------------------------------
-- Historique immuable : le contenu d'une version publiée ou archivée ne
-- change jamais, et une version archivée ne revient jamais en arrière
-- (restaurer = créer un NOUVEAU brouillon). Vaut aussi pour le service-role.
-- ------------------------------------------------------------
create or replace function protect_site_version_history()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' and new.snapshot is distinct from old.snapshot then
    raise exception 'Le contenu d''une version publiée ou archivée est immuable' using errcode = 'P0001';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'Une version archivée ne peut pas être réactivée (créer un nouveau brouillon)' using errcode = 'P0001';
  end if;
  if old.status = 'published' and new.status = 'draft' then
    raise exception 'Une version publiée ne repasse pas en brouillon' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_site_versions_history
  before update on site_versions
  for each row execute function protect_site_version_history();
