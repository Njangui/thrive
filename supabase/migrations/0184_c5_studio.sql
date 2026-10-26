-- ============================================================
-- 0184_c5_studio.sql
-- C5 — Studio créatif : kit de marque (visuel) et tâches média (fal.ai).
--
-- `brand_kits` = identité VISUELLE seulement (couleurs, polices, logo, style).
-- La voix de marque (ton rédactionnel) appartient à C3 : pas de doublon ici.
--
-- `media_jobs` = journal de chaque génération/amélioration : qui, quoi, coût
-- estimé, empreinte confirmée, statut, résultat. Écrit UNIQUEMENT par le
-- service-role ; les membres peuvent le lire. Il sert aussi de grand livre
-- PROVISOIRE des débits (`usage_units`) en attendant le registre d'usage C1
-- (`usage_synced` = false tant que C1 ne l'a pas repris).
-- ============================================================

create table if not exists brand_kits (
  organization_id uuid primary key references organizations(id) on delete cascade,
  primary_color text not null default '#1F4E79' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#F4F1EA' check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#E07A1F' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  text_color text check (text_color is null or text_color ~ '^#[0-9A-Fa-f]{6}$'),
  heading_font text not null default 'Arial' check (heading_font ~ '^[A-Za-z0-9 ,-]{1,60}$'),
  body_font text not null default 'Arial' check (body_font ~ '^[A-Za-z0-9 ,-]{1,60}$'),
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  tagline text check (tagline is null or char_length(tagline) <= 120),
  style_notes text check (style_notes is null or char_length(style_notes) <= 500),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_brand_kits_updated_at
  before update on brand_kits
  for each row execute function set_updated_at();

alter table brand_kits enable row level security;

create policy "members can read brand_kits of their org"
  on brand_kits for select
  using (is_member_of_org(organization_id));
create policy "owner/admin can insert brand_kits"
  on brand_kits for insert
  with check (current_org_role(organization_id) in ('owner', 'admin'));
create policy "owner/admin can update brand_kits"
  on brand_kits for update
  using (current_org_role(organization_id) in ('owner', 'admin'))
  with check (current_org_role(organization_id) in ('owner', 'admin'));

create table if not exists media_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  capability text not null check (capability in ('image.generate', 'image.enhance', 'image.remove_background', 'video.generate')),
  request jsonb not null,
  -- Empreinte confirmée par l'humain (carte d'approbation) : l'agent ne peut rien changer après le « oui ».
  request_fingerprint text not null,
  idempotency_key text not null,
  status text not null default 'pending_charge'
    check (status in ('pending_charge', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  provider text,
  provider_job_id text,
  provider_status_url text,
  provider_result_url text,
  provider_cancel_url text,
  -- Coût fournisseur estimé en MILLIÈMES de dollar (milli-USD) : unité neutre, sans prix de plan ;
  -- C1 la convertira en crédits via plan_entitlements. `cost_basis` dit d'où vient le chiffre.
  estimated_milli_usd integer not null check (estimated_milli_usd >= 0),
  cost_basis text not null check (cost_basis in ('configured', 'ceiling')),
  usage_units integer not null default 0,
  usage_synced boolean not null default false,
  -- Débit à rembourser (échec après débit) : le contrat C1 n'a pas encore de remboursement.
  refund_due boolean not null default false,
  outputs jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create trigger trg_media_jobs_updated_at
  before update on media_jobs
  for each row execute function set_updated_at();

create index idx_media_jobs_org_created on media_jobs(organization_id, created_at desc);
create index idx_media_jobs_open on media_jobs(status) where status in ('queued', 'running');

alter table media_jobs enable row level security;

-- Lecture seule pour les membres ; AUCUNE politique d'écriture : seul le service-role écrit.
create policy "members can read media_jobs of their org"
  on media_jobs for select
  using (is_member_of_org(organization_id));

-- Plafond mensuel optionnel de dépense média (milli-USD). NULL = pas de plafond supplémentaire
-- (chaque génération reste de toute façon confirmée une par une : action `sensitive`).
alter table growth_settings
  add column if not exists media_monthly_budget_milli_usd integer
    check (media_monthly_budget_milli_usd is null or media_monthly_budget_milli_usd >= 0);
