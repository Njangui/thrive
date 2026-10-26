-- ============================================================
-- 0142_c3_brand_voice.sql
-- C3 (assistant client) — voix de marque et messages prédéfinis (livrable E).
--
-- Deux tables, toutes deux sous RLS :
--  * brand_voice_profiles : un profil par entreprise (tutoiement / vouvoiement,
--    niveau d'emojis, expressions locales, expressions à éviter, quelques vrais
--    messages en exemple AVEC consentement explicite).
--  * predefined_messages : surcharges par entreprise de la bibliothèque de
--    messages de base (les valeurs par défaut vivent dans le code). Seules les
--    lignes `approved` sont utilisées à l'exécution : jamais de texte non validé
--    envoyé à un client.
--
-- Note C1 : le brief prévoit de stocker le profil via la « mémoire tenant »
-- (C1), qui n'existe pas encore. Table dédiée en attendant ; la migration vers la
-- mémoire tenant se fera en lisant/écrivant ces mêmes colonnes.
--
-- Minimisation (loi n° 2024/017) : les exemples de messages sont envoyés au
-- fournisseur IA dans le prompt ; ils ne peuvent donc exister que si
-- `examples_consent = true` (contrainte en base, pas seulement en code).
-- ============================================================

create table if not exists public.brand_voice_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  register text not null default 'vous' check (register in ('vous', 'tu')),
  emoji_level text not null default 'light' check (emoji_level in ('none', 'light', 'rich')),
  local_expressions text[] not null default '{}' check (cardinality(local_expressions) <= 10),
  avoid_expressions text[] not null default '{}' check (cardinality(avoid_expressions) <= 20),
  example_messages text[] not null default '{}' check (cardinality(example_messages) <= 10),
  examples_consent boolean not null default false,
  examples_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_voice_examples_need_consent
    check (cardinality(example_messages) = 0 or examples_consent)
);

create trigger trg_brand_voice_profiles_updated_at
  before update on public.brand_voice_profiles
  for each row execute function set_updated_at();

alter table public.brand_voice_profiles enable row level security;

create policy "members can read brand voice of their org"
  on public.brand_voice_profiles for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can write brand voice of their org"
  on public.brand_voice_profiles for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

-- ------------------------------------------------------------
-- Messages prédéfinis : surcharges validées par le propriétaire.
-- register / emoji_level = 'any' : la surcharge vaut pour tous les tons.
-- ------------------------------------------------------------
create table if not exists public.predefined_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 60),
  register text not null default 'any' check (register in ('any', 'vous', 'tu')),
  emoji_level text not null default 'any' check (emoji_level in ('any', 'none', 'light', 'rich')),
  body text not null check (char_length(body) between 1 and 1000),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  source text not null default 'owner' check (source in ('owner', 'llm')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key, register, emoji_level),
  constraint predefined_approved_has_approver
    check (status <> 'approved' or approved_at is not null)
);

create trigger trg_predefined_messages_updated_at
  before update on public.predefined_messages
  for each row execute function set_updated_at();

-- Le préfixe de la contrainte unique (organization_id, key, ...) couvre la
-- lecture par organisation ; pas d'index supplémentaire nécessaire.

alter table public.predefined_messages enable row level security;

create policy "members can read predefined messages of their org"
  on public.predefined_messages for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can write predefined messages of their org"
  on public.predefined_messages for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));
