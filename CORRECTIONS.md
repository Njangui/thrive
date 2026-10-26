# Journal des corrections — audit Flexco (22/10/2026)

Code de référence : ce dossier (copie modifiée). Vérifications exécutées : `tsc` propre, `eslint` propre, Vitest 2518 tests verts (198 fichiers), rejeu des 106 migrations sur PGlite (seules les 2 migrations vector/pg_trgm échouent, faute d'extension dans PGlite), 4 scripts SQL de non-régression (`t_lot2` 27/27, `t_lot3` 17/17, `t_lot4` 17/17, `t_lot5` 4/4).
**Non vérifié** : `next build` (impossible dans le bac à sable : Google Fonts injoignable), tout test sur staging (URL jamais fournie), Fapshi réel (sandbox), Supabase réel.

Légende : ✅ corrigé et testé · 🟡 corrigé, sans test dédié ou partiel · ⏳ à vérifier sur staging · ❌ non traité.

## Lot 1 — Base de données (0188)
| Constat | État |
|---|---|
| Constat | État |
|---|---|
| Constat | État |
|---|---|
| C1 admin → owner, C2 owner modifie statut/plan/slug, C12 search_path, D1 WhatsApp d'un autre, D2 faux domaine vérifié, D3 provider_connections, D4 durée vidéo/modules | ✅ (Q28 A : écriture directe supprimée) |

## Lot 2 — Plans, abonnements, crédits (0075, 0189, 0190)
| Constat | État |
|---|---|
| P1 impayé garde ses droits (Q7 A + 3 j de grâce) | ✅ |
| P2 migration 0075 | ✅ (rejeu PGlite) |
| P3 plan « business » | ✅ supprimé s'il n'est pas référencé (sinon la ligne reste en base) |
| P4 trois sources de prix (Q9) | 🟡 `updatePlanDetails` aligne `plan_prices` ; la valeur par défaut n'est pas retirée en base |
| P5 clé inconnue = illimité (Q10) | ✅ refus par défaut |
| P7 page tarifs ≠ base (Q11 B) | ✅ page lue depuis `plan_entitlements` |
| P8 promo globale (Q12) | ✅ retirée du projet |
| P9 paiement « payé » avant effet | ✅ `processing` → effet → `completed`, `effect_failed` + alerte + reprise |
| P10 crédits add-on perdus, P11 ajout non atomique | ✅ colonne `addon_credits`, RPC atomiques |
| P6 quotas décoratifs, P12 palier remet la consommation à 0 | ❌ non traité |

## Lot 3 — Paiements, webhooks, affiliation (0191, 0192)
| Constat | État |
|---|---|
| F1/W1 événements ratés jamais rejoués | ✅ rejeu (3 tentatives, statut `dead`, cron `replay-webhook-events`) |
| F3 montant non comparé | ✅ (écart → paiement laissé en attente + alerte) |
| F6 recharge portefeuille (Q18 B) | ✅ retirée |
| F8/F9 paiement d'affiliés non atomique / rejet d'une demande payée | ✅ fonctions SQL |
| AF2 remboursements | ✅ `refund_subscription_payment` (action admin) |
| QA1 URL de statut Fapshi | 🟡 forme officielle d'abord, repli `?transId=` ; ⏳ à confirmer sur le sandbox (Q34) |
| QA2 URL de base Fapshi | ✅ `FAPSHI_BASE_URL` obligatoire, sans défaut |
| W5 comparaison du cron en temps constant, W6 crons hors production | ✅ |
| W2 limitation de débit Telegram, W3 JSON invalide → 400, W4 jeton dans les logs | 🟡 faits en fin de projet, sans test dédié |
| F2, F4, F5, F11, W7, AF3, AF4 | ❌ non traités (F2/F4 à vérifier sur staging) |

## Lot 4 — Comptes et rôles (0193)
| Constat | État |
|---|---|
| C3 suspension (Q3 A) | ✅ garde dans `requireMembership`, registre fournisseurs, dashboard |
| C4 invitation rétrograde un owner | ✅ |
| C5/C6 rôles (Q5 B : 4 rôles) | ✅ owner/admin/manager/employee |
| C7/C8 limites d'organisations, création atomique (Q6 A) | ✅ `create_organization_atomic` |
| C10 lien d'invitation, C11 HTML non échappé | ✅ |
| D5 sous-domaines réservés | ✅ |
| C9 `organizations.plan` | ❌ non traité |

## Lot 5 — IA, limites, import
| Constat | État |
|---|---|
| R1/R4 relances IA (Q23 B) | ✅ contrôle qualité + `maxTokens` 160, repli sur message fixe |
| R2 double envoi | ✅ réservation `pending→processing` (0194) |
| A2 auto-approbation (Q22 A) | ✅ interdite s'il existe un autre approbateur |
| A1 plafond de coût | 🟡 plafond par action (10 unités) ; pas de plafond quotidien propre (borné par le solde de crédits) |
| S1/S2 YouTube (Q26 A) | ✅ secret ≥ 32 car. obligatoire, état lié à l'utilisateur ; 🟡 pas de mémorisation du nonce |
| CAT1/CAT2 import (Q27 A) | ✅ http(s), 5 Mo, 20 000 lignes, `maxDuration` 60 |
| CAT3 quota à l'import | ❌ non traité (dépassement de quelques produits possible) |
| RL1/RL2/RL3/QA8 limites de débit (Q33 A, Q32 B) | ✅ `RATE_LIMIT_REQUIRED` (défaut désactivé), repli ouvert + alerte en logs si Redis tombe, webhooks 60/10 s |
| S3 /health | ✅ cache 10 s |
| AN1/AN2 analytique | ✅ limite de débit + vidéo du tenant ; secret `ANALYTICS_HASH_SECRET` (repli sur l'ancienne clé tant qu'il n'est pas défini) |
| AF1 auto-parrainage (Q24 A) | 🟡 id, e-mail normalisé, téléphone ; l'IP hachée n'est pas utilisée (faux positifs) |
| Domaine déjà rattaché ailleurs (Q30) | 🟡 refus de réaffectation ; vérification DNS réelle ⏳ (cible DNS à confirmer) |
| C13 échange de code OAuth | 🟡 erreur gérée ; quota d'équipe atomique non traité |

## Lot 6 — Qualité
| Constat | État |
|---|---|
| QA3 Next.js 16.3.5 → 16.3.8 (faille critique) | ✅ ; images/CSP/médias limités à NOTRE projet Supabase |
| QA4 dépendances | ✅ sharp 0.35.5, source-map-js 1.2.2, uuid d'exceljs 11.1.1 (override), vitest 5.0.3, vite 8.3.4. `npm audit` : 13 → 5 (braces/micromatch/fast-glob/eslint-config-next : outils de lint, aucun correctif publié) |
| QA5 rétention vidéo | ✅ `detectVideoStorageClass`, `effectiveRetentionDays` |
| QA7 | 🟡 deux paquets de types déclarés ; cycle application/infrastructure non traité |
| SEC1 CSP à nonce | 🟡 implémentée derrière `CSP_NONCE=true` (défaut : CSP statique) ; ⏳ à valider sur staging (pages rendues à la demande) |
| SEC2 médias | ✅ projet unique, redirections suivies à la main (3 sauts max) |

## Reste à faire / non couvert
- ADM1, ADM2, QA6 (assistant : à activer pendant la phase agent, Q35 A) : non traités.
- Faits à vérifier sur staging : Q21 (`CRON_SECRET` défini), Q30 (DNS), Q32 (Upstash), Q34 (Fapshi sandbox).
- Nouvelles variables : `FAPSHI_BASE_URL` (obligatoire), `YOUTUBE_OAUTH_STATE_SECRET` (≥ 32 car.), `RATE_LIMIT_REQUIRED`, `ANALYTICS_HASH_SECRET`, `CSP_NONCE` (voir `.env.example`). `.npmrc` : `legacy-peer-deps=true` (nécessaire avec vitest 5.0.3).

---

## Assistant piloté par chat — Étape 1 (fondations)

**Ce qui existe maintenant**
- **Politique de validation** (migration `0195`) : 3 profils (Prudent / Équilibré / Autonome) + exception par action (auto jusqu'à un montant, toujours demander, interdit). Montants calculés par le code (`amountOf`), jamais par le modèle ; montant inconnu → validation demandée.
- **Garde-fous fixes** (indépendants des réglages) : actions sensibles (remboursement, annulation, changement de prix…), envoi > 20 destinataires, coût > plafond par action → toujours validés.
- **Branchement réel du chat** : outils Opérations (commandes, stock, produits, rendez-vous, finances, clients) enregistrés dans le noyau ; agent `assistant` ; `KernelAgentRuntime` (cartes d'approbation rédigées par le code, validation PIN/lien liée à l'empreinte exacte des paramètres, usage unique) ; activation par `AGENT_RUNTIME_ENABLED=true` (désactivé par défaut : l'assistant répond qu'il n'est pas activé).
- **Écran `/dashboard/assistant/settings`** (propriétaire / admin) : profils, exceptions, garde-fous affichés, journal lisible des actions.

**Vérifié** : tsc et eslint sans erreur, 2553 tests Vitest, rejeu PGlite 105 migrations (2 échecs attendus : extensions `vector` / `pg_trgm`), `t_agent1` OK.
**NON vérifié** : appel réel du modèle avec outils (Mistral) ; flux PIN de bout en bout sur staging ; rendu visuel des nouveaux écrans ; « Modifier » une carte (volontairement refusé pour l'instant : refuser puis redemander).

## Étape 2 — Catalogue, prospects, conversations

- 12 outils ajoutés (`domains/commerce.ts`, détail dans `docs/agents/ROLE_TOOL_MATRIX.md`) : produits (créer en brouillon, modifier, publier/retirer), catégories, prospects (liste, statut, notes), conversations (lire, prendre la main, rendre à l'IA, clôturer, répondre).
- **Nouveau garde-fou fixe `confirmAlways`** : un message envoyé à un client est toujours validé, quel que soit le profil ou l'exception « automatique » (un texte client malveillant ne peut pas faire écrire l'assistant à la place du propriétaire). L'écran de réglages ne propose pas « Automatique » pour ces actions.
- L'agent `assistant` est désormais enregistré en dernier (`domains/assistant.ts`) et reçoit tous les outils des autres domaines.
- Vérifié : tsc, eslint (0 erreur), 2561 tests. NON vérifié : appel réel du modèle avec ces outils, services FAQ (liés à la session web, non branchés ici volontairement).

## Étape 3 — Marketing

- 11 outils (`domains/marketing.ts`) : diffusions (aperçu d'audience, liste, programmer, annuler), publications (canaux, récentes, publier), commentaires (liste, répondre, masquer, réafficher).
- Tout ce qui part vers des clients ou le public (diffusion, publication, réponse publique) est `confirmAlways`. Les canaux de publication sont résolus côté serveur depuis des identifiants : le modèle ne peut pas fournir un canal inventé.
- Commentaires : propriétaire/admin seulement, comme l'écran du tableau de bord.
- **FAQ non branchée** : ses services exigent une session web (`requireMembership`) ; à refaire proprement avec l'acteur du canal (étape 4).
- Vérifié : tsc, tests. NON vérifié : envoi réel (Zernio/WhatsApp), appel réel du modèle.

## Étape 4 — Administration

- 17 outils (`domains/admin.ts`) : équipe, FAQ (reprise des services sans session web), fiche entreprise, alertes, abonnement et crédits en LECTURE seule.
- Invitation, changement de rôle, retrait de membre, suppression de FAQ : sensibles (validation + PIN). Texte de FAQ et fiche entreprise : `confirmAlways`.
- Volontairement NON exposés au chat : changement d'offre, paiements, domaine, site (à faire dans le tableau de bord) — risque financier / irréversible.
- Vérifié : tsc, tests. NON vérifié : envoi réel d'invitation par email, appel réel du modèle.

## Étape 5 — Tâches planifiées depuis le chat

- Migration `0196` (titre de tâche). Service `task-service.ts` (validation, limites), dépôt Supabase, 5 outils (`domains/tasks.ts`).
- Création d'une tâche : toujours validée. Une tâche en cours ne peut pas en créer d'autres (pas de boucle d'autorité).
- Livraison : le résultat arrive dans le fil « Tâches planifiées » avec les cartes de validation (approuvables comme dans le chat, PIN compris) + notification si validation attendue.
- Le tick `agents-tick` n'exécute des tâches que si `AGENT_RUNTIME_ENABLED=true`.
- Vérifié : tsc, tests, rejeu PGlite 106 migrations, `t_agent5` OK. NON vérifié : exécution réelle du cron sur staging (CRON_SECRET, fréquence), appel réel du modèle, rendu du fil.

## Étape 6 — Tests de bout en bout

- `assistant-e2e.test.ts` : 20 scénarios (modèle scripté, outils de tous les domaines avec services factices, moteur de règles, approbations et pont PIN réels). Couvrent : profils, injection par message client / note de commande, PIN lié à l'action et non rejouable, paramètres falsifiés, employé / gérant / client, isolation entre entreprises, crédits épuisés, boucle du modèle, outil inventé, tâches planifiées.
- Contrôle de non-vacuité : deux mutations volontaires du code (garde-fou `confirmAlways` désactivé ; PIN toujours accepté) font échouer 2 tests chacune ; code restauré ensuite.
- Vue d'ensemble et checklist de mise en service : `docs/agents/ASSISTANT_PILOTE.md`.
- **Reste à vérifier sur staging** (impossible ici) : vrai modèle Mistral avec outils, flux PIN complet, cron, rendu visuel des écrans.

## Étape 7 — Générateur de site libre (agent Site)

- Schéma : `mode: "free"` optionnel (absent = gabarit, anciens instantanés valides) ; 12 blocs riches (`rich_hero`, `feature_grid`, `image_text`, `steps`, `stats`, `pricing`, `quotes`, `cta_band`, `faq_list`, `image_gallery`, `rich_text`, `divider`) ; règles de blocs par page déplacées au niveau du site (dépendent du mode). Rendu `rich-blocks.tsx` + accueil libre via `BlockPage` (`app/page.tsx`, aperçu privé) ; pont de rendu inchangé pour les gabarits.
- Opérations ajoutées : `set_mode`, `replace_page_blocks`, `duplicate_block`, `set_page_slug`, `add_page` avec blocs ; `remove_block` autorisé sur l'accueil libre. Contrôle SEO : titre principal unique, liens imbriqués, alt du hero riche.
- Historique fin : migration `0197` (`site_revisions`, immuable, numérotée, 100 max) + `editDraftCore` / `revertDraftCore` / variantes « Core » sans session (utilisables depuis Telegram/WhatsApp) ; UI « Étapes du brouillon » avec retour en arrière.
- Agent : 10 outils `site.*` (`domains/site.ts`), publication sensible (PIN), restauration/abandon `confirmAlways`, employé sans accès. Note : l'étape 4 disait « site non exposé au chat » — c'est désormais le cas pour le BROUILLON, la publication restant validée + PIN.
- Vérifié : tsc, eslint 0 erreur, 2651 tests (dont service de versions sur base en mémoire avec mutation de contrôle, 18 tests schéma/opérations/SEO/rendu sûr, 12 outils, 5 scénarios E2E), rejeu PGlite des migrations.
- NON vérifié : rendu visuel réel (pas de `next build` ni navigateur ici), vrai modèle Mistral composant un site, conversion d'un vrai tenant, `publish_site` pour gérants via l'assistant (volontairement refusé).


## Étape 8 — Secteurs santé/éducation, Flexco sur Flexco, prospection WhatsApp
- Secteurs `health` et `education` : configuration, catalogue, gabarits de vitrine, modèles de site libre (op `apply_sector_template`), consignes IA (pas de conseil médical, pas de promesse d'admission) et contrôle de réponse (`medical_advice`, `admission_promise`).
- Flexco sur Flexco : identification par `FLEXCO_PLATFORM_ORG_ID`, persona commerciale, FAQ et site générés depuis `plans` (aucun prix en dur), action idempotente.
- Prospection WhatsApp : migration 0198, import CSV, validation liée à l'empreinte, plafond, horaires, STOP, 1 relance, cron, outils agent, page dashboard. Voir `docs/PROSPECTION.md`.
- NON VÉRIFIÉ : rendu visuel des nouveaux blocs/pages, approbation réelle des modèles Meta, envoi réel Zernio, événements webhook réels.
