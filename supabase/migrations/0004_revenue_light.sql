-- ============================================================
-- 0004_revenue_light.sql
-- Phase 5 (préparée dès maintenant car indispensable pour boucler
-- le workflow central de la section 64 : Lead -> Order -> Payment -> Revenue)
-- ============================================================

create type order_status as enum (
  'pending', 'confirmed', 'processing', 'ready', 'delivered', 'cancelled'
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid references leads(id),          -- traçabilité lead -> vente (section 14)
  contact_id uuid not null references contacts(id),
  status order_status not null default 'pending',
  total_amount numeric(14,2) not null default 0,
  currency text not null default 'XAF',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

create index idx_orders_org on orders(organization_id);
create index idx_orders_lead on orders(lead_id);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  label text not null,               -- nom produit/service au moment de la vente
  unit_price numeric(14,2) not null,
  quantity numeric(10,2) not null default 1,
  product_id uuid,                   -- FK ajoutée en Phase 11 quand `products` existe
  created_at timestamptz not null default now()
);

create index idx_order_items_order on order_items(order_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid references orders(id),
  provider_name text,                 -- 'cinetpay' | 'notchpay' | 'mtn_momo' | 'manual'
  provider_reference text,            -- id de transaction côté provider (idempotence)
  amount numeric(14,2) not null,
  currency text not null default 'XAF',
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, provider_name, provider_reference)
);

create index idx_payments_org on payments(organization_id);
create index idx_payments_order on payments(order_id);

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  unique (organization_id, name)
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  category_id uuid references expense_categories(id),
  amount numeric(14,2) not null,
  currency text not null default 'XAF',
  expense_date date not null default current_date,
  description text,
  supplier text,
  receipt_url text,                   -- Storage Provider (section 30)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_expenses_org_date on expenses(organization_id, expense_date);

create table receivables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references contacts(id),
  order_id uuid references orders(id),
  amount_total numeric(14,2) not null,
  amount_paid numeric(14,2) not null default 0,
  due_date date,
  status text not null default 'open' check (status in ('open', 'partially_paid', 'paid', 'overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_receivables_updated_at
  before update on receivables
  for each row execute function set_updated_at();

create index idx_receivables_org_status on receivables(organization_id, status);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table expense_categories enable row level security;
alter table expenses enable row level security;
alter table receivables enable row level security;

create policy "members can access orders of their org" on orders for all
  using (is_member_of_org(organization_id));
create policy "members can access order_items of their org" on order_items for all
  using (is_member_of_org(organization_id));
create policy "members can access payments of their org" on payments for all
  using (is_member_of_org(organization_id));
create policy "members can access expense_categories of their org" on expense_categories for all
  using (is_member_of_org(organization_id));
create policy "members can access expenses of their org" on expenses for all
  using (is_member_of_org(organization_id));
create policy "members can access receivables of their org" on receivables for all
  using (is_member_of_org(organization_id));
