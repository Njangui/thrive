-- Publications Telegram natives d'un tenant.
-- Séparées de social_posts/Zernio : Telegram est ici un canal client direct.
create table telegram_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  content text not null,
  target_chat_id text not null,
  target_label text,
  attachment_url text,
  attachment_type text check (attachment_type in ('image', 'video', 'audio', 'file')),
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'published', 'failed', 'cancelled')),
  scheduled_for timestamptz,
  telegram_message_id bigint,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_telegram_publications_updated_at
  before update on telegram_publications
  for each row execute function set_updated_at();

create index idx_telegram_publications_org on telegram_publications(organization_id, created_at desc);
create index idx_telegram_publications_due on telegram_publications(status, scheduled_for);

alter table telegram_publications enable row level security;

create policy "members can access telegram publications of their org"
  on telegram_publications for all
  using (is_member_of_org(organization_id))
  with check (is_member_of_org(organization_id));
