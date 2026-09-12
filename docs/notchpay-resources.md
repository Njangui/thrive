# NotchPay Resources — intégration technique

Documente l'intégration de la **Resources API** de NotchPay
(`/resources/countries`, `/resources/channels`), distincte de l'API
`/payments` déjà intégrée (voir `docs/PAYMENT_INTEGRATION.md`). Utilisée
UNIQUEMENT pour synchroniser un catalogue de capacités (pays/devises/
canaux) — jamais pour déplacer de l'argent.

## Endpoints confirmés

Vérifiés via `developer.notchpay.co/api-reference/resources` le
06/09/2026 (page réellement récupérée pendant l'implémentation, pas
devinée depuis un souvenir d'entraînement).

| Endpoint | Usage |
|---|---|
| `GET /resources/countries` | Liste des pays supportés par NotchPay comme moyen de paiement — **distinct** de `GET /countries` (sans préfixe), qui liste tous les pays du monde pour des formulaires génériques et n'est **pas** utilisé ici |
| `GET /resources/countries/{code}` | Détail d'un pays + `available_channels` |
| `GET /resources/channels?country={code}` | Canaux de paiement individuels (ex : `cm.mtn`), filtrables par pays |

### Forme des réponses (telle que documentée)

```json
// GET /resources/countries
{
  "code": 200, "status": "OK", "message": "...",
  "countries": [
    { "code": "CM", "name": "Cameroon", "currency": "XAF",
      "flag": "https://assets.notchpay.co/flags/cm.png",
      "phone_code": "+237", "channels": ["mobile_money", "card"] }
  ]
}

// GET /resources/channels
{
  "code": 200, "status": "OK", "message": "...",
  "channels": [
    { "id": "cm.mtn", "name": "MTN Mobile Money", "country": "CM",
      "currency": "XAF", "type": "mobile_money",
      "logo": "...", "minimum": 100, "maximum": 1000000 }
  ]
}
```

Point important : `flag` est une **URL d'image**, jamais un emoji.
Stocké tel quel dans `countries.flag_url` — l'emoji affiché en Super
Admin/landing est calculé à la volée (`country-service.ts::isoCodeToFlagEmoji`)
en repli quand `flag_url` est absent (pays pas encore synchronisé).

## Ce qui n'a PAS pu être vérifié dans cet environnement

Le sandbox d'exécution n'a accès réseau qu'aux registres de paquets
(npm/pip/GitHub) — **pas** à `api.notchpay.co`. Impossible d'exécuter un
vrai appel HTTP contre l'API pendant l'implémentation. Le parsing est
donc défensif (`syncCountries`/`syncChannels` ignorent silencieusement
une entrée malformée plutôt que de faire échouer toute la
synchronisation) et les tests (`notchpay-resources-service.test.ts`)
valident le comportement du CODE contre la forme documentée ci-dessus,
pas contre une vraie réponse serveur. **À vérifier en premier lors du
prochain déploiement** : lancer une synchronisation manuelle
(`/admin/countries` → "Synchroniser NotchPay") contre un vrai compte
NotchPay et comparer la forme réelle de la réponse à celle documentée
ici.

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
