# Rapport de fusion #12 — Connexion Google, lien Console Admin dans le dashboard, lien Tableau de bord sur la landing

Fait suite à `RAPPORT_FUSION_11.md`. Contrairement aux lots précédents,
il ne s'agit pas d'un merge de plusieurs sources : le point de départ est
`thrive-main__9_.zip`, la version du dépôt telle que vous l'avez ensuite
travaillée vous-même (511 fichiers, déjà rebrandée **CRESYVA** — `name`
dans `package.json`, `CresyvaBrand`, `.mkt-*`/`.adm-*` avec les couleurs
de la nouvelle marque). Trois fonctionnalités ajoutées dessus, à votre
demande.

## 1. Connexion/inscription Google

- `src/app/_components/auth-shell.tsx` : nouvel export `GoogleIcon` (logo
  "G" officiel multicolore) — seule icône de marque tierce des pages
  d'auth, séparée du jeu d'icônes trait de `app-icons.tsx`.
- `src/app/globals.css` : nouvelle classe `.auth-oauth-button`.
- `src/app/login/page.tsx`, `src/app/signup/page.tsx` : bouton "Continuer
  avec Google" au-dessus du formulaire email/mot de passe (masqué en mode
  "mot de passe oublié" sur `/login`, ça n'a pas de sens dans ce flux).
  Appelle `supabase.auth.signInWithOAuth({ provider: "google", options:
  { redirectTo: ... } })` — **réutilise tel quel** `/auth/callback`, déjà
  en place pour le magic link et la réinitialisation de mot de passe :
  aucune modification de cette route n'était nécessaire.

**⚠️ Configuration manuelle requise, hors de ce dépôt** — le code seul ne
suffit pas, le provider Google doit être activé côté Supabase. Les 3
étapes exactes (Google Cloud Console → Client OAuth, Supabase Dashboard →
Providers → Google, Supabase Dashboard → Redirect URLs) sont documentées
dans une nouvelle section **`docs/DEPLOYMENT.md` § 2bis**, dans le même
esprit que les sections existantes pour Zernio/NotchPay. Sans ces 3
étapes, le bouton redirige vers une erreur Supabase après le clic — ce
n'est pas un bug du code livré ici.

## 2. Lien "Console Admin" dans le dashboard, visible uniquement pour les admins

- `src/application/services/platform-admin-service.ts` : nouvelle
  fonction `getPlatformAdminStatus(userId)`, variante **non bloquante**
  de `requirePlatformAdmin()` — retourne `PlatformAdmin | null` au lieu
  de lever `AuthenticationError`/`AuthorizationError`. `requirePlatformAdmin()`
  refactorée pour réutiliser cette fonction en interne, comportement
  externe strictement identique (mêmes erreurs, même forme de retour) —
  vérifié par les tests existants, plus 3 tests ajoutés pour la nouvelle
  fonction.
- `src/app/_components/app-icons.tsx` : nouvelle icône `IconShield`.
- `src/app/dashboard/layout.tsx` : appelle `getPlatformAdminStatus(user.id)`
  (ajouté au `Promise.all` déjà présent), transmet `isPlatformAdmin` à
  `DashboardSidebar` et `DashboardTopbar`.
- `src/app/dashboard/_components/dashboard-nav.tsx` : `useVisibleNavGroups()`
  accepte un 3ᵉ paramètre optionnel `isPlatformAdmin`, ajoute un groupe
  "Plateforme" → lien "Console Admin" (`/admin`) uniquement si vrai.
- `src/app/dashboard/_components/mobile-nav.tsx`,
  `src/app/dashboard/_components/topbar.tsx` : prop `isPlatformAdmin`
  ajoutée et transmise à la chaîne (topbar → mobile-nav), même lien
  visible aussi dans le tiroir mobile.

La protection réelle de `/admin/*` reste entièrement dans
`admin/layout.tsx` (`requirePlatformAdmin()`, 404 générique pour un
non-admin) — ce lien n'est qu'un confort d'affichage pour un compte qui
est à la fois marchand et admin plateforme, jamais une barrière de
sécurité. Cohérent avec le choix déjà documenté dans `docs/DEPLOYMENT.md`
§6 de ne jamais confirmer l'existence de la console à qui n'y a pas
droit — ce paragraphe a été mis à jour en conséquence.

