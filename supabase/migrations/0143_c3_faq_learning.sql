-- ============================================================
-- 0143_c3_faq_learning.sql
-- C3 (assistant client) — FAQ qui apprend (livrable F).
--
-- Boucle : les questions qui reviennent sont COMPTÉES, une FAQ est PROPOSÉE au
-- propriétaire (valider / modifier / refuser), rien n'est publié seul.
--
-- Données personnelles (loi n° 2024/017) :
--  * l'apprentissage est DÉSACTIVÉ par défaut (opt-in par entreprise) ;
--  * `faq_question_log` ne contient que le texte de la question, nettoyé (emails,
--    numéros, liens retirés côté application), sans identifiant de client ni de
--    conversation, et réservé au propriétaire / administrateur ;
--  * rétention courte : `purge_faq_question_log()` (30 jours par défaut) — à
--    planifier par le planificateur de tâches C1 (ou un cron Supabase) ;
--  * aucune de ces données n'entraîne un modèle.
-- ============================================================

-- ------------------------------------------------------------
-- FAQ : origine, date de revue, dernier usage
-- ------------------------------------------------------------
alter table public.faqs
  add column if not exists source text not null default 'owner' check (source in ('owner', 'learned')),
  add column if not exists review_at date,
  add column if not exists last_hit_at timestamptz;

comment on column public.faqs.review_at is 'C3 — date à laquelle la réponse doit être relue (prix, horaires et règles changent).';

-- ------------------------------------------------------------
-- Réglages d'apprentissage (un par entreprise)
-- ------------------------------------------------------------
create table if not exists public.faq_learning_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  weekly_threshold integer not null default 3 check (weekly_threshold between 2 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_faq_learning_settings_updated_at
  before update on public.faq_learning_settings
  for each row execute function set_updated_at();

alter table public.faq_learning_settings enable row level security;

create policy "owner/admin can manage faq learning settings"
  on public.faq_learning_settings for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

-- ------------------------------------------------------------
-- Journal des questions (anonymisé, court)
-- ------------------------------------------------------------
create table if not exists public.faq_question_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 200),
  tokens text[] not null check (cardinality(tokens) between 1 and 8),
  -- 'ai' : l'assistant a répondu ; 'verify' : « je vérifie » + transfert à un humain.
  resolution text not null check (resolution in ('ai', 'verify')),
  suggested_answer text check (suggested_answer is null or char_length(suggested_answer) <= 600),
  created_at timestamptz not null default now()
);

create index if not exists idx_faq_question_log_org_recent
  on public.faq_question_log (organization_id, created_at desc);

alter table public.faq_question_log enable row level security;

create policy "owner/admin can read faq question log"
  on public.faq_question_log for select
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

-- Pas de politique d'écriture : seul le serveur (service-role) écrit.

-- ------------------------------------------------------------
-- Propositions de FAQ
-- ------------------------------------------------------------
create table if not exists public.faq_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 200),
  suggested_answer text check (suggested_answer is null or char_length(suggested_answer) <= 600),
  keywords text[] not null default '{}',
  signature text[] not null check (cardinality(signature) between 1 and 8),
  occurrences integer not null default 1 check (occurrences >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  faq_id uuid references public.faqs(id) on delete set null,
  -- Une proposition décidée n'est pas re-proposée avant cette date.
  cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faq_candidates_decided_has_date check (status = 'pending' or decided_at is not null)
);

create trigger trg_faq_candidates_updated_at
  before update on public.faq_candidates
  for each row execute function set_updated_at();

create index if not exists idx_faq_candidates_org_status
  on public.faq_candidates (organization_id, status, occurrences desc);

alter table public.faq_candidates enable row level security;

create policy "owner/admin can manage faq candidates"
  on public.faq_candidates for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

-- ------------------------------------------------------------
-- Usages des FAQ par jour (compteur de crédits économisés)
-- ------------------------------------------------------------
create table if not exists public.faq_hit_daily (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  faq_id uuid not null references public.faqs(id) on delete cascade,
  day date not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (faq_id, day)
);

create index if not exists idx_faq_hit_daily_org_day
  on public.faq_hit_daily (organization_id, day desc);

alter table public.faq_hit_daily enable row level security;

create policy "members can read faq hits of their org"
  on public.faq_hit_daily for select
  using (is_member_of_org(organization_id));

-- ------------------------------------------------------------
-- Enregistrer un usage : n'écrit que si la FAQ appartient bien à l'organisation
-- (le client service-role ne protège pas de lui-même contre un faq_id étranger).
-- ------------------------------------------------------------
create or replace function public.faq_record_hit(p_organization_id uuid, p_faq_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into public.faq_hit_daily (organization_id, faq_id, day, hits)
  select p_organization_id, p_faq_id, current_date, 1
   where exists (select 1 from public.faqs f where f.id = p_faq_id and f.organization_id = p_organization_id)
  on conflict (faq_id, day) do update set hits = public.faq_hit_daily.hits + 1;

  update public.faqs set last_hit_at = now()
   where id = p_faq_id and organization_id = p_organization_id;
end;
$$;

revoke all on function public.faq_record_hit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.faq_record_hit(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- Rétention du journal des questions (à planifier ; 30 jours par défaut).
-- ------------------------------------------------------------
create or replace function public.purge_faq_question_log(p_days integer default 30)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.faq_question_log
   where created_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 7));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_faq_question_log(integer) from public, anon, authenticated;
grant execute on function public.purge_faq_question_log(integer) to service_role;
