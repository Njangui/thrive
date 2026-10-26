# C5 — Plan « Pubs Zernio » (vague 3) — notes d'audit et plan, avant tout code

Sources : documentation Zernio consultée le 09/10/2026 (docs.zernio.com : Meta Ads, Messaging & Call Ads, Duplicate & Lifecycle, Insights, Ads Pricing, changelog). Ce qui n'est pas dans ces pages est marqué « à vérifier ».

## 1. Ce que la documentation confirme
| Sujet | Fait | Conséquence pour Flexco |
|---|---|---|
| Pub qui ouvre WhatsApp | `POST /v1/ads/messaging` avec `destination: "whatsapp"` (l'ancien `/v1/ads/ctwa` est **déprécié**). Exige une Page Facebook **appairée à un numéro WhatsApp Business vérifié**. | Premier cas d'usage (le plus adapté au marché). Pas d'ancien endpoint. |
| Validation à blanc | `validateOnly: true` : Meta uniquement, forme « une création » seulement (pas `creatives[]`, pas `adSetId`) ; autre plateforme → `501 feature_not_available`. Le changelog ajoute Google PMax / Demand Gen. | **TikTok, LinkedIn, Pinterest, X : pas de dry-run.** On démarre par Meta. |
| Création en pause | Possible sur Meta et TikTok (`status`), et `statusOption: PAUSED` à la duplication. | Pour les plateformes sans dry-run : créer en pause, puis une 2e confirmation pour activer. |
| Idempotence | En-tête `Idempotency-Key` (UUID, 24 h) sur `/ads/messaging` ; même clé + corps différent = 422 ; sans clé, un retry **crée une 2e campagne**. | Clé = notre identifiant de demande, toujours envoyée. |
| Budgets | Unités entières de la **devise du compte pub** (pas de centimes) ; `minimumDailyBudget` et `currency` lus via `GET /v1/ads/accounts` ; budget `lifetime` exige `endDate`. | Ne rien coder en dur : lire devise et minimum. |
| Pause / reprise | `PUT /v1/ads/campaigns/{id}/status` ; lot de 50 : `/ads/campaigns/bulk-status`. Supprimer une campagne supprime ses annonces. | « Arrêt d'urgence » = pause en lot (réversible). |
| Mesure | `GET /v1/ads/tree` et `/v1/ads/timeline` : dépense, clics, conversions, ROAS, **sans appel Meta** (données synchronisées). `reviewStatus` : `in_review`, `approved`, `rejected`, `with_issues`. | Alimente les alertes déjà écrites (étape 3). Une pub refusée = alerte. |
| Prérequis | Compte pub (`act_…`), Page, **moyen de paiement chez Meta** (Zernio ne peut pas l'ajouter). Un compte Instagram connecté en « Instagram Login » **ne peut pas** faire de pub (`422 linked_account_required`). | Contrôle de préparation avant toute proposition de pub. |
| Veille | « Ad Library » : recherche dans l'archive publique des pubs. | Base de la veille concurrentielle (données publiques). |

## 2. Deux faits qui changent les hypothèses du brief (à faire confirmer par Zernio)
1. **Facturation Zernio par usage** : pubs = 0,01 $ par annonce active/mois au-delà de 500 gratuites (aucun pourcentage de la dépense pub) ; **messages sortants = 10 000 gratuits puis 1 $ / 10 000, tous canaux, à partir du 1er octobre 2026**. Le brief dit « tout inclus » : ce n'est plus exact d'après la documentation. Impact faible par message mais non nul ; **mon estimateur de diffusion (étape 2) ne l'inclut pas encore**.
2. **Sans carte bancaire chez Zernio**, la plateforme est bloquée à **500 annonces actives** (`403 ads_allowance_exceeded`, alerte e-mail à 375).

## 3. Le vrai risque n'est pas Zernio, c'est la dépense publicitaire
L'argent de la pub est payé **à Meta par le tenant** ; Flexco ne peut pas la « débiter » dans le registre d'usage. Le garde-fou doit donc être **côté création** :
- **Plafonds obligatoires** par tenant (journalier et mensuel, en devise du compte pub). **Sans plafond défini : aucune pub possible** (défaut sûr, aucun montant inventé).
- **Exposition maximale affichée sur la carte d'approbation** : budget journalier × nombre de jours (ou budget total), comparée au plafond restant.
- Toute campagne a une **date de fin** (sinon refusée) ; toute création est `sensitive` et liée à l'**empreinte exacte** des paramètres (même mécanisme que le Studio).
- Jamais de réactivation automatique ; la **pause** automatique n'existe que sur règle explicite du propriétaire.

## 4. Plan (petites PR, Meta / WhatsApp d'abord)
1. **`AdsPort` + adaptateur Zernio** : lister les comptes pub, créer une pub WhatsApp (avec `validateOnly`), pause/reprise (unitaire et en lot), lire arbre et chronologie. `Idempotency-Key` systématique. Tests sur réponses simulées conformes à la doc.
2. **Table `ad_requests`** (comme `media_jobs`) : empreinte confirmée, clé d'idempotence, exposition maximale, statut, identifiants Meta ; RLS lecture membres, écriture service-role ; plafonds dans `growth_settings`.
3. **Service** `previewAd` (validation à blanc + exposition maximale + contrôle de préparation) → `submitAd` (empreinte, plafonds, idempotence) → `pauseAd` / `pauseAllAds`.
4. **Surveillance** : dépense vs plafond, annonce refusée, dépense sans conversion après N jours, ROAS bas → alertes (module existant).
5. **Plus tard** : trafic vers le site (`/ads/create`), puis TikTok/Google (sans dry-run : création en pause + 2e confirmation).
6. **Veille marché** (séparée) : Ad Library + pages publiques, **uniquement des données publiques d'entreprises**, aucune donnée personnelle ; à faire valider côté loi n° 2024/017.

## 5. Questions pour Marc-well
1. **Plafonds** : je propose « sans plafond défini = aucune pub ». D'accord ? (Aucun montant par défaut.)
2. **Zernio** : peut-on confirmer avec eux la facturation des messages (10 000 gratuits puis 1 $/10 000) et si elle s'applique à notre contrat ?
3. **Numéro WhatsApp** : les tenants ont-ils déjà une Page Facebook appairée à leur numéro WhatsApp Business vérifié ? C'est le prérequis le plus bloquant.
4. **Attribution pub → conversation → commande** : la documentation indique que l'identifiant de la pub arrive dans le « referral » du premier message WhatsApp. Il faudra que C3 (assistant client) enregistre `source_ad_id` sur la conversation. Je rédige le contrat ; la page « Conversions API for business messaging » reste **à lire**.
