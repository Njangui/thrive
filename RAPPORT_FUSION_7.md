# Rapport de fusion #7 — Design unifié + branche fonctionnelle + P1 invitations/tenant

Trois sources fournies pour cette fusion, sans indication préalable de
laquelle était la plus à jour — établi par inspection directe du code
(marqueurs de fonctionnalités, dates implicites) avant toute décision
de fusion :

- **`sme-os-design-unifie`** (A) — chantier de refonte visuelle complet
  (voir son propre `RAPPORT_UNIFICATION_DESIGN.md`, conservé tel quel) :
  thème `navy/violet/success/danger/warning` unifié sur tout le
  périmètre authentifié (dashboard marchand, Super Admin, login/
  onboarding/invite, pages légales), nouvelle sidebar/topbar
  (`dashboard-nav.tsx`/`topbar.tsx`/`mobile-nav.tsx`) remplaçant
  l'ancienne nav plate, **navigation réellement filtrée par les modules
  activés de l'organisation** (`getEnabledModules` — système qui
  existait déjà dans le code mais n'était câblé nulle part côté UI
  avant ce chantier), accueil dashboard reconstruit avec de vrais KPI.
  Partie d'un état **antérieur** à la session en cours : n'a ni l'auth
  email/mot de passe, ni le correctif CSP, ni la carte de disponibilité
  Afrique, ni l'édition FAQ, ni le correctif du lien "Voir mon site".
- **`thrive-fusionne`** (B) — état courant de la session en cours
  (auth email/mot de passe + inscription + mot de passe oublié,
  correctif CSP `connect-src`, carte d'Afrique + cartes pays enrichies
  sur la landing, édition FAQ, lien "Voir mon site" basé sur le vrai
  sous-domaine du tenant, protection contre un crash sur `/onboarding`
  si la lecture des pays échoue). N'a pas le chantier de design unifié
  de A.
