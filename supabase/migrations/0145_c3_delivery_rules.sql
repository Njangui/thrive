-- ============================================================
-- 0145_c3_delivery_rules.sql
-- C3 (assistant client) — règles de livraison du tenant (brief, point G).
--
-- Jusqu'ici, toute question de livraison finissait en « je vérifie » : il n'existait
-- aucune donnée structurée (la barre d'annonce de la vitrine n'est qu'un texte libre).
-- Les zones, frais, seuils de gratuité et délais sont désormais LUS comme les prix :
-- jamais figés dans un gabarit, jamais inventés par un modèle (principe 3).
--
-- * delivery_zones    : une ligne par zone desservie (nom, alias, frais, gratuité, délai).
-- * delivery_settings : retrait sur place et paiement à la livraison. NULL = « pas renseigné » :
--   l'assistant ne répond jamais oui ou non à une question dont la réponse n'est pas connue.
--
-- Lecture : membres de l'entreprise. Écriture : propriétaire / administrateur.
-- ============================================================

create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (char_length(slug) between 1 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 10),
  -- NULL et non gratuit = « frais communiqués à la commande » (selon la distance, par exemple).
  fee_amount numeric(12, 2) check (fee_amount is null or fee_amount >= 0),
  is_free boolean not null default false,
  -- Livraison gratuite à partir de ce montant d'achat.
  free_above_amount numeric(12, 2) check (free_above_amount is null or free_above_amount > 0),
  eta_text text check (eta_text is null or char_length(eta_text) <= 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  constraint delivery_free_has_no_fee check (not is_free or fee_amount is null or fee_amount = 0)
);

create trigger trg_delivery_zones_updated_at
  before update on public.delivery_zones
  for each row execute function set_updated_at();

alter table public.delivery_zones enable row level security;

create policy "members can read delivery zones of their org"
  on public.delivery_zones for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can write delivery zones of their org"
  on public.delivery_zones for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

create table if not exists public.delivery_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  pickup_available boolean,
  pickup_note text check (pickup_note is null or char_length(pickup_note) <= 200),
  accepts_cash_on_delivery boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_delivery_settings_updated_at
  before update on public.delivery_settings
  for each row execute function set_updated_at();

alter table public.delivery_settings enable row level security;

create policy "members can read delivery settings of their org"
  on public.delivery_settings for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can write delivery settings of their org"
  on public.delivery_settings for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
