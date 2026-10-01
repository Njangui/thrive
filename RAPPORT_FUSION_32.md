# RAPPORT_FUSION_32 — Lot P (vidéos Zernio, domaine hors forfait, badge, TikTok) dans la base fusion-31

**Date : 01/10/2026**

## 1. Ce qui a été fusionné

| Archive | Rôle | Traitement |
|---|---|---|
| `thrive-main-fusion-31.zip` | **Base retenue** (marque flexco, Fapshi, Next 16, fusions 18→31, migrations jusqu'à 0074) | conservée intégralement |
| `files__6_.zip` → `thrive-main-lot-P.zip` + `RAPPORT_LOT_P.md` | **Lot P** (nouveau, ≠ ancien « Lot P messagerie » déjà intégré en F25) | delta repris sur la base |
| `thrive-main__9_.zip` | ancêtre de fusion-31 (identique sauf 17 fichiers, tous déjà dans fusion-31) | rien à reprendre |
| `thrive-main__10_.zip` | version plus ancienne (23/09) | rien à reprendre |

⚠ Le lot P part de l'ancienne base **cresyva + NotchPay + Next 14** (lot O). Il n'a pas pu être copié tel quel : fusion
à 3 voies **fichier par fichier, hunk par hunk**, renommage `cresyva → flexco` appliqué, et tout ce que la base avait
fait depuis (Fapshi, essai Pro offert, prix par pays, groupes WhatsApp/Telegram, bouton Déconnecter, templates
sectoriels, Service client…) a été **gardé**. Le lot P n'a donc apporté que ses propres changements.

⚠ Homonyme : `docs/RAPPORT_LOT_P.md` = ancien Lot P (messagerie). `RAPPORT_LOT_P.md` (racine) = ce lot-ci.

## 2. Ce que le lot P apporte maintenant

- **Vidéos** : restent chez Zernio ; cron `/api/cron/process-catalog-videos` qui retéléverse avant la fin des 7 jours
  (`host_expires_at`), `expires_at` = promesse de l'offre, jamais reculée. Remplace le modèle `storage_class` du lot O.
- **Domaine personnalisé** hors forfait, ouvert à tous : nouvelle page `/dashboard/domain` (la recherche de domaine y a
  été déplacée), entrée de menu, `/admin/domains` avec statut de paiement (impossible de marquer « enregistrée » sans
  « payé », et création réelle de `tenant_domains`).
- **Badge** visible seulement sur Discover (retirable dès Starter).
- **TikTok** : réponse automatique aux commentaires en Pro, `isOwnAccount`, anti-spam par identifiant d'auteur,
  « reconnexion requise » (+ bandeau dans Canaux).
- **Telegram** : suivi automatique d'un groupe converti en supergroupe. **YouTube** : bouton « Reconnecter » par chaîne.
- `scripts/verify-zernio-capabilities.ts` + `npm run verify:zernio`.

## 3. Conflits / arbitrages

1. **Migration** : `0067_freemium_v3_domain_video_tiktok.sql` → renumérotée **`0075`** (0067 = freemium_v2, 0066 = Fapshi,
   0074 = repair grid déjà pris). Elle DOIT passer après 0074, qui réinsère `custom_domain` (le `delete` de 0075 le retire).
2. `social-account-registry-service.ts` / `multi-account-sections.tsx` / `channels/page.tsx` : le lot P n'avait pas le
   bouton **Déconnecter** ni l'exclusion des comptes déconnectés (ajoutés dans la base) → conservés ; seul
   `needsReconnect` + « Reconnecter » ajoutés.
3. `site/page.tsx` : bloc « Template actif » de la base conservé ; seule la section domaine est remplacée par un lien
   vers `/dashboard/domain`. `domain-search-*` déplacés vers `dashboard/domain/` (version de la base, plus récente).
4. `subscription-service.ts`, `plans-repository.ts` : prix par pays et essai Pro offert de la base conservés.
5. `dashboard-nav.tsx` : lien « Service client » de la base conservé ; ajout « Domaine personnalisé ».
6. `telegram/types.ts`, `domain-events.ts`, webhooks Zernio/Telegram : champs groupes/Telegram de la base conservés.
7. `package.json` / `docs/DEPLOYMENT.md` : base conservée (Fapshi, Next 16, vitest 5) ; ajout du script `verify:zernio`
   et de la section « Lot P » (migration 0075).
8. **Supprimé** : `catalog-video-retention.test.ts` (testait `storage_class`, concept abandonné par le lot P).
9. **Ajouté hors lot P** : `custom_domain` retiré de `DIAGNOSTIC_FEATURES` (`admin-diagnostic-service.ts`) — sinon le
   diagnostic admin afficherait ce verrou comme fermé pour tous les plans.
10. Deux corrections de compatibilité (le lot P a été écrit pour TS 5 / vitest 1) : cast `BodyInit` sur le PUT de
    renouvellement vidéo (TS 6), et mock `ZernioSocialClient` en `function` dans `catalog-video-cron.test.ts` (vitest 5).

## 4. Vérifications (sur l'arbre fusionné, `npm ci` réel)

- `tsc --noEmit` : **0 erreur** · `eslint .` : **0 erreur**, 1 avertissement préexistant (`isBlank`)
- `vitest run` : **1228 / 1230**. Les 2 échecs sont les tests Fapshi `client.test.ts` **déjà en échec dans fusion-31**
  (vérifié sur la base non modifiée, voir RAPPORT_FUSION_27).

## 5. Non vérifié

- `next build` non lancé. Migration 0075 non exécutée sur une vraie base. Aucun appel réel Zernio/Supabase/Telegram
  (`npm run verify:zernio` à lancer avec ta clé, voir `RAPPORT_LOT_P.md` §0).
- Reste non fait du lot P (inchangé) : plusieurs numéros WhatsApp dédiés (clé `whatsapp_group_numbers` réservée, pas appliquée).
- Pas de base commune réelle du lot P (le lot O seul n'était pas fourni) : le delta a été reconstitué par comparaison
  et par dates de modification (39 fichiers modifiés après le lot O). Un fichier du lot P modifié sans changement de date
  aurait pu m'échapper — relire `git diff` avant de déployer.
- Les anciennes bases (`__9_`, `__10_`) n'ont pas été fusionnées : elles sont contenues dans fusion-31.

## 6. Mise à jour — `next build` (01/10/2026)
- `next build --webpack` : **compilation OK, TypeScript OK, génération des pages OK** (exit 0), route `/dashboard/domain`, `/admin/domains` et le cron `process-catalog-videos` incluses.
- Build fait avec des polices Google **simulées** (sandbox sans accès à fonts.googleapis.com) et des variables Supabase **factices** : le rendu typographique et la connexion réelle ne sont donc pas vérifiés. Sur ta machine / Vercel, le build normal (Turbopack) utilisera les vraies polices. Le mode Turbopack n'a pas pu être testé ici (le mock de polices n'y fonctionne pas).
- Correction (erreur **préexistante dans fusion-31**, bloquait `next build`) : `dashboard/analytics/landing/page.tsx`, `searchParams` typé `Promise<…> | {…}` → `Promise<…>` (exigé par Next 16).
