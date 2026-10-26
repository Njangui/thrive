-- ============================================================
-- 0100_agent_settings.sql
-- C1 (noyau agentique) — réglages d'agents par tenant : outils activés,
-- niveau d'autonomie par niveau de risque, plafonds de budget.
--
-- Défauts SÛRS : `enabled_tools` NULL = seuls les outils `read` sont
-- utilisables ; `write_reversible` demande confirmation tant que le
-- propriétaire n'a pas choisi `allow` ; `sensitive` est TOUJOURS confirmé
-- (la contrainte ci-dessous l'interdit au niveau base, pas seulement en code).
-- Aucun prix ici (principe 12) : les plafonds sont des quantités d'unités.
-- ============================================================

create table agent_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  -- NULL = défaut (outils `read` uniquement) ; sinon liste explicite de noms d'outils.
  enabled_tools text[],
  autonomy jsonb not null default '{"write_reversible":"confirm"}'::jsonb,
  -- ex. {"max_units_per_action": 50}
  budget jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint agent_settings_autonomy_valid check (
    jsonb_typeof(autonomy) = 'object'
    and coalesce(autonomy->>'write_reversible', 'confirm') in ('allow', 'confirm')
    and coalesce(autonomy->>'sensitive', 'confirm') = 'confirm'
    and coalesce(autonomy->>'read', 'allow') = 'allow'
  ),
  constraint agent_settings_budget_valid check (jsonb_typeof(budget) = 'object')
);

create trigger trg_agent_settings_updated_at
  before update on agent_settings
  for each row execute function set_updated_at();

alter table agent_settings enable row level security;

create policy "members can read agent_settings of their org"
  on agent_settings for select
  using (is_member_of_org(organization_id));

create policy "owner/admin can insert agent_settings"
  on agent_settings for insert
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

create policy "owner/admin can update agent_settings"
  on agent_settings for update
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'));

create policy "owner can delete agent_settings"
  on agent_settings for delete
  using (is_member_of_org(organization_id) and current_org_role(organization_id) = 'owner');
