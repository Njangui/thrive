-- ============================================================
-- 0019_subscription_payments.sql
-- Lot G, Partie 1 — Paiement d'abonnement via NotchPay.
--
-- ÉCART DOCUMENTÉ vs 07_LOT_G_domaines_addons_paiement.md : le cahier
-- décrit `subscription_payments` avec seulement (organization_id,
-- plan_key, amount_fcfa, provider, provider_reference, status,
-- webhook_received_at). Mais son propre schéma pour la Partie 2
-- (`organization_addons.subscription_payment_id`) suppose que CETTE
-- MÊME table sert aussi à payer un add-on — hors un add-on n'a pas de
-- plan_key. `payment_type` + `addon_key` + `addon_quantity` ci-dessous
-- comblent cet angle mort plutôt que de dupliquer une seconde table de
-- paiement quasi identique. `plan_key` devient nullable en conséquence.
-- La FK de `addon_key` vers `addons(key)` est ajoutée dans 0020 (la
-- table `addons` n'existe pas encore à ce stade) — même pattern que
-- l'ALTER différé de `provider_connections` en 0010.
-- Voir RAPPORT_LOT_G.md, section "Écarts assumés".
-- ============================================================

create table subscription_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  payment_type text not null default 'plan_subscription'
    check (payment_type in ('plan_subscription', 'addon')),
  -- Renseigné seulement si payment_type = 'plan_subscription'.
  plan_key text references plans(key),
  -- Renseignés seulement si payment_type = 'addon' (FK ajoutée en 0020).
  addon_key text,
  addon_quantity integer,
  amount_fcfa integer not null check (amount_fcfa >= 0),
  provider text not null default 'notchpay' check (provider in ('notchpay')),
  -- Générée côté application (randomUUID) AVANT l'appel NotchPay et
  -- transmise comme `reference` — jamais générée par le provider, pour
  -- pouvoir insérer cette ligne avant même la réponse HTTP (voir
  -- subscription-payment-service.ts::initiatePayment). C'est ce qui rend
  -- le webhook idempotent : il retrouve toujours une ligne préexistante
  -- par `provider_reference`, jamais besoin de la créer à la volée.
  provider_reference text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'refunded', 'cancelled')),
  webhook_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_payments_type_fields_check check (
    (payment_type = 'plan_subscription' and plan_key is not null and addon_key is null and addon_quantity is null)
    or
    (payment_type = 'addon' and addon_key is not null and addon_quantity is not null and addon_quantity > 0 and plan_key is null)
  )
);

create trigger trg_subscription_payments_updated_at
  before update on subscription_payments
  for each row execute function set_updated_at();

create index idx_subscription_payments_org on subscription_payments(organization_id, created_at desc);
create index idx_subscription_payments_status on subscription_payments(status);

comment on column subscription_payments.provider_reference is
  'Référence UUID générée côté application (jamais par NotchPay), transmise '
  'en tant que `reference` à POST /payments. Sert de clé d''idempotence '
  'webhook : le handler ne fait jamais confiance au corps du webhook sans '
  'relire cette ligne + re-vérifier via GET /payments/{reference} '
  '(section "Bonnes pratiques" de la doc NotchPay).';

alter table subscription_payments enable row level security;

-- Lecture seule pour les membres de l'organisation (historique de
-- facturation) — écriture réservée au service-role (initiatePayment +
-- webhook), jamais un insert/update direct côté client.
create policy "members can read subscription_payments of their org"
  on subscription_payments for select
  using (is_member_of_org(organization_id));
