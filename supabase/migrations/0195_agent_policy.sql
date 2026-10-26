-- 0195_agent_policy.sql
-- Politique de validation des agents : profil + exceptions par outil (auto / valider / interdit, seuil de montant).
-- Les garde-fous fixes (actions sensibles, envois groupés, plafond de coût) vivent dans le code et ne sont PAS configurables.

alter table agent_settings
  add column if not exists profile text not null default 'prudent',
  add column if not exists tool_policies jsonb not null default '{}'::jsonb;

-- Comportement existant conservé : un tenant qui avait choisi « allow » reste en autonomie sans seuil (profil custom).
update agent_settings set profile = 'custom' where autonomy->>'write_reversible' = 'allow' and profile = 'prudent';

create or replace function public.agent_tool_policies_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) e
       where jsonb_typeof(e.value) <> 'object'
          or coalesce(e.value->>'mode', '') not in ('auto', 'confirm', 'deny')
          or (e.value ? 'autoMaxAmount' and (jsonb_typeof(e.value->'autoMaxAmount') <> 'number' or (e.value->>'autoMaxAmount')::numeric < 0))
          or e.key !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
     );
$$;

alter table agent_settings drop constraint if exists agent_settings_profile_valid;
alter table agent_settings add constraint agent_settings_profile_valid check (profile in ('prudent', 'balanced', 'autonomous', 'custom'));
alter table agent_settings drop constraint if exists agent_settings_tool_policies_valid;
alter table agent_settings add constraint agent_settings_tool_policies_valid check (public.agent_tool_policies_valid(tool_policies));
