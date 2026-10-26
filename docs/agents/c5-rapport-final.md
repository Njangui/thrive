# C5 — Croissance et Studio : rapport final

Branche cible : `agents/c5-croissance` · Migrations : **0180 à 0186** (plage C5 : 0180-0199) · Langue : français, comme l'existant.

## 0. Décisions de Marc-well (mise à jour)
| # | Question | Réponse | Effet |
|---|---|---|---|
| 1 | « Sans plafond défini, aucune pub » | **Oui** | Confirmé comme comportement par défaut. Service `setAdCaps` / `getAdCaps` / `clearAdCaps` ajouté (owner/admin) : changement de devise refusé tant qu'une pub non terminée existe dans l'ancienne, avertissement si la baisse passe sous l'engagé (rien n'est arrêté), valeurs validées (limite de la base incluse). |
| 2 | Clés Zernio / fal.ai de test | **Plus tard** | Aucune intégration réelle testée tant que ce n'est pas fait (voir §9, étape 5). |
| 3 | Pages Facebook appairées aux numéros WhatsApp des tenants | **Oui** | Prérequis des pubs WhatsApp satisfait côté tenants ; l'aperçu continue d'avertir que le moyen de paiement chez Meta ne peut pas être vérifié ici. |
| 4 | Facturation des messages Zernio | **« Prendre ce qui est dans leur doc »** | Intégrée à l'estimation de diffusion : 1 $ par 10 000 messages (10 000 gratuits/mois), **au maximum**, tous canaux, **séparée du tarif Meta** (c'est un coût de Flexco, pas du tenant). Reste à confirmer au contrat : quota gratuit partagé par la clé plateforme ou par tenant. |
| 5 | Validation légale (loi n° 2024/017) | **Un juriste** | Inscrit comme condition de mise en service de la veille de concurrents (voir `c5-veille-plan.md` §4). Aucune collecte de pages de concurrents ne doit être activée avant son avis. |

