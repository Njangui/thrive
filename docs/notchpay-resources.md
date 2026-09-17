# NotchPay Resources — historique (fonctionnalité retirée le 16/09/2026)

Ce fichier documente une **fonctionnalité de synchronisation automatique
qui n'existe plus dans le code**. Conservé comme historique/diagnostic
pour comprendre pourquoi les pays/canaux sont désormais gérés
manuellement (SQL direct + `/admin/countries`) plutôt que synchronisés
depuis NotchPay — voir `docs/country-engine.md` pour l'architecture
actuelle.

Documentait à l'origine l'intégration de la **Resources API** de
NotchPay (`/resources/countries`, `/resources/channels`), distincte de
l'API `/payments` déjà intégrée (voir `docs/PAYMENT_INTEGRATION.md`).

## ⚠️ Correctif 16/09/2026 — les endpoints ci-dessous étaient FAUX

Le risque identifié dans la section précédente ("à vérifier en premier
lors du prochain déploiement") s'est confirmé en production : la
synchronisation échouait avec
`NotchPay listCountries failed (404): {"code":"404","status":"Not
Found","message":"Resource Not Found"}`.

Vérification faite le 16/09/2026 contre la référence API RÉELLEMENT
auto-générée de NotchPay (`developer.notchpay.co/api-reference/
list-all-countries` et `/list-all-payment-channels`, générée depuis
leur vraie spec OpenAPI) — **par opposition** à la page-guide
narrative `/api-reference/resources` qui avait servi de source le
06/09/2026. Ces deux pages du site de NotchPay se contredisent :

| | Page-guide "Resources API" (source du 06/09/2026 — **fausse**) | Référence OpenAPI réelle (vérifiée le 16/09/2026) |
|---|---|---|
| Lister les pays | `GET /resources/countries` → `{countries: [{code, name, currency, flag, phone_code, channels}]}` | `GET /countries` (sans préfixe) → `{data: [{name, code}]}`, mais c'est la liste générique des ~250 pays du **monde**, pas "supportés par NotchPay" |
| Lister les canaux | `GET /resources/channels?country=X` → `{channels: [{id, name, country, currency, type, minimum, maximum, logo}]}` | `GET /channels?country=X` → `{data: [...]}` ; l'exemple visible dans la doc ressemble à un catalogue de TYPES (Mobile Money, Card, PayPal) plutôt qu'aux opérateurs individuels par pays (`cm.mtn`) |

**Conclusion : aucun endpoint public confirmé de NotchPay ne répond à
la question posée par le Country Engine ("quels pays/canaux NotchPay
supporte-t-il techniquement comme plateforme").** La page-guide qui le
prétendait décrit une fonctionnalité qui ne correspond à aucune route
réellement déployée (404 systématique).

### Ce qui a été corrigé dans le code (16/09/2026)

- `resources-client.ts` : les chemins `/resources/countries` et
  `/resources/channels` ont été remplacés par les vrais chemins
  confirmés `/countries` et `/channels` — élimine le 404.
- `notchpay-resources-service.ts` : **logique inchangée**. La
  validation défensive déjà présente (une ligne sans `currency`/
  `phone_code` est ignorée, jamais une erreur globale) fait que
  `syncCountries()` retourne désormais `{status: "success",
  itemsSynced: 0}` à chaque exécution — plus d'erreur affichée, mais
  aucune nouvelle donnée non plus, puisque `/countries` ne fournit pas
  ces champs. C'est le comportement voulu tant qu'aucun endpoint
  NotchPay adapté n'existe.
- Les pays/canaux réellement utilisés en production (Cameroun, MTN,
  Orange Money) restent ceux saisis à la main dans
  `0040_country_engine.sql` — **ils n'ont jamais dépendu de cette
  synchronisation**, qui n'a probablement jamais réussi à récupérer de
  vraies données depuis sa création.

### Pour aller plus loin (si besoin un jour)

Si l'auto-découverte de nouveaux pays devient nécessaire, la voie
fiable est de contacter le support NotchPay ou de tester en direct
(`curl -H "Authorization: <clé>" https://api.notchpay.co/channels?country=CM`)
pour voir la forme RÉELLE retournée par ce compte, plutôt que de se
fier à la doc-guide narrative de NotchPay. En attendant, gérer
`notchpay_supported`/`payment_channels` à la main via `/admin/countries`
(comme c'est déjà le cas pour le Cameroun) reste la source de vérité
la plus fiable.

## Architecture

```
notchpay-resources-service.ts   (application — lecture/écriture DB, jamais appelé par un composant React)
        │
        ▼
resources-client.ts   (infrastructure — transport HTTP pur, aucune écriture DB)
        │
        ▼
api.notchpay.co/resources/*
```

`NotchPayResourcesClient` (infrastructure) est délibérément **séparé**
de `NotchPayClient` (paiements) : même compte/clé API, mais des
préoccupations différentes. Pas de port `PaymentProvider` partagé — la
synchronisation de ressources est spécifique à NotchPay par
construction (un futur second provider de paiement aurait son propre
catalogue, pas interchangeable via une interface commune sans données
réelles sur sa forme).

## Comportement en cas d'échec

`syncCountries()`/`syncChannels()` ne lèvent **jamais** — elles
retournent `{ status: "failed", errorMessage }` et **ne touchent à
aucune ligne existante** en cas d'erreur réseau/API. Le dernier état
synchronisé reste utilisé par toute l'application (`countries`,
`payment_channels` inchangées). Chaque tentative (succès ou échec) est
journalisée dans `notchpay_sync_runs`, consultable via
`getSyncStatus()` — affiché au Super Admin comme "Dernière
synchronisation : ... / Statut : ✓ / ⚠".

Une synchronisation **ne modifie jamais** `countries.launch_status` —
seule colonne qui reste exclusivement sous contrôle Super Admin.

## Déclenchement

- Manuel : bouton "Synchroniser NotchPay" sur `/admin/countries`
  (`admin-countries-service.ts::triggerManualSync`, `syncAllResources()`
  — synchronise les pays puis les canaux de CHAQUE pays connu,
  séquentiellement).
- Par pays : bouton "Synchroniser les canaux de ce pays" sur
  `/admin/countries/[code]` (`triggerCountryChannelsSync`).
- Périodique : **pas encore câblé** dans ce lot (pas de nouvelle route
  `/api/cron/*` créée) — la fréquence par défaut demandée par le cahier
  (1×/jour) reste à brancher sur un cron externe, sur le même modèle
  que `/api/cron/process-subscription-renewals` déjà existant. Voir
  "Prochaines étapes" du rapport d'implémentation.

## Retrait complet (16/09/2026, deuxième passe)

Après le correctif d'URL ci-dessus, le Super Admin a demandé une
recherche approfondie sur la couverture réelle de NotchPay pour peupler
`countries`/`payment_channels` directement en SQL plutôt que par sync.
Conséquence : `resources-client.ts`, `syncCountries`/`syncChannels`/
`syncAllResources`/`getSyncStatus` et les boutons "Synchroniser" (liste
+ page pays) ont été **entièrement retirés** — `notchpay-resources-service.ts`
n'est plus qu'une couche de lecture DB (`getCountries`/`getCountry`/
`getChannels`). Tout ce qui précède dans ce fichier (architecture,
endpoints, comportement de sync) décrit donc du code qui **n'existe
plus** — gardé uniquement comme trace du diagnostic.

### Niveau de confiance sur la couverture pays (recherche du 16/09/2026)

- **Confirmé opérationnel** : Cameroun uniquement. La page technique
  `developer.notchpay.co/send-money/transfers` (pas la page-guide
  "Resources API", déjà montrée peu fiable) ne liste QUE `cm.mtn` /
  `cm.orange` / `cm.mobile` comme types de destinataires supportés, et
  précise même que les virements bancaires sont encore "coming soon"
  chez NotchPay. Aucune couverture indépendante (presse, dépôts de
  code tiers) trouvée confirmant un lancement multi-pays réel.
- **Revendication publique NotchPay, non vérifiée techniquement** :
  Nigeria (NGN), Ghana (GHS), Côte d'Ivoire (XOF), Sénégal (XOF),
  Gabon (XAF), Kenya (KES), Ouganda (UGX) — cités par la page-guide
  "Resources API" et la FAQ NotchPay comme couverture prévue/en cours.
  Devise et indicatif de ces 7 pays sont des faits ISO standards
  (fiables à 100%, indépendants de NotchPay) ; en revanche les
  `channel_code` insérés pour eux (migration `0052`) sont des
  PLACEHOLDERS construits à partir des catégories larges citées
  (Mobile Money, Cards, Wave, M-Pesa, USSD) — jamais vérifiés en
  direct — d'où `payment_channels.is_available = false` par défaut
  pour ces 7 pays : un Super Admin doit consciemment le repasser à
  `true`, pays par pays, après vérification réelle (support NotchPay
  ou test de paiement), avant toute activation commerciale.
- Aucune source (y compris un site "v3" en preview repéré pendant la
  recherche, à l'aspect non officiel/non confirmé) ne justifie d'aller
  au-delà de ces 7 pays — ne pas en ajouter d'autres sans nouvelle
  vérification explicite.
