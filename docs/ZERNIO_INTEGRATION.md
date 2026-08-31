# Intégration Zernio

Zernio est la couche d'intégration WhatsApp + réseaux sociaux (section 13
doc produit). Notre backend ne lui donne jamais un accès direct à
Supabase — on récupère les données pertinentes puis on appelle l'API
Zernio nous-mêmes.

**Règle suivie tout du long** (et vérifiée activement pendant la
construction, pas supposée) : ne jamais deviner un endpoint. Deux fois
pendant ce projet, une hypothèse initiale s'est révélée fausse après
consultation de docs.zernio.com — les corrections sont tracées dans
`docs/GAP_ANALYSIS.md` et dans les commentaires des fichiers concernés.

## Ce qui est CONFIRMÉ (consulté sur docs.zernio.com, 27 août 2026)

- Base URL : `https://zernio.com/api/v1`, auth `Authorization: Bearer <clé>`
- Modèle multi-tenant Zernio : un **profile** par tenant, chaque profile
  contient des **accounts** (WhatsApp, Facebook, Instagram...)
- Répondre à un message entrant : `POST /inbox/conversations/{conversationId}/messages`
  avec `{ accountId, message }` — **pas** un envoi "à froid" par numéro
- Webhooks : enveloppe `{ id, event, message, conversation, account, timestamp }`,
  signature `X-Zernio-Signature` (HMAC-SHA256 hex), déduplication sur `payload.id`
- Routage multi-tenant des webhooks inbox : `account.id`
- Social publishing : `POST /posts` (un seul endpoint pour brouillon/
  programmation/publication immédiate), `GET /posts/{id}`, `DELETE /posts/{id}`
  (annule un brouillon/post programmé, jamais un post publié),
  `GET /analytics`
- Idempotence native : header `x-request-id` sur `POST /posts`
- Les URLs Supabase Storage sont auto-proxées par Zernio (pas de config
  supplémentaire nécessaire pour les images de produits)

## Ce qui reste À CONFIRMER avant la mise en production

- Détail exact des champs internes de `message`/`conversation` dans les
  webhooks inbox (la doc consultée référence des types nommés sans lister
  tous leurs champs en clair) — utiliser la fonctionnalité "Test webhook"
  du dashboard Zernio pour capturer un vrai payload avant d'aller en prod.
- Détail exact du champ `platformResults` dans `GET /posts/{id}`.
- Le compte WhatsApp business doit être réellement connecté et vérifié
  côté Zernio (numéro, template messages approuvés si utilisés hors
  fenêtre des 24h).

## Où se trouve le code

```
infrastructure/providers/messaging/zernio/   Messaging (WhatsApp inbox)
  types.ts       Formes de données confirmées/inférées, avec commentaires
  client.ts      Appels HTTP bas niveau
  mapper.ts      Zernio -> DomainEvent normalisé (le SEUL endroit qui connaît le format Zernio)
  webhook-handler.ts  Signature + parsing + hash
  adapter.ts     Implémente le port MessagingProvider
  resolve-organization.ts  account.id -> organization_id

infrastructure/providers/social/zernio/      Social publishing
  types.ts, client.ts, adapter.ts (implémente SocialPublishingProvider)
```

## Limitation documentée

`cancelPost` fonctionne réellement (`DELETE /posts/{id}`, confirmé), mais
ne peut annuler qu'un brouillon ou un post programmé — un post déjà publié
ne peut pas être supprimé par cette route (Zernio protège l'historique de
publication, cohérent avec notre propre règle de ne jamais supprimer
l'historique).
