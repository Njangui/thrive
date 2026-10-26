-- ============================================================
-- 0121_assistant_chat.sql
-- C2 — étape 2 : chat propriétaire du dashboard (historique).
-- `assistant_threads` : une conversation par (membre, tenant).
-- `assistant_messages` : messages du fil. Les cartes d'approbation sont dans
-- `parts` (jsonb) ; l'état réel d'une approbation vit dans `pending_actions`
-- (C1) — ici, uniquement référence + instantané d'affichage.
-- Écriture : service_role (le service applicatif vérifie acteur + tenant).
-- Lecture authenticated : uniquement SES propres fils — un owner ne lit PAS le
-- chat privé d'un employé (les actions restent tracées dans l'audit de C1).
-- ============================================================
create table assistant_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  membership_id uuid not null references memberships(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text check (title is null or length(title) <= 120),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  archived_at timestamptz
);
create index idx_assistant_threads_user_org
  on assistant_threads(user_id, organization_id, last_message_at desc) where archived_at is null;
create index idx_assistant_threads_org on assistant_threads(organization_id);
alter table assistant_threads enable row level security;
create policy "member reads own assistant threads"
  on assistant_threads for select
  using (user_id = auth.uid() and is_member_of_org(organization_id));

create table assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references assistant_threads(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '' check (length(content) <= 20000),
  parts jsonb not null default '[]'::jsonb check (jsonb_typeof(parts) = 'array'),
  -- Idempotence des renvois mobiles (réseau instable).
  client_message_id uuid,
  -- Exécution tracée côté C1 (agent_runs), sans FK : table de C1.
  run_id uuid,
  status text not null default 'complete' check (status in ('streaming', 'complete', 'error', 'aborted')),
  created_at timestamptz not null default now()
);
create index idx_assistant_messages_thread on assistant_messages(thread_id, created_at, id);
create index idx_assistant_messages_org on assistant_messages(organization_id);
create unique index uq_assistant_messages_client
  on assistant_messages(thread_id, client_message_id)
  where client_message_id is not null and role = 'user';
alter table assistant_messages enable row level security;
create policy "member reads own assistant messages"
  on assistant_messages for select
  using (user_id = auth.uid() and is_member_of_org(organization_id));

create or replace function enforce_assistant_message_thread()
returns trigger language plpgsql as $$
declare t_org uuid; t_user uuid;
begin
  select organization_id, user_id into t_org, t_user from assistant_threads where id = new.thread_id;
  if t_org is null or t_org <> new.organization_id or t_user <> new.user_id then
    raise exception 'assistant_messages incohérent avec le fil %', new.thread_id;
  end if;
  return new;
end; $$;
create trigger trg_assistant_messages_thread
  before insert on assistant_messages for each row execute function enforce_assistant_message_thread();
