-- 0070_finance_category_compatibility.sql
-- Harmonise les catégories de dépenses plateforme introduites en 0068 avec
-- le référentiel complet du cockpit financier 0069.
-- 0068 utilisait `infrastructure`; l'interface 0069 utilise des catégories
-- plus précises (hosting, database, storage, ...). Sans cette migration,
-- l'enregistrement d'une dépense Vercel/Supabase pouvait échouer au CHECK.

update public.platform_expenses
set category = 'hosting'
where category = 'infrastructure';

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.platform_expenses'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%category%';

  if constraint_name is not null then
    execute format('alter table public.platform_expenses drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.platform_expenses
  add constraint platform_expenses_category_check
  check (category in (
    'zernio', 'hosting', 'database', 'storage', 'email', 'ai',
    'payment', 'domain', 'phone', 'marketing', 'affiliate',
    'salary', 'legal', 'accounting', 'monitoring', 'other'
  ));

create index if not exists idx_platform_expenses_class_category_date
  on public.platform_expenses(expense_class, category, expense_date desc);
