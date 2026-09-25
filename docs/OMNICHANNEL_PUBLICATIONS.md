# Publications omnicanales flexco 

## Principe

La page `/dashboard/marketing/nouveau` est le point d'entrée unique pour publier depuis le catalogue.

Le commerçant :
1. sélectionne un ou plusieurs produits actifs ;
2. flexco  construit automatiquement le contenu (nom, prix, catégorie, description, URL et images) ;
3. sélectionne les destinations connectées ;
4. publie immédiatement ou programme la diffusion.

## Destinations

- Réseaux sociaux gérés par le connecteur social : Facebook, Instagram, LinkedIn, TikTok, X/Twitter et autres comptes réellement connectés, selon les capacités du compte.
- YouTube : publication directe via la connexion native YouTube. Une vidéo publique est nécessaire ; une simple image de catalogue ne suffit pas.
- Telegram : bot du commerçant connecté directement. Les conversations Telegram déjà connues sont proposées et un canal/groupe peut être renseigné manuellement avec son `@username` ou son identifiant numérique.
- WhatsApp : les groupes connectés et réellement activés sont disponibles pour la diffusion. Une diffusion vers un groupe WhatsApp exige qu'une conversation Zernio ait déjà été établie avec ce groupe.

## Programmation

- Social : `social_posts` + `social_post_targets` conservent le suivi par plateforme.
- Telegram : `telegram_publications` est traité par `/api/cron/process-telegram-publications`.
- WhatsApp groupes : le système existant `group_broadcasts` est utilisé par son cron.

## Pièces jointes Telegram entrantes

Le webhook tenant reconnaît maintenant :
- photos ;
- vidéos ;
- documents ;
- audio ;
- messages vocaux.

Le fichier est récupéré avec `getFile`, téléchargé depuis l'API Bot Telegram puis stocké dans le bucket média du tenant. Le message conserve dans `messages.metadata.attachment` l'URL, le type, le nom, le MIME et le `fileId`. L'inbox affiche un lien vers la pièce jointe.

La limite applicative est de 20 Mo par pièce jointe entrante, alignée sur la limite du Bot API utilisée par cette intégration.
