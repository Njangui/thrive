-- ============================================================
-- 0008_catalog_faq_business.sql
-- Adaptation au doc 2 : le catalogue devient le module central
-- (section 2 et 9). Ce fichier étend le schéma posé sous le doc 1
-- sans renommer ce qui existe déjà (voir docs/GAP_ANALYSIS.md, section G).
-- ============================================================

-- ------------------------------------------------------------
-- Business Data (section 8) — extension de `organizations`,
-- pas de table séparée : une organization EST le business.
-- ------------------------------------------------------------
alter table organizations
  add column description text,
  add column phone text,
  add column whatsapp_number text,
  add column email text,
  add column address text,
  add column opening_hours jsonb not null default '{}'::jsonb,
  add column social_links jsonb not null default '{}'::jsonb,
  add column logo_url text,
  add column website_url text;

-- ------------------------------------------------------------
-- Catégories (partagées entre products et services)
-- ------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create index idx_categories_org on categories(organization_id);

-- ------------------------------------------------------------
-- Products — catalogue complet (section 9). On ALTER la table posée
-- sous le doc 1 (qui ne portait que le minimum pour l'inventaire)
-- plutôt que d'en créer une seconde.
-- ------------------------------------------------------------
create type product_status as enum ('draft', 'active', 'out_of_stock', 'inactive');

alter table products
  add column slug text,
  add column description text,
  add column category_id uuid references categories(id),
  add column compare_at_price numeric(14,2),
  add column status product_status not null default 'draft';

-- `is_active` est remplacé par `status` (plus expressif : DRAFT/ACTIVE/
-- OUT_OF_STOCK/INACTIVE, section 9). Table encore vide à ce stade du
-- projet — suppression sans risque de perte de données réelles.
alter table products drop column is_active;

alter table products add constraint uq_products_org_slug unique (organization_id, slug);

comment on column products.status is
  'Section 10 : ne JAMAIS supprimer un produit épuisé — transition '
  'active <-> out_of_stock uniquement. inactive = retiré volontairement '
  'par le commerçant, draft = pas encore publié.';

create table product_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  url text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_product_images_product on product_images(product_id, position);

-- ------------------------------------------------------------
-- Services — même logique que products, pour les prestataires
-- (coiffure, consulting, etc.) qui vendent du temps plutôt que du stock.
-- ------------------------------------------------------------
create table services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  category_id uuid references categories(id),
  price numeric(14,2) not null default 0,
  duration_minutes integer,
  status product_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create trigger trg_services_updated_at
  before update on services
  for each row execute function set_updated_at();

create index idx_services_org on services(organization_id);

-- ------------------------------------------------------------
-- FAQ (section 18) — répondu SANS appel LLM quand une correspondance
-- est trouvée (voir application/services/faq-resolver.ts).
-- ------------------------------------------------------------
create table faqs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  question text not null,
  answer text not null,
  -- mots-clés explicites pour le matching déterministe V1 (pas de
  -- recherche sémantique en V1 — section 45 : règles avant IA)
  keywords text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_faqs_updated_at
  before update on faqs
  for each row execute function set_updated_at();

create index idx_faqs_org on faqs(organization_id) where is_active;

-- ------------------------------------------------------------
-- Notifications (section 42) — persistées, pas juste un TODO en commentaire.
-- ------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id),
  title text not null,
  body text not null,
  channel text not null default 'in_app' check (channel in ('in_app', 'email', 'sms', 'whatsapp')),
  related_entity_type text,
  related_entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_recipient on notifications(recipient_user_id, read_at);

-- ------------------------------------------------------------
-- Revenues (section 26) — entrées manuelles, distinctes de `payments`
-- (qui restent liés à une commande). Une commande complétée génère
-- automatiquement une ligne ici (logique en application layer, pas
-- un trigger DB — voir order-service, section N du gap analysis).
-- ------------------------------------------------------------
create table revenues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid references orders(id),
  amount numeric(14,2) not null,
  currency text not null default 'XAF',
  category text,
  source text,
  reference text,
  revenue_date date not null default current_date,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_revenues_org_date on revenues(organization_id, revenue_date);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table categories enable row level security;
alter table product_images enable row level security;
alter table services enable row level security;
alter table faqs enable row level security;
alter table notifications enable row level security;
alter table revenues enable row level security;

create policy "members can access categories of their org" on categories for all
  using (is_member_of_org(organization_id));
create policy "members can access product_images of their org" on product_images for all
  using (is_member_of_org(organization_id));
create policy "members can access services of their org" on services for all
  using (is_member_of_org(organization_id));
create policy "members can access faqs of their org" on faqs for all
  using (is_member_of_org(organization_id));
create policy "recipient can read own notifications" on notifications for select
  using (recipient_user_id = auth.uid());
create policy "recipient can update own notifications" on notifications for update
  using (recipient_user_id = auth.uid());
create policy "members can access revenues of their org" on revenues for all
  using (is_member_of_org(organization_id));

-- ------------------------------------------------------------
-- tenant_modules : le set de modules reflète maintenant le doc 2, pas
-- le doc 1. `automation` et `ai_insights` sont explicitement retirés
-- (hors MVP, section 6 doc 2). Voir docs/GAP_ANALYSIS.md section F.
-- ------------------------------------------------------------
alter table tenant_modules drop constraint tenant_modules_module_check;

alter table tenant_modules add constraint tenant_modules_module_check
  check (module in (
    'crm', 'catalog', 'landing', 'whatsapp', 'faq', 'ai',
    'orders', 'appointments', 'inventory', 'finance', 'marketing', 'analytics'
  ));