- **`thrive-p1-invitations-tenant`** (C) — lot ciblé, 6 fichiers, deux
  correctifs de sécurité : `acceptInvitation` ne vérifiait jamais que
  l'email de session correspondait à l'email invité (n'importe quel
  compte connecté pouvait consommer l'invitation de quelqu'un d'autre) ;
  le middleware ne nettoyait les en-têtes `x-tenant-slug`/
  `x-tenant-custom-domain` forgeables que dans les branches sous-domaine/
  domaine-custom, jamais sur le domaine racine. Introduit au passage le
  premier bouton de déconnexion du projet (`SignOutButton` — aucune
  route de déconnexion n'existait nulle part avant ce lot).

## 1. Stratégie de fusion

Base retenue : **A** (le chantier de design est la pièce la plus
volumineuse et la plus transverse — ~34 fichiers, nouvelle architecture
de nav — moins risqué à partir dessus que d'y refaire ce chantier).
Sur cette base :

1. Tout ce que A possède déjà et que B/C n'ont pas modifié : conservé
   tel quel (la grande majorité — les ~29 pages dashboard converties
   couleur/typo, `dashboard-service.ts` étendu, `globals.css`, les
   nouveaux fichiers de nav, `admin/_components/charts.tsx`/`icons.tsx`).
2. Fichiers où seul B avait du contenu (A n'y a jamais touché) : repris
   de B à l'identique — `next.config.mjs` (correctif CSP),
   `marketing-landing.tsx` + nouveau `africa-availability-map.tsx`,
   `robots.ts`, `site-service.ts` (champ `slug`).
3. Fichiers où B avait un ajout fonctionnel réel sur une base que A
   avait par ailleurs recolorée : le contenu de B **réintégré à la
   main dans la version A**, reconverti au vocabulaire de classes du
   design unifié (`adm-input`/`adm-btn-primary`/`adm-alert-*`,
   `navy-900`/`violet-600`/`slate-500`, `font-jakarta`) plutôt que
   simplement écrasé ou laissé dans l'ancien thème — `login/page.tsx`
   et le nouveau `reset-password/page.tsx` (entièrement réécrits sur ce
   vocabulaire), `dashboard/faq/page.tsx` (formulaire d'édition inline
   ajouté), `dashboard/site/page.tsx` (lien de site basé sur le slug),
   `onboarding/page.tsx` (lecture des pays protégée).
4. Fusion à trois pour `invite/accept/page.tsx` : habillage de A +
   correctif de sécurité de C (vérification d'email + bouton de
   déconnexion).
5. Lot sécurité de C appliqué tel quel (A et B partageaient encore la
   version non corrigée, aucun conflit) : `middleware.ts`,
   `team-service.ts`, leurs fichiers de test, `sign-out-button.tsx`.

## 2. Vérifications effectuées — et leurs limites

**Pas d'accès réseau ni de `node_modules` dans cet environnement** :
aucune commande `npm install`/`typecheck`/`lint`/`test`/`build` n'a pu
être exécutée pour cette fusion, contrairement à ce qui est documenté
dans certains de vos rapports précédents. Ce qui a réellement été fait :

- Diff exhaustif fichier-par-fichier entre les trois sources
  (`diff -rq`) pour cartographier précisément chaque différence avant
  toute décision de fusion (rien fusionné "à l'aveugle").
- Pour chaque fichier modifié à la main : relecture ligne à ligne,
  vérification de l'équilibre des accolades/parenthèses.
- **Passe finale sur l'ensemble du projet fusionné** (tous les
  `.ts`/`.tsx`, pas seulement les fichiers touchés) : équilibre
  accolades/parenthèses vérifié partout, 0 anomalie détectée.
- Diff final contre A et contre B pour confirmer que chaque différence
  restante est explicable (soit une réintégration volontaire, soit un
  remplacement volontaire par la version de A) — aucune différence
  "orpheline" non comprise.
- `package.json` et `.env.example` confirmés identiques entre A et B
  (aucune dépendance ni variable d'environnement à réconcilier).

**Ce qui n'a PAS été vérifié** et reste à faire avant déploiement,
comme pour les lots 1/4 de `RAPPORT_FUSION_6.md` : `npm install` réel,
`typecheck`, `lint`, `test`, `build`. Priorité si un test échoue :
`team-service.test.ts` et `middleware.test.ts` (lot C, le plus
récemment écrit, jamais exécuté dans cet environnement non plus selon
son propre `NOTES.md`).

## 3. Fichiers modifiés par rapport à la base A

```
next.config.mjs                                    — repris de B (correctif CSP)
src/middleware.ts                                   — repris de C (sécurité)
src/middleware.test.ts                               — nouveau, de C
src/app/login/page.tsx                              — réécrit (contenu B + habillage A)
src/app/reset-password/page.tsx                      — nouveau (contenu B + habillage A)
src/app/invite/accept/page.tsx                       — fusion A + C
src/app/robots.ts                                    — repris de B
src/app/onboarding/page.tsx                          — réintégration (contenu B + habillage A)
src/app/_components/marketing-landing.tsx            — repris de B
src/app/_components/africa-availability-map.tsx      — nouveau, de B
src/app/_components/sign-out-button.tsx              — nouveau, de C
src/app/dashboard/faq/page.tsx                       — réintégration (contenu B + habillage A)
src/app/dashboard/site/page.tsx                      — réintégration (contenu B + habillage A)
src/application/services/site-service.ts             — repris de B
src/application/services/team-service.ts             — repris de C (sécurité)
src/application/services/team-service.test.ts         — repris de C
```

Tout le reste du périmètre (dashboard marchand, Super Admin, pages
légales, landing hors section pays) = identique à `sme-os-design-unifie`.

## 4. Prochaine étape

Faire tourner `npm install && npm run typecheck && npm run lint &&
npm test && npm run build` dans un environnement avec accès réseau
avant tout déploiement — aucune de ces commandes n'a pu être exécutée
ici. Le lot C signalait par ailleurs, dans son propre `NOTES.md`, trois
chantiers suivants non commencés : URLs sociales/XSS (section 10),
idempotence des webhooks NotchPay/Zernio (section 20), rate limiting
centralisé (section 12).
