# Internationalisation

Couvre ce que le Country Engine change concrètement pour un utilisateur
non-camerounais : devise, téléphone, langue. Voir `docs/country-engine.md`
pour l'architecture pays/pricing.

## Devises

`currency-service.ts` remplace l'hypothèse FCFA globale par une table
statique (`CURRENCIES`) de métadonnées par devise (symbole, nombre de
décimales ISO 4217). Table volontairement statique — pas d'appel réseau
pour formater un prix, opération bien trop fréquente pour en dépendre
(voir `docs/notchpay-resources.md`, NotchPay expose bien
`/resources/currencies` avec `decimal_places`, mais ce n'est PAS
consommé automatiquement dans ce lot).

Tout montant est stocké en **entier**, dans la plus petite unité de sa
devise (jamais un flottant) :

```ts
normalizeMoney(50, "GHS")   // -> 5000 (2 décimales : pesewas)
normalizeMoney(15000, "XAF") // -> 15000 (0 décimale : identité)
formatMoney(5000, "GHS")    // -> "50,00 GH₵"
```

**Ajouter une devise** : une seule entrée à ajouter dans `CURRENCIES`
(`currency-service.ts`). Rien d'autre à toucher — `plan_prices` et
`subscription_payments.currency_code` sont déjà des colonnes texte
libres (validées par regex ISO 4217, pas par un enum fermé).

Une devise absente de la table retombe sur 2 décimales par défaut
(jamais 0, pour ne jamais tronquer silencieusement un montant réel) —
signal qu'il faut compléter `CURRENCIES` dès que constaté.

## Téléphone

Aucune hypothèse `+237` codée en dur dans la validation : le format
E.164 générique (`admin-numbers-service.ts::E164_PATTERN`) accepte déjà
n'importe quel indicatif — c'était déjà le cas avant ce lot, seuls les
**placeholders visuels** des formulaires supposaient `+237`.

Corrigé dans l'onboarding (`onboarding-wizard.tsx`) : le placeholder du
champ téléphone/WhatsApp de l'étape 3 suit désormais l'indicatif
(`phoneCode`) du pays sélectionné à l'étape 1, plutôt que `+237` en dur.

**Non traité dans ce lot** (hors périmètre explicite) : les autres
formulaires publics de l'application (réservation, etc.) qui affichent
encore un placeholder `+237` — recensés lors de l'inspection initiale
mais non modifiés, car ils concernent les CLIENTS FINAUX des
entreprises utilisatrices de SME-OS, pas SME-OS elle-même (hors mission
"country management" au sens strict). Voir rapport d'implémentation,
section "Risques restants".

## Langue

Pays et langue restent deux concepts **délibérément non couplés** : le
Country Engine ne dérive aucune langue depuis `countries.iso_code`, et
aucun changement de ce lot ne force une langue selon le pays choisi à
l'onboarding. L'application reste actuellement mono-langue (français)
indépendamment du pays — un futur support multilingue devra passer par
un mécanisme séparé (ex : préférence explicite de l'organisation), pas
par une déduction depuis le pays.

## Ce que le Country Engine NE fait PAS (hors périmètre, section 49)

- Pas de conversion de devise / taux de change automatique.
- Pas de moteur de traduction ou de contenu localisé par pays.
- Pas de fuseau horaire dérivé du pays (`organizations.timezone` garde
  son défaut `Africa/Douala` pour toute nouvelle organisation, y
  compris hors Cameroun — laissé configurable manuellement comme
  avant ce lot, non couplé au Country Engine).
