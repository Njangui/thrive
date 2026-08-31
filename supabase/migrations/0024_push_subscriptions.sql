-- Lot I, Partie 1 (notifications push) : une ligne par device/navigateur
-- abonné, jamais par utilisateur (un même commerçant peut avoir plusieurs
-- appareils abonnés simultanément — desktop + mobile). `endpoint` est
-- l'identifiant unique fourni par le navigateur (Push Service), donc la
-- contrainte unique naturelle pour dédupliquer les ré-abonnements.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

create index idx_push_subscriptions_org on push_subscriptions(organization_id);
create index idx_push_subscriptions_user on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

-- Section 35 : double barrière. Un utilisateur ne gère (lit/écrit/supprime)
-- que ses PROPRES souscriptions, et seulement au sein d'une organisation
-- dont il est membre — même si en pratique les écritures applicatives
-- passent par le service-role (push-service.ts), cette policy protège
-- contre tout accès direct depuis un client Supabase authentifié.
create policy "user manages own push subscriptions" on push_subscriptions
  for all
  using (is_member_of_org(organization_id) and user_id = auth.uid())
  with check (is_member_of_org(organization_id) and user_id = auth.uid());
