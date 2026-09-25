> ⚠️ **Archivé à la fusion #17 — contenu d'origine inchangé, sous ce bandeau.**
> Ce fichier s'appelait `RAPPORT_FUSION_14.md` sur la branche « liens tenant +
> boutons » (issue de la fusion #13). Il entrait en collision avec le
> `RAPPORT_FUSION_14.md` de l'autre branche (Catalogue V2), d'où le renommage.
> Deux écarts entre ce qui est décrit ci-dessous et ce qui est livré :
> 1. La migration `0056_telegram_publications_buttons.sql` est devenue **`0065_telegram_publications_buttons.sql`**
>    (le numéro `0056` est pris par `0056_service_images_and_specifications.sql`).
> 2. Le bouton CTA WhatsApp reste disponible dans l'adaptateur Zernio pour le **1:1**,
>    mais n'est **plus envoyé vers les groupes WhatsApp** (messages interactifs non pris
>    en charge par l'API Groupes). Lire la section « Correction — WhatsApp (Zernio)… »
>    ci-dessous avec cette réserve. Détail : `RAPPORT_FUSION_17.md`.

---

# Rapport — Correction lien produit tenant (domaine générique au lieu du domaine réel) + bouton Telegram

Fait suite à `RAPPORT_FUSION_13.md`. Signalé le 19/09/2026 par un lien
produit partagé depuis le canal Telegram du tenant de test "Habynex" :
une fois cliqué, le lien pointait vers un domaine générique au lieu du
domaine du tenant, page introuvable.

## Diagnostic

Le bug n'était pas propre à Telegram : **4 fichiers**, couvrant tous les
canaux sortants du SaaS, construisaient un lien produit public avec
`env.NEXT_PUBLIC_APP_URL` — le domaine générique de la plateforme —
au lieu du domaine RÉEL du tenant (sous-domaine `{slug}.flexco .app`
ou domaine custom vérifié comme `habynex.com`). Trouvé par recherche
exhaustive de tous les usages de `NEXT_PUBLIC_APP_URL` dans `src/` :

- `conversation-orchestrator.ts` — le bot IA qui répond automatiquement
  aux clients sur WhatsApp (PRODUCT_DISCOVERY et PRODUCT_QUERY).
- `marketing-service.ts` — campagnes de publication réseaux sociaux.
- `whatsapp-group-service.ts` — diffusions dans les groupes WhatsApp.
- `omnichannel-publication-service.ts` — publication catalogue multi-canal
  (réseaux sociaux + Telegram + groupes WhatsApp en un seul geste) ;
  c'est précisément cette fonction (`buildCatalogPublicationContent`)
  qui a produit le message du screenshot signalé.

Un précédent chantier (Lot H, section 23 du master prompt) avait déjà
identifié et documenté ce piège pour le RENDU DE PAGE (canonical, Open
Graph, sitemap — `resolveRequestOrigin()` dans
`resolve-request-tenant.ts`, qui lit le header `host` de la requête en
cours) mais n'avait pas couvert ces 4 fichiers, qui tournent tous HORS
requête HTTP d'un visiteur (webhook entrant, cron, job planifié) — donc
sans `host` de visiteur à lire.

## Correction

Nouvelle fonction **`getTenantPublicOrigin(organizationId)`** dans
`resolve-request-tenant.ts` (même fichier que `resolveRequestOrigin`,
même préoccupation, source différente) : résout le domaine public réel
du tenant depuis la base — domaine custom vérifié marqué principal en
priorité, sinon le premier domaine custom vérifié, sinon le sous-domaine
plateforme, jamais `NEXT_PUBLIC_APP_URL`. Ne lève jamais (repli sur
`NEXT_PUBLIC_APP_URL` si l'organisation est introuvable, pour ne jamais
faire échouer tout un envoi à cause d'un seul lien).

Branchée dans les 4 fichiers listés ci-dessus. Testée (nouveau fichier
`resolve-request-tenant.test.ts`, 3 tests : domaine custom, repli
sous-domaine, repli final sans organisation).

## Bouton "Voir plus" (Telegram uniquement)

Demandé en complément : remplacer le lien en clair par un bouton
("Voir plus" / "voir plus de détails") pour que le client n'ait pas à
voir l'URL directement.

Vérifié avant d'implémenter (`docs/ZERNIO_INTEGRATION.md`) : seul
Telegram confirme un mécanisme de bouton pour ce type d'envoi
(`reply_markup.inline_keyboard`, API Bot officielle). Rien de confirmé
côté Zernio/WhatsApp pour un envoi "à froid" — jamais implémenté sur la
base d'une supposition, donc **le bouton n'existe que pour Telegram** ;
les réseaux sociaux et les groupes WhatsApp gardent le lien en texte,
seul moyen dont ils disposent d'atteindre la fiche produit.

Câblage complet :
- `OutboundMessage.buttons` (port `messaging-provider.ts`) — optionnel,
  ignoré silencieusement par les canaux qui ne le gèrent pas.
- `TelegramInlineKeyboardMarkup`/`reply_markup` ajouté aux types et à
  l'adapter Telegram (`sendMessage`/`sendPhoto`/`sendVideo`/`sendAudio`/
  `sendDocument`).
- `buildProductButtons(products, origin)` (nouvelle fonction,
  `omnichannel-publication-service.ts`) : un bouton par produit, "Voir
  plus" si un seul produit, "Voir : {nom}" sinon, tronqué à la limite de
  64 caractères de l'API Bot. `buildCatalogPublicationContent()` accepte
  un 4ᵉ paramètre `includeLinks` (def. `true`) — `false` pour Telegram,
  qui n'a donc plus le lien en double (texte + bouton).
- Publications Telegram **programmées** (table `telegram_publications`,
  cron `process-telegram-publications`) : nouvelle colonne `buttons`
  (migration `0056_telegram_publications_buttons.sql`, `jsonb`
  nullable) — sans elle, un bouton choisi au moment de la
  programmation aurait été perdu au moment de l'envoi réel, plus tard,
  par le cron. `telegram-publication-service.ts` mis à jour (lecture +
  écriture) sur ses 3 points d'insertion et son unique point d'envoi
  partagé (`sendTelegramPublication`).

Testé (nouveau fichier `omnichannel-publication-service.test.ts`, 7
tests) : lien correct sous le domaine du tenant, `includeLinks=false`
n'affiche aucun lien, un bouton par produit dans l'ordre, produit sans
slug ignoré, troncature à 64 caractères.

## Vérification

- `npm run typecheck` : 0 erreur.
- `npm run lint` : 0 erreur (même warning préexistant qu'au rapport
  précédent, sans rapport avec ce correctif).
- `npm run test` : **632/632 tests verts** (622 + 10 nouveaux), 58
  fichiers. `conversation-orchestrator.test.ts` et
  `whatsapp-group-service.test.ts` adaptés (nouveau mock/paramètre).
- `npm run build` : **82/82 pages générées**, même nombre qu'avant ce
  correctif. Vérifié comme d'habitude sur ce projet en stubant
  temporairement `next/font/google` (bloqué par l'allowlist réseau de ce
  bac à sable), **fichiers originaux restaurés avant livraison**.

Livré en zip du projet complet (`node_modules`/`.next` exclus).

## Correction — WhatsApp (Zernio) supporte en réalité un bouton CTA URL

Le paragraphe ci-dessus affirmait que WhatsApp/Zernio ne supportait aucun
mécanisme de bouton pour ce type d'envoi. **C'était faux** — trouvé en
vérifiant docs.zernio.com plus en profondeur (recherche web, sur demande
explicite) : Zernio expose bien un bouton CTA URL WhatsApp natif
(`interactive.type: "cta_url"`, forme identique à l'API Cloud de Meta,
confirmée par recoupement du SDK officiel `github.com/zernio-dev/chat-sdk-adapter`
et de la documentation Meta elle-même). Contrainte réelle, différente de
Telegram : **un seul bouton URL par message WhatsApp** (limite du type
`cta_url`, pas de la mise en œuvre). Corrigé :

- `ZernioInteractiveCtaUrl` (types.ts) + `ZernioAdapter.sendMessage` :
  envoie un message interactif `cta_url` quand `OutboundMessage.buttons`
  contient exactement 1 bouton ; message texte simple sinon (0 ou 2+
  boutons — WhatsApp ne peut pas représenter plusieurs liens distincts
  avec un seul bouton). Jamais combiné avec une pièce jointe
  (`attachmentUrl`) : seul `header` dans `interactive` est confirmé pour
  ça, jamais mélangé sans confirmation.
- `omnichannel-publication-service.ts` (cible WhatsApp groupe) et
  `whatsapp-group-service.ts` (diffusions groupe) : un seul produit ->
  lien masqué du texte + vrai bouton "Voir plus" ; plusieurs produits ->
  comportement inchangé (liens en texte), faute de pouvoir représenter
  plusieurs liens avec un seul bouton.
- Bug préexistant trouvé et corrigé au passage (sans rapport avec les
  boutons) : la publication WhatsApp groupe **immédiate** (non
  programmée) de `omnichannel-publication-service.ts` passait l'ID du
  groupe WhatsApp lui-même (`external_id`) comme `externalThreadId`, au
  lieu du vrai identifiant de conversation Zernio
  (`zernio_conversation_id`) — cette diffusion aurait échoué à chaque
  envoi. `ConnectedGroup` expose maintenant `zernioConversationId`
  explicitement plutôt que de réutiliser `externalId` par erreur.
- `buildProductButtons` déplacée de `omnichannel-publication-service.ts`
  vers `catalog-service.ts` (import circulaire évité : `whatsapp-group-service.ts`
  en avait besoin aussi, et `omnichannel-publication-service.ts` importe
  déjà `whatsapp-group-service.ts`).

Domaine racine réel confirmé par Vox (scholarmach.com, pas flexco .app) —
`getTenantPublicOrigin()` n'en dépend pas (lit `NEXT_PUBLIC_ROOT_DOMAIN`
dynamiquement), seuls deux exemples en dur obsolètes corrigés
(`.env.example`, `VAPID_SUBJECT` par défaut dans `env.ts`).

Tests ajoutés : `zernio/adapter.test.ts` (3 tests — bouton unique envoyé
en interactif, aucun bouton envoyé en texte simple, plusieurs boutons
repliés sur le texte simple), `buildProductButtons` déplacé vers
`catalog-service.test.ts`.

**Vérification finale** : typecheck 0 erreur, lint 0 erreur (même warning
préexistant), **635/635 tests verts** (632 + 3 nouveaux), build 82/82
pages (même méthode de vérification que d'habitude sur ce projet).

