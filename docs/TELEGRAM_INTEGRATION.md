# Intégration Telegram — indépendante de Zernio

## Pourquoi deux intégrations Telegram distinctes

Ce projet contient **deux usages de l'API Bot Telegram, entièrement
séparés** — aucun fichier, aucune table de déduplication, aucun secret
partagé entre les deux. Un changement (ou la suppression) de l'un
n'affecte jamais l'autre, et ni l'un ni l'autre ne passe par Zernio
(`docs/ZERNIO_INTEGRATION.md`), qui reste l'unique fournisseur WhatsApp.

| | Bot plateforme | Canal client par tenant |
|---|---|---|
| **Rôle** | Alertes opérateur (nouvelle candidature affilié, fraude, demande de paiement) + commandes affiliés (`/mystats`, liaison de compte) | Vos clients peuvent vous écrire sur Telegram, comme sur WhatsApp |
| **Bot** | Un seul, pour toute la plateforme | Un par organisation — chaque tenant crée le sien via [@BotFather](https://t.me/BotFather) |
| **Jeton** | `TELEGRAM_BOT_TOKEN` (variable d'environnement) | Stocké en Supabase Vault, un par connexion (`provider_connections`) |
| **Webhook** | `/api/webhooks/telegram` (URL fixe) | `/api/webhooks/telegram/tenant/[token]` (URL opaque, une par tenant) |
| **Secret webhook** | `TELEGRAM_BOT_WEBHOOK_SECRET` (fixe) | Généré aléatoirement par connexion (`provider_connections.metadata.webhookSecret`) |
| **Port domaine implémenté** | `NotificationProvider` (`infrastructure/providers/telegram/adapter.ts`) | `MessagingProvider` (`infrastructure/providers/messaging/telegram/adapter.ts`) |
| **Connexion** | Configuration serveur (variables d'environnement) | Self-service, `/dashboard/channels` |
| **Déduplication webhook** | `webhook_events`, `provider='telegram_platform'` | `webhook_events`, `provider='telegram_tenant'`, `external_event_id = ${organizationId}:${update_id}` |

La déduplication du canal tenant combine `organizationId` et `update_id`
car `update_id` n'est unique QUE par bot Telegram — deux tenants ayant
chacun leur propre bot pourraient sinon partager le même `update_id` et
se bloquer mutuellement.

## Canal client — comment ça marche

1. Le tenant crée un bot via @BotFather (`/newbot`), copie le jeton.
2. Il le colle dans `/dashboard/channels` → `connectTelegramChannel()` :
   - valide le jeton (`getMe`),
   - le stocke en Vault (jamais en clair),
   - génère un identifiant d'URL opaque + un secret de webhook propres à
     cette connexion,
   - enregistre le webhook côté Telegram (`setWebhook`).
3. Un client envoie un message au bot → `/api/webhooks/telegram/tenant/[token]`
   → normalisé en `MESSAGE_RECEIVED` (même pipeline que Zernio :
   `handleInboundMessage` → `routeMessage` → réponse IA/escalade humaine
   si nécessaire) → réponse envoyée via `TelegramMessagingAdapter`.

Un chat privé Telegram n'a ni conversation ni contact séparés
(contrairement à WhatsApp/Zernio) : `chat.id` sert à la fois
d'`externalContactId` et d'`externalThreadId` — c'est la même entité
durable côté Telegram. Aucun numéro de téléphone n'est disponible (sauf
partage explicite, non implémenté) : les contacts Telegram dédoublonnent
via une nouvelle colonne `contacts.external_channel_id`
(`0046_contacts_channel_identity.sql`), jamais `phone_e164` — voir cette
migration pour le raisonnement complet (un contact sans téléphone ne
peut pas dédoublonner sur une colonne qui vaut toujours `NULL`).

### Un tenant peut-il avoir WhatsApp ET Telegram en même temps ?

Oui. `registry.ts::getMessagingProvider(organizationId, providerName)`
accepte désormais un second paramètre pour désambiguïser — chaque
appelant (webhook Zernio, webhook Telegram tenant, réponse manuelle
d'un agent) précise explicitement le canal qu'il cible.

## Bot plateforme — commandes

| Commande | Effet |
|---|---|
| `/start <jeton>` | Lie ce chat à un compte affilié (jeton à usage unique, 15 min, généré depuis `/affiliate/dashboard/telegram`) |
| `/mystats` | Clics, filleuls, conversions, solde (en attente / disponible / déjà versé) |
| `/help` | Liste des commandes |

## Installation (bot plateforme)

```bash
# 1. Créer le bot via @BotFather, récupérer le jeton
# 2. Renseigner TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME,
#    TELEGRAM_ADMIN_CHAT_ID (chat/groupe qui recevra les alertes)
# 3. Enregistrer le webhook (TELEGRAM_BOT_WEBHOOK_SECRET = une valeur
#    aléatoire de votre choix, ex: `openssl rand -hex 32`)
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://votre-domaine.tld/api/webhooks/telegram",
    "secret_token": "'"$TELEGRAM_BOT_WEBHOOK_SECRET"'",
    "allowed_updates": ["message"]
  }'
```

Le canal client, lui, ne nécessite AUCUNE installation manuelle : chaque
tenant enregistre son propre webhook automatiquement lors de la connexion
depuis `/dashboard/channels` (`TelegramMessagingClient.setWebhook`,
appelé par `telegram-channel-service.ts::connectTelegramChannel`).

## Confirmé (API Telegram)

- Authentification par le jeton dans l'URL elle-même
  (`api.telegram.org/bot<token>/<method>`), jamais un header.
- Pas de signature HMAC du corps — seul `secret_token` (comparaison en
  temps constant) protège le webhook.
- Aucun endpoint pour interroger le profil d'un utilisateur arbitraire —
  un bot ne connaît un utilisateur qu'à travers les messages qu'il lui
  envoie (restriction de confidentialité Telegram).
- Aucun accusé de lecture pour un bot en chat privé.

## Ce qui est désormais pris en charge

- Réception et réponse aux messages texte dans le pipeline de conversations.
- Envoi sortant d'image, vidéo, audio ou fichier lorsqu'une URL publique est fournie.
- Publication immédiate et programmation vers un groupe ou canal depuis `/dashboard/marketing/nouveau`.
- Traitement des publications programmées via `/api/cron/process-telegram-publications`.

## Limites restantes

- Les pièces jointes ENTRANTES nécessitent encore un pipeline média dédié (récupération du `file_id`, téléchargement puis stockage CRESYVA).
- Le partage de contact (numéro de téléphone) côté Telegram n'est pas encore intégré.
- La configuration du canal client par un Super Admin reste volontairement hors du parcours : la connexion est self-service depuis `/dashboard/channels`.
