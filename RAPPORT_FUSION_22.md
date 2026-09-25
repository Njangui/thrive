# Rapport de la fusion #22 — fusion #21 + lot O (Freemium v2)

Fait suite à `RAPPORT_FUSION_21.md` et intègre `RAPPORT_LOT_O.md`. Date : 21 septembre 2026.

**Demande** : « fusionne ». Entrées : `flexco -fusionne-21.zip` (fusion #21 = `thrive-main` + fusions #18 → #21) et `thrive-main-lot-O.zip` (lot O, bâti sur `thrive-main`, donc **sans** les fusions #18 → #21 : Fapshi, Next 16, Zod 4, Tailwind 4, refonte SEO, directions artistiques V17 → V19).

## 1. Résultat en bref

| | |
|---|---|
| Fichiers du lot O repris tels quels (F21 inchangé sur ces fichiers) | 52 modifiés + 27 nouveaux + la migration |
| Fichiers fusionnés à la main (modifiés des deux côtés) | 17 (§3) |
| Fichiers du lot O **volontairement non repris** (obsolètes) | 12 (§4) |
| Adaptations rendues nécessaires par la fusion | 3 (§5) |
| Fichiers de la fusion #21 supprimés | 0 |
| Migration du lot O | livrée sous le n° 0066, **renumérotée 0067** (0066 = `0066_fapshi_payment_provider.sql`) |

## 2. Méthode — et sa limite

Le lot O et la fusion #21 partent de la même base (`thrive-main`) mais je n'ai pas cette base : je l'ai reconstituée.

- **Fichiers touchés par le lot O** : horodatages du zip (512 fichiers portent la date de la base, 99 sont plus récents = le lot O).
- **Fichiers touchés par les fusions #18 → #21** : annexes de `RAPPORT_FUSION_18` à `_21`.
- Un fichier touché **d'un seul côté** est pris de ce côté. Un fichier touché **des deux côtés** (17) est fusionné à la main, bloc par bloc, en attribuant chaque différence à l'un ou l'autre.
- Contrôle : sur les 52 fichiers « lot O seul », aucune ligne de la fusion #21 ne porte de marqueur Fapshi / Tailwind 4 / Zod 4 / SEO (donc rien n'a été écrasé), et aucun utilitaire Tailwind 3 n'est introduit par le lot O.

**Limite** : cette attribution repose sur les annexes et les horodatages, pas sur un vrai fichier de base. Elle est vérifiée par le contrôle ci-dessus et par `tsc` (§6), pas prouvée.

## 3. Les 17 fichiers modifiés des deux côtés

| Fichier | Décision |
|---|---|
| `dashboard/_components/dashboard-nav.tsx` | #21 + liens « Diffusions » et « Fiche entreprise » |
| `dashboard/analytics/landing/page.tsx`, `dashboard/appointments/page.tsx` | #21 (Tailwind 4) + verrou `UpgradeNotice` du lot O |
| `dashboard/site/page.tsx` | #21 (direction artistique V18/V19 conservée) + lien « Modifier ma fiche entreprise » du lot O |
| `dashboard/marketing/omnichannel-publication-composer.tsx` | Lot O (plus de saisie libre d'un chat Telegram, champ « premier commentaire ») + `outline-none` → `outline-hidden` (6, règle de #21 §2.2) |
| `dashboard/channels/page.tsx` | Lot O (sections multi-comptes) + de #21 : `next/link`, message de paiement générique, `shadow-xs` ×2 |
| `(site)/services/[slug]/page.tsx`, `sitemap.ts`, `_components/tenant-landing.tsx` | #21 (SEO, JSON-LD, vitrines sectorielles) + garde `bookingEnabled` du lot O |
| `domain/entities/conversation.ts` | #21 (`z.record(z.string(), …)`, Zod 4) + motif `semi_automatic` du lot O |
| `application/services/youtube-channel-service.ts` | Lot O (plusieurs chaînes) ; import inutilisé retiré comme en #21 |
| `infrastructure/providers/registry.ts` | Lot O (Messenger/Instagram, multi-bots Telegram, multi-comptes YouTube, `getMessagingProviderForChannel`) + bloc `getPaymentProvider` Fapshi de #21 |
| `docs/DEPLOYMENT.md` | #21 (Fapshi, `proxy.ts`) + section « Lot O » (migration citée en 0066 puis 0067) |
| `storefront-service.test.ts` | #21 (textes V15) + `bookingEnabled` / `brandingRemoved` |
| `team-service.test.ts`, `marketing-service.test.ts`, `admin-plans-service.test.ts` | Version du lot O (elle suit le code du lot O ; #18 avait corrigé les mêmes tests périmés d'une autre façon, pour l'ancien code) |

## 4. Non repris du lot O (obsolète face à la fusion #21)

`src/app/api/webhooks/notchpay/route.ts` et les 5 fichiers `payment/notchpay/*` (remplacés par Fapshi), `src/middleware.ts` (devenu `proxy.ts`), `tailwind.config.ts` (devenu `.js`), `vitest.config.ts` / `vitest.integration.config.ts` (devenus `.mts`), `.eslintrc.json` (config plate `eslint.config.mjs`), `tsconfig.tsbuildinfo`.

## 5. Adaptations rendues nécessaires par la fusion

1. **Migration renumérotée 0066 → 0067** (collision avec la migration Fapshi). Références corrigées dans `plans-repository.ts`, `telegram-channel-service.ts`, `tests/rls-policies.test.ts`, `DEPLOYMENT.md`, `RAPPORT_LOT_O.md`. Les deux migrations sont indépendantes ; **ordre d'application : 0066 puis 0067**.
2. **`sector-home.tsx` (vitrines sectorielles de #21)** : 7 boutons « Prendre rendez-vous / Réserver » pointaient en dur vers `/rendez-vous`, que le lot O rend introuvable (404) hors Starter+. Ils retombent maintenant sur la page Contact quand `bookingEnabled` est faux. Décision de ma part, à inverser si vous préférez masquer les boutons.
3. **Six déclarations inutilisées** issues du lot O (que #21 avait ramené à 0 alerte ESLint) : `SOCIAL_BRAND` / `SOCIAL_CHANNELS` / `disconnectTelegramChannel` dans `channels/page.tsx` (remplacés par `MultiAccountSections`), `canUseFeature` dans `marketing-service.ts` et son mock dans le test, `accountIds` dans `omnichannel-publication-service.ts`.

## 6. Vérification — ce qui a été fait et ce qui ne l'a pas été

**Fait** : compilation TypeScript 6.0.3 de l'arbre fusionné, comparée à celle de la fusion #21 (le bac à sable n'a ni `node_modules` ni réseau : les deux produisent ~10 000 erreurs de modules absents, donc j'ai comparé les **diagnostics nouveaux**). Résultat : aucun export manquant ni signature locale incohérente détectés, aucune variable inutilisée nouvelle. Un seul diagnostic nouveau, artefact de l'absence des types Next (`redirect()` non typé `never` dans `broadcasts/page.tsx`).

**Non fait** : `npm ci`, `typecheck`, `lint`, `npm test`, `npm run build`, `test:e2e`, `test:integration`. **Aucun test n'a été exécuté** : ni les 890 de la fusion #21, ni les 825 du lot O, ni leur somme sur l'arbre fusionné. Rien n'a été vu dans un navigateur.

À lancer chez vous : `npm ci && npm run typecheck && npm run lint && npm test && npm run build`. Si quelque chose échoue, les suspects sont les 17 fichiers du §3 et `sector-home.tsx`.

## 7. Ce qui reste valable des rapports précédents

- Lot O §5 : rien n'a été testé contre Zernio (`permanent: true`, webhook `post.tiktok.url_resolved`, DM Messenger/Instagram), ni la migration sur une vraie base.
- Fusion #21 §7 : Fapshi jamais testé contre la vraie API, licence des images de démonstration, revue visuelle (Tailwind 4, vitrines V17 → V19), décisions produit ouvertes.
- Déploiement du lot O (voir `docs/DEPLOYMENT.md`, section « Lot O ») : sauvegarder la base, migrations **avant** le code, cron `process-first-comments`, « Actualiser » sur chaque bot Telegram existant.

## 8. À noter (déjà présent dans le lot O, non modifié ici)

Le composeur Telegram seul de `/dashboard/marketing` (`telegram-publication-composer.tsx`) garde un champ libre `targetChatId`, alors que le lot O annonce la fin de la saisie libre d'un identifiant de chat pour publier. Le lot O ne touche pas ce fichier ; je n'ai pas tranché.

## Annexe — fichiers touchés par rapport à la fusion #21

### Ajoutés (30)

- `RAPPORT_FUSION_22.md`
- `RAPPORT_LOT_O.md`
- `src/app/api/cron/process-first-comments/route.ts`
- `src/app/dashboard/_components/upgrade-notice.tsx`
- `src/app/dashboard/broadcasts/page.tsx`
- `src/app/dashboard/business/page.tsx`
- `src/app/dashboard/channels/multi-account-sections.tsx`
- `src/application/config/feature-gates.ts`
- `src/application/services/business-profile-service.test.ts`
- `src/application/services/business-profile-service.ts`
- `src/application/services/catalog-video-retention.test.ts`
- `src/application/services/comment-auto-reply-service.test.ts`
- `src/application/services/comment-auto-reply-service.ts`
- `src/application/services/contact-broadcast-service.test.ts`
- `src/application/services/contact-broadcast-service.ts`
- `src/application/services/feature-gate-service.test.ts`
- `src/application/services/feature-gate-service.ts`
- `src/application/services/first-comment-service.test.ts`
- `src/application/services/first-comment-service.ts`
- `src/application/services/inbound-auto-reply-service.test.ts`
- `src/application/services/inbound-auto-reply-service.ts`
- `src/application/services/inbox-channel-policy.ts`
- `src/application/services/messaging-policy-service.test.ts`
- `src/application/services/messaging-policy-service.ts`
- `src/application/services/social-account-registry-service.ts`
- `src/application/services/telegram-destination-service.test.ts`
- `src/application/services/telegram-destination-service.ts`
- `src/infrastructure/providers/social/youtube/multi-adapter.test.ts`
- `src/infrastructure/providers/social/youtube/multi-adapter.ts`
- `supabase/migrations/0067_freemium_v2_multi_accounts.sql`

### Modifiés (70)

- `docs/DEPLOYMENT.md`
- `src/app/(site)/rendez-vous/page.tsx`
- `src/app/(site)/services/[slug]/page.tsx`
- `src/app/(site)/services/page.tsx`
- `src/app/_components/landing-sections/cta.tsx`
- `src/app/_components/landing-sections/hero.tsx`
- `src/app/_components/landing-sections/services.tsx`
- `src/app/_components/sector-home.tsx`
- `src/app/_components/storefront/storefront-footer.tsx`
- `src/app/_components/tenant-landing.tsx`
- `src/app/api/cron/process-broadcasts/route.ts`
- `src/app/api/webhooks/telegram/tenant/[token]/route.ts`
- `src/app/api/webhooks/zernio/route.ts`
- `src/app/dashboard/_components/catalog-videos-panel.tsx`
- `src/app/dashboard/_components/dashboard-nav.tsx`
- `src/app/dashboard/analytics/landing/page.tsx`
- `src/app/dashboard/appointments/page.tsx`
- `src/app/dashboard/channels/page.tsx`
- `src/app/dashboard/leads/page.tsx`
- `src/app/dashboard/marketing/nouveau/page.tsx`
- `src/app/dashboard/marketing/omnichannel-publication-composer.tsx`
- `src/app/dashboard/orders/[id]/page.tsx`
- `src/app/dashboard/orders/page.tsx`
- `src/app/dashboard/site/page.tsx`
- `src/app/sitemap.ts`
- `src/application/config/pricing.ts`
- `src/application/services/admin-plans-service.test.ts`
- `src/application/services/admin-plans-service.ts`
- `src/application/services/appointment-service.ts`
- `src/application/services/catalog-video-service.ts`
- `src/application/services/conversation-orchestrator.ts`
- `src/application/services/domain-service.ts`
- `src/application/services/entitlements-service.test.ts`
- `src/application/services/entitlements-service.ts`
- `src/application/services/follow-up-service.ts`
- `src/application/services/handoff-service.ts`
- `src/application/services/lead-service.test.ts`
- `src/application/services/lead-service.ts`
- `src/application/services/marketing-service.test.ts`
- `src/application/services/marketing-service.ts`
- `src/application/services/omnichannel-publication-service.test.ts`
- `src/application/services/omnichannel-publication-service.ts`
- `src/application/services/order-service.test.ts`
- `src/application/services/order-service.ts`
- `src/application/services/plans-repository.ts`
- `src/application/services/social-post-tracking-service.ts`
- `src/application/services/storefront-service.test.ts`
- `src/application/services/storefront-service.ts`
- `src/application/services/subscription-service.ts`
- `src/application/services/team-service.test.ts`
- `src/application/services/telegram-channel-service.ts`
- `src/application/services/telegram-publication-service.ts`
- `src/application/services/youtube-channel-service.ts`
- `src/application/services/zernio-channel-service.ts`
- `src/domain/entities/conversation.ts`
- `src/domain/events/domain-events.ts`
- `src/domain/ports/messaging-provider.ts`
- `src/domain/ports/social-publishing-provider.ts`
- `src/infrastructure/providers/messaging/telegram/client.ts`
- `src/infrastructure/providers/messaging/telegram/mapper.ts`
- `src/infrastructure/providers/messaging/telegram/resolve-organization.ts`
- `src/infrastructure/providers/messaging/telegram/types.ts`
- `src/infrastructure/providers/messaging/zernio/mapper.ts`
- `src/infrastructure/providers/messaging/zernio/resolve-organization.ts`
- `src/infrastructure/providers/registry.ts`
- `src/infrastructure/providers/social/composite-adapter.ts`
- `src/infrastructure/providers/social/zernio/adapter.ts`
- `src/infrastructure/providers/social/zernio/client.ts`
- `src/infrastructure/providers/social/zernio/types.ts`
- `tests/rls-policies.test.ts`

### Supprimés (0)
