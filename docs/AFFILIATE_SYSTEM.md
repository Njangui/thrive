# Programme d'affiliation

## Résumé

Un affilié (n'importe quel utilisateur connecté — client flexco  existant
ou candidat totalement externe, les deux profils sont acceptés) candidate
via `/devenir-affilie` -> `/affiliate/apply`, est approuvé par le Super
Admin (`/admin/affiliates`), reçoit un lien de suivi personnel
(`/affiliate/dashboard/links`), et touche une commission en FCFA sur les
paiements d'abonnement des organisations qu'il a apportées.

Commission = **un seul taux fixe pour toute la plateforme** (pas de
paliers par affilié — décision produit), réglable sans migration depuis
`/admin/affiliates/settings` :

| Réglage (`platform_settings`)     | Valeur par défaut | Sens                                                             |
| ---------------------------------- | ------------------ | ----------------------------------------------------------------- |
| `affiliate_commission_rate_bps`    | 2000 (20%)         | Taux de commission, en points de base                            |
| `affiliate_recurring_months`       | 0                  | Renouvellements commissionnés après le 1er paiement (-1 = à vie)  |
| `affiliate_cookie_window_days`     | 30                 | Durée de validité du cookie d'attribution après un clic           |
| `affiliate_hold_period_days`       | 14                 | Rétention avant qu'une commission ne devienne payable             |
| `affiliate_min_payout_fcfa`        | 10 000             | Seuil minimum pour demander un paiement                           |

⚠️ Ces valeurs sont des **placeholders** (même réserve que
`docs/DATABASE.md` pour la table `plans`) — aucun chiffrage officiel du
programme n'a été fourni pour ce lot.

## Flux complet

```
Visiteur clique /r/{code}
  -> enregistre le clic (IP hachée, vélocité vérifiée)
  -> pose un cookie HttpOnly signé (sme_aff, HMAC-SHA256)
  -> redirige vers la destination du lien

Le visiteur s'inscrit et crée son organisation (onboarding)
  -> onboarding-actions.ts lit le cookie sme_aff et le transmet à
     createOrganization()
  -> attributeReferral() vérifie la signature, bloque l'auto-référencement,
     crée UNE ligne affiliate_referrals (organization_id est UNIQUE —
     jamais réattribuée ensuite)

L'organisation paie son 1er abonnement (webhook NotchPay confirmé)
  -> subscription-payment-service.ts::markPaymentCompleted appelle
     recordAffiliateConversion() (best-effort, idempotent sur
     subscription_payment_id)
  -> commission calculée au taux en vigueur, statut pending_hold,
     hold_release_at = maintenant + affiliate_hold_period_days

Cron quotidien /api/cron/release-affiliate-holds
  -> passe les commissions pending_hold échues à approved (ou reversed
     si le paiement source a été remboursé entre-temps)

L'affilié demande un paiement (/affiliate/dashboard/payouts)
  -> request_affiliate_payout() (fonction SQL atomique, FOR UPDATE SKIP
     LOCKED) verrouille ses commissions approved non encore couvertes par
     un paiement, crée affiliate_payouts + affiliate_payout_items

Le Super Admin traite la demande (/admin/affiliates/payouts)
  -> virement manuel hors-bande (mobile money/bancaire — NotchPay n'a
     aucune API de transfert sortant), puis "Marquer payé" avec la
     référence de transaction
```

## Sécurité et anti-fraude

- **Cookie signé, jamais falsifiable** : `affiliate-link-security.ts`,
  HMAC-SHA256 avec `AFFILIATE_LINK_SECRET`, vérification en temps
  constant (`crypto.timingSafeEqual`).
- **Aucune IP en clair** : `affiliate_clicks.ip_hash` (SHA-256 + pepper),
  suffisant pour détecter une vélocité anormale sans stocker de donnée
  personnelle directement identifiante.
- **Auto-référencement bloqué à la source** : si l'affilié et le
  propriétaire de la nouvelle organisation sont le même utilisateur,
  AUCUNE ligne `affiliate_referrals` n'est créée (pas juste flaguée) — un
  signalement `self_referral` (sévérité `high`) est tout de même créé
  pour la traçabilité, et l'opérateur plateforme est notifié en temps réel
  (Telegram, voir `docs/TELEGRAM_INTEGRATION.md`).
- **Vélocité de clics** : au-delà de 20 clics en 10 minutes depuis le même
  `ip_hash`, le clic est marqué suspect et visible dans la file de revue
  (`/admin/affiliates/fraud`) — jamais bloquant (un pic de trafic viral
  légitime reste possible).
- **Propriétaire dupliqué** : si l'utilisateur qui crée l'organisation
  possède déjà une AUTRE organisation référée, un signalement de sévérité
  `low` est créé pour revue — pas bloqué (plusieurs commerces réels sous
  un même compte est un cas légitime).
- **Une organisation = un seul affilié, pour toujours** : contrainte
  unique en base (`affiliate_referrals.organization_id`), jamais
  réattribuée même par un second cookie.
- **Une commission = un seul paiement** : contrainte unique
  (`affiliate_conversions.subscription_payment_id`) — idempotence du hook
  posé dans `markPaymentCompleted`, un webhook rejoué ne double jamais une
  commission.
- **Période de rétention** : protège contre les remboursements/
  rétractations — une commission n'est payable qu'après
  `affiliate_hold_period_days`, et seulement si le paiement source est
  toujours `completed` à cette échéance.
- **Demande de paiement atomique** : `request_affiliate_payout()`
  (fonction SQL, `FOR UPDATE SKIP LOCKED`) élimine toute course
  concurrente entre deux demandes qui couvriraient les mêmes commissions.
- **RLS** : un affilié ne lit que ses propres lignes
  (`is_affiliate_owner(affiliate_id)`, analogue à `is_member_of_org`).
  Toute écriture passe par le service-role après vérification applicative
  — jamais un insert/update direct authenticated.

## Ce qui n'est PAS implémenté (hors scope de ce lot)

- Paiement automatique des commissions (NotchPay n'expose aucune API de
  transfert sortant — voir `docs/PAYMENT_INTEGRATION.md`).
- Promotion automatique de palier par volume (le champ
  `min_conversions_for_upgrade` a été retiré avec la suppression des
  paliers — un seul taux plateforme désormais).
- Affiliation multi-niveaux (sous-affiliés).

## Fichiers clés

| Rôle                     | Fichier                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| Schéma                    | `supabase/migrations/0044_affiliate_system.sql`, `0047_affiliate_payout_atomic.sql` |
| Logique métier pure        | `src/domain/entities/affiliate.ts`                                     |
| Sécurité (cookie/hash)    | `src/application/services/affiliate-link-security.ts`                  |
| Service principal          | `src/application/services/affiliate-service.ts`                        |
| Paiements                  | `src/application/services/affiliate-payout-service.ts`                 |
| Console admin              | `src/application/services/affiliate-admin-service.ts`                  |
| Route publique de suivi   | `src/app/r/[code]/route.ts`                                            |
| Portail affilié            | `src/app/affiliate/*`                                                  |
| Console admin (UI)         | `src/app/admin/affiliates/*`                                           |
| Cron de libération         | `src/app/api/cron/release-affiliate-holds/route.ts`                    |
