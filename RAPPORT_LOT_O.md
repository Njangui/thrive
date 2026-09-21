# RAPPORT LOT O — Freemium v2 : multi-comptes, verrous, messagerie, diffusions

Date : 21/09/2026 · Base : `thrive-main` (fusion 17) · Typecheck 0 erreur · Lint 0 erreur (1 warning préexistant) ·
Tests **825 / 825** (avant : 758 OK + 7 KO périmés — tous corrigés) · Migration **0067** (livrée sous le n° 0066, renumérotée à la fusion #22 : 0066 est déjà `0066_fapshi_payment_provider.sql`) : syntaxe SQL validée (analyseur
PostgreSQL), **non exécutée sur une vraie base** · Build Next non lancé (Google Fonts injoignable depuis le bac à sable).

## 1. Décisions prises (à valider — toutes modifiables sans code depuis /admin/plans)
| Sujet | Décision | Pourquoi |
|---|---|---|
| Telegram canaux / groupes | canaux **1 / 3 / 12**, groupes **1 / 2 / 8** (Discover / Starter / Pro) | conserve les totaux 2 / 5 / 20 de la grille, répartis 60 % canaux (publication) / 40 % groupes |
| Diffusion contacts | Discover **0**, Starter **50**, Pro **100**, 5 campagnes/jour | grille ; garde-fou anti-abus |
| Vidéos | Discover **7 j**, Starter **30 j**, Pro **90 j**, *uniquement si Zernio confirme un stockage permanent* | voir §5 |
| TikTok réponse auto | `tiktok_auto_comments` = 0 partout (retiré, réactivable) | demande |
| CRM / commandes / RDV / analytique site / relances | Discover **0**, Starter/Pro **1** | demande ; Discover garde liste de prospects + notes |
| Domaine perso / badge | Starter+ / Pro | demande (« oui ») |
| Messenger / Instagram DM | Messenger Starter+, Instagram Pro | Facebook en Starter, Instagram en Pro dans la grille |
| Groupes/canaux Telegram | messages de groupes/canaux **ne créent plus** de conversations | ce sont des destinations de publication |
| Multi-bots, même utilisateur | 1 conversation par (organisation, utilisateur Telegram) ; réponse via le **dernier bot** utilisé | évite de casser la contrainte d'unicité existante |

