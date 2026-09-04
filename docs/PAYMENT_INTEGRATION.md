# Intégration paiement — NotchPay

**Statut :** SUPPORTED (paiement + webhook), PARTIAL (méthodes de paiement selon pays/compte), NOT_SUPPORTED (paiement récurrent réel, remboursement via API).
**Consulté :** 31 août 2026, [developer.notchpay.co](https://developer.notchpay.co) — `/api-reference/payments`, `/get-started/webhooks`, `/api-reference/resources`.
**Adapter :** `src/infrastructure/providers/payment/notchpay/` (types, client, adapter, webhook-handler).

Ce document tranche, capacité par capacité, ce que l'intégration fait réellement — pour que personne (Marc-well, un futur agent) n'ait à re-deviner ce qui a été vérifié vs supposé.

## Résumé

| Capacité | Verdict | Détail |
|---|---|---|
| Créer un paiement + obtenir une URL de checkout | **SUPPORTED** | `POST /payments` → `authorization_url` |
| Vérifier le statut d'un paiement | **SUPPORTED** | `GET /payments/{reference}` |
| Recevoir une confirmation par webhook | **SUPPORTED** | Signature HMAC-SHA256 vérifiable (`X-Notch-Signature`) |
| Annuler un paiement | **PARTIAL** | `DELETE /payments/{reference}` — uniquement si encore `pending` |
| Mobile Money (MTN/Orange Cameroun) | **SUPPORTED** | Canaux confirmés `cm.mtn` / `cm.orange` |
| Carte bancaire | **PARTIAL** | Existe côté NotchPay (guide de test mentionné) mais l'activation réelle par pays/compte marchand n'a pas pu être vérifiée depuis la documentation seule — à confirmer au moment de la configuration du compte NotchPay de production |
| Paiement récurrent réel (abonnement automatique) | **NOT_SUPPORTED** | Aucune ressource "subscription"/"recurring" dans l'API — chaque renouvellement est un nouveau `POST /payments` initié manuellement (voir `/dashboard/subscription`, bouton "Renouveler") |
| Remboursement via API | **NOT_SUPPORTED** | Aucun endpoint de remboursement dans `/api-reference` (`payments`, `transfers`, `customers`, `beneficiaries`, `webhooks`, `balance`, `resources` — c'est la liste complète). Le dashboard NotchPay permet d'émettre un remboursement manuellement ; ce projet ne l'automatise pas |

## Ce qui est réellement branché

- **Créer un paiement** — `POST https://api.notchpay.co/payments`, en-tête `Authorization: <clé publique>` (jamais de préfixe `Bearer`, à la différence de Zernio — vérifié explicitement, ce n'est pas un oubli). Body : `amount`, `currency`, `email` ou `phone`, `description`, `reference` (fournie par nous, jamais générée par NotchPay). Réponse : `transaction.reference` + `authorization_url` vers lequel rediriger l'utilisateur.
- **Vérifier un paiement** — `GET /payments/{reference}`. Utilisé deux fois dans ce projet : au clic "Payer" pour obtenir l'URL de checkout, et **systématiquement dans le webhook** avant de créditer quoi que ce soit (voir plus bas).
- **Annuler un paiement** — `DELETE /payments/{reference}`, confirmé fonctionner uniquement tant que le paiement est `pending` (répond une erreur sinon). Utilisé par "Annuler" sur un paiement en attente (`/dashboard/subscription`).
- **Webhook** — POST vers l'URL configurée côté dashboard NotchPay (Settings > Webhooks). Corps : `{ id, event, data: { reference, status, amount, currency, ... } }`, un seul événement par delivery (pas de batch, contrairement à Zernio). Événements confirmés : `payment.created`, `payment.complete`, `payment.failed`, `payment.canceled`, `payment.expired`. Signature : en-tête `X-Notch-Signature`, HMAC-SHA256 hexadécimal du **corps brut**, comparaison en temps constant (`crypto.timingSafeEqual`).

## Pourquoi pas de paiement récurrent automatique

La documentation NotchPay ne référence que sept ressources : `payments`, `transfers`, `customers`, `beneficiaries`, `webhooks`, `balance`, `resources`. Aucune ne modélise un abonnement récurrent (pas de `POST /subscriptions`, pas de "plan" côté NotchPay). Chaque paiement est un événement ponctuel. Ce projet en tire la conséquence directe : `organization_subscriptions.current_period_end` est étendu d'un mois **à chaque paiement confirmé**, jamais par un job récurrent qui déclencherait un débit automatique — c'est le tenant qui reclique "Renouveler" (ou passe à un autre forfait) à l'échéance. Un rappel proactif avant expiration n'est pas dans le périmètre de ce lot (candidat naturel pour Lot H, section notifications/observabilité).

## Pourquoi pas de remboursement via API

Aucun des endpoints documentés (`/api-reference/*`) ne couvre un remboursement. Le dashboard NotchPay indique explicitement permettre d'"émettre des remboursements" — mais uniquement comme action manuelle dans l'interface marchand, jamais via un appel REST documenté. `PaymentProvider` (port, `src/domain/ports/payment-provider.ts`) n'expose donc volontairement aucune méthode `refund()` : l'ajouter aurait supposé une capacité non vérifiée. Un statut `refunded` existe dans le schéma `subscription_payments` (et dans `PaymentStatusResult`) pour rester cohérent avec un éventuel futur remboursement traité manuellement puis reflété en base par un Super Admin — mais aucun code de ce lot ne l'écrit automatiquement.

## Différences avec le webhook Zernio (déjà dans le projet)

Pour qui compare les deux adapters côte à côte :

| | Zernio | NotchPay |
|---|---|---|
| En-tête d'auth | `Authorization: Bearer <clé>` | `Authorization: <clé>` (sans préfixe) |
| En-tête de signature webhook | `X-Zernio-Signature` (à vérifier dans le code existant) | `X-Notch-Signature` |
| Forme du webhook | Tableau d'événements possible (normalisé côté adapter) | Un seul objet par delivery (jamais de tableau) |

## Bonnes pratiques appliquées (section "Best Practices" de la doc NotchPay)

- **Ne jamais faire confiance au seul corps du webhook** — `handlePaymentWebhook()` revérifie systématiquement via `GET /payments/{reference}` avant de créditer un abonnement ou un add-on, même si `event.data.status` indique déjà `complete`.
- **Gérer les retries** — la route webhook répond toujours `200` (même sur événement dupliqué ou déjà traité), pour ne jamais provoquer un retry NotchPay infini sur une erreur qui nous est propre.
- **Idempotence** — chaque paiement a une `provider_reference` générée par nous (jamais par NotchPay) *avant* l'appel API, ce qui permet au webhook de toujours retrouver une ligne préexistante plutôt que d'en créer une à la volée à partir du seul événement reçu.

## Domaines — verdict (voir aussi RAPPORT_LOT_G.md)

Hors périmètre de ce document (spécifique au paiement), mais même discipline : aucun registrar avec API publique en self-service couvrant le `.cm` n'a été trouvé dans le temps imparti. Détail complet et candidats évalués (OpenProvider, EuroDNS) dans `RAPPORT_LOT_G.md`, section "Domaines".
