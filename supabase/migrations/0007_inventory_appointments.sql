-- ============================================================
-- 0007_inventory_appointments.sql
-- Phase 11 — Modules optionnels. Ne pas activer par défaut (voir
-- tenant_modules) : "restaurant" et "retail" les activent, "beauty" les
-- ignore pour inventory, etc. (voir application/config/modules.ts).
-- ============================================================

create table products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  sku text,
  unit_price numeric(14,2) not null default 0,
  cost_price numeric(14,2),
  unit text default 'unité',
  current_stock numeric(12,2) not null default 0,
  min_stock numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);

create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

create index idx_products_org on products(organization_id);

-- La FK différée annoncée dans 0004_revenue_light.sql : maintenant que
-- `products` existe, on la rend explicite.
alter table order_items
  add constraint fk_order_items_product
  foreign key (product_id) references products(id);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment')),
  quantity numeric(12,2) not null,
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_inventory_movements_product on inventory_movements(product_id, created_at);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id),
  service_label text not null,
  employee_user_id uuid references auth.users(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_appointments_updated_at
  before update on appointments
  for each row execute function set_updated_at();

create index idx_appointments_org_start on appointments(organization_id, start_at);

alter table products enable row level security;
alter table inventory_movements enable row level security;
alter table appointments enable row level security;

create policy "members can access products of their org" on products for all
  using (is_member_of_org(organization_id));
create policy "members can access inventory_movements of their org" on inventory_movements for all
  using (is_member_of_org(organization_id));
create policy "members can access appointments of their org" on appointments for all
  using (is_member_of_org(organization_id));