## 2. Livré, par demande
1. **Mono-compte** : `telegram_bots`, `youtube_accounts`, `social_accounts` (+ `zernio_social_profiles`) ; quotas *cumulatifs* réels
   (plafond appliqué à la connexion, jauges dans /dashboard/subscription) ; `YouTubeMultiAccountAdapter` ; adaptateur Zernio
   multi-profils (un compte TikTok par profil Zernio, profils créés automatiquement) ; validation d'appartenance des comptes ciblés
   (la clé Zernio est partagée : sans elle un tenant pouvait cibler le compte d'un autre).
2. **Telegram direct** : bots multiples, `telegram_destinations` (canal/groupe), enregistrement manuel (`@nom`, lien t.me, id) avec
   contrôle des droits du bot, **enregistrement automatique** via `my_chat_member`, quotas canaux/groupes séparés.
3. **Commentaires FB/IG « comme les messages »** : `comment-auto-reply-service` → même orchestrateur, même politique d'offre,
   mêmes escalades ; anti-boucle (commentaires du compte, 30 réponses/10 min, 3/auteur/jour) ; réglage par compte.
4. **Diffusion contacts** : `contact-broadcast-service`, page `/dashboard/broadcasts`, cron, STOP = désinscription, règle Meta des 24 h.
5. **Vidéos Zernio permanent** : `permanent` demandé au presign (tolérant), classe de stockage **déduite côté serveur**, durée par plan.
6. **Verrous** : CRM (pipeline, score), commandes, rendez-vous (vitrine publique incluse), analytique du site, relances, domaine perso,
   badge — pages **et** services (un appel direct d'un compte Discover échoue).
7. **Messagerie unifiée** : Messenger + Instagram DM (résolution du compte, routage, réponse), canaux non inclus ignorés avant écriture.
8. **Semi-automatique / automatique** : `messaging-policy-service` + `inbound-auto-reply-service` (FAQ → infos entreprise → catalogue ;
   Discover : escalade `semi_automatic` + accusé de réception ; Starter/Pro : IA en dernier recours).
9. **TikTok / premier commentaire** : `firstComment` Zernio (FB, IG, LinkedIn) ; TikTok par job différé (commentaire + épinglage).
10. **Fiche entreprise** (`/dashboard/business`) pour tous les plans + identité (logo, bannière, favicon) déverrouillée sur Discover.
+ Bug corrigé au passage : les **relances WhatsApp** demandaient un fournisseur « whatsapp » au lieu de « zernio » (jamais envoyées).

## 3. Déploiement — voir `docs/DEPLOYMENT.md` § « Lot O »
Migration **avant** le code. Cliquer « Actualiser » sur chaque bot Telegram existant. Nouveau cron `process-first-comments`.

## 4. Changements de comportement pour les organisations existantes
- Discover : commandes, rendez-vous (et page/section publique de réservation), pipeline CRM, analytique du site, relances, domaine perso
  deviennent inaccessibles (données conservées).
- Orgs au-delà des nouveaux quotas : rien n'est supprimé ; seuls de nouveaux ajouts sont refusés.
- Le registre `social_accounts` ne reprend que le dernier compte social ; il se complète automatiquement (page Canaux, publication).
- Telegram : plus de saisie libre d'un identifiant de chat pour publier ; messages de groupes/canaux ignorés.

## 5. NON VÉRIFIÉ en conditions réelles (à tester avec des comptes/clefs réels)
1. **Zernio `permanent: true`** : absent de la référence publique de l'endpoint (nom, type MIME, taille) ; le guide média dit « temporaire 7 j,
   copie permanente à la publication ». Le paramètre est envoyé avec repli sans lui ; si Zernio le refuse ou l'ignore, la vidéo reste
   « temporaire (7 jours) » **et l'interface le dit** — la promesse 30/90 j ne tient alors pas.
2. Forme du webhook `post.tiktok.url_resolved`, réponse de « créer un commentaire » et endpoint d'épinglage TikTok (lecture défensive, erreurs conservées).
3. Payload des DM Messenger/Instagram et champ `comment.from.id` (détection des commentaires du compte).
4. Migration 0067 sur une base réelle (contraintes, reprise des données).
5. Rien n'a été exécuté contre Supabase, Zernio, NotchPay, Telegram ou YouTube.

## 6. Correction d'une affirmation précédente
Je t'avais dit que TikTok ne permet pas de lire/répondre aux commentaires via Zernio : c'était basé sur une ancienne table. La doc
actuelle indique le contraire (comptes connectés via l'app Business TikTok). Le retrait décidé par toi est appliqué ; réactivation :
/admin/plans → `tiktok_auto_comments`. Premier commentaire : `firstComment` Zernio ne couvre pas TikTok (d'où le job dédié).

## 7. Limites connues / suites
- WhatsApp : pas de modèles de message approuvés → diffusion limitée aux contacts dans la fenêtre de 24 h.
- YouTube : pas de premier commentaire (scope OAuth supplémentaire nécessaire) ; reconnecter une chaîne quand le plafond est atteint passe par « Ajouter » désactivé.
- Non fait : icônes de verrou dans la navigation, verrou des rôles d'équipe, tests d'intégration RLS des nouvelles tables, Playwright, `next build`.
- Architecture : `registry.ts` (infrastructure) importe `listOrganizationZernioProfileIds` (application) — à déplacer si vous durcissez les couches.

## 8. Fichiers
Nouveaux : migration 0067 ; `feature-gates.ts` ; services `feature-gate`, `business-profile`, `messaging-policy`, `inbound-auto-reply`,
`inbox-channel-policy`, `social-account-registry`, `comment-auto-reply`, `first-comment`, `telegram-destination`, `contact-broadcast` (+ tests) ;
`youtube/multi-adapter.ts` ; pages `business`, `broadcasts` ; `channels/multi-account-sections.tsx` ; `upgrade-notice.tsx` ; cron `process-first-comments`.
Réécrits : `telegram-channel-service`, `youtube-channel-service`, zones multi-comptes de `zernio-channel-service`, `registry.ts`, sections de la page Canaux.
