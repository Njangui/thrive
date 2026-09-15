-- ============================================================
-- 0044_affiliate_system.sql
-- Programme d'affiliation plateforme (parrainage de nouvelles
-- entreprises clientes de SME-OS, PAS un parrainage entre clients
-- finaux d'un tenant). Même posture que `subscription_payments`/`plans` :
-- objet PLATEFORME, jamais scopé par `organization_id` côté schéma —
-- seule `affiliate_referrals.organization_id` référence une organisation
-- (celle qui a été amenée par l'affilié), sans que l'affilié lui-même
-- ne soit membre de cette organisation.
--
-- Principes de sécurité (voir docs/AFFILIATE_SYSTEM.md pour le détail) :
--  - Toute écriture passe par le service-role depuis
--    `application/services/affiliate-*.ts`, jamais un insert/update direct
--    authenticated — même discipline que `subscription_payments`
--    ("Lecture seule pour les membres... écriture réservée au service-role").
--  - Une organisation ne peut être attribuée qu'à UN SEUL affilié
--    (`affiliate_referrals.organization_id unique`) — jamais réattribuée.
--  - Chaque paiement d'abonnement ne peut générer qu'UNE seule commission
--    (`affiliate_conversions.subscription_payment_id unique`) — idempotence
--    du hook posé dans `subscription-payment-service.ts::markPaymentCompleted`.
--  - Aucune IP en clair : `affiliate_clicks.ip_hash` (SHA-256 + pepper
--    côté application, voir `affiliate-link-security.ts`), suffisant pour
--    détecter un abus de vélocité sans stocker de donnée personnelle brute.
-- ============================================================

-- ------------------------------------------------------------
-- Taux de commission — UN SEUL taux plateforme (pas de paliers), réglable
-- par le Super Admin comme n'importe quel autre réglage global (table
-- générique `platform_settings`, 0020_addons.sql — pas de table dédiée
-- pour éviter une structure surdimensionnée pour deux nombres).
--
-- ⚠️ VALEURS PLACEHOLDER (mêmes réserves que 0012_plans_entitlements.sql) :
-- aucun chiffrage officiel n'a été fourni pour ce lot — 20% du premier
-- paiement, sans récurrence, est une valeur d'illustration raisonnable
-- pour un programme d'affiliation SaaS, ajustable depuis
-- /admin/affiliates/settings sans migration.
--
-- affiliate_commission_rate_bps : taux en points de base (2000 = 20%).
-- affiliate_recurring_months : renouvellements commissionnés après le
--   premier paiement — 0 = uniquement le premier paiement, N>0 = le
--   premier + N renouvellements, -1 = à vie. Voir domain/entities/
--   affiliate.ts::isConversionEligible pour la règle exacte (seule
--   source de vérité du calcul, jamais dupliquée ailleurs).
-- ------------------------------------------------------------
insert into platform_settings (key, value) values
  ('affiliate_commission_rate_bps', '2000'::jsonb),
  ('affiliate_recurring_months', '0'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- Affiliés — un affilié est un compte Supabase Auth (même mécanisme de
-- connexion que /login, lien magique) ayant candidaté et été approuvé.
-- Peut être un client SME-OS existant (owner d'une organisation) OU un
-- compte entièrement dédié — les deux rôles coexistent sans conflit,
-- `affiliates.user_id` n'a aucun lien avec `memberships`.
-- ------------------------------------------------------------
create table affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null,
  contact_email text not null,
  phone text,
  -- Comment l'affilié compte promouvoir SME-OS (collecté à la
  -- candidature, lu par l'admin avant approbation) — texte libre, jamais
  -- validé automatiquement.
  promotion_channels text,
  -- Où payer la commission : mobile money (le cas confirmé Cameroun,
  -- cf. NotchPayAdapter) ou virement bancaire. Volontairement `jsonb`
  -- plutôt que des colonnes dédiées : la forme diffère selon le pays de
  -- l'affilié (même raisonnement que `provider_connections.metadata`).
  -- Ex: {"type":"mobile_money","operator":"mtn","phone":"+237..."}
  payout_method jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'rejected')),
  rejection_reason text,
  notes text,
  applied_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_affiliates_updated_at
  before update on affiliates
  for each row execute function set_updated_at();

