# C2 — Outils de l'agent Opérations

Code : `src/application/agents/ops/`. Aucun outil n'accède à la base directement : chacun appelle un service existant (injectable via `OpsServices`, ce qui rend les tests indépendants de Supabase).

## Principes

- **Le tenant et le rôle viennent de l'`AgentActor`, jamais des arguments du modèle.** Un `organizationId` injecté dans les paramètres est ignoré (testé).
- **Garde de rôle avant tout `run`/`preview`** (`define()` → `assertPermission`). Un `employee` est refusé sur tous les outils, sans aucun appel de service (testé).
- **Le LLM ne calcule pas** : prix lus dans le catalogue, totaux calculés par le service. Le schéma de `orders.create` n'accepte que `productId` + `quantity` (`unitPrice`/`total` sont retirés).
- **Texte client = donnée non fiable** : les notes sont renvoyées sous `customerNoteUntrusted` (≤ 300 car.), téléphones masqués (`+237…01`).
- Aucun seuil/prix en dur. Seules bornes de sanité : quantité, date (-366 j / +1 j), montant ≤ 1e9 à 2 décimales.

## Catalogue

| Outil | Risque | Rôles (par défaut) | Notes |
|---|---|---|---|
| orders.list / orders.get | read | owner, admin, manager, cashier | |
| contacts.find | read | + sales | recherche nom/téléphone, échappée |
| products.find / stock.get / stock.low | read | + cashier, sales (produits) | |
| appointments.list | read | owner, admin, manager | |
| finance.recent / finance.overview | read | owner, admin, manager, accountant | |
| orders.create | write_reversible | owner, admin, manager, cashier | prix du catalogue, produit actif, lignes fusionnées, alerte stock, contact du tenant |
| orders.complete | write_reversible | idem | refuse annulée ; idempotent |
| stock.restock / stock.remove | write_reversible | owner, admin, manager | |
| appointments.create / setStatus | write_reversible | owner, admin, manager | téléphone normalisé E.164 |
| expenses.create / revenues.create | write_reversible | owner, admin, manager, accountant | |
| **orders.cancel** | **sensitive** | owner, admin, manager | refuse commande terminée ; idempotent ; `preview` |
| **orders.refund** | **sensitive** | owner, admin, manager (au-dessus du seuil : owner/admin) | voir « Remboursements » ; `preview` |
| **products.setPrice** | **sensitive** | owner, admin, manager | read-modify-write complet ; signale la promo supprimée ; `preview` |

Les permissions sont dans `role-matrix.ts` (`OPS_PERMISSIONS`), alignées sur les garde-fous existants du dashboard. `extraPermissions` de l'acteur peut accorder une permission en plus.

## Lacunes (rien d'inventé)

- **Livraisons** : aucun module/table/service de livraison dans le dépôt → pas d'outils `deliveries.*`.
- ~~Remboursements~~ : conçus après accord de Marc-well (voir ci-dessous).
- **Dépense par photo de reçu** : reportée (dépend de l'OCR/vision et de la politique d'envoi d'images).

## Remboursements (`orders.refund`, migration 0125)

Décisions de conception (jugements documentés, **à faire valider par le comptable du tenant**) :
- **Enregistrement, pas virement** : Flexco n'envoie pas l'argent ; le commerçant rembourse (Mobile Money, espèces) puis valide la carte. L'aperçu le rappelle.
- **Atomique** : `record_order_refund` verrouille la commande (`FOR UPDATE`), exige `completed`, plafonne le cumul au total, écrit le remboursement ET la contre-passation.
- **Effet comptable** : une ligne `revenues` **négative sans `order_id`**. Reliée à la commande, le calcul du coût des ventes (`tenant-finance-service`) compterait le coût deux fois. Le coût des ventes n'est pas annulé ; le retour en stock reste une action séparée (`stock.restock`).
- **Montants** : le modèle peut donner un montant ou `full: true` ; dans ce cas le montant (total − déjà remboursé) est calculé par le code.
- **Seuil** : celui du propriétaire (réglages d'alertes, déclencheur `refund_over_threshold`). **Aucune valeur par défaut.** Au-dessus du seuil : un manager est refusé **avant même l'émission de la carte** (seuls owner/admin, ou la permission `orders.refund.large` accordée à un membre) et une alerte critique part. Sans seuil défini : pas de règle de seuil, mais **chaque** remboursement alerte (déclencheur actif par défaut).
- **PIN** : toujours (risque `sensitive`). La « seconde confirmation » au-dessus du seuil est réalisée par le **changement d'approbateur** (owner/admin), pas par un second PIN : plus simple, pas de friction pour les petits montants. Sur WhatsApp : jamais de validation dans le chat.
- **Limites** : pas de clé d'idempotence côté outil (C1 `pending_actions` garantit « une exécution par carte ») ; pas de remboursement de commandes `pending` (on annule) ; pas de remboursement de paiements d'abonnement (autre domaine).

## Points d'intégration avec C1

- `ops-contract.ts` est un **miroir local** du contrat C1 (`RiskLevel`, `ToolDef`, `ToolCtx`). À remplacer par `src/application/agents/contracts.ts` au merge.
- **Extension proposée** : `ToolDef.preview?(params, ctx)` → `{title, summary, details}` pour les outils `sensitive`, afin d'afficher une carte de validation lisible (Telegram/dashboard) calculée côté code, pas par le LLM.
- `ROLE_TOOL_MATRIX` pour C1 : dérivable de `OPS_PERMISSIONS`.
- Pas de clé d'idempotence sur `orders.create` au-delà de `pending_actions` de C1 : un double déclenchement hors C1 créerait deux commandes.

## Données envoyées au fournisseur LLM

Résultats d'outils renvoyés au modèle : noms de produits, quantités, prix, statuts, noms de clients, téléphones masqués, notes clients (tronquées, marquées non fiables), montants. Jamais : téléphones complets, PIN, tokens, codes de liaison.

## Risques connus

- `products.setPrice` : read-modify-write → une modification concurrente entre lecture et écriture peut être écrasée (fenêtre courte, confirmée par l'humain).
- `orders.create` passe par `createOrder` qui notifie les admins et applique la garde d'offre (`assertGatedFeature`) ; un tenant sans l'offre reçoit l'erreur du service.
- Classement `orders.complete` en write_reversible (génère revenu + décrément de stock, difficile à annuler) : jugement à valider.
