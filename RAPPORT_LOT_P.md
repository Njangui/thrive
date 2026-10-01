# RAPPORT LOT P — Vidéos chez Zernio (renouvelées automatiquement), domaine hors forfait, badge Discover, TikTok Pro

> **Note de fusion (fusion 32)** : dans ce dépôt, la migration de ce lot s'appelle `0075_freemium_v3_domain_video_tiktok.sql` (renumérotée, voir RAPPORT_FUSION_32.md).

Date : 22/09/2026 · Base : Lot O · Typecheck 0 erreur · Lint 0 erreur (1 warning préexistant, inchangé) ·
Tests **843 / 843** (Lot O : 825) · Migration 0067 : syntaxe SQL validée — **non exécutée sur une vraie base**.
Rien n'a tourné contre un vrai Zernio, Supabase ou Telegram. `npm run verify:zernio` est fait pour ça, mais il
faut ta clé pour le lancer.

**Ce rapport remplace la version précédente** : un premier jet de ce lot avait déplacé l'hébergement des vidéos vers
un bucket Supabase à nous. Décision explicite revenue en arrière : **les vidéos restent chez Zernio, quelle que soit
la contrainte que ça impose**. Ce qui suit décrit l'état final, livré.

## 0. Ce qui était incertain, tranché ou non
| Sujet | Statut |
|---|---|
| Zernio `permanent: true` (vidéos) | **Confirmé absent de l'API** (doc, SDK officiels, changelog — PLAN_LOT_P.md §0.1). |
| Conséquence de cette décision | Zernio ne garde un fichier que 7 jours. Honorer 7/30/90 jours sans quitter Zernio demande de RETÉLÉVERSER le fichier périodiquement — c'est ce qui est construit (voir §1). |
| TikTok, réponse auto aux commentaires | Confirmé permis. Activé en Pro. |
| Domaine perso / badge | Retiré des forfaits / visible Discover seulement (tes décisions, inchangées). |

## 1. Comment la promesse 7/30/90 jours est tenue sans quitter Zernio
Chaque vidéo a deux échéances distinctes en base :
- **`expires_at`** — la promesse de l'offre (7/30/90 jours), fixée à l'envoi, **jamais reculée**.
- **`host_expires_at`** — la fin de la fenêtre Zernio ACTUELLE (toujours 7 jours), qu'un cron avance en
  retéléversant le fichier bien avant qu'elle ne se referme.

Un nouveau cron, `/api/cron/process-catalog-videos` (toutes les 4 à 6 heures), pour chaque vidéo encore dans sa
fenêtre de promesse mais dont la fenêtre Zernio approche (36 h de marge) : retélécharge le fichier depuis son URL
Zernio actuelle, redemande un presign, le renvoie, et avance `host_expires_at` de 7 jours de plus. Il s'arrête tout
seul une fois `expires_at` dépassée — la vidéo expire alors normalement, côté Zernio comme côté catalogue.

Une publication programmée vérifie les DEUX échéances (`assertVideoAvailableForPublication`) : si le renouvellement
a échoué et que la fenêtre Zernio est déjà close, la publication est refusée avec un message clair, plutôt que de
pointer vers un fichier mort.

**Risque réel, non vérifié** : un renouvellement charge le fichier ENTIER en mémoire (jusqu'à 200 Mo) avant de le
retéléverser. C'est le même mécanisme que celui déjà utilisé pour republier une vidéo sur Telegram/YouTube — pas une
nouveauté — mais jamais testé avec un vrai fichier proche de 200 Mo, et jamais sous la contrainte mémoire/temps d'une
fonction Vercel. Le cron traite 5 vidéos par passage (pas plus) précisément pour limiter ce risque. `maxDuration` est
fixé à 300 s dans le code : vérifie que ton forfait Vercel l'autorise, sinon réduis le lot et augmente la fréquence.

## 2. Ce qui est construit (le reste, inchangé depuis le rapport précédent)
- **TikTok** : `tiktok_auto_comments` = Pro. Même pipeline que Facebook/Instagram. Anti-spam par identifiant
  d'auteur quand Zernio le fournit. Détection `isOwnAccount` du commentaire (préférée à la détection par id/pseudo
  quand Zernio l'envoie). Filet de sécurité : un échec qui ressemble à un refus de permission sur un compte TikTok
  marque "reconnexion requise", désactive la réponse automatique sur ce compte, notifie l'admin — pour ne pas
  retenter en boucle. Bandeau visible dans Canaux. **La liste de mots qui déclenche ça n'est pas vérifiée avec de
  vraies erreurs Zernio.**
- **Domaine personnalisé** : retiré des forfaits, service à la demande ouvert à tous les plans, nouvelle page
  `/dashboard/domain`. `/admin/domains` : statut de paiement, impossible de marquer "enregistrée" sans "payé" —
  et marquer "enregistrée" crée maintenant réellement la ligne technique `tenant_domains` (c'était manuel en SQL
  jusqu'ici).
- **Badge** : visible sur Discover seulement, masqué dès Starter.
- **Telegram** : un groupe converti en supergroupe par Telegram change d'identifiant — la destination suit
  automatiquement (sans ça, la conversion cassait silencieusement la publication).
- **YouTube** : bouton "Reconnecter" par chaîne. Limite inhérente à Google : l'OAuth ne permet pas de cibler une
  chaîne précise depuis notre page, l'utilisateur choisit dans l'écran Google.

## 3. Non fait
- **Plusieurs numéros WhatsApp dédiés** (0/1/2 selon l'offre) : la clé existe dans `/admin/plans`, mais rien ne
  l'applique — le code actuel suppose un seul numéro par entreprise dans toute son architecture. Chantier à part
  entière, pas bâclé ici.
- Bouton "Vérifier" une destination Telegram, cadence d'envoi respectant les limites Telegram.
- DM TikTok dans la messagerie unifiée, réponse privée aux commentaires (options non demandées).
- Pas de test automatisé pour le téléchargement/retéléversement RÉEL d'un gros fichier (seules les fonctions pures
  et la logique du cron sont testées, avec des téléchargements/envois simulés) — un mock prouverait que le mock
  fonctionne, pas que Zernio et la mémoire serverless tiennent la charge. Le vrai test, c'est d'envoyer une vidéo
  volumineuse en conditions réelles avant d'ouvrir au public.
- Aucun `next build` lancé (Google Fonts injoignable dans mon environnement).

## 4. Fichiers
Réécrits : `catalog-video-service.ts` (modèle Zernio + renouvellement), `catalog-videos-panel.tsx`,
`app/api/cron/process-catalog-videos/route.ts`, migration `0067` (section vidéos), tests
`catalog-video-service.test.ts`, `catalog-video-cron.test.ts`.
Restauré : `createMediaPresign` dans le client Zernio (retiré puis réintroduit).
Inchangé depuis le rapport précédent : tout le reste (TikTok, domaine, badge, Telegram, YouTube — voir §2).