create index idx_affiliates_status on affiliates(status);

comment on table affiliates is
  'Écriture réservée service-role (candidature via '
  'affiliate-service.ts::applyForAffiliate après vérification de session, '
  'approbation via affiliate-admin-service.ts après requirePlatformAdmin()) '
  '— jamais un insert/update direct authenticated, même posture que '
  'subscription_payments.';

-- ------------------------------------------------------------
-- Liens de suivi — un affilié peut créer plusieurs liens (campagnes :
-- "bio Instagram", "vidéo YouTube"...), chacun avec son propre code
-- court et sa propre destination.
-- ------------------------------------------------------------
create table affiliate_links (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  -- Généré côté application (base62, voir affiliate-service.ts) —
  -- longueur/charset volontairement peu contraints ici (validation
  -- applicative complète), la contrainte ci-dessous n'est qu'un
  -- garde-fou anti-injection basique.
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{4,32}$'),
  label text,
  destination_path text not null default '/'
    check (destination_path like '/%' and destination_path not like '//%'),
  is_active boolean not null default true,
  -- Compteurs dénormalisés (incrémentés atomiquement côté application à
  -- chaque clic/conversion) pour éviter un COUNT(*) coûteux sur
  -- affiliate_clicks/affiliate_referrals à chaque affichage du tableau de
  -- bord affilié — même logique que organization_addons.quantity.
  click_count integer not null default 0,
  conversion_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_affiliate_links_updated_at
  before update on affiliate_links
  for each row execute function set_updated_at();

create index idx_affiliate_links_affiliate on affiliate_links(affiliate_id);

-- Incréments atomiques des compteurs dénormalisés — un `UPDATE ... SET x
-- = x + 1` exprimé via une fonction SQL (comme consume_ai_credit,
-- 0043_ai_credits_atomic.sql) car le client supabase-js ne sait exprimer
-- qu'une VALEUR statique dans `.update()`, jamais une expression relative
-- à la ligne courante — sans ceci, deux clics concurrents (pic de trafic
-- viral, voir lib/rate-limit.ts::affiliateClickLimiter) pourraient perdre
-- un incrément (lecture-puis-écriture non atomique côté application).
create or replace function public.increment_affiliate_link_clicks(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.affiliate_links set click_count = click_count + 1 where id = p_link_id;
end;
$$;

create or replace function public.increment_affiliate_link_conversions(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.affiliate_links set conversion_count = conversion_count + 1 where id = p_link_id;
end;
$$;

revoke all on function public.increment_affiliate_link_clicks(uuid) from public, anon, authenticated;
revoke all on function public.increment_affiliate_link_conversions(uuid) from public, anon, authenticated;
grant execute on function public.increment_affiliate_link_clicks(uuid) to service_role;
grant execute on function public.increment_affiliate_link_conversions(uuid) to service_role;

-- ------------------------------------------------------------
-- Clics — un clic par visite de /r/{code}, avant toute conversion.
-- AUCUNE IP en clair : `ip_hash` = HMAC-SHA256(ip, AFFILIATE_LINK_SECRET),
-- suffisant pour détecter une vélocité anormale (section fraude) sans
-- conserver de donnée personnelle directement identifiante.
-- ------------------------------------------------------------
create table affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references affiliate_links(id) on delete cascade,
  -- Dénormalisé depuis link_id : évite un JOIN sur affiliate_links pour
  -- la policy RLS ci-dessous (is_affiliate_owner), et pour les requêtes
  -- de vélocité par affilié.
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  -- Jeton signé embarqué dans le cookie `sme_aff` (voir
  -- affiliate-link-security.ts::signReferralToken) — unique par clic,
  -- c'est CE jeton qui relie un clic à une future organisation créée.
  click_token text not null unique,
  ip_hash text not null,
  user_agent_hash text,
  referer_host text,
  is_suspicious boolean not null default false,
  suspicious_reason text,
  created_at timestamptz not null default now()
);

create index idx_affiliate_clicks_link on affiliate_clicks(link_id, created_at desc);
create index idx_affiliate_clicks_ip_velocity on affiliate_clicks(ip_hash, created_at desc);

-- ------------------------------------------------------------
-- Attribution — lie DÉFINITIVEMENT une organisation à l'affilié qui l'a
-- amenée, au moment de la création de l'organisation (onboarding-service.ts).
-- `organization_id unique` : une organisation ne peut avoir qu'UN SEUL
-- affilié attribué, jamais réécrit ensuite (même si un second cookie
-- d'affiliation arrivait plus tard — l'attribution est first-write-wins).
-- ------------------------------------------------------------
create table affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  link_id uuid references affiliate_links(id),
  click_id uuid references affiliate_clicks(id),
  attribution_method text not null default 'cookie' check (attribution_method in ('cookie', 'manual')),
  status text not null default 'pending' check (status in ('pending', 'converted', 'reversed')),
  conversions_count integer not null default 0,
  first_converted_at timestamptz,
  last_converted_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_affiliate_referrals_affiliate on affiliate_referrals(affiliate_id);

comment on table affiliate_referrals is
  'Une ligne par organisation référée, jamais par clic. `status=reversed` '
  'réservé à une intervention admin manuelle (ex: fraude confirmée '
  'a posteriori) — aucun code de ce lot ne repasse automatiquement une '
  'référence de ''converted'' à ''reversed'' (voir affiliate_conversions '
  'pour les renversements au niveau paiement individuel).';

-- ------------------------------------------------------------
-- Conversions — une ligne par paiement d'abonnement générant une
-- commission. `sequence_number` (1er, 2e... paiement de CETTE
-- organisation) permet de vérifier l'éligibilité à la récurrence contre
-- le palier de l'affilié AU MOMENT de ce paiement précis (pas un
-- snapshot figé à l'attribution — un changement de palier par l'admin
-- s'applique aux paiements futurs, jamais rétroactivement aux
-- commissions déjà calculées).
-- ------------------------------------------------------------
create table affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references affiliate_referrals(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  -- Idempotence du hook markPaymentCompleted : un paiement ne peut
  -- générer qu'UNE seule commission, jamais deux (webhook rejoué).
  subscription_payment_id uuid not null unique references subscription_payments(id) on delete cascade,
  sequence_number integer not null check (sequence_number >= 1),
  amount_fcfa integer not null check (amount_fcfa >= 0),
  commission_rate_bps integer not null,
  commission_amount_fcfa integer not null check (commission_amount_fcfa >= 0),
  currency_code text not null default 'XAF',
  -- pending_hold : en attente de la fin de la période de rétention
  --   anti-remboursement (voir platform_settings.affiliate_hold_period_days)
  -- approved : période de rétention écoulée, paiement toujours actif ->
  --   commission payable, incluse dans le solde disponible de l'affilié
  -- reversed : le paiement source a été remboursé/annulé avant la fin de
  --   la rétention -> commission jamais due
  -- paid : incluse dans un affiliate_payouts déjà marqué payé
  status text not null default 'pending_hold'
    check (status in ('pending_hold', 'approved', 'reversed', 'paid')),
  hold_release_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_affiliate_conversions_updated_at
  before update on affiliate_conversions
  for each row execute function set_updated_at();

create index idx_affiliate_conversions_affiliate on affiliate_conversions(affiliate_id, status);
create index idx_affiliate_conversions_hold on affiliate_conversions(status, hold_release_at)
  where status = 'pending_hold';

-- ------------------------------------------------------------
-- Demandes de paiement — NotchPay (seul PaymentProvider implémenté,
-- voir docs/PAYMENT_INTEGRATION.md) n'expose aucune API de transfert
-- sortant : le paiement de la commission reste un virement mobile
-- money/bancaire MANUEL effectué par l'opérateur SME-OS, tracé ici pour
-- l'audit (référence de transaction saisie a posteriori) plutôt
-- qu'automatisé via un provider non vérifié.
-- ------------------------------------------------------------
create table affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references affiliates(id) on delete cascade,
  amount_fcfa integer not null check (amount_fcfa > 0),
  currency_code text not null default 'XAF',
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'paid')),
  -- Copie de affiliates.payout_method AU MOMENT de la demande — un
  -- affilié qui changerait sa méthode de paiement après coup ne doit
  -- jamais faire perdre la trace de COMMENT un virement déjà en cours a
  -- réellement été envoyé.
  payout_method_snapshot jsonb not null,
  admin_notes text,
  payment_reference text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_affiliate_payouts_updated_at
  before update on affiliate_payouts
  for each row execute function set_updated_at();

