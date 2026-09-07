# Comparaison au master prompt — après fusion des Lots 1, 2, 4 + complément

Évaluation honnête de l'état réel du dépôt (vérifié par lecture de
code + exécution réelle de typecheck/test/lint/build, pas seulement
sur la base des rapports des lots) contre le master prompt fourni.
**Le Lot 3 (WhatsApp/conversations/IA/groupes/publications sociales)
n'a toujours pas été livré** — tout ce périmètre reste évalué dans
l'état où les vagues B-N (précédentes) l'avaient laissé. Le reste du
périmètre P0 identifié après la fusion initiale a été construit
directement (à la demande explicite du porteur du projet), voir
`RAPPORT_FUSION_6.md` section 9 pour le détail complet de chaque point.

```text
Architecture / multi-tenant (§4)        ████████░░ 80%
Sécurité (§64-65, §85)                  █████████░ 90%
Stock + transaction commande (§18-19)   █████████░ 90%
Base de données / migrations (§68)      ████████░░ 80%
Dashboard entreprise (§48-50)           ████████░░ 80%
Catalogue / produits / images (§13-16)  █████████░ 90%
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
Analytics (§47)                         ███████░░░ 70% (product_click câblé ; conversation_started attend le Lot 3)
Tests critiques (§71)                   ████████░░ 80% (test réel + bordures construits, jamais encore EXÉCUTÉS faute d'instance)
Polish transverse (§72-78)              ███░░░░░░░ 30% (volontairement restreint, périmètre non retouché)
Documentation (§81, §98)                █████████░ 90% (rafraîchie intégralement cette session)
```

## Ce qui a changé depuis la première version de ce document

Après la fusion initiale des Lots 1/2/4, le porteur du projet a demandé
explicitement de construire le reste du périmètre P0 (hérité du Lot O)
qu'aucun des 4 lots n'avait couvert, à l'exception de tout ce qui
touche au Lot 3. Concrètement, sur les 5 points P0 listés dans la
version précédente de ce document :

1. ~~Lot 3 jamais livré~~ → **toujours vrai**, seul point encore
   entièrement ouvert de la liste originale.
2. ~~Test d'isolation multi-tenant réel absent~~ → **construit**
   (`tests/integration/tenant-isolation.test.ts`), jamais encore
   exécuté (nécessite un vrai projet Supabase de test).
3. ~~`product_click`/`conversation_started` jamais émis~~ →
   **`product_click` câblé** ; `conversation_started` reste ouvert,
   son seul point d'insertion (`conversation-orchestrator.ts`) est
   réservé au Lot 3.
4. ~~Seed de démo absent~~ → **construit** (`npm run seed:demo`,
   "Mode Élégance"), jamais encore exécuté (même raison que le point 2).
5. ~~`docs/ROADMAP.md`/`GAP_ANALYSIS.md` jamais consolidés~~ →
   **fait**, avec un rafraîchissement complet de toute la documentation
   (pas seulement ces deux fichiers) suite au retour du porteur du
   projet ("mes docs sont tous obsolètes").

## P0 — ce qui reste réellement ouvert

1. **Lot 3 jamais livré** — seul point bloquant restant de cette liste.
2. **`conversation_started` non câblé** — bloqué sur le Lot 3
   (`conversation-orchestrator.ts`).
3. **Rien n'a encore tourné contre une vraie instance Supabase** — le
   test d'isolation et le seed de démo existent et sont vérifiés par
   `tsc`/le compilateur, mais aucun des deux n'a jamais été EXÉCUTÉ
   faute d'accès réseau à un projet Supabase réel dans cet
   environnement. C'est désormais un point d'exécution, plus de
   construction.

## P1 — réel mais moins bloquant

4. **`resolveRequestOrigin()` migration partielle** — `team-service.ts`
   migré, `marketing-service.ts`/`whatsapp-group-service.ts`/
   `conversation-orchestrator.ts` intentionnellement laissés pour le
   Lot 3.
5. **Gestion FAQ et informations business** — toujours éditables en SQL
   direct uniquement (aucun des 4 lots n'avait ce périmètre explicite).
6. **Écran analytics dédié** (top publications) — la page d'accueil
   affiche des compteurs globaux, pas encore de vue détaillée par
   publication.
7. **Recherche/filtre sur la liste de produits du dashboard** —
   identifié Lot 2, non construit.
8. **Polish transverse minimal** — pas de `error.tsx`/`not-found.tsx`
   racine personnalisés, PWA non retouché cette vague (périmètre
   volontairement restreint par le Lot 4 pour limiter le risque de
   collision — voir son cahier).

## Corrections et constructions réellement effectuées et vérifiées

**Par les Lots 1/2/4 eux-mêmes** (résumé — détail dans
`RAPPORT_FUSION_6.md` section 6) : transaction stock/commande atomique,
cron fail-safe en production, `/dashboard/services`, landing marketing
SME-OS, galerie multi-photos produit, `/admin/plans`, prix barré/promotion.

**Construit directement à la fusion, hors périmètre des 4 lots**
(section 9 de `RAPPORT_FUSION_6.md`) : test d'isolation multi-tenant
réel (24 tables), tests de bordure entitlements paramétrés (4 clés),
câblage `product_click`, action "Réapprovisionner", migration
`resolveRequestOrigin()` pour `team-service.ts`, script `seed:demo`
complet, et un rafraîchissement complet de la documentation
(`ROADMAP.md` réécrit, `GAP_ANALYSIS.md` clôturé, `MVP_SCOPE.md`/
`SECURITY.md`/`DEPLOYMENT.md`/`ARCHITECTURE.md`/`AI.md` corrigés).

## Notes de fiabilité

Les Lots 1 et 4 ont livré sans aucun accès réseau côté leur propre
environnement — deux bugs réels en ont résulté (typage + hoisting
Vitest), corrigés à la fusion. Le Lot 2 avait un accès réseau réel et
n'avait aucun bug de ce type. Un troisième constat, cette fois sur la
documentation plutôt que le code : au moins deux affirmations fausses
ont été trouvées dans des docs pourtant récemment mises à jour par un
lot sur lui-même (`docs/MVP_SCOPE.md` par le Lot 2, `docs/DEPLOYMENT.md`
sur des points en réalité livrés par les Lots M et N) — même schéma que
pour le code : une affirmation non vérifiée contre l'état réel du dépôt
reste fausse quel que soit qui l'a écrite. Tout le dépôt (1+2+4 +
compléments) est maintenant vérifié dans mon propre environnement :
`npm run typecheck`/`npm test`/`npm run lint` à 100% verts, `npm run
build` réussi.
