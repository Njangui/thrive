-- ============================================================
-- 0021_domain_pricing.sql
-- Lot G, Partie 3 — Domaines (achat).
--
-- VÉRIFICATION FOURNISSEUR (voir RAPPORT_LOT_G.md, section "Domaines") :
-- aucun registrar avec une API publique en self-service et couvrant le
-- .cm (géré régionalement par Netcom.cm/ANTIC, sans API documentée) n'a
-- été trouvé dans le temps imparti. `tenant_domains` (0001) reste la
-- table de VÉRITÉ pour un domaine effectivement branché à un tenant ;
-- les deux tables ci-dessous couvrent uniquement le PROCESSUS D'ACHAT
-- (tarification + demandes), traité manuellement par l'équipe Marc-well
-- jusqu'à intégration d'un vrai registrar (voir DomainProvider port +
-- ManualDomainAdapter).
-- ============================================================

create table domain_tld_pricing (
  tld text primary key,                 -- ex: '.cm', '.com', '.africa' (avec le point, pour affichage direct)
  supplier_price_fcfa integer not null check (supplier_price_fcfa >= 0),
  margin_fcfa integer not null default 0 check (margin_fcfa >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_domain_tld_pricing_updated_at
  before update on domain_tld_pricing
  for each row execute function set_updated_at();

comment on table domain_tld_pricing is
  'Grille tarifaire Super Admin (section 45/Lot C étendue). Prix vendu = '
  'supplier_price_fcfa + margin_fcfa, calculé à l''affichage/à la demande '
  '(jamais stocké ici — seul domain_requests snapshote le prix au moment '
  'de la demande, ces deux colonnes pouvant changer après coup).';

create table domain_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain_name text not null,            -- nom complet demandé, ex: 'boutique-fatou.cm'
  tld text not null references domain_tld_pricing(tld),
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'registered', 'failed', 'cancelled')),
  -- Snapshot du prix au moment de la demande (voir commentaire ci-dessus).
  supplier_price_fcfa integer not null check (supplier_price_fcfa >= 0),
  sold_price_fcfa integer not null check (sold_price_fcfa >= 0),
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text,
  updated_at timestamptz not null default now()
);

create trigger trg_domain_requests_updated_at
  before update on domain_requests
  for each row execute function set_updated_at();

create index idx_domain_requests_org on domain_requests(organization_id, requested_at desc);
create index idx_domain_requests_status on domain_requests(status);

comment on table domain_requests is
  'File d''attente de traitement MANUEL (ManualDomainAdapter — aucun '
  'registrar réel branché, voir RAPPORT_LOT_G.md). `resolved_at` + '
  '`resolution_note` sont renseignés par le Super Admin en clôturant la '
  'demande (registered/failed/cancelled) — jamais automatiquement.';

alter table domain_tld_pricing enable row level security;
alter table domain_requests enable row level security;

-- Tarification : catalogue plateforme, lecture publique aux comptes
-- authentifiés (même posture que addons), écriture service-role.
create policy "authenticated users can read active domain tld pricing"
  on domain_tld_pricing for select
  to authenticated
  using (active = true);

-- Écriture (création + résolution) réservée service-role : même posture
-- que subscription_payments/audit_logs — `domain-service.ts::requestDomain`
-- passe par requireMembership() en amont (côté Server Action) puis écrit
-- via getSupabaseServiceClient(), jamais un insert client direct.
create policy "members can read domain_requests of their org"
  on domain_requests for select
  using (is_member_of_org(organization_id));
