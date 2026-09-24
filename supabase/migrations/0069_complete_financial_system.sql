-- 0069_complete_financial_system.sql
-- Financial cockpit CRESYVA + comptabilité de gestion tenant.
--
-- Principes :
-- 1) Revenus reconnus = lignes `revenues` pour les tenants / paiements
--    SaaS confirmés pour la plateforme.
-- 2) Coût des ventes (COGS) = coût unitaire figé au moment de la commande.
--    On ne recalcule donc jamais une ancienne marge avec le prix d'achat
--    actuel du catalogue.
-- 3) Charges = dépenses classées cost_of_revenue / operating / tax.
-- 4) Les coûts récurrents de plateforme sont des budgets/engagements
--    distincts des dépenses réellement payées.

alter table order_items
  add column if not exists unit_cost numeric(14,2);

update order_items oi
set unit_cost = coalesce(p.cost_price, 0)
from products p
where oi.product_id = p.id
  and oi.unit_cost is null;

update order_items
set unit_cost = 0
where unit_cost is null;

alter table order_items
  alter column unit_cost set default 0,
  alter column unit_cost set not null;

comment on column order_items.unit_cost is
  'Coût unitaire figé pour le calcul historique du COGS et de la marge. '
  'Renseigné à la création de la commande depuis products.cost_price.';

alter table expenses
  add column if not exists expense_class text not null default 'operating'
    check (expense_class in ('cost_of_revenue', 'operating', 'tax'));

create index if not exists idx_expenses_org_class_date
  on expenses(organization_id, expense_class, expense_date desc);

alter table platform_expenses
  add column if not exists expense_class text not null default 'operating'
    check (expense_class in ('cost_of_revenue', 'operating', 'tax'));

create index if not exists idx_platform_expenses_class_date
  on platform_expenses(expense_class, expense_date desc);

create table if not exists platform_costs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  label text not null,
  category text not null check (category in (
    'zernio', 'hosting', 'database', 'storage', 'email', 'ai',
    'payment', 'domain', 'phone', 'marketing', 'affiliate',
    'salary', 'legal', 'accounting', 'monitoring', 'other'
  )),
  cost_class text not null default 'cost_of_revenue'
    check (cost_class in ('cost_of_revenue', 'operating', 'tax')),
  billing_type text not null default 'fixed'
    check (billing_type in ('fixed', 'usage', 'one_time')),
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly', 'annual', 'one_time')),
  monthly_budget_fcfa numeric(14,2),
  monthly_budget_usd numeric(14,2),
  active boolean not null default true,
  starts_on date not null default current_date,
  ends_on date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (monthly_budget_fcfa is null or monthly_budget_fcfa >= 0),
  check (monthly_budget_usd is null or monthly_budget_usd >= 0),
  check (ends_on is null or ends_on >= starts_on)
);

create index if not exists idx_platform_costs_active on platform_costs(active, starts_on, ends_on);
create index if not exists idx_platform_costs_category on platform_costs(category);

alter table platform_costs enable row level security;

create trigger trg_platform_costs_updated_at
  before update on platform_costs
  for each row execute function public.set_updated_at();

comment on table platform_costs is
  'Référentiel des coûts récurrents/engagements de la plateforme. '
  'Ne remplace pas platform_expenses : les dépenses réellement payées '
  'restent enregistrées séparément pour le calcul du résultat réalisé.';

-- Checklist initiale : aucun montant n'est inventé. Ces lignes rendent les
-- principaux postes visibles dès la première ouverture du cockpit ; le
-- Super Admin renseigne ensuite le budget réel du contrat/facture.
insert into platform_costs (provider, label, category, cost_class, billing_type, billing_cycle, monthly_budget_fcfa, notes)
select * from (values
  ('Vercel', 'Hébergement / déploiement', 'hosting', 'cost_of_revenue', 'usage', 'monthly', null::numeric, 'Configurer le budget réel ou le montant moyen mensuel.'),
  ('Supabase', 'Base de données PostgreSQL', 'database', 'cost_of_revenue', 'usage', 'monthly', null::numeric, 'Inclut compute, base et éventuels dépassements.'),
  ('Supabase', 'Stockage fichiers / images', 'storage', 'cost_of_revenue', 'usage', 'monthly', null::numeric, 'Renseigner le coût réel si le quota inclus est dépassé.'),
  ('Resend', 'E-mails transactionnels', 'email', 'cost_of_revenue', 'usage', 'monthly', null::numeric, 'Renseigner le plan et les dépassements réels.'),
  ('Fournisseur IA', 'API / crédits IA', 'ai', 'cost_of_revenue', 'usage', 'monthly', null::numeric, 'Remplacer le libellé par le fournisseur réellement utilisé.'),
  ('Fournisseur paiement', 'Frais de paiement', 'payment', 'cost_of_revenue', 'usage', 'monthly', null::numeric, 'Saisir les frais réellement prélevés par transaction.'),
  ('Registrar', 'Domaines et renouvellements', 'domain', 'operating', 'usage', 'annual', null::numeric, 'Renseigner le coût moyen mensuel des domaines.'),
  ('Téléphonie', 'Numéros dédiés / communications', 'phone', 'cost_of_revenue', 'usage', 'monthly', null::numeric, 'Inclure les numéros loués et leurs frais réels.'),
  ('Monitoring', 'Monitoring / cron / observabilité', 'monitoring', 'operating', 'usage', 'monthly', null::numeric, 'Ex: monitoring, cron externe, logs.'),
  ('Comptabilité', 'Comptabilité / conseil', 'accounting', 'operating', 'fixed', 'monthly', null::numeric, 'Renseigner uniquement si ce poste existe réellement.'),
  ('Juridique', 'Juridique / conformité', 'legal', 'operating', 'fixed', 'monthly', null::numeric, 'Renseigner uniquement si ce poste existe réellement.'),
  ('Marketing', 'Acquisition / publicité', 'marketing', 'operating', 'usage', 'monthly', null::numeric, 'Budget mensuel réellement engagé.'),
  ('CRESYVA', 'Salaires / rémunérations', 'salary', 'operating', 'fixed', 'monthly', null::numeric, 'Renseigner uniquement lorsque ce coût est réellement engagé.')
) as seed(provider, label, category, cost_class, billing_type, billing_cycle, monthly_budget_fcfa, notes)
where not exists (
  select 1 from platform_costs existing
  where existing.provider = seed.provider and existing.label = seed.label
);
