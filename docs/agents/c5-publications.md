# C5 — Publications : profils, métadonnées, annulation (étape 1)

## Décisions
- **Telegram = canal direct** (bot du tenant, table `telegram_publications`, cron `process-telegram-publications`), hors Zernio. Son annulation est un changement de statut gardé (`scheduled` → `cancelled`), sans appel externe.
- **Réseaux (Facebook, Instagram, TikTok, LinkedIn, X, Pinterest, YouTube)** : via Zernio. Annulation = `DELETE /posts/{id}` (brouillon ou programmé). Un post publié se retire par « Unpublish », non pris en charge sur Instagram, TikTok et Snapchat : **non implémenté ici**, une publication diffusée est refusée.
- **Honnêteté** : jamais « annulé » sans confirmation du fournisseur (404 = déjà supprimé = OK ; autre erreur = statut inchangé + `error_message`).
- **Limites par plateforme en code** (`platform-profiles.ts`), valeurs prudentes, toutes « a_verifier » sauf Telegram. Le LLM rédige, `fitMetadataToPlatform` garantit les limites.

## Schéma (migration 0180)
`social_post_targets.status` accepte `cancelled` ; `social_posts` et `telegram_publications` gagnent `cancelled_at` / `cancelled_by` ; `social_posts.publication_meta` (jsonb) ; table `growth_settings` (`publication_autonomy` = `propose` par défaut | `add`), lecture membres, écriture owner/admin (RLS).

## Code
`src/application/services/publishing/` : `platform-profiles.ts`, `publication-metadata.ts`, `publication-scheduling.ts` (annuler, reprogrammer Telegram, lister). Chaque fonction vérifie que l'acteur est membre de l'organisation (service-role).

## Limites connues / à faire
- Reprogrammation **sociale** non faite : `PUT /posts/{id}` existe chez Zernio, corps exact **à vérifier** (test le moins coûteux : un brouillon sur un compte de démo).
- Annulation d'une publication programmée vers un **groupe WhatsApp** (`whatsapp-group-service`) non couverte.
- `growth_settings` : pas encore lue par un agent ; les politiques RLS sont écrites mais **pas encore testées contre une base réelle** (pas d'instance Supabase ici).
- Branchement au registre d'outils / `evaluateAction` (C1) en vague 2 : `post.cancel` = `write_reversible`, `post.schedule` selon réglage.

## Tester
`npx vitest run src/application/services/publishing` (28 tests).

---

# Étape 2 — Diffusion : annulation, coût, palier, horaire

## Fait
- `cancelContactBroadcast` **idempotent** (« déjà annulée »), tracé (`cancelled_by/at`), refus explicite d'une campagne `processing` ou terminée (le cron réécrirait le statut ; mieux vaut un refus clair qu'une fausse annulation).
- `broadcast/broadcast-planning.ts` (pur) : `estimateBroadcastCost` (coût attendu + plafond, tarifs injectables, inconnu compté à part, FCFA seulement si un taux est fourni), `planDelivery` (modèle obligatoire hors fenêtre, palier du numéro, report jour par jour), `suggestSendHour` (d'après les messages entrants, heure de Douala ; défaut explicite faute de 30 messages).
- `broadcast/broadcast-preview-service.ts` : `previewBroadcast` (lecture seule) + `buildBroadcastPreview` (pur, testé).
- Migration 0181 : `contact_broadcasts.template_name/template_params/estimated_cost/cancelled_*`, `growth_settings.whatsapp_daily_unique_contacts` (défaut 250).

## Hypothèses à confirmer
- Tarif marketing 0,0259 $/message (zone « Rest of Africa ») et quota de 1 000 messages de service/mois : **sources tierces, non vérifiés** (`DEFAULT_META_RATE_CARD.verified = false`). Tarif de service au-delà du quota : **inconnu**, jamais inventé.
- Le palier (250 contacts uniques/jour) est supposé ne compter que les conversations démarrées par modèle. **À vérifier chez Meta.**
- Les compteurs « déjà démarrés aujourd'hui » et « messages de service ce mois-ci » sont des **approximations** (envois WhatsApp réussis des diffusions Flexco ; les réponses de l'IA/de l'équipe ne sont pas comptées).

## Pas fait (étape 2b)
- **Envoi réel d'un modèle hors fenêtre** : le port a `templateName`, mais l'adaptateur Zernio ne l'implémente pas. Zernio expose une API de diffusion WhatsApp par modèle (créer, ajouter les destinataires par lots de 100, envoyer/programmer, annuler) ; la forme exacte des requêtes est **à vérifier** (test le moins coûteux : une diffusion d'un modèle approuvé vers 1 numéro de test). Tant que ce n'est pas fait, les hors-fenêtre restent ignorés à l'envoi.
- Branchement de l'estimation dans `createContactBroadcast` (stockage de `estimated_cost`) et dans l'UI/la carte d'approbation C1.
- `previewBroadcast` (accès base) non testé unitairement : à valider en intégration.

