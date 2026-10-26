-- C1 P6 — Mémoire d'entreprise (`tenant_memory`) avec embeddings pgvector.
-- À VALIDER côté Supabase : extension `vector` activée sur le projet (Database >
-- Extensions) et dimension 1024 = `mistral-embed` (à vérifier dans la doc Mistral
-- avant déploiement ; changer de modèle/dimension exige une migration + ré-embedding).
-- Contenu = données d'entreprise (jamais d'instructions, jamais de secrets). Écriture
-- service-role uniquement (le service applique permissions, confirmation, audit).

create extension if not exists vector;

create table tenant_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('fact', 'preference', 'faq', 'decision')),
  content text not null check (char_length(content) between 1 and 2000),
  content_hash text not null check (char_length(content_hash) = 64),
  embedding vector(1024) not null,
  embedding_model text not null check (char_length(embedding_model) between 1 and 100),
  source text not null check (source in ('user', 'agent', 'import')),
  created_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index uq_tenant_memory_active_hash on tenant_memory(organization_id, content_hash) where status = 'active';
create index idx_tenant_memory_org_status on tenant_memory(organization_id, status, created_at desc);
create index idx_tenant_memory_embedding on tenant_memory using hnsw (embedding vector_cosine_ops);

create or replace function guard_tenant_memory_update() returns trigger language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id or new.content is distinct from old.content
     or new.content_hash is distinct from old.content_hash or new.embedding is distinct from old.embedding
     or new.kind is distinct from old.kind or new.source is distinct from old.source or new.created_at is distinct from old.created_at then
    if pg_trigger_depth() > 1 then return new; end if;
    raise exception 'tenant_memory: contenu immuable (archiver puis recréer)';
  end if;
  return new;
end $$;
create trigger trg_tenant_memory_guard before update on tenant_memory for each row execute function guard_tenant_memory_update();

alter table tenant_memory enable row level security;
create policy "owner/admin/manager can read tenant_memory" on tenant_memory for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin', 'manager'));
revoke insert, update, delete on tenant_memory from anon, authenticated;

-- Création idempotente (même contenu actif => duplicate) avec quota par organisation.
create or replace function public.memory_upsert(
  p_organization_id uuid, p_kind text, p_content text, p_hash text, p_embedding vector(1024), p_model text,
  p_source text, p_created_by uuid, p_expires_at timestamptz, p_max_active integer
) returns table (out_status text, out_id uuid)
language plpgsql security definer set search_path = public, extensions
as $$
declare v_id uuid; v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('tenant_memory:' || p_organization_id::text, 0));
  select id into v_id from tenant_memory where organization_id = p_organization_id and content_hash = p_hash and status = 'active';
  if found then return query select 'duplicate'::text, v_id; return; end if;
  select count(*) into v_count from tenant_memory where organization_id = p_organization_id and status = 'active';
  if v_count >= greatest(coalesce(p_max_active, 500), 1) then return query select 'quota_exceeded'::text, null::uuid; return; end if;
  insert into tenant_memory(organization_id, kind, content, content_hash, embedding, embedding_model, source, created_by, expires_at)
  values (p_organization_id, p_kind, p_content, p_hash, p_embedding, p_model, p_source, p_created_by, p_expires_at)
  returning id into v_id;
  return query select 'created'::text, v_id;
end $$;

-- Recherche : toujours bornée à l'organisation, actifs et non expirés.
create or replace function public.memory_search(p_organization_id uuid, p_embedding vector(1024), p_limit integer, p_min_similarity double precision)
returns table (id uuid, kind text, content text, source text, similarity double precision, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then raise exception 'memory_search: limite invalide'; end if;
  return query
  select m.id, m.kind, m.content, m.source, (1 - (m.embedding <=> p_embedding))::double precision as sim, m.created_at
    from tenant_memory m
   where m.organization_id = p_organization_id and m.status = 'active' and (m.expires_at is null or m.expires_at > now())
     and (1 - (m.embedding <=> p_embedding)) >= coalesce(p_min_similarity, 0)
   order by m.embedding <=> p_embedding
   limit p_limit;
end $$;

create or replace function public.memory_archive(p_organization_id uuid, p_id uuid)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare n integer;
begin
  update tenant_memory set status = 'archived', archived_at = now() where id = p_id and organization_id = p_organization_id and status = 'active';
  get diagnostics n = row_count;
  return case when n = 1 then 'archived' else 'not_found' end;
end $$;

-- Droit à l'effacement : suppression définitive (vecteur compris).
create or replace function public.memory_erase(p_organization_id uuid, p_id uuid)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare n integer;
begin
  delete from tenant_memory where id = p_id and organization_id = p_organization_id;
  get diagnostics n = row_count;
  return case when n = 1 then 'erased' else 'not_found' end;
end $$;

-- Hygiène : supprime les entrées archivées anciennes et les entrées expirées (durée fournie par l'appelant).
create or replace function public.memory_purge(p_archived_before timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions
as $$
declare n integer;
begin
  if p_archived_before is null or p_archived_before > now() - interval '1 day' then raise exception 'memory_purge: date trop récente'; end if;
  delete from tenant_memory where (status = 'archived' and archived_at < p_archived_before) or (expires_at is not null and expires_at < now() - interval '1 day');
  get diagnostics n = row_count;
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'memory_upsert(uuid, text, text, text, vector, text, text, uuid, timestamptz, integer)',
    'memory_search(uuid, vector, integer, double precision)', 'memory_archive(uuid, uuid)', 'memory_erase(uuid, uuid)', 'memory_purge(timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
