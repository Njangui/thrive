# Vidéos du catalogue (Zernio, 7 jours)

Mis en place en sept. 2026. Migration : `0059_catalog_videos.sql`.

## Faits VÉRIFIÉS dans la doc Zernio (docs.zernio.com, sept. 2026)

| Sujet | Ce que dit la doc |
| --- | --- |
| Durée | « Uploads expire after 7 days » — stockage temporaire (`media.zernio.com/temp/…`). Zernio recommande de programmer les publications qui utilisent un upload **dans les 7 jours** suivant l'envoi. |
| Après publication | Quand une publication qui référence l'URL est publiée, Zernio **copie** le fichier vers un stockage permanent (pour la publication). La doc ne dit pas que l'URL temporaire reste valable au-delà de 7 jours : par prudence, l'application la considère indisponible à l'échéance. |
| Envoi | `POST /v1/media/presign` (`filename`, `contentType`, `size` facultatif) → `uploadUrl` (Cloudflare R2, valable 1 h) + `publicUrl`. Le navigateur fait un `PUT` avec le même `Content-Type`, sans `Authorization`. Jusqu'à 5 Go. |
| Formats vidéo | MP4, MPEG, MOV, AVI, WebM, M4V (l'application n'accepte que MP4 et MOV, communs à tous les canaux). |
| Taille | Au-delà de 200 Mo, Zernio « peut ne pas » compresser aux limites de chaque plateforme → plafond de 200 Mo dans l'application. |

## Qui publie quoi

| Canal | Qui publie | Quand la vidéo est relue chez Zernio | Limite des 7 jours |
| --- | --- | --- | --- |
| Instagram, TikTok, Facebook… | Zernio | À l'heure programmée, par Zernio | Oui — programmation refusée au-delà |
| Telegram | Notre serveur (bot du tenant) | Le jour J, par le cron `process-telegram-publications` : relit la vidéo chez Zernio puis la téléverse (≤ 50 Mo) | Oui |
| YouTube | Notre serveur → YouTube | À la programmation : téléversée chez YouTube en privé avec `publishAt` ; YouTube publie à l'heure dite | Non (le fichier n'est nécessaire qu'à l'instant de la programmation) |

Garde-fous : `catalog-video-service.ts` (`assertPublicationMediaAvailable`), appelé par `publishOmnichannel` (niveau global « le fichier existe maintenant », puis par cible pour la date), par l'exécuteur des publications Telegram programmées, et doublé côté écran par le composeur de publication.

## Affichage

- Fiche produit publique, section « En vidéo » de la page d'accueil, badge « ▶ Vidéo » du catalogue : **vidéos non expirées seulement** — elles disparaissent d'elles-mêmes à l'échéance.
- Back-office : panneau « Vidéos » sur les fiches produit et service (compte à rebours, badge « expirée », retéléversement).

## Points à vérifier en production

1. Envoi navigateur → R2 : si l'envoi échoue, vérifier la console (CSP `connect-src`, CORS du bucket Zernio).
2. Cron Telegram et publications vidéo : `maxDuration = 60` s ; selon le plan Vercel, la limite réelle peut être plus basse.
3. Telegram : limite du Bot API à 50 Mo par téléversement ; MOV/AVI/WebM sont envoyés comme documents (lecture intégrée seulement pour MP4).
