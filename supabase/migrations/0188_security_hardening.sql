-- ============================================================
-- 0188_security_hardening.sql
-- Corrections d'audit (C1, C2, C12, D1, D2, D3, D4, Q28) :
--
--  1. PLUS D'ÉCRITURE DIRECTE PAR L'API. Un utilisateur connecté détient la clé
--     publique (anon) et un jeton : il peut appeler l'API Supabase lui-même.
--     Jusqu'ici ~60 tables acceptaient ses écritures via RLS (rôle owner/admin
--     ou simple membre), contournant toutes les règles de l'application
--     (promotion en owner, statut/plan de l'entreprise, domaines « vérifiés »,
--     comptes WhatsApp, connexions fournisseurs...). Désormais TOUTE écriture
--     passe par le serveur (service_role) : le code de l'application n'écrit
--     jamais avec le jeton utilisateur (vérifié : seuls auth.* et des lectures).
--  2. Fonctions SECURITY DEFINER : exécution réservée au service_role, sauf les
--     4 aides utilisées par les politiques RLS.
--  3. Défense en profondeur si un droit d'écriture était ré-accordé un jour :
--     un admin ne peut ni créer, ni modifier, ni supprimer un owner ; les
--     colonnes commerciales de `organizations` ne sont pas modifiables avec
--     un jeton utilisateur.
--  4. `whatsapp_accounts.account_id` unique sur toute la plateforme.
--  5. `search_path` fixé sur les aides RLS (C12).
--
-- ROLLBACK (si une page cassait) : grant insert, update, delete on <table> to authenticated;
-- à ne faire que pour une table précise et après revue.
-- ============================================================

-- 1. Écritures directes retirées --------------------------------------------
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;

-- 2. Fonctions SECURITY DEFINER : service_role uniquement (sauf aides RLS) ------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    if fn.proname in ('is_member_of_org', 'current_org_role', 'can_publish_site', 'is_affiliate_owner') then
      continue;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end $$;

-- 5. search_path fixé sur les aides RLS ----------------------------------------
alter function is_member_of_org(uuid) set search_path = public, pg_temp;
alter function current_org_role(uuid) set search_path = public, pg_temp;
alter function can_publish_site(uuid) set search_path = public, pg_temp;
alter function is_affiliate_owner(uuid) set search_path = public, pg_temp;

-- 3a. memberships / team_invitations : un admin ne touche jamais à un owner -------
drop policy if exists "owner/admin can manage memberships" on memberships;
create policy "owner/admin can insert memberships"
  on memberships for insert
  with check (
    is_member_of_org(organization_id)
    and current_org_role(organization_id) in ('owner', 'admin')
    and (role <> 'owner' or current_org_role(organization_id) = 'owner')
  );
create policy "owner/admin can update memberships"
  on memberships for update
  using (
    is_member_of_org(organization_id)
    and current_org_role(organization_id) in ('owner', 'admin')
    and (role <> 'owner' or current_org_role(organization_id) = 'owner')
  )
  with check (
    is_member_of_org(organization_id)
    and current_org_role(organization_id) in ('owner', 'admin')
    and (role <> 'owner' or current_org_role(organization_id) = 'owner')
  );
create policy "owner/admin can delete memberships"
  on memberships for delete
  using (
    is_member_of_org(organization_id)
    and current_org_role(organization_id) in ('owner', 'admin')
    and (role <> 'owner' or current_org_role(organization_id) = 'owner')
  );

drop policy if exists "owner/admin can manage team_invitations" on team_invitations;
create policy "owner/admin can manage team_invitations"
  on team_invitations for all
  using (is_member_of_org(organization_id) and current_org_role(organization_id) in ('owner', 'admin'))
  with check (
    is_member_of_org(organization_id)
    and current_org_role(organization_id) in ('owner', 'admin')
    and (role <> 'owner' or current_org_role(organization_id) = 'owner')
  );

-- 3b. organizations : colonnes commerciales non modifiables avec un jeton utilisateur ---
create or replace function guard_organization_protected_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- auth.uid() est NULL pour le service_role (serveur) : seules les requêtes portant
  -- un jeton utilisateur sont contrôlées.
  if auth.uid() is not null and (
    new.status is distinct from old.status
    or new.plan is distinct from old.plan
    or new.trial_start is distinct from old.trial_start
    or new.trial_end is distinct from old.trial_end
    or new.slug is distinct from old.slug
    or new.country_code is distinct from old.country_code
    or new.currency is distinct from old.currency
    or new.is_demo is distinct from old.is_demo
  ) then
    raise exception 'Colonnes protégées : statut, plan, essai, adresse, pays et devise ne sont modifiables que par la plateforme.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_organization_protected_columns on organizations;
create trigger trg_guard_organization_protected_columns
  before update on organizations
  for each row execute function guard_organization_protected_columns();

-- 4. Un compte WhatsApp ne peut appartenir qu'à UNE entreprise -----------------------
do $$
begin
  if exists (select 1 from whatsapp_accounts group by account_id having count(*) > 1) then
    raise exception 'whatsapp_accounts contient des account_id en double : résoudre à la main avant cette migration (D1).';
  end if;
end $$;
create unique index if not exists uq_whatsapp_accounts_account_id on whatsapp_accounts(account_id);