---

# Étape 3 — `track()`, analyses et alertes

## Fait
- **`track()`** (`analytics/track.ts`) : façade typée au-dessus de `trackEvent` (qui ne lève jamais). Nouvel événement **`whatsapp_click`** (migration 0182 : contrainte CHECK recréée en entier, sinon les insertions échoueraient en silence, même piège que 0060). `trackClickAction` l'émet en plus de `cta_click` (inchangé) quand le `ctaId` contient « whatsapp ».
- **Attribution sans donnée personnelle** : le clic porte `visitor` (HMAC IP + navigateur + jour, jamais l'IP) ; c'est la même empreinte que l'entrée de session, qui porte source/campagne UTM → `c5_traffic_by_source` relie « pub/source → visiteur → clic WhatsApp ».
- **Analyses SQL** (migration 0183), calculées en base, jamais par le LLM : stock dormant, marge par produit, prévision de rupture, clients inactifs (hors désinscrits), résultats des diffusions, trafic par source. Exécutables par le **service-role uniquement** (`anon`/`authenticated` sans droit) ; `getGrowthInsights` vérifie d'abord que l'acteur est membre de l'organisation.
- **Alertes** (`growth-alerts.ts`) : rupture, marge faible/négative, prix d'achat manquant, stock dormant (valeur immobilisée), clients inactifs. Chaque alerte porte `facts` + `items` (chiffres du SQL) et une action suggérée ; le rédacteur IA peut reformuler, pas recalculer.
- **Bilans** `buildDigest('daily' | 'weekly')` : contenu seulement ; `empty: true` si rien à signaler. **La livraison (Telegram, WhatsApp, push) relève de C2 via `notify()`**, et la planification du cron de C1.

## Choix qui comptent
- **Coût inconnu ≠ marge de 100 %** : `order_items.unit_cost` vaut 0 par défaut (0069). Un coût à 0 est traité comme *inconnu* : marge NULL, et une alerte « prix d'achat manquant » à la place. C'est la erreur la plus facile à faire sur ce schéma.
- Ventes = commandes `completed` (c'est là que le stock est décrémenté, 0009) ; date = `orders.created_at`.
- Diffusions : commandes `confirmed`/`completed` passées par un destinataire **dans les N jours après réception** = **corrélation, pas causalité** (dit dans le bilan).
- Seuils (jours, marge minimale, horizon de rupture) = paramètres, pas des vérités métier.

## Tests
- `npx vitest run src/application/services/analytics` (19 tests TS).
- **SQL réel** : `npm i --no-save @electric-sql/pglite && node tests/sql/c5-insights.pglite.mjs` (Postgres en WASM, schéma réduit aux colonnes utilisées ; 7 groupes de vérifications dont l'isolation entre tenants et les droits d'exécution). Hors `npm test` et **pglite n'est pas ajouté aux dépendances** : à décider.

## Pas fait / limites
- **Boucle « pub → conversation → commande »** : seule la partie « source → visiteur → clic WhatsApp » est mesurée. Relier une conversation WhatsApp à une pub demande l'identifiant de référence de Meta dans le webhook (publicités « cliquer pour WhatsApp ») : **à vérifier** dans la doc Zernio/Meta, à faire avec l'agent Pub (vague 3).
- `product_view` ne porte pas `visitor` (page produit = périmètre C4) : pas d'attribution des vues produit par source.
- Alertes **non planifiées** : le cron quotidien/hebdomadaire et l'envoi dépendent de C1 (planificateur) et C2 (`notify()`).
- Ventes **sans `product_id`** (lignes libres) exclues des marges et des prévisions de rupture.
- Fonctions SQL non testées sur les vraies données (volume, plans d'exécution) : `EXPLAIN` à faire sur une base réaliste.

---

# Étape 4 — Studio créatif (MediaPort, kit de marque, gabarits)

## Fait
- **`MediaPort`** (`domain/ports/media-port.ts`) : asynchrone (`submit` / `status` / `cancel`), `supports(capability)`. Capacités = `image.generate`, `image.enhance`, `image.remove_background`, `video.generate` (des **capacités**, pas des agents). Adaptateur **fal.ai** (API de file d'attente) ; le suivi est par **interrogation** (pas de webhook public à authentifier).
- **Aucun modèle imposé** : un identifiant de modèle par capacité (`FAL_MODEL_*`, variables d'environnement). Sans identifiant → `MediaNotConfiguredError`, **avant** toute création de tâche ou tout débit.
- **Dépense = `sensitive`, liée à l'empreinte** : `previewMedia` → estimation au pire cas + empreinte SHA-256 des paramètres exacts et du tenant (carte d'approbation, C1). `submitMedia` n'exécute que si l'empreinte confirmée est identique à celle recalculée (un paramètre changé après le « oui » = refus total).
- **Idempotence** : `unique (organization_id, idempotency_key)` ; rejouer = même tâche, **un seul débit, un seul appel fournisseur** ; une clé réutilisée pour une autre demande est refusée.
- **Débit avant l'appel fournisseur**, plafond mensuel optionnel (`growth_settings.media_monthly_budget_milli_usd`, les tâches échouées/annulées ne comptent pas), échec après débit → `refund_due = true`.
- **Coût** : plafond du brief par défaut (images 0,04 $, vidéo 0,50 $/s) donc **jamais sous-estimé** ; tarif réel injectable une fois le modèle choisi. Unité de débit = **milli-USD de coût fournisseur** (neutre : aucun prix de plan, le modèle de prix v2 n'est pas décidé).
- **Résultats copiés dans NOTRE stockage** (`StorageProvider`, donc R2 quand C4 l'aura branché) : hôtes autorisés (`fal.media`, `fal.run`), taille max 100 Mo, types image/vidéo seulement. Une copie échouée laisse la tâche **ouverte** et retentable.
- **Kit de marque visuel** (couleurs, polices, logo, style) : lecture tout membre, écriture owner/admin (contrôlé en service ET par la RLS). La voix rédactionnelle reste à C3.
- **Prompt d'image** : style + palette de la marque, **jamais de texte ni de logo dans l'image**. Le texte, le prix et le logo sont posés par un **gabarit SVG** (gratuit, déterministe) : prix formaté par le code depuis le catalogue, tout échappé, couleurs/polices/URL non sûres écartées, texte choisi par contraste.
- **Sécurité fournisseur** : la clé API n'est envoyée qu'à `queue.fal.run` (une URL de suivi renvoyée ailleurs est ignorée).

## Schéma (migration 0184)
`brand_kits` (RLS : lecture membres, écriture owner/admin, contraintes hex/https/polices) ; `media_jobs` (RLS : **lecture seule** pour les membres, aucune politique d'écriture : seul le service-role écrit) ; `growth_settings.media_monthly_budget_milli_usd`. `media_jobs` sert de **grand livre provisoire** (`usage_units`, `usage_synced`) tant que C1 n'a pas livré `usage.charge` : `jobLedgerUsagePort` le remplacera sans changer le service.

## Tests
- TS : `npx vitest run src/application/services/studio src/infrastructure/providers/media` (58 tests). Deux mutations volontaires (contrôle d'empreinte, plafond) sont bien détectées.
- **SQL réel** : `npm i --no-save @electric-sql/pglite && node tests/sql/c5-migrations-rls.pglite.mjs` applique 0180, 0181, 0182, 0184 sur Postgres (PGlite) et vérifie contraintes + RLS (rôle, appartenance, isolation entre tenants). Deux mutations de politique RLS sont détectées (un premier test était trop faible ; corrigé).

## À vérifier / pas fait
- **fal.ai (non confirmé, dépend du modèle)** : noms des champs d'entrée (`image_size`, `num_images`, `image_url`, `duration`, `aspect_ratio`), forme de sortie par modèle, méthode HTTP exacte de l'annulation (PUT supposé), facturation d'une tâche annulée, domaines du CDN de sortie. **Test le moins coûteux** : un seul visuel 1:1 avec le modèle d'image le moins cher, `FAL_KEY` d'un compte de test.
- **Aucune génération réelle n'a été faite** (pas de clé, pas de réseau fal ici) : l'adaptateur est testé sur des réponses simulées conformes à la documentation.
- **SVG ≠ PNG** : Instagram/Facebook/TikTok n'acceptent pas le SVG. La rastérisation (sharp ou `next/og`) n'est **pas faite** : décision à prendre (nouvelle dépendance).
- **Vidéo** : durée plafonnée à 15 s (garde-fou réglable `MAX_VIDEO_SECONDS`) ; pas d'enchaînement de plans ni de voix off ici.
- **Pas d'agent ni d'outil enregistré** : le branchement dans le registre et les cartes d'approbation attend C1 (vague 2). Pas d'interface ni de route d'API : services seulement.
- **Remboursement** : le contrat C1 n'a pas d'opération de remboursement ; `refund_due` marque ce qu'il faudra rembourser.
- Un cron (C1) doit appeler `refreshMediaJob` pour les tâches `queued`/`running`.

## Outils C5 déclarés (proposition pour `docs/agents/ROLE_TOOL_MATRIX.md`, tenue par C1)
| Outil | Risque | Permission (proposée) | Remarque |
|---|---|---|---|
| `insights.get`, `digest.build` | read | tout membre (rôles gestion) | chiffres issus du SQL |
| `post.list` | read | manager+ | |
| `post.schedule` / `post.reschedule` | write_reversible (selon réglage « proposer/ajouter ») | manager+ | reprogrammation sociale non faite |
| `post.cancel` | write_reversible | manager+ | idempotent |
| `broadcast.preview` | read | manager+ | coût Meta « à confirmer » |
| `broadcast.schedule` | **sensitive** | owner/admin | toujours confirmé |
| `broadcast.cancel` | write_reversible | manager+ | idempotent, avant envoi seulement |
| `brand_kit.get` | read | tout membre | |
| `brand_kit.save` | write_reversible | owner/admin | |
| `media.preview` | read | manager+ | aucune dépense |
| `media.generate`, `media.enhance` | **sensitive** | owner/admin | empreinte confirmée, plafond mensuel |
| `media.cancel` | write_reversible | manager+ | |
| `template.render_promo` | read | tout membre | gratuit |

---

# Étape 5.1 — Pubs : `AdsPort` et adaptateur Zernio (aucun service, aucune table encore)

Plan complet, faits confirmés et risques : voir `c5-ads-plan.md`.

## Fait
- **`AdsPort`** (`domain/ports/ads-port.ts`) : `listAdAccounts`, `validateWhatsAppAd` (à blanc, ne crée rien), `createWhatsAppAd` (clé d'idempotence **obligatoire**), `setCampaignStatus`, `bulkSetCampaignStatus` (par 50), `getTimeline`.
- **Adaptateur Zernio** (`infrastructure/providers/ads/zernio-ads-adapter.ts`) : `POST /v1/ads/messaging` (`destination: "whatsapp"`, l'ancien `/ads/ctwa` est déprécié), `PUT /v1/ads/campaigns/{id}/status`, `POST /v1/ads/campaigns/bulk-status`, `GET /v1/ads/accounts`, `GET /v1/ads/timeline`.
- **Validation de la demande avant tout appel réseau** : compte pub `act_…`, image https, budget positif et fini, devise sur 3 lettres, **date de fin obligatoire** (garde-fou de dépense), pays en ISO, champs inconnus refusés.
- **Un refus de Meta à la validation est un résultat** (`ok: false` + sous-code), pas une exception ; une panne (500/501) reste une exception.
- **Identifiants de campagne strictement numériques** (pas d'injection dans le chemin d'URL) ; une campagne absente de la réponse d'un lot est rapportée **en erreur**, jamais supposée réussie.
- `describeAdsError` : messages français pour les erreurs documentées (quota de 500 annonces, Instagram Login, Page non appairée à WhatsApp, 409/422…), jamais le corps brut de l'API.

## Sécurité à respecter par le service (PR suivante)
La clé Zernio est celle de la **plateforme** : elle peut agir sur le compte pub de n'importe quel tenant. Le port ne connaît aucun tenant. **Le service doit vérifier que `accountId` et `adAccountId` appartiennent à l'organisation de l'acteur avant tout appel**, et ne jamais accepter un identifiant venant d'un agent ou d'un message.

## À vérifier (non confirmé par la documentation lue)
- Casse exacte de `campaignStatus` à la création : **non envoyé par défaut**. Test sans coût : `validateWhatsAppAd` avec ce champ.
- Enveloppe exacte de la réponse de `/ads/timeline` : le parseur lève une erreur claire si elle diffère.
- Forme exacte du corps de `bulk-status` (suivi de l'appel unitaire).
- Lecture de l'arbre des campagnes (`GET /v1/ads/tree`) : **non implémentée**, page « Campaigns » à lire.
- **Aucun appel réel fait** (pas de clé ni de compte pub de test) : tests sur réponses simulées conformes à la documentation. Test le moins coûteux : `listAdAccounts`, puis `validateWhatsAppAd`, puis `getTimeline` sur 7 jours.

## Correction à l'étape 2 (estimation de diffusion) — RÉSOLUE (voir « Étape 7 »)
La documentation Zernio indique une facturation des messages sortants : **10 000 gratuits, puis 1 $ par tranche de 10 000, tous canaux, depuis le 1er octobre 2026**. L'estimateur de diffusion ne l'inclut **pas encore** (coût par message très faible mais non nul). À confirmer avec Zernio avant de l'ajouter à la carte de tarifs.

---

# Étape 5.2 — Pubs : service, plafonds, journal (`ad_requests`)

## Fait
- **Plafonds obligatoires** (`growth_settings.ads_daily_cap / ads_monthly_cap / ads_cap_currency`, migration 0185) : tout ou rien, journalier ≤ mensuel, devise du compte pub, **aucune conversion**. **Sans plafonds, aucune pub n'est possible** (défaut sûr, aucun montant inventé). Modifiables par owner/admin seulement (RLS, vérifié).
- **Calcul des plafonds** (`ads/ad-budget.ts`, pur) : exposition **maximale**, jamais une prévision ; plafond journalier tenu **chaque jour** de la diffusion (pire jour, pas la somme des pubs qui ne se chevauchent pas), plafond mensuel **chaque mois touché** (budget total réparti par jour) ; jours de début et de fin inclus ; pub en attente comptée en entier, en pause comptée jusqu'à sa pause, échouée ignorée.
- **`previewAd`** (lecture) : exposition maximale, plafonds restants, contrôle du compte, **validation à blanc Meta** (appelée seulement si rien d'autre ne bloque), bloquants et avertissements → matière de la carte d'approbation (C1).
- **`submitAd`** : owner/admin ; empreinte confirmée == empreinte recalculée ; idempotence ; plafonds ; **clé envoyée à Zernio = identifiant de NOTRE ligne** (jamais choisi par l'appelant : pas de collision entre tenants, pas de rejeu sous une autre demande).
- **Issue incertaine** (panne réseau) : la ligne reste `pending` (elle compte déjà dans les plafonds) ; rejouer la même demande réutilise **la même clé** : pas de doublon. Un refus net du fournisseur marque `failed` avec un message français.
- **Pause** (owner/admin/manager) : jamais « en pause » sans confirmation du fournisseur. **Reprise** (owner/admin) : **plafonds revérifiés** pour la période restante (reprendre = dépenser de nouveau). **Arrêt d'urgence** `pauseAllAds` : lot, chaque ligne rapportée seule, seules les pauses confirmées sont enregistrées.
- **Ciblage explicite obligatoire** : sans pays, Zernio cible les États-Unis par défaut (documenté) ; durée maximale 90 jours (`MAX_AD_DAYS`, réglable).

## Sécurité (la clé Zernio est celle de la plateforme)
`verifyAdAccount` exige que le compte Zernio soit dans `social_accounts` (même organisation, `connected`, plateforme `facebook` ou `metaads` ; un compte Instagram seul ne peut pas faire de pub) **et** que le compte pub soit joignable par ce compte. Testé : compte d'un autre tenant, déconnecté, Instagram seul, inconnu, compte pub étranger → refus **avant tout appel Zernio**.

## Tests
- TS : `npx vitest run src/application/services/ads src/infrastructure/providers/ads` (55 tests). **Six mutations volontaires détectées** (contrôle de propriété du compte, plafonds à la reprise, empreinte, clé d'idempotence, contrôle de rôle, issue incertaine marquée « échec »).
- SQL réel : `node tests/sql/c5-migrations-rls.pglite.mjs` couvre maintenant 0185 (cohérence des plafonds, contraintes de `ad_requests`, RLS, aucune écriture client) ; deux mutations détectées.

## À vérifier / pas fait
- **Aucun appel réel** à Zernio (pas de clé ni de compte pub de test) ; voir la liste « à vérifier » de l'étape 5.1. Premier test sans coût : `previewAd` sur un compte de test (validation à blanc).
- **Dépense réelle non lue** : les plafonds raisonnent sur les budgets **engagés** (pire cas), pas sur la dépense mesurée. La chronologie Zernio (`getTimeline`) pourra la remplacer.
- **Pas d'écran ni de route** pour fixer les plafonds : `growth_settings` s'écrit pour l'instant en base ; l'interface relève du dashboard.
- **Surveillance non faite** : dépense vs plafond, annonce refusée par Meta (`reviewStatus`), dépense sans conversion → alertes à brancher sur `growth-alerts.ts` ; elles dépendent de la lecture de l'arbre des campagnes (page « Campaigns » de la doc, non lue).
- **Statut `submitted` = créée chez Zernio, en revue** : l'état de diffusion réel (approuvée, refusée) n'est pas encore relu.
- **Meta uniquement, pub WhatsApp uniquement.** TikTok/Google/LinkedIn/Pinterest/X (pas de validation à blanc) et pub « trafic vers le site » restent à faire.
- **Jours en UTC** : une pub dont les jours dépendent du fuseau du compte pub peut avoir un décalage d'un jour dans le calcul ; la prudence (jours inclus) va dans le sens de la sécurité.

## Outils C5 à ajouter à la matrice (proposition, tenue par C1)
| Outil | Risque | Permission (proposée) | Remarque |
|---|---|---|---|
| `ad.preview` | read | tout membre | validation à blanc, aucune dépense |
| `ad.create` | **sensitive** | owner/admin | empreinte confirmée, plafonds obligatoires |
| `ad.pause`, `ad.pause_all` | write_reversible | owner/admin/manager | arrêt d'urgence |
| `ad.resume` | **sensitive** | owner/admin | plafonds revérifiés |
| `ad_caps.set` | **sensitive** | owner/admin | fixe les plafonds (aucune pub sans eux) |

---

# Étape 5.3 — Pubs : surveillance (dépense réelle, revue Meta, conversations)

Source : doc Zernio « Get campaign tree » (`GET /v1/ads/tree`), consultée le 09/10/2026 : arbre campagne › ensemble › annonce, métriques à chaque niveau, pagination par campagne (100 max), `reviewStatus` et `rejectionReason` par annonce.

## Fait
- **`AdsPort.getCampaignTree`** + adaptateur : campagnes, annonces aplaties (statut, revue, motif de refus), budget, devise, métriques (dépense, clics, conversions…). Identifiant de campagne strictement numérique.
- **`buildAdAlerts`** (`ads/ad-monitoring.ts`, pur, 16 tests) :
  - **annonce refusée** — détectée par `reviewStatus` (documenté : c'est le **seul** moyen de la distinguer d'une annonce saine) ; motif de Meta tronqué ;
  - **problèmes signalés** (`with_issues`, erreur, problèmes remontés par Meta) ;
  - **dépense RÉELLE vs plafonds** : prévient à 80 % (haute), critique à 100 %, mois **et** jour ; la dépense du jour inconnue n'invente aucune alerte ;
  - **dépense supérieure au budget engagé** (marge de 25 % réglable : Meta peut dépenser plus que le budget journalier certains jours, **à vérifier**) ;
  - **aucune conversation** : uniquement sur un **zéro mesuré** après 3 jours de diffusion avec dépense ;
  - **campagne créée hors de Flexco** : dépense non couverte par nos plafonds.
- **`monitorAds`** (service) : contrôle d'appartenance du compte **avant tout appel Zernio**, lecture du mois en cours (jusqu'à 5 pages, sinon « tronquée »), dépense du jour via la chronologie, croisement avec `ad_requests` et les plafonds. Une panne de l'arbre remonte ; une chronologie indisponible ne bloque pas (note explicite). **Lecture seule.**
- Les alertes pubs réutilisent le format `GrowthAlert` (bilans quotidien et hebdomadaire inchangés).

## Deux garde-fous contre les fausses alertes
1. **« Non mesuré » (`null`) ≠ « zéro mesuré » (0)** pour les conversations WhatsApp : sans cette distinction, une pub saine dont Zernio ne remonte pas la mesure serait signalée « sans conversation » et le propriétaire pourrait la couper à tort. Le cas « non mesuré » devient une **note**, pas une alerte.
2. **Devises jamais additionnées** : une campagne dans une autre devise que les plafonds est exclue des sommes et signalée.

## Tests
`npx vitest run src/application/services/ads src/infrastructure/providers/ads` (80 tests). **Sept mutations volontaires détectées** (non mesuré traité comme zéro, alerte sur non mesuré, refus non lu via `reviewStatus`, devises mélangées, propriété du compte non vérifiée, seuil d'alerte, pagination).

## À vérifier / pas fait
- **Clé d'action des conversations WhatsApp** : supposée `onsite_conversion.messaging_conversation_started_7d` (nom d'action Meta). Si Zernio la nomme autrement, tout reste « non mesuré » (note affichée, aucune fausse alerte). Test sans coût : lire l'arbre d'un compte réel et inspecter `metrics.actions`.
- **Enveloppe de `/ads/timeline`** : toujours à confirmer (voir 5.1).
- **Aucune pause automatique** : si le plafond est atteint, l'alerte prévient, elle ne coupe rien. Une coupure automatique n'existerait que sur **règle explicite du propriétaire** (réglage à créer, ex. `ads_auto_pause_on_cap`, défaut désactivé) : décision à prendre.
- **Aucun cron** : `monitorAds` n'est appelé par personne tant que le planificateur de C1 n'existe pas ; la livraison (Telegram, WhatsApp, push) relève de C2 via `notify()`.
- **Conversion → commande non reliée** : mesure d'arrêt à « conversation démarrée ». Relier une conversation à une commande demande `source_ad_id` côté C3 (voir `c5-ads-plan.md`).
- Lecture au niveau **compte** : pas de suivi par annonce dans le temps (pas d'historique stocké chez nous).

---

# Étape 6 — Veille : la demande réelle des clients (signal n° 1 du plan `c5-veille-plan.md`)

Choix par défaut annoncé : statistiques du site uniquement (aucune conversation lue, aucune donnée personnelle, aucune question légale nouvelle). Les prix de concurrents désignés (signal n° 2) et l'archive publique des pubs Meta (signal n° 3, quasi aveugle pour le Cameroun) attendent les réponses de Marc-well.

## Fait
- **Migration 0186** : `c5_product_demand(p_org, p_days)` — par produit actif : clics (période courante et précédente), vues, unités vendues (commandes terminées), stock, prix. Service-role uniquement ; l'événement **et** le produit doivent appartenir au tenant (testé : un clic enregistré sous un autre tenant n'est pas compté).
- **Alertes** (`analytics/demand-alerts.ts`, pur, 14 tests) :
  - **demande sans stock** (haute) : ≥ 5 clics et stock épuisé ;
  - **très regardé, jamais vendu** (moyenne) : ≥ 10 clics, 0 vendu, du stock → prix, photo ou description à revoir ;
  - **forte hausse d'intérêt** (moyenne) : ≥ 1,5 × la période précédente, base minimale de 3 clics (pas de ratio sur de tout petits nombres) ; un produit en rupture n'est signalé qu'une fois.
  Branchées dans `buildGrowthAlerts` (donc dans les bilans quotidien et hebdomadaire) ; la rupture avec demande apparaît dans le bilan du jour (gravité haute). Seuils = paramètres.
- Peu de clics au total → note « indicatif ». Chiffres du SQL, rédaction par gabarit ; le LLM ne calcule rien.

## Constat de qualité de données (important)
`product_view` est enregistré **au rendu serveur de la page produit, sans filtre des robots** (Google, aperçus de lien Meta/WhatsApp) et sans identifiant de visiteur : ces « vues » sont **gonflées**. Les alertes n'utilisent donc **que `product_click`** (clic sur une carte produit, déclenché côté visiteur, limité en débit) ; les vues sont renvoyées à titre indicatif avec une note. Un test garantit que 500 vues sans clic ne déclenchent rien.

## Patch pour C4 (page produit : périmètre C4, **non appliqué**)
`docs/agents/patches/c5-product-view-bot-filter.patch` : ignore les robots pour `product_view`. Vérifié : s'applique sans conflit, le projet compile avec, le fichier du dépôt est resté inchangé. **À vérifier avec C4** : `headers()` rend la page dynamique ; elle l'est déjà si la résolution du tenant lit l'hôte (à confirmer, sinon prévoir le filtrage ailleurs, p. ex. dans `trackEvent`).

## Tests
- TS : `npx vitest run src/application/services/analytics` (40 tests). **Cinq mutations sur les alertes, dont une qui a révélé un test manquant** (produit en rupture signalé deux fois) : corrigé, mutation rejouée et détectée.
- SQL réel : `node tests/sql/c5-insights.pglite.mjs` (8 groupes) — fenêtres courante/précédente, isolation entre tenants, droits d'exécution ; trois mutations détectées (filtre organisation, bornage de la période précédente, `cta_click` comptés comme clics produit).

## À vérifier / pas fait
- **Pas de lien clic → WhatsApp par produit** : `whatsapp_click` ne porte pas l'identifiant du produit (le bouton ne le transmet pas) ; à voir avec C4 si on veut « combien de demandes WhatsApp par produit ».
- **Pas de visiteur unique** sur les clics produit : un même visiteur peut cliquer plusieurs fois ; ce sont des **clics**, pas des personnes.
- **Seuils par défaut** (5 / 10 clics, ratio 1,5) à régler sur le trafic réel d'un tenant ; sur un très petit site, tout sera « indicatif ».
- Non branché à un planificateur ni à une interface (voir C1 et C2).


---

# Étape 7 — Décisions de Marc-well appliquées

## Frais de messages Zernio dans l'estimation de diffusion
`estimateBroadcastCost` renvoie désormais `sentMessages` et `platformFeeMaxUsd` : **1 $ par 10 000 messages, tous canaux, au MAXIMUM** (le quota gratuit de 10 000/mois est ignoré tant qu'on ne sait pas s'il est partagé par la clé plateforme ou propre à chaque tenant). Ces frais sont **séparés** de `expectedUsd` / `maxUsd` (tarif Meta, payé par le tenant) : ce sont des coûts de Flexco. Seuls les messages réellement envoyés comptent (les hors-fenêtre ignorés faute de modèle ne coûtent rien). Source et réserve affichées dans les notes (« application au contrat à confirmer »). 4 tests ; 3 mutations détectées (messages ignorés comptés, mauvais diviseur, frais mélangés au tarif Meta).

## Plafonds de pub : service complet
`getAdCaps` (tout membre), `setAdCaps` et `clearAdCaps` (owner/admin, action `sensitive`) dans `ads/ad-service.ts`. Défaut sûr confirmé : **sans plafonds, `previewAd` bloque et `submitAd` refuse**.
- Valeurs validées : positives, finies, journalier ≤ mensuel, devise à 3 lettres, borne de la colonne `numeric(14,2)`.
- **Changement de devise refusé** tant qu'une pub non terminée existe dans l'ancienne devise (les exposures ne se convertissent pas : les additionner serait faux).
- **Baisse sous l'engagé** : acceptée avec avertissement explicite ; **aucune pause forcée** (la pause reste une action distincte) ; aucune nouvelle pub tant que l'engagé dépasse.
- N'écrase pas les autres réglages du tenant (autonomie de publication, palier WhatsApp).
- 9 tests ; **7 mutations détectées** (rôle, garde de devise, journalier > mensuel, avertissement, retrait sans rôle, borne de la base, pause forcée à la baisse).

## Validation légale
Un juriste validera les points listés dans `c5-veille-plan.md` §4 **avant toute mise en service** de la veille de concurrents ; aucun code de collecte de pages de concurrents n'a été écrit en attendant.
