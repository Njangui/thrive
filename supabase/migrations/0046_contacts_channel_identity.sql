-- ============================================================
-- 0046_contacts_channel_identity.sql
-- Extension MINIMALE et additive de `contacts` (0003_crm.sql) pour
-- accueillir un canal SANS numéro de téléphone (Telegram — un chat privé
-- Telegram est identifié par un chat_id numérique, jamais un E.164).
--
-- Pourquoi cette migration existe : `contacts` dédoublonne aujourd'hui
-- UNIQUEMENT via `unique(organization_id, phone_e164)`. En SQL, deux
-- lignes avec `phone_e164 = NULL` ne sont JAMAIS considérées en conflit
-- par cette contrainte (NULL ≠ NULL) — un upsert avec `phone_e164: null`
-- créerait donc un NOUVEAU contact à CHAQUE message entrant d'un même
-- utilisateur Telegram, au lieu de mettre à jour le même contact
-- (doublons silencieux : CRM, leads, scoring tous faussés). Cette
-- migration ajoute une seconde clé de dédoublonnage, utilisée
-- UNIQUEMENT quand `phone_e164` est absent — le chemin WhatsApp/Zernio
-- existant (`phone_e164` toujours renseigné) est intégralement
-- inchangé, y compris son comportement d'upsert (voir
-- conversation-service.ts::handleInboundMessage).
-- ============================================================

alter table contacts add column external_channel_id text;

comment on column contacts.external_channel_id is
  'Identité de dédoublonnage pour un canal SANS téléphone (ex: '
  '''telegram:123456789'' — `${channel}:${externalContactId}`). NULL pour '
  'tout contact WhatsApp/Zernio (qui continue de dédoublonner par '
  'phone_e164, inchangé). Jamais les deux à la fois par construction '
  'applicative (voir conversation-service.ts), mais rien n''empêche en '
  'théorie qu''un contact ait éventuellement les deux renseignés si un '
  'futur lot fusionne les identités multi-canaux d''une même personne.';

-- Index partiel (pas une contrainte `unique(organization_id, phone_e164)`
-- élargie) : seules les lignes SANS téléphone doivent dédoublonner par
-- cette colonne, pour ne jamais interférer avec la contrainte existante.
create unique index idx_contacts_external_channel_id
  on contacts(organization_id, external_channel_id)
  where external_channel_id is not null;
