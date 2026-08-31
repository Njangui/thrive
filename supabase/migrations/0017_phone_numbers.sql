-- ============================================================
-- 0017_phone_numbers.sql
-- Lot C — `/admin/numbers` a besoin d'un inventaire des numéros dédiés.
--
-- Aucune gestion de numéros dédiés (Lot A / WhatsApp groups) n'existe
-- dans le projet fourni à ce lot (migrations 0001-0010 uniquement au
-- moment de la rédaction). Conformément à
-- 00_CONVENTIONS_COMMUNES.md > "Intégration entre équipes parallèles" :
-- table minimale créée ici pour ne pas bloquer sur une dépendance
-- externe. Si le Lot A a construit une table plus riche, câbler
-- manuellement à la fusion et éventuellement retirer celle-ci.
-- ============================================================

create table phone_numbers (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  country text,
  organization_id uuid references organizations(id) on delete set null,
  status text not null default 'available'
    check (status in ('available', 'assigned', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_phone_numbers_updated_at
  before update on phone_numbers
  for each row execute function set_updated_at();

create index idx_phone_numbers_org on phone_numbers(organization_id);

comment on table phone_numbers is
  'Lot C — stub minimal (voir en-tête du fichier). organization_id '
  'nullable = numéro non encore assigné (pool disponible).';

alter table phone_numbers enable row level security;

-- Table interne plateforme, pas une donnée tenant : même logique que
-- `platform_admins` (migration 0015), accès service-role uniquement,
-- exclusivement depuis `/admin/*` après `requirePlatformAdmin()`. Aucune
-- policy pour les tenants dans ce lot — une future itération pourrait
-- ajouter une policy `select` scoping "un membre peut lire le numéro
-- assigné à son organisation" si un besoin tenant-facing apparaît.
