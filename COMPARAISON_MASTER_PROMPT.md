# Comparaison au master prompt — après fusion des Lots 1, 2, 4

Évaluation honnête de l'état réel du dépôt (vérifié par lecture de
code + exécution réelle de typecheck/test/lint/build, pas seulement
sur la base des rapports des lots) contre le master prompt fourni.
**Le Lot 3 (WhatsApp/conversations/IA/groupes/publications sociales)
n'a pas encore été livré** — tout ce périmètre reste évalué dans
l'état où les vagues B-N (précédentes) l'avaient laissé, pas encore
audité/corrigé par cette nouvelle vague. Les pourcentages ci-dessous
reflètent l'état du CODE, pas la qualité des rapports fournis par
chaque lot.

```text
Architecture / multi-tenant (§4)        ████████░░ 80%
Sécurité (§64-65, §85)                  ████████░░ 80%
Stock + transaction commande (§18-19)   █████████░ 90%
Base de données / migrations (§68)      ████████░░ 80%
Dashboard entreprise (§48-50)           ████████░░ 80%
Catalogue / produits / images (§13-16)  ████████░░ 80%
Services (§17)                          █████████░ 90%
Landing marketing SME-OS (§6-7)         ████████░░ 80%
Landing client / personnalisation (§10) ██████░░░░ 60% (Lot K, non ré-audité cette vague)
Onboarding / presets sectoriels (§8-9)  ███████░░░ 70%
WhatsApp / groupes (§33-37)             ██████░░░░ 60% (Lot 3 non livré — état hérité B-N)
Conversations / IA (§21-31)             ██████░░░░ 60% (Lot 3 non livré — état hérité B-N)
Publications sociales (§40-43)          █████░░░░░ 50% (Lot 3 non livré — état hérité B-N)
Webhooks Zernio (§44-46)                ██████░░░░ 60% (Lot 3 non livré — état hérité B-N)
Super Admin (§52-54, §56)               ████████░░ 80%
Abonnements / NotchPay (§58-59)         ███████░░░ 70%
Domaines / téléphones (§60-63)          ███████░░░ 70%
Analytics (§47)                         ████░░░░░░ 40% (product_click/conversation_started jamais câblés)
Tests critiques (§71)                   █████░░░░░ 50% (isolation réelle Supabase + bordures entitlement absentes)
Polish transverse (§72-78)              ███░░░░░░░ 30% (volontairement restreint, périmètre non retouché)
Documentation (§81, §98)                █████░░░░░ 50% (ROADMAP/GAP_ANALYSIS pas encore consolidés)
```

## P0 — encore ouvert, prioritaire

1. **Lot 3 jamais livré** — WhatsApp/conversations/IA/groupes/social
   restent dans l'état hérité des vagues B-N, non audités par cette
   nouvelle vague. C'est le trou le plus large restant.
2. **Test d'isolation multi-tenant réel absent** — `tests/rls-
   policies.test.ts` (Lot 1) est une analyse statique des fichiers de
   migration (utile, mais ne remplace pas un vrai test réseau contre
   une instance Supabase). `tests/integration/` n'existe toujours pas.
3. **`product_click`/`conversation_started` jamais émis** — toujours
   uniquement présents dans la définition de type
   `analytics-service.ts`, jamais déclenchés (vérifié par grep sur le
   dépôt fusionné).
4. **Seed de démo absent** — `scripts/` toujours vide, `npm run
   seed:demo` pointe vers un fichier qui n'existe pas.
5. **`docs/ROADMAP.md`/`GAP_ANALYSIS.md` jamais consolidés** pour
   cette vague — toujours dans l'état où B-N les avait laissés.

Ces 5 points correspondent exactement au périmètre que j'avais
explicitement fait porter par le cahier du Lot 4 ("hérité du Lot O")
— **aucun des 3 lots livrés ne les a réellement traités**, à vérifier
avec le porteur du projet si ce périmètre a bien été transmis tel
quel à l'IA en charge du Lot 4, ou doit être repris par un lot
correctif.

## P1 — réel mais moins bloquant

6. **`restockProduct` sans appelant UI** (trouvé à la fusion, section
   7 de `RAPPORT_FUSION_6.md`) — un produit ne peut pas être
   manuellement remis en stock positif depuis le dashboard aujourd'hui.
7. **Tests de bordure entitlement (99/100/101, `-1` illimité)** non
   ajoutés — `entitlements-service.test.ts` a été étendu par le Lot 4
   pour d'autres raisons (bonus dédié WhatsApp) mais pas avec les cas
   de bordure paramétrés demandés.
8. **`resolveRequestOrigin()` comme référence unique** — toujours 4
   fichiers utilisant `NEXT_PUBLIC_APP_URL` pour construire des liens
   publics (`marketing-service.ts`, `whatsapp-group-service.ts`,
   `team-service.ts`, `conversation-orchestrator.ts` — ces deux
   derniers appartiennent au périmètre du Lot 3, donc logiquement
   encore non traités).
9. **Polish transverse minimal** — pas de `error.tsx`/`not-found.tsx`
   racine, PWA non retouché cette vague (le Lot 4 a délibérément
   restreint son périmètre, voir son cahier — ce n'est pas un oubli
   mais un choix documenté pour limiter le risque de collision).

## Corrections réellement effectuées et vérifiées cette vague

- **Transaction stock/commande atomique** — corrige une vraie race
  condition confirmée dans le code d'origine (`markOrderCompleted` +
  `decrementStock`/`restockProduct` en plusieurs opérations non
  atomiques). Verrouillage de ligne réel (`FOR UPDATE`), testé.
- **Cron fail-safe en production** — les routes cron laissaient
  passer une requête sans `CRON_SECRET` configuré en se contentant
  d'un avertissement loggé ; refusent maintenant explicitement en
  production.
- **Services : vraie interface dashboard** — `/dashboard/services`
  construit de bout en bout (CRUD réel), la table `services`
  n'était auparavant lue que par la landing publique.
- **Landing marketing SME-OS** — la racine `/` sans tenant affichait
  une page de statut de développement interne avec des phases
  marquées "todo" alors que terminées ; remplacée par une vraie
  landing commerciale, tarifs lus depuis `listPlans()` (jamais codés
  en dur).
- **Galerie multi-photos produit** — le formulaire dashboard
  n'exposait qu'une seule image malgré un schéma DB déjà prêt pour
  plusieurs ; corrigé.
- **`/admin/plans`** — aucune interface n'existait pour modifier les
  limites de plan (crédits IA, groupes, add-ons...) malgré des tables
  déjà peuplées ; construite.
- **Prix barré / promotion produit** — ajouté proprement (validation :
  jamais un prix barré inférieur ou égal au prix courant).

## Notes de fiabilité

Les Lots 1 et 4 ont livré sans aucun accès réseau côté leur propre
environnement — donc sans jamais avoir fait tourner `tsc`/`vitest`/
`eslint` eux-mêmes, seulement une relecture manuelle. Deux bugs réels
en ont résulté (détail dans `RAPPORT_FUSION_6.md` section 3),
corrigés à la fusion. Le Lot 2, à l'inverse, avait un accès réseau
réel et a livré un travail déjà vérifié — aucun bug de ce type trouvé
de son côté. Tout le dépôt fusionné (1+2+4) est maintenant vérifié
dans mon propre environnement : `npm run typecheck`/`npm test`/
`npm run lint` à 100% verts, `npm run build` réussi.