Non tranché : écran pour fixer les plafonds (le service existe, pas l'interface), coupure automatique au plafond, orientation de la veille (signaux 2 et 3), rastérisation SVG, `pglite` en dépendance de développement.

## 1. Résumé
Livré : publications (limites par plateforme, annulation, reprogrammation Telegram), diffusion (annulation, estimation de coût, palier du numéro, horaire suggéré), `track()` et analyses en SQL avec alertes et bilans, Studio créatif (MediaPort fal.ai, kit de marque, gabarit SVG), pubs Meta/WhatsApp via Zernio (port, service, plafonds, surveillance) et première brique de veille (demande réelle des clients).
**Rien n'a été testé contre un service réel** (Zernio, fal.ai, Meta) : pas de clé ni de compte de test. Tout est testé sur des réponses simulées conformes à la documentation, et le SQL sur un vrai Postgres de test (PGlite).

## 2. Chiffres (état consolidé)
- **208 tests C5, tous réussis** (18 fichiers) + 2 scripts SQL (`tests/sql/`) qui appliquent les migrations et vérifient contraintes, RLS, isolation entre tenants, droits d'exécution.
- Suite complète : 1 437 réussis, **7 échecs**, tous dans `catalog-video-retention.test.ts` (C4) et `fapshi/client.test.ts` (paiement). **Vérifié : identiques sur votre dépôt d'origine sans mes changements**, ainsi que l'unique erreur de typage (le test de rétention vidéo importe des fonctions que `catalog-video-service` n'exporte pas encore).
- Typage et lint propres sur tous les fichiers C5. `package.json` et `package-lock.json` **inchangés**.
- À chaque étape, des **mutations volontaires** (retirer un garde-fou et vérifier qu'un test échoue) : une quarantaine, toutes détectées après correction. Elles ont révélé **3 faiblesses dans mes propres tests** (un test RLS qui ne vérifiait que l'appartenance et pas le rôle, un cas « rupture + hausse » manquant, une assertion trop étroite) : corrigées.

## 3. Fichiers touchés hors du code C5
Quatre fichiers existants modifiés, aucun dans un autre périmètre métier :
- `src/lib/env.ts` : 5 variables **optionnelles** `FAL_KEY`, `FAL_MODEL_*` (partagé).
- `src/app/_components/track-click-action.ts` et `src/application/services/analytics-service.ts` : événement `whatsapp_click` (suivi du site, `track()` est à C5).
- `src/application/services/contact-broadcast-service.ts` : annulation idempotente, `loadCandidates` exporté (diffusion : C5).
**Non appliqué** : `docs/agents/patches/c5-product-view-bot-filter.patch` (page produit = C4).

## 4. Ce qui est fait (détail dans `docs/agents/c5-publications.md`)
| Domaine | Livré |
|---|---|
| Publications | Profils de limites (8 plateformes, Telegram hors Zernio), adaptation déterministe des métadonnées, annulation sociale (honnête : jamais « annulé » sans confirmation) et Telegram, reprogrammation Telegram, liste des programmées, réglage « proposer / ajouter » (défaut : proposer) |
| Diffusion | Annulation idempotente, estimation du coût Meta (tarifs injectables, inconnu jamais inventé) et des frais de messages Zernio (maximum, séparés), modèle obligatoire hors fenêtre 24 h, palier du numéro, horaire suggéré d'après les données |
| Mesure | `track()`, `whatsapp_click` avec empreinte anonyme (source/campagne → clic), 7 analyses SQL (stock dormant, marges, rupture, clients inactifs, résultats de diffusion, trafic par source, demande par produit), alertes, bilans quotidien et hebdomadaire |
| Studio | MediaPort + adaptateur fal.ai, dépense confirmée par empreinte, idempotence, plafond mensuel, débit avant l'appel, copie des résultats dans notre stockage, kit de marque, gabarit SVG sûr |
| Pubs | AdsPort + adaptateur Zernio, validation à blanc, création idempotente, **plafonds obligatoires (sans plafond, aucune pub) avec service pour les fixer, les lire et les retirer**, contrôle de propriété des comptes, pause / reprise (plafonds revérifiés) / arrêt d'urgence, surveillance (refus Meta, plafonds, dépassement, sans conversation, dépense hors Flexco) |
| Veille | Demande réelle des clients (clics sur les produits) ; plan pour le reste |

## 5. Ce qui n'est pas fait
- **Aucun branchement agentique** : pas d'outil enregistré, pas d'`evaluateAction`, pas de cartes d'approbation (dépend de C1, vague 2). Les services prennent déjà l'empreinte confirmée en entrée.
- **Aucun planificateur ni livraison** : les bilans et la surveillance ne sont appelés par personne (C1 : planificateur ; C2 : `notify()`).
- **Interface** : aucun écran ni route (plafonds de pub, kit de marque, aperçus).
- **Envoi réel d'un modèle WhatsApp hors fenêtre** (API de diffusion Zernio : forme des requêtes à vérifier). Tant que ce n'est pas fait, ces contacts sont ignorés à l'envoi.
- **Reprogrammation d'un post social** (PUT Zernio, corps à vérifier) ; annulation d'une publication vers un **groupe WhatsApp**.
- **Rastérisation des visuels SVG** en PNG (Instagram/Facebook/TikTok n'acceptent pas le SVG) : décision de dépendance (sharp ou `next/og`).
- Pubs hors Meta/WhatsApp (TikTok, Google, LinkedIn, Pinterest, X : pas de validation à blanc chez Zernio) ; pub « trafic vers le site ».
- Veille : prix de concurrents désignés (signal n° 2) et option archive Meta (signal n° 3) en attente de décision.
- Boucle **pub → conversation → commande** : mesurée jusqu'au clic WhatsApp seulement.

## 6. Risques principaux
1. **Aucun test réel** des intégrations externes : la première exécution contre Zernio/fal.ai peut révéler des écarts (champs, enveloppes de réponse). Chaque point incertain est marqué « à vérifier » dans le code et la doc, avec le test le moins coûteux.
2. **La clé Zernio est celle de la plateforme** : elle peut agir sur le compte pub de n'importe quel tenant. Mitigation en place (propriété du compte vérifiée avant tout appel, testée par mutation) ; à garder à l'esprit pour tout nouvel outil.
3. **La dépense publicitaire est payée à Meta** par le tenant : le garde-fou est posé à la création (plafonds sur budgets engagés), pas sur la dépense mesurée ; Meta peut dépasser un budget journalier certains jours (alerte prévue, marge à vérifier).
4. **Données de vues gonflées** par les robots (`product_view`) : les alertes n'utilisent que les clics ; patch C4 non appliqué.
5. **Volume** : fonctions SQL non testées sur de gros volumes (`EXPLAIN` à faire sur une base réaliste).
6. **Légal** (loi n° 2024/017) : non évalué par un juriste ; points listés dans `c5-veille-plan.md` §4. Je ne suis pas juriste.

## 7. Faits externes qui contredisent le brief (à confirmer)
- **Zernio facture à l'usage** : annonces au-delà de 500 gratuites (0,01 $/annonce active/mois) et **messages sortants** (10 000 gratuits, puis 1 $ par 10 000, depuis le 1er octobre 2026). Le brief disait « tout inclus ». Intégré à l'estimateur de diffusion (maximum, séparé du tarif Meta) sur décision de Marc-well ; application au contrat à confirmer.
- **Archive publique des pubs Meta** : ne contient que les annonces diffusées dans l'UE/Royaume-Uni (hors pubs politiques) : quasi aveugle pour des concurrents camerounais.
- Sans carte bancaire chez Zernio : blocage à 500 annonces actives.

## 8. Questions pour Marc-well (consolidées)
**Produit / décisions**
1. ~~Valider « sans plafond défini, aucune pub »~~ **Fait (oui).** Reste : qui construit l'écran pour fixer les plafonds ?
2. Coupure automatique quand le plafond est atteint ? (proposé : réglage du propriétaire, désactivé par défaut)
3. Veille : réorienter vers demande réelle + prix de concurrents désignés, l'archive Meta restant une option ? Rétention des observations : 12 mois ?
4. Rastérisation des visuels : ajouter `sharp` (ou utiliser `next/og`) ?
5. `@electric-sql/pglite` en dépendance de développement pour intégrer les tests SQL à `npm test` ?
**Tiers / comptes**
6. Un compte pub de test + `ZERNIO_API_KEY` ; une `FAL_KEY` de test et le modèle d'image le moins cher à utiliser. **Plus tard (Marc-well).**
7. ~~Facturation des messages Zernio~~ **Intégrée selon leur doc.** Reste à confirmer au contrat : quota gratuit partagé par la clé plateforme ou par tenant ?
8. ~~Pages Facebook appairées aux numéros WhatsApp~~ **Oui.**
**Autres Claude**
9. **C1** : `usage.charge` avec **remboursement** (aujourd'hui `refund_due` marque ce qui est dû) ; `evaluateAction` / `pending_actions` liés à l'**empreinte** ; planificateur (surveillance, bilans, suivi des tâches média) ; reprise des lignes `usage_synced = false`.
10. **C2** : `notify()` pour livrer bilans et alertes.
11. **C3** : enregistrer `source_ad_id` (référence de la pub dans le premier message WhatsApp) sur la conversation ; accord pour d'éventuelles questions WhatsApp agrégées dans la veille.
12. **C4** : appliquer le patch du filtre des robots ; ajouter l'identifiant de produit aux clics WhatsApp ; branchement R2 du stockage (les résultats du Studio passent par le port de stockage existant).
13. ~~Juridique~~ **Un juriste validera** les points du §4 de `c5-veille-plan.md` avant toute mise en service de la veille de concurrents.

## 9. Appliquer et tester
1. Décompresser l'archive à la racine du dépôt (aucune dépendance npm ajoutée).
2. Migrations dans l'ordre : `0180` → `0186` (aucune collision avec les plages des autres Claude).
3. Variables optionnelles : `FAL_KEY`, `FAL_MODEL_IMAGE_GENERATE`, `FAL_MODEL_IMAGE_ENHANCE`, `FAL_MODEL_IMAGE_REMOVE_BACKGROUND`, `FAL_MODEL_VIDEO_GENERATE` (sans elles, le Studio refuse proprement) ; `ZERNIO_API_KEY` déjà existante pour les pubs.
4. Tests : `npm test` ; SQL : `npm i --no-save @electric-sql/pglite && node tests/sql/c5-insights.pglite.mjs && node tests/sql/c5-migrations-rls.pglite.mjs`.
5. Premiers essais réels, du moins coûteux au plus coûteux : `listAdAccounts` → `previewAd` (validation à blanc, rien n'est créé) → `getTimeline` 7 jours → une génération 1:1 d'un seul visuel.

## 10. Outils C5 déclarés (à reprendre dans `ROLE_TOOL_MATRIX.md`, tenue par C1 ; permissions proposées)
| Outil | Risque | Permission |
|---|---|---|
| `insights.get`, `digest.build`, `post.list`, `broadcast.preview`, `media.preview`, `ad.preview`, `ad.monitor`, `brand_kit.get`, `template.render_promo` | read | membres (gestion) |
| `post.schedule`, `post.reschedule` | write_reversible (selon réglage « proposer/ajouter ») | manager+ |
| `post.cancel`, `broadcast.cancel`, `media.cancel` | write_reversible | manager+ |
| `brand_kit.save` | write_reversible | owner/admin |
| `ad.pause`, `ad.pause_all` | write_reversible | owner/admin/manager |
| `broadcast.schedule` | **sensitive** | owner/admin |
| `media.generate`, `media.enhance` | **sensitive** | owner/admin |
| `ad.create`, `ad.resume`, `ad_caps.set`, `ad_caps.clear` | **sensitive** | owner/admin |
| `ad_caps.get` | read | membres |
