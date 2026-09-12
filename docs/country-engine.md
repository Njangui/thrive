# Country Engine

Système centralisé de gestion des pays, devises et tarification qui
permet à SME-OS de s'étendre du Cameroun vers d'autres marchés africains
**sans modifier le code métier** — activer un pays devient une opération
de configuration Super Admin, pas une opération de développement.

Voir aussi `docs/notchpay-resources.md` (intégration technique NotchPay)
et `docs/internationalization.md` (devises, téléphone, langue).

## Principe fondateur

```
NotchPay (capacité technique)  ≠  SME-OS (décision commerciale)
```

`countries.notchpay_supported = true` **n'implique jamais**
`countries.launch_status = 'active'`. NotchPay indique ce qui est
techniquement possible ; le Super Admin décide ce qui est réellement
vendu, depuis `/admin/countries`.

```
NotchPay API
    │  (notchpay-resources-service.ts::syncCountries/syncChannels)
    ▼
countries / payment_channels (DB — dernier état connu, jamais perdu)
    │  (country-service.ts — SEUL point d'entrée pour les règles pays)
    ▼
Super Admin (admin-countries-service.ts) décide launch_status
    │
    ▼
Onboarding / Checkout / Landing (lisent via country-service.ts)
```

## Tables (migration `0040_country_engine.sql`)

| Table | Rôle |
|---|---|
| `countries` | Référence plateforme : ISO code, devise, indicatif, `notchpay_supported` (technique), `launch_status` (commercial) |
| `payment_channels` | Canaux NotchPay par pays (`cm.mtn`, `cm.orange`, ...) — jamais une liste en dur |
| `plan_prices` | Prix par (plan, pays) — indépendant, jamais une conversion forex automatique depuis le prix camerounais |
| `country_waitlist` | Liste d'attente pré-lancement (pays en `waitlist`/`coming_soon`) |
| `notchpay_sync_runs` | Historique des synchronisations — permet d'afficher le dernier succès même après un échec |

Plus `organizations.country_code` (`0041`) et
`subscription_payments.currency_code` (`0042`).

### `launch_status` — écart assumé vs le cahier

Le cahier d'origine liste séparément `sme_os_enabled`, `launch_status` et
`is_active`. Trois signaux qui se recouvrent auraient créé un risque réel
de désynchronisation. **`launch_status` seul** (`disabled` |
`coming_soon` | `waitlist` | `active`) est l'unique source de vérité
commerciale — cohérent avec la philosophie déjà en place dans ce projet
(ex : `organization_subscriptions` comme seule source de vérité
d'abonnement, jamais `organizations.plan` en parallèle).

## Services applicatifs

| Fichier | Rôle |
|---|---|
| `currency-service.ts` | `normalizeMoney`/`formatMoney`/`validateMoney` — jamais de calcul flottant sur un montant |
| `notchpay-resources-service.ts` | Lecture DB (`getCountries`/`getCountry`/`getChannels`) + synchronisation (`syncCountries`/`syncChannels`/`syncAllResources`) |
| `country-service.ts` | **Seul point d'entrée** pour toute règle pays (`isCountryActive`, `listPublicCountries`, `validateCountryForSignup`, `joinCountryWaitlist`...) — interdiction du cahier respectée : aucun `if (country === "CM")` dispersé ailleurs |
| `admin-countries-service.ts` | Actions Super Admin (activation, pricing, sync manuelle) — RBAC vérifié par l'appelant (`requirePlatformAdmin()`), jamais par ce service lui-même |
| `plans-repository.ts::resolvePlanPriceForCountry` | Résout le prix effectif ; repli garanti sur `plans.price_fcfa` + devise du pays si aucune ligne `plan_prices` n'existe |

## Checklist d'activation (Super Admin, `/admin/countries/[code]`)

`setCountryLaunchStatus(code, "active", ...)` **bloque** la transition
si, au moment de l'activation :

- `notchpay_supported = false` (jamais synchronisé/pas supporté) ;
- aucun canal de paiement disponible ;
- au moins un des 3 plans (`starter`/`business`/`pro`) n'a pas de ligne
  `plan_prices` active pour ce pays (repose sur le prix par défaut).

Cette checklist ne s'applique **qu'à l'activation d'un pays pas encore
actif** — un Super Admin peut corriger un prix sur un pays déjà actif
sans la redéclencher, et modifier un prix archive l'ancien plutôt que
de l'écraser (historique conservé, `plan_prices.is_active`).

## Désactivation — ce que ça signifie (et ne signifie PAS)

Désactiver un pays = **plus de nouvelles inscriptions**. Ça ne
supprime, ne modifie ni ne bloque **jamais** : organisations, données
métier, abonnements ou paiements existants. `setCountryLaunchStatus`
ne touche que la table `countries` — rien d'autre.

## Checkout — pourquoi le client ne peut pas frauder le montant

```
organization.country_code (DB, jamais transmis par le client)
        ↓
resolvePlanPriceForCountry(plan, countryCode)
        ↓ (plan_prices actif, ou repli plan.priceFcfa + devise du pays)
amount + currencyCode
        ↓
validateMoney(amount, currencyCode)  — entier positif, jamais un flottant
        ↓
provider.createPayment({ amount, currency: currencyCode, ... })
```

`initiatePayment` (`subscription-payment-service.ts`) ignore tout
montant/devise qu'un client pourrait envoyer — tout est recalculé
serveur, à partir du pays réel de l'organisation en base.

## Régression Cameroun

Le seed de `0040` insère les prix `plan_prices` du Cameroun avec les
**mêmes valeurs exactes** que `plans.price_fcfa` (0/15 000/35 000 XAF).
Une organisation camerounaise résout donc son prix par le chemin
`plan_prices` (nouveau), avec un résultat **identique** au chemin de
repli `plans.price_fcfa` (ancien) — les deux convergent. Vérifié par
`subscription-payment-service.test.ts` (le test de régression existant
passe sans modification de ses assertions) et par exécution réelle des
migrations sur un Postgres local (voir rapport d'implémentation).

## Limites connues (voir rapport d'implémentation pour le détail)

- Les **add-ons** (`addons-service.ts`) restent mono-devise XAF — hors
  périmètre explicite de ce lot (le cahier ne demande une tarification
  par pays que pour les *plans*, section 17). À traiter avec une table
  `addon_prices` par pays sur le même modèle que `plan_prices` si des
  organisations non-camerounaises doivent acheter des add-ons.
- Le pricing appliqué au checkout est déterminé par `billing_interval =
  'monthly'` uniquement (colonne conservée pour extensibilité, mais
  restreinte : NotchPay n'a pas de prélèvement récurrent réel, voir
  `docs/PAYMENT_INTEGRATION.md`).
