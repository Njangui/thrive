-- ============================================================
-- 0058_whatsapp_coexistence_dedicated_numbers.sql
--
-- Contexte produit : la messagerie WhatsApp (conversations 1:1) passe en
-- Coexistence (le commerçant garde son numéro utilisable sur l'app
-- WhatsApp Business tout en étant connecté à l'API — voir
-- zernio-channel-service.ts et docs.zernio.com/platforms/whatsapp/
-- connection). Un numéro en Coexistence ne supporte PAS l'API Groupes
-- (confirmé même doc, section "Groups API: Not supported"). Les Groupes
-- WhatsApp exigent donc désormais un SECOND numéro, dédié, connecté en
-- Cloud API classique (onboarding=api) — jamais le même numéro que la
-- messagerie.
--
-- Deux façons pour un commerçant d'obtenir ce numéro dédié :
--   (a) gratuit — il connecte lui-même son propre numéro (self-serve,
--       même parcours Zernio, second profil dédié) ;
--   (b) payant — il en demande un depuis son dashboard ; un Super Admin
--       lui assigne un numéro du pool `/admin/numbers` ; en échange il
--       paie un abonnement MENSUEL, séparé de son abonnement de forfait,
--       avec sa propre échéance. Sans renouvellement à échéance, le
--       numéro est automatiquement repris et les groupes qu'il alimente
--       sont suspendus (voir phone-number-rental-service.ts).
-- ============================================================

-- 1) Un second "profil" Zernio par organisation (provider_connections
--    n'autorisait qu'une ligne par (organization_id, provider_type,
--    provider_name) — 'whatsapp_groups' est un provider_type à part
--    entière, distinct de 'messaging' (coexistence, conversations 1:1),
--    pour que les deux connexions WhatsApp d'une même organisation
--    coexistent sans se marcher dessus.
alter table provider_connections drop constraint provider_connections_provider_type_check;
alter table provider_connections add constraint provider_connections_provider_type_check
  check (provider_type in ('messaging', 'ai', 'payment', 'storage', 'notification', 'social', 'whatsapp_groups'));

-- 2) Un groupe peut désormais être suspendu automatiquement (numéro
--    dédié repris faute de paiement) — distinct de 'disconnected', qui
--    reste réservé à une action délibérée du commerçant (voir
--    0018_whatsapp_groups.sql). entitlements-service.ts ne compte que
--    status='connected' (CUMULATIVE_TABLE_BY_KEY) : 'suspended' est donc
--    automatiquement exclu du quota sans aucun changement à ce fichier.
alter table whatsapp_groups drop constraint whatsapp_groups_status_check;
alter table whatsapp_groups add constraint whatsapp_groups_status_check
  check (status in ('connected', 'disconnected', 'error', 'suspended'));

-- 3) Facturation du numéro dédié géré par la plateforme (chemin b
--    ci-dessus) — même paire de colonnes que
--    organization_subscriptions (0006/0036) pour rester cohérent avec
--    processSubscriptionRenewals, mais un cycle VOLONTAIREMENT
--    indépendant (sa propre échéance, jamais mêlée à celle du forfait).
--    NULL pour un numéro non loué (pool disponible, ou numéro assigné
--    hors de ce mécanisme de facturation).
alter table phone_numbers add column current_period_end timestamptz;
alter table phone_numbers add column last_renewal_reminder_sent_at timestamptz;

comment on column phone_numbers.current_period_end is
  'Échéance du loyer mensuel de ce numéro dédié (chemin payant, voir '
  'phone-number-rental-service.ts). NULL = pas de facturation active sur '
  'ce numéro (pool disponible, ou assigné sans passer par la location).';

-- phone_numbers a été créé sans policy tenant (0017 : "table interne
-- plateforme, service-role uniquement"). Le commerçant a maintenant
-- besoin de voir SON numéro loué (échéance, statut) depuis
-- /dashboard/channels — lecture seule, aucune écriture tenant.
create policy "members can read their organization's assigned phone number" on phone_numbers
  for select using (is_member_of_org(organization_id));

-- 4) File d'attente des demandes de numéro dédié faites par un
--    commerçant (chemin b) — un Super Admin les traite depuis
--    /admin/numbers en assignant un numéro du pool, ce qui marque la
--    demande fulfilled (voir phone-number-rental-service.ts). Une seule
--    demande non traitée à la fois par organisation : au-delà, le
--    commerçant attend le traitement de la première plutôt que d'en
--    empiler plusieurs.
create table phone_number_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'fulfilled', 'cancelled')),
  requested_by uuid references auth.users(id),
  fulfilled_phone_number_id uuid references phone_numbers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_phone_number_requests_updated_at
  before update on phone_number_requests
  for each row execute function set_updated_at();

create unique index uq_phone_number_requests_one_pending_per_org
  on phone_number_requests(organization_id) where (status = 'pending');

create index idx_phone_number_requests_status on phone_number_requests(status);

alter table phone_number_requests enable row level security;

create policy "members can view their organization's phone number requests" on phone_number_requests
  for select using (is_member_of_org(organization_id));
-- L'insertion se fait via getSupabaseServiceClient() côté
-- requestDedicatedNumber() (contrôle de rôle owner/admin en couche
-- application, requireMembership — même discipline que le reste du
-- fichier) : pas de policy insert tenant, cohérent avec
-- phone_numbers ci-dessus.

comment on table phone_number_requests is
  'Demandes commerçant pour un numéro WhatsApp dédié géré par la '
  'plateforme (loyer mensuel) — voir phone-number-rental-service.ts et '
  '0058_whatsapp_coexistence_dedicated_numbers.sql en tête de fichier.';

-- 5) Le loyer du numéro dédié réutilise EXACTEMENT le pipeline de
--    paiement existant (subscription_payments -> NotchPay ->
--    handlePaymentWebhook -> markPaymentCompleted) plutôt que de
--    dupliquer une seconde table de paiement quasi identique (même
--    logique que l'ajout du payment_type 'addon' en 0020).
alter table subscription_payments drop constraint subscription_payments_payment_type_check;
alter table subscription_payments add constraint subscription_payments_payment_type_check
  check (payment_type in ('plan_subscription', 'addon', 'dedicated_number'));

alter table subscription_payments add column phone_number_id uuid references phone_numbers(id) on delete set null;

comment on column subscription_payments.phone_number_id is
  'Renseigné uniquement quand payment_type=''dedicated_number'' — quel '
  'numéro loué ce paiement renouvelle (voir markPaymentCompleted).';