## 3. Lien "Tableau de bord" sur la landing pour un visiteur déjà connecté

- `src/app/page.tsx` : lit la session (`getSupabaseServerSessionClient()`)
  côté serveur pour la branche marketing (racine, hors tenant), transmet
  `isAuthenticated` à `MarketingLanding`. Volontairement **pas** de
  résolution d'organisation ici (pas de duplication avec la logique déjà
  dans `dashboard/layout.tsx`, qui gère déjà son propre repli vers
  `/onboarding` si besoin) — juste une lecture de session, un lien vers
  `/dashboard`, et c'est cette page qui tranche la suite.
- `src/app/_components/marketing-landing.tsx` : accepte `isAuthenticated`.
  Header, CTA du hero, CTA final et footer affichent "Accéder à mon
  tableau de bord" / "Tableau de bord" → `/dashboard` à la place de
  Connexion/Créer un compte quand vrai (le bandeau "Aucune carte
  bancaire / Prêt en quelques minutes / Annulable à tout moment" est
  masqué dans ce cas, plus pertinent pour un compte déjà créé).
- `src/app/_components/marketing-mobile-menu.tsx` : même logique, prop
  `isAuthenticated` transmise depuis `MarketingLanding`.

Les tenants (vitrines publiques sur sous-domaine/domaine custom) ne sont
pas concernés — seule la landing marketing racine (celle du produit
CRESYVA lui-même) affiche ce lien, une vitrine tenant n'a pas de notion
de "mon tableau de bord" pour ses propres visiteurs.

`e2e/marketing-landing.spec.ts` (parcours non-authentifié, sans compte de
test) reste valide sans modification : ces 3 tests tournent sans session,
la branche `else` de chaque condition est strictement identique au
contenu d'avant cette fusion.

## Bug préexistant trouvé et corrigé (sans rapport avec les 3 fonctionnalités ci-dessus)

En lançant `next build` sur le dépôt reçu (`thrive-main__9_.zip`, avant
toute modification de ma part au-delà de l'ajout d'une classe CSS), le
build échouait sur `src/app/globals.css` : 10 utilitaires Tailwind
`shadow-[...rgb(15 23 42,...)...]` avec un **espace non échappé** à
l'intérieur d'une valeur arbitraire entre crochets — syntaxe JIT Tailwind
invalide (un espace dans `shadow-[...]` doit être un underscore `_`,
sinon le nom de classe généré est coupé au premier espace). Confirmé
préexistant par diff contre l'archive reçue avant toute édition : aucune
des lignes fautives (`.adm-card:hover`, `.auth-logo-mark`,
`.auth-form-card`, `.onb-card`, `.pricing-card`, `.pricing-card.popular`,
`.affiliate-visual`, `.affiliate-bottom`, `.adm-dashboard-section`,
`.adm-kpi`) ne fait partie des 3 fonctionnalités demandées — probablement
introduit lors du dernier passage de rebranding, avant cet envoi.
Corrigé (espaces → underscores dans les 10 occurrences, uniquement à
l'intérieur des crochets Tailwind — les usages en CSS brut hors `@apply`,
ex. `background-image: radial-gradient(..., rgb(0 209 160 / .09), ...)`,
n'ont pas ce problème et n'ont pas été touchés).

## Vérifications passées sur l'ensemble du dépôt

- `npm ci` : 517 paquets, aucune erreur
- `tsc --noEmit` : propre
- `next lint` : aucun avertissement/erreur
- `vitest run` : **622/622 tests passent (56 fichiers)** — 619 + les 3
  nouveaux tests de `getPlatformAdminStatus()`
- `next build` : succès complet, **84 routes générées** (le dépôt reçu en
  comptait déjà 84 avant mes 3 ajouts — aucune nouvelle route créée par
  ce lot, uniquement des liens vers des routes déjà existantes). Mêmes
  stubs **temporaires** que les fusions précédentes sur `src/app/fonts.ts`
  et les deux appels `next/font/google` de `layout.tsx` (sandbox sans
  accès à `fonts.googleapis.com`) + variables Supabase factices — **les
  deux fichiers restaurés à l'identique de l'original avant livraison**
  (diff vérifié), aucun changement de code réel lié aux polices.
