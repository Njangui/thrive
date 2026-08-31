-- ============================================================
-- 0018_whatsapp_groups.sql
-- Lot F — Groupes WhatsApp & diffusion groupée (master prompt §39-40,
-- §43-44). Périmètre du Lot "A" jamais livré — voir GAP_ANALYSIS_V2.md.
--
-- La clé d'entitlement 'whatsapp_groups' existe déjà depuis
-- 0012_plans_entitlements.sql et `entitlements-service.ts` la traite déjà
-- en mode CUMULATIF via `countOrganizationRows("whatsapp_groups", ...)`
-- (CUMULATIVE_TABLE_BY_KEY) — le nom de table ci-dessous n'est donc pas un
-- choix libre, il DOIT être exactement `whatsapp_groups` avec une colonne
-- `organization_id` pour que ce branchement déjà existant fonctionne sans
-- modification de entitlements-service.ts.
-- ============================================================

create table whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Id du groupe côté Zernio (`group.id`, confirmé
  -- docs.zernio.com/platforms/whatsapp/groups — GET /whatsapp/wa-groups).
  external_id text not null,
  name text not null,
  -- NULLABLE et volontairement non garanti à jour : confirmé sur
  -- docs.zernio.com/whatsapp/list-whatsapp-group-chats que la réponse de
  -- l'API de listing ne contient QUE {id, subject, createdAt} — pas de
  -- nombre de participants. Colonne posée pour un enrichissement futur
  -- (si Zernio l'ajoute un jour, ou via un appel dédié), jamais fabriquée
  -- ici — voir docs/ZERNIO_INTEGRATION.md, section "Groupes WhatsApp".
  participant_count integer,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  -- Id de la conversation Inbox Zernio pour ce groupe, quand elle est
  -- connue. CONFIRMÉ (docs.zernio.com/platforms/whatsapp/groups) : l'envoi
  -- d'un message dans un groupe passe par l'API Inbox standard, scoppée à
  -- un conversationId — et "les conversations de groupe sont créées
  -- automatiquement quand un message de groupe est REÇU" (pas envoyé).
  -- Aucun endpoint de cold-start documenté pour un groupe (contrairement
  -- au cold-start 1:1 par numéro de téléphone). La réception de messages
  -- DANS un groupe est explicitement hors scope de ce lot (cahier Lot F,
  -- section "Hors scope") — cette colonne reste donc NULL pour tous les
  -- groupes connectés par ce lot ; elle existe pour qu'un futur lot qui
  -- construirait la réception webhook des messages de groupe puisse la
  -- peupler sans nouvelle migration, et pour que `processScheduledBroadcasts`
  -- puisse honnêtement distinguer "pas encore possible" de "jamais possible".
  zernio_conversation_id text,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_id)
);

create trigger trg_whatsapp_groups_updated_at
  before update on whatsapp_groups
  for each row execute function set_updated_at();

create index idx_whatsapp_groups_org on whatsapp_groups(organization_id);

comment on table whatsapp_groups is
  'Lot F — groupes WhatsApp déclarés ("connectés") par une entreprise pour '
  'y diffuser des sélections de produits. Le nom de cette table est une '
  'dépendance directe de entitlements-service.ts (CUMULATIVE_TABLE_BY_KEY) '
  '— ne pas renommer sans mettre à jour ce fichier partagé.';

create table group_broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'completed', 'failed', 'cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_group_broadcasts_updated_at
  before update on group_broadcasts
  for each row execute function set_updated_at();

create index idx_group_broadcasts_org on group_broadcasts(organization_id);
-- Requête d'exécution différée : `scheduled_at <= now() and status = 'scheduled'`
-- (voir processScheduledBroadcasts) — index composite pour ce filtre précis.
create index idx_group_broadcasts_due on group_broadcasts(status, scheduled_at);

create table group_broadcast_targets (
  id uuid primary key default gen_random_uuid(),
  -- Dénormalisé depuis group_broadcasts (même organization_id) — cohérent
  -- avec social_post_targets (0010_marketing_social_publishing.sql) : la
  -- policy RLS `is_member_of_org(organization_id)` a besoin de la colonne
  -- directement sur la ligne, pas seulement via une jointure.
  organization_id uuid not null references organizations(id) on delete cascade,
  broadcast_id uuid not null references group_broadcasts(id) on delete cascade,
  group_id uuid not null references whatsapp_groups(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_group_broadcast_targets_updated_at
  before update on group_broadcast_targets
  for each row execute function set_updated_at();

create index idx_group_broadcast_targets_broadcast on group_broadcast_targets(broadcast_id);
create index idx_group_broadcast_targets_org on group_broadcast_targets(organization_id);

comment on table group_broadcast_targets is
  'Une ligne par GROUPE ciblé par une diffusion (pas par produit) — une '
  'diffusion de 10 produits vers 4 groupes crée 4 lignes ici, pas 40 : le '
  'message groupé liste les produits, cohérent avec master prompt §40.';

create table group_broadcast_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  broadcast_id uuid not null references group_broadcasts(id) on delete cascade,
  product_id uuid not null references products(id),
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_group_broadcast_products_broadcast on group_broadcast_products(broadcast_id);
create index idx_group_broadcast_products_org on group_broadcast_products(organization_id);

alter table whatsapp_groups enable row level security;
alter table group_broadcasts enable row level security;
alter table group_broadcast_targets enable row level security;
alter table group_broadcast_products enable row level security;

-- RLS standard (00_CONVENTIONS_COMMUNES_V2.md) : même granularité que les
-- tables social_* (Lot D), pas de restriction supplémentaire par rôle —
-- la granularité par rôle (ex: owner/admin seulement pour créer une
-- diffusion) est appliquée en couche application via requireMembership(),
-- pas dans la policy RLS elle-même.
create policy "members can access whatsapp_groups of their org" on whatsapp_groups for all
  using (is_member_of_org(organization_id));
create policy "members can access group_broadcasts of their org" on group_broadcasts for all
  using (is_member_of_org(organization_id));
create policy "members can access group_broadcast_targets of their org" on group_broadcast_targets for all
  using (is_member_of_org(organization_id));
create policy "members can access group_broadcast_products of their org" on group_broadcast_products for all
  using (is_member_of_org(organization_id));
