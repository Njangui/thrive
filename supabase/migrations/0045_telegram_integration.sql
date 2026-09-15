-- ============================================================
-- 0045_telegram_integration.sql
-- Intégration Telegram — INDÉPENDANTE de Zernio par construction.
--
-- Zernio (messaging-provider.ts) reste l'unique canal WhatsApp du client
-- final d'un tenant. Telegram ne joue PAS ce rôle ici : c'est un canal de
-- notification/pilotage pour deux publics entièrement différents —
-- l'affilié (ses stats, ses alertes de conversion) et l'opérateur
-- plateforme (alertes admin : nouvelle candidature, fraude détectée,
-- demande de paiement). Aucune table, aucun adapter, aucune route ne
-- référence Zernio depuis ce fichier ni depuis
-- `infrastructure/providers/telegram/*` — un changement (ou une
-- suppression) de l'intégration Zernio n'affecte donc jamais ce module,
-- et réciproquement. Voir docs/TELEGRAM_INTEGRATION.md.
--
-- Déduplication des webhooks Telegram : PAS de table dédiée — réutilise
-- `webhook_events` (0006_webhooks_and_audit.sql, déjà générique sur
-- `provider`), avec `provider='telegram'` et
-- `external_event_id = update_id` (entier Telegram, casté en text).
-- Cohérent avec le pattern déjà établi pour Zernio/NotchPay, sans
-- dupliquer la mécanique d'idempotence.
-- ============================================================

create table telegram_links (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('affiliate', 'platform_admin')),
  affiliate_id uuid references affiliates(id) on delete cascade,
  admin_user_id uuid references auth.users(id) on delete cascade,
  -- Jeton à usage unique généré côté dashboard (affilié) ou déploiement
  -- (admin), consommé par le webhook au premier /start reçu — jamais
  -- réutilisable après liaison (voir telegram-bot-service.ts).
  link_token text not null unique,
  link_token_expires_at timestamptz not null,
  chat_id bigint,
  telegram_user_id bigint,
  telegram_username text,
  status text not null default 'pending' check (status in ('pending', 'linked', 'revoked')),
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_links_purpose_fields_check check (
    (purpose = 'affiliate' and affiliate_id is not null and admin_user_id is null)
    or
    (purpose = 'platform_admin' and admin_user_id is not null and affiliate_id is null)
  )
);

create trigger trg_telegram_links_updated_at
  before update on telegram_links
  for each row execute function set_updated_at();

-- Un affilié n'a qu'UNE seule liaison Telegram active à la fois. Les
-- lignes 'pending'/'revoked' passées ne comptent pas dans cette
-- contrainte (index partiel) — un affilié peut régénérer un lien après
-- expiration sans collision avec sa tentative précédente.
create unique index idx_telegram_links_affiliate_linked
  on telegram_links(affiliate_id) where status = 'linked';

create unique index idx_telegram_links_chat_linked
  on telegram_links(chat_id) where status = 'linked';

create index idx_telegram_links_token on telegram_links(link_token);

comment on table telegram_links is
  'Écriture réservée service-role (émission du jeton depuis '
  'affiliate-service.ts/telegram-bot-service.ts, confirmation depuis '
  'le webhook /api/webhooks/telegram) — jamais un insert/update direct '
  'authenticated.';

alter table telegram_links enable row level security;

-- Un affilié lit uniquement le statut de SA propre liaison (pour afficher
-- "Connecté en tant que @untel" sur /affiliate/dashboard/telegram).
-- Aucune policy pour les lignes purpose='platform_admin' — lues
-- uniquement via service-role (console admin).
create policy "affiliate can read own telegram link"
  on telegram_links for select
  using (purpose = 'affiliate' and is_affiliate_owner(affiliate_id));
