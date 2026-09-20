# Changements du 19 sept. 2026

> **Note de fusion #16** — changelog conservé tel que reçu, sauf les numéros de migration :
> à l'intégration, `0058` était déjà pris (WhatsApp Coexistence), donc `catalog_videos`
> est devenue `0059` et `landing_analytics` `0060` — les numéros cités ci-dessous sont
> ceux de ce dépôt. Voir `RAPPORT_FUSION_16.md`.

## Migrations à exécuter (dans l'ordre)
1. `supabase/migrations/0059_catalog_videos.sql` — table `catalog_videos`
2. `supabase/migrations/0060_landing_analytics.sql` — type d'événement `video_play` + index

## Correctifs
- Crédits IA consommés sans IA configurée (`ai-response-service.ts`)
- FAQ jamais déclenchée : correspondance par mots + FAQ/catalogue toujours actifs après une escalade « IA indisponible »
- Notifications sans son : push pour toutes les priorités, urgence haute, son + toast dans le dashboard ouvert, notification des messages sans réponse automatique
- « Score IA » renommé « Score d'engagement » (calcul par règle, sans IA)
- Permissions-Policy `microphone=(self)`, CSP `media-src`/`connect-src`, `serverActions.bodySizeLimit = 4mb`

## Nouveautés
- Messagerie : pièces jointes 📎 et messages vocaux 🎤
- Vidéos du catalogue hébergées chez Zernio (7 jours) — voir `docs/CATALOG_VIDEOS.md`
- Telegram / YouTube : la vidéo est relue chez Zernio puis publiée par notre serveur
- Page « Analytics vitrine » — voir `docs/LANDING_ANALYTICS.md`
- Nouveau logo (icônes PWA, apple-touch-icon, marque) ; cache du service worker passé en v2

## À faire à la main
- Remettre à zéro `used_credits` (table `ai_credit_balances`) pour rembourser les crédits consommés à tort
- Tester en conditions réelles : envoi navigateur → Zernio (CORS/CSP), vocal sur WhatsApp/Telegram, cron Telegram avec une vidéo