create index idx_affiliate_payouts_affiliate on affiliate_payouts(affiliate_id, status);

-- Association N-N payout <-> conversions couvertes. `conversion_id
-- unique` garantit qu'une commission ne peut être payée qu'une seule
-- fois, même si deux demandes de paiement étaient créées par erreur.
create table affiliate_payout_items (
  payout_id uuid not null references affiliate_payouts(id) on delete cascade,
  conversion_id uuid not null unique references affiliate_conversions(id) on delete restrict,
  primary key (payout_id, conversion_id)
);

-- ------------------------------------------------------------
-- File de revue anti-fraude — jamais bloquant automatiquement (sauf
-- l'auto-référencement, bloqué à la source par affiliate-service.ts
-- avant même d'écrire une ligne ici) : chaque flag reste visible pour
-- décision humaine dans /admin/affiliates/fraud.
-- ------------------------------------------------------------
create table affiliate_fraud_flags (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid references affiliates(id) on delete cascade,
  click_id uuid references affiliate_clicks(id) on delete cascade,
  referral_id uuid references affiliate_referrals(id) on delete cascade,
  flag_type text not null check (flag_type in (
    'self_referral', 'click_velocity', 'ip_reuse_across_affiliates',
    'cookie_tampered', 'duplicate_organization_owner'
  )),
  severity text not null check (severity in ('low', 'medium', 'high')),
  details jsonb,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_affiliate_fraud_flags_status on affiliate_fraud_flags(status, created_at desc);

-- ============================================================
-- RLS
-- ============================================================

create or replace function is_affiliate_owner(target_affiliate_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from affiliates a
    where a.id = target_affiliate_id and a.user_id = auth.uid()
  );
$$;

comment on function is_affiliate_owner is
  'Analogue de is_member_of_org() (migration 0002) pour le portail '
  'affilié /affiliate/*. SECURITY DEFINER : nécessaire pour lire '
  '`affiliates` depuis les policies des tables filles sans dépendre '
  'd''une policy select sur affiliates elle-même côté appelant.';

alter table affiliates enable row level security;
alter table affiliate_links enable row level security;
alter table affiliate_clicks enable row level security;
alter table affiliate_referrals enable row level security;
alter table affiliate_conversions enable row level security;
alter table affiliate_payouts enable row level security;
alter table affiliate_payout_items enable row level security;
alter table affiliate_fraud_flags enable row level security;

-- Un affilié ne lit QUE sa propre ligne. Aucune policy insert/update/
-- delete : toute écriture passe par le service-role (voir commentaire de
-- tête de table).
create policy "affiliate can read own profile"
  on affiliates for select
  using (user_id = auth.uid());

create policy "affiliate can read own links"
  on affiliate_links for select
  using (is_affiliate_owner(affiliate_id));

create policy "affiliate can read own clicks"
  on affiliate_clicks for select
  using (is_affiliate_owner(affiliate_id));

create policy "affiliate can read own referrals"
  on affiliate_referrals for select
  using (is_affiliate_owner(affiliate_id));

create policy "affiliate can read own conversions"
  on affiliate_conversions for select
  using (is_affiliate_owner(affiliate_id));

create policy "affiliate can read own payouts"
  on affiliate_payouts for select
  using (is_affiliate_owner(affiliate_id));

-- affiliate_payout_items / affiliate_fraud_flags : aucune policy pour un
-- rôle client — accès service-role uniquement (même posture que
-- platform_admins), ces tables ne servent qu'aux vues admin.

-- ------------------------------------------------------------
-- Réglages plateforme (table générique platform_settings, 0020_addons.sql)
-- — regroupe ici les réglages qui ne sont pas déjà insérés en tête de
-- fichier (taux de commission), pour que tout le programme d'affiliation
-- reste piloté sans migration supplémentaire depuis
-- /admin/affiliates/settings.
-- ------------------------------------------------------------
insert into platform_settings (key, value) values
  ('affiliate_cookie_window_days', '30'::jsonb),
  ('affiliate_hold_period_days', '14'::jsonb),
  ('affiliate_min_payout_fcfa', '10000'::jsonb)
on conflict (key) do nothing;
