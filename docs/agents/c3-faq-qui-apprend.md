# C3 — FAQ qui apprend (étape 4b · livrable F)

Branche : `agents/c3-assistant-client` · Migration : `0143_c3_faq_learning.sql` · Prérequis : étapes 1, 2 et 4a.

## Principe (8 : « boucle d'ingénierie, pas magie »)
On **compte** les questions qui reviennent, on **propose** une FAQ au propriétaire, il **valide, modifie ou refuse**. Rien n'est publié automatiquement. Une FAQ servie ne consomme aucun crédit IA : le compteur d'économies le rend visible.

## Ce que ça fait
1. **Variables dynamiques** dans les réponses de FAQ : `{price:identifiant-produit}`, `{hours}`, `{address}`, `{contact}`, `{catalog_url}`. Elles sont lues **au moment de répondre**. Si une valeur est introuvable (horaires non renseignés, produit supprimé ou inactif), la FAQ n'est **pas utilisée** et la chaîne continue : jamais de réponse périmée. Une variable inconnue est refusée à l'enregistrement ; un montant écrit en dur donne un avertissement (pas un blocage : une FAQ « Livraison 1 500 FCFA » existante reste modifiable, il n'existe pas encore de variable de livraison).
2. **Détection des questions répétées** : quand l'assistant répond lui-même à une question générale (livraison, paiement, horaires… — jamais produit, commande, réclamation), la question est enregistrée, nettoyée. Regroupement **par mots** (radicaux compatibles avec le moteur de FAQ, sans embeddings) : « vous livrez à Douala ? » ~ « livraison possible sur Douala ? » ; « Douala » ≠ « Yaoundé ». Au seuil hebdomadaire (3 par défaut, 2 à 50), une **proposition** est créée.
3. **Proposition** : question représentative, nombre d'occurrences, mot-clé suggéré (les 3 mots les plus parlants *ensemble*), et réponse pré-remplie **seulement si** la réponse envoyée ne contenait rien de périssable (ni montant, numéro, email, lien — le lien catalogue devient `{catalog_url}` —, ni stock). Les questions qui ont fini en « je vérifie » + humain partent sans réponse : le propriétaire rédige la sienne.
4. **Décision** (`decideFaqCandidate`) : valider (tel quel ou modifié) crée la FAQ (origine « learned », relecture dans 90 jours) ; refuser met la proposition en sommeil 90 jours. La proposition est réservée avant la création : deux clics ne créent pas deux FAQ ; si la création échoue, la proposition redevient disponible.
5. **Compteur de crédits économisés** (`getFaqSavings`) : usages de FAQ par jour × crédits par tour d'IA (1).
6. **Dates de revue** : toute FAQ créée ou modifiée a une date de relecture à 90 jours ; `listFaqsDueForReview` liste celles à relire, `markFaqReviewed` repousse.

`matchFaq` renvoie désormais l'identifiant de la FAQ (nécessaire au comptage) ; `createFaq` / `updateFaq` valident les variables.

## Données et légal (loi n° 2024/017)
- **Désactivé par défaut** (opt-in par entreprise, `faq_learning_settings.enabled`). Activer = accepter que les questions des clients, nettoyées, soient conservées 30 jours pour repérer celles qui reviennent.
- Journal minimal : texte nettoyé (emails, numéros, liens retirés), 200 caractères, **aucun identifiant de client ni de conversation**, lisible par propriétaire / administrateur seulement. Un prénom écrit dans une question peut subsister : le nettoyage est un filet, pas une garantie.
- Rétention : `purge_faq_question_log()` (30 jours, plancher 7). **À planifier** (planificateur C1 ou cron Supabase) : tant qu'elle n'est pas planifiée, le journal n'est pas purgé.
- Aucune donnée n'est envoyée à une API externe par cette fonction et aucune n'entraîne un modèle. **À faire valider par un juriste** : texte de consentement montré au propriétaire.

## Ce qui n'est PAS dans cette étape
- **Pas d'interface** : propositions, validation, réglages, économies et relectures sont des services protégés (propriétaire / administrateur) sans écran. À brancher : dashboard FAQ ou outil de chat C2.
- **Pas d'outil `faq.create` du registre C1** (`contracts.ts` n'existe pas) : `createFaq` fait le travail ; son enregistrement comme `ToolDef` (`write_reversible`) viendra avec le contrat.
- **Pas de carte d'approbation `pending_actions`** (C1) : table de propositions dédiée ; migration possible vers `pending_actions` plus tard.
- **Réponses d'humains non captées** : quand un humain répond depuis le dashboard, la réponse n'alimente pas encore la proposition (le hook appartient au dashboard / C2). `recordQuestionForLearning` accepte déjà ce cas (`resolution`).
- **Regroupement par mots** : deux questions sans mot en commun (synonymes) ne sont pas regroupées ; les embeddings (étape 3) amélioreront sans changer l'interface (`areSimilar`, `clusterQuestions`).

## Choix à valider
- Seuil par défaut : 3 questions similaires par semaine. Fenêtre : 7 jours.
- Sommeil après refus : 90 jours. Relecture : 90 jours.
- Les commentaires publics alimentent aussi l'apprentissage (ils sont déjà publics).
- Mot-clé unique composé de plusieurs mots (peu de faux déclenchements, mais peut rater une reformulation) : le propriétaire peut le modifier.

## Comment tester
- Unitaires : `npm test` (`faq-learning`, `faq-learning-service` avec fausse base en mémoire, `faq-resolver`, `conversation-orchestrator`).
- SQL réel : `npm run test:integration` avec `SUPABASE_TEST_*` (`tests/integration/c3-faq-learning.test.ts` : défauts, bornes, `faq_record_hit` et isolation entre organisations, droits, purge, RLS anonyme, cascades). Les politiques propriétaire / membre nécessitent des sessions par rôle.
- Déploiement : appliquer `0143` ; sans elle, les fonctions « runtime » (enregistrer, compter) échouent silencieusement et la FAQ continue de répondre comme avant.
