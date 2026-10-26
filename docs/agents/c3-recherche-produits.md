# C3 — Recherche produit de l'assistant client (étape 1)

Branche : `agents/c3-assistant-client` · Migration : `0140_c3_product_search.sql`

## Ce qui change
Avant : `getActiveProducts` triait par `created_at`, `searchProductsByName` faisait un `ilike` sur le nom, mot par mot ; le budget (« autour de 25 000 ») devenait un mot-clé (`autour`). Maintenant :

1. **Compréhension déterministe** (`product-query-parser.ts`, pure, sans IA) : extrait le budget (autour de / moins de / plus de / entre X et Y, « 25k », « 25.000 francs ») et les mots significatifs (singulier, mots de 3 lettres conservés : « sac », « air », « max »).
2. **Recherche classée en SQL** (`search_products_for_assistant`) : texte français sans accent (`search_document` + index GIN), tolérance aux fautes (`pg_trgm`, `word_similarity ≥ 0,5`), filtres actif / prix / catégorie, puis classement par règles métier. Un produit est retenu s'il couvre au moins la moitié des mots.
3. **Réponse honnête** (`product-search-service.ts`) : si rien n'entre dans le budget, le client est prévenu (« Je n'ai rien trouvé à moins de 20 000 FCFA. Voici ce qui s'en rapproche : ») et les articles sont triés par proximité du budget. Le prix affiché et la promotion viennent de la base ; la promotion n'apparaît que si `compare_at_price > unit_price` et que l'échéance n'est pas passée.
4. **Parcours par catégorie** : « quelles catégories avez-vous ? » liste les catégories qui ont des produits actifs, avec leur effectif (calculé en base).
5. **Repli** : si la fonction SQL échoue ou n'est pas déployée, l'orchestrateur retombe sur l'ancienne recherche par nom (le client n'est jamais sans réponse) et ne prétend rien sur le budget.

`getActiveProducts` n'est PAS modifié (le dashboard marketing l'utilise, périmètre C4/C5).

## Classement (un seul endroit : la fonction SQL)
couverture des mots ×3 · mots dans le nom ×1,5 · rang texte intégral ×1 · promo en cours +0,3 · mis en avant +0,2 · marge (départage) jusqu'à +0,2. Sans mots (« présentez vos produits ») : seules les règles métier classent.

## Sécurité et isolation
- Aucune table nouvelle. `search_products_for_assistant` est `security invoker`, filtre explicitement sur `p_organization_id`, et son exécution est réservée au `service_role` (`anon` / `authenticated` : refusé).
- Le prix n'est jamais lu dans le texte par un modèle : filtres numériques stricts.
- **Données envoyées à une API externe : aucune** dans cette étape (tout se passe en base).

## Choix produit à valider (Marc-well)
- « Autour de X » = X ± 20 % (`AROUND_TOLERANCE`).
- « Budget X » est traité comme un plafond.
- La marge du commerçant départage les ex-aequo avec un poids faible : à confirmer que c'est souhaité.

## Limites connues (traitées aux étapes suivantes)
- « montre » (le produit) est avalé par « montre-moi » ; « téléphone » est exclu (vieille liste de mots vides orientée infos de contact). La compréhension par petit modèle (étape 2) lèvera ces cas avec le contexte du tenant.
- Pas de synonymes (« basket » / « sneakers ») : viendront avec les embeddings (0141, `product_embeddings`).
- Renommer une catégorie met à jour `updated_at` des produits concernés (trigger existant).
- Recherche non filtrée par stock numérique : la source de vérité est `status = 'active'` (basculé en `out_of_stock` par `adjust_product_stock`).
- Performance : correcte pour des catalogues de quelques milliers de produits par tenant (le décompte des mots est évalué ligne à ligne après filtre d'organisation) ; à mesurer sur un gros tenant.

## Comment tester
- Unitaires : `npm test` (parseur, service, orchestrateur — la base est mockée).
- SQL réel : `npm run test:integration` avec `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY` d'un projet de TEST (`tests/integration/c3-product-search.test.ts` : classement, fautes, accents, spécifications, prix, promo, isolation A/B, droits).
- Déploiement : appliquer `0140` avant (ou avec) le code ; sans elle, le repli prend le relais.
