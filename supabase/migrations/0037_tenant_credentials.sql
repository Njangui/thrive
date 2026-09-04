-- ============================================================
-- 0037_tenant_credentials.sql
-- Lot N, Partie 3 — Résolution de credentials par tenant.
--
-- ÉCART DOCUMENTÉ vs le cahier : celui-ci demande de créer
-- `organization_provider_credentials`. Cette table existe DÉJÀ sous un
-- autre nom depuis la toute première fusion : `provider_connections`
-- (0005_providers_and_ai.sql) a EXACTEMENT la forme demandée —
-- organization_id, provider_type, provider_name, credential_reference,
-- unique(organization_id, provider_type, provider_name) — et
-- secrets-resolver.ts (commentaire de tête, écrit dès le MVP) anticipait
-- déjà littéralement "une vraie résolution per-tenant... indexée par
-- provider_connections.credential_reference". Créer une seconde table
-- identique aurait dupliqué la source de vérité pour rien. Cette
-- migration n'ajoute donc AUCUNE table — seulement les fonctions Vault
-- nécessaires pour que credential_reference cesse d'être un champ mort.
-- Voir RAPPORT_LOT_N.md.
--
-- Fonctions wrapper CONFIRMÉES nécessaires (supabase.com/docs/guides/database/vault,
-- consulté 31 août 2026) : le schéma `vault` n'est PAS exposé par
-- PostgREST (confirmé également via un cas réel documenté : appeler
-- `vault.create_secret` en RPC direct depuis un client échoue,
-- "Searched for the function public.vault.create_secret"). Il faut donc
-- des fonctions `public.*`, `security definer`, dont l'exécution est
-- réservée à `service_role` — jamais appelées directement par un rôle
-- authentifié normal.
-- ============================================================

create extension if not exists supabase_vault;

create or replace function public.vault_create_secret(secret_value text, secret_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return vault.create_secret(secret_value, secret_name);
end;
$$;

create or replace function public.vault_update_secret(secret_id uuid, new_secret_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform vault.update_secret(secret_id, new_secret_value);
end;
$$;

create or replace function public.vault_read_secret(secret_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  result text;
begin
  select decrypted_secret into result from vault.decrypted_secrets where id = secret_id;
  return result;
end;
$$;

create or replace function public.vault_delete_secret(secret_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = secret_id;
end;
$$;

-- Exécution réservée service-role — jamais un rôle authentifié normal,
-- jamais anon (même posture que platform_admins/organization_provider_credentials
-- envisagée par le cahier : "accès service-role uniquement").
revoke all on function public.vault_create_secret(text, text) from public, anon, authenticated;
revoke all on function public.vault_update_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.vault_read_secret(uuid) from public, anon, authenticated;
revoke all on function public.vault_delete_secret(uuid) from public, anon, authenticated;

grant execute on function public.vault_create_secret(text, text) to service_role;
grant execute on function public.vault_update_secret(uuid, text) to service_role;
grant execute on function public.vault_read_secret(uuid) to service_role;
grant execute on function public.vault_delete_secret(uuid) to service_role;

comment on function public.vault_read_secret(uuid) is
  'Wrapper security definer autour de vault.decrypted_secrets, exécution '
  'réservée service_role. Ne JAMAIS créer d''équivalent qui renverrait '
  'plusieurs secrets ou exposerait la vue entière — un seul secret par '
  'id, c''est la surface minimale (secrets-resolver.ts::resolveCredential).';
