-- ============================================================
-- 0068_platform_finance_and_zernio_costs.sql
-- Finance interne flexco  : dépenses de plateforme et pilotage Zernio.
-- Les revenus SaaS restent dans subscription_payments.
-- ============================================================

create table if not exists platform_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('zernio', 'infrastructure', 'ai', 'payment', 'marketing', 'other')),
  label text not null,
  amount_fcfa integer not null check (amount_fcfa >= 0),
  expense_date date not null default current_date,
  vendor text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_expenses_date on platform_expenses(expense_date desc);
create index if not exists idx_platform_expenses_category_date on platform_expenses(category, expense_date desc);

alter table platform_expenses enable row level security;

comment on table platform_expenses is
  'Dépenses internes de la plateforme flexco . Lecture/écriture exclusivement via la console Super Admin (service role).';

insert into platform_settings (key, value)
values ('zernio_usd_to_xaf_rate', '600'::jsonb)
on conflict (key) do nothing;
