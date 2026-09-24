# tokoo  — modèle Telegram opérationnel

## 1. Les deux bots ne jouent pas le même rôle

### Bot plateforme / opérateur
Variables : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, `TELEGRAM_BOT_WEBHOOK_SECRET`.

Il appartient à tokoo  et sert à :
- notifier l'opérateur des événements majeurs de la plateforme ;
- conserver le parcours Telegram historique des affiliés (`/start`, `/mystats`, `/help`).

Il ne sert pas à discuter avec les clients d'un commerçant.

### Bot commerçant / tenant
Chaque entreprise crée son propre bot avec BotFather et colle son token dans `Dashboard → Canaux → Telegram`.

tokoo  :
1. vérifie le token avec `getMe` ;
2. stocke le token dans le coffre Supabase ;
3. crée un webhook unique pour ce bot ;
4. reçoit les messages entrants ;
5. les envoie dans le même pipeline de conversation que les autres canaux ;
6. permet à l'IA ou à un humain de répondre ;
7. permet désormais de publier immédiatement ou de programmer une publication vers un groupe/canal Telegram.

Telegram est donc indépendant de Zernio.

## 2. Limites Telegram importantes

- Un bot peut envoyer un message dans une conversation après que l'utilisateur a commencé à interagir avec lui.
- Pour un groupe, le bot doit être ajouté au groupe et avoir les droits nécessaires.
- Pour un canal, le bot doit être administrateur avec le droit de publier.
- Le bot ne peut pas récupérer arbitrairement le profil ou le numéro de téléphone d'un utilisateur.
- tokoo  gère actuellement les messages entrants texte dans le pipeline conversationnel ; les pièces jointes entrantes nécessitent encore un traitement média dédié. Les pièces jointes sortantes publiques (image/vidéo/audio/fichier) sont supportées par l'adapter Telegram.

## 3. Publications Telegram

Page : `/dashboard/marketing/nouveau`.

Le commerçant peut :
- écrire un texte ;
- fournir une URL média publique ;
- choisir un `@username` de canal ou un identifiant numérique de groupe/canal ;
- publier immédiatement ;
- programmer une date/heure.

Les programmations sont stockées dans `telegram_publications` et traitées par `/api/cron/process-telegram-publications`.

Le cron doit être appelé régulièrement, idéalement toutes les 1 à 5 minutes.

## 4. Configuration du bot opérateur

1. Créer le bot dans BotFather.
2. Récupérer le token.
3. Envoyer `/start` au bot depuis le compte ou groupe qui doit recevoir les alertes.
4. Avec `TELEGRAM_BOT_TOKEN` configuré, exécuter `npm run telegram:discover-chat` pour afficher les IDs de chats détectés.
5. Mettre l'ID choisi dans `TELEGRAM_ADMIN_CHAT_ID`.
6. Générer un secret avec `openssl rand -hex 32` et le placer dans `TELEGRAM_BOT_WEBHOOK_SECRET`.
7. Configurer `NEXT_PUBLIC_APP_URL`.
8. Exécuter `npm run telegram:setup` après le déploiement.

Le script configure le webhook vers `/api/webhooks/telegram` avec le secret Telegram et les mises à jour `message`.

## 5. Alertes opérateur configurées

| Événement | Message envoyé |
|---|---|
| Nouvelle entreprise | 🆕 tokoo  · Nouvelle entreprise + nom/pays/secteur |
| Entreprise suspendue | ⛔ tokoo  · Entreprise suspendue |
| Entreprise réactivée | ✅ tokoo  · Entreprise réactivée |
| Changement de forfait | 💳 tokoo  · Forfait modifié |
| Paiement confirmé | 💰 tokoo  · Paiement confirmé |
| Paiement échoué | ⚠️ tokoo  · Paiement échoué |
| Abonnement expiré | ⏰ tokoo  · Abonnement expiré |
| Connexion Telegram | 📲 tokoo  · Bot Telegram connecté |
| Déconnexion Telegram | 🔌 tokoo  · Bot Telegram déconnecté |
| Connexion fournisseur perdue | 🔴 tokoo  · Connexion fournisseur perdue |
| Candidature affilié | 🤝 tokoo  · Nouvelle candidature affilié |
| Fraude détectée | 🚨 tokoo  · Alerte anti-fraude |
| Demande de paiement affilié | 💸 tokoo  · Demande de paiement affilié |
| Paiement affilié effectué | 🏦 tokoo  · Paiement affilié effectué |
| Paiement affilié rejeté | ↩️ tokoo  · Paiement affilié rejeté |
| Domaine traité | 🌐 tokoo  · Domaine traité |

Aucun secret, token ou donnée de paiement sensible n'est envoyé dans Telegram.

## 6. Notifications commerçant

### In-app
Tous les événements métier importants sont persistés dans `notifications` et apparaissent dans le centre de notifications.

### Push
Les événements `important` et `critical` sont également envoyés aux appareils ayant activé les notifications PWA. Les événements `normal` restent in-app pour éviter le bruit.

| Action | Priorité | Message |
|---|---|---|
| Nouveau prospect | important | Nouveau prospect. — Un nouveau prospect vient d'être ajouté. |
| Nouvelle commande | critical | Nouvelle commande. — Commande de X FCFA reçue. |
| Conversation à reprendre | critical | Une conversation nécessite votre intervention. |
| Produit en rupture | important | Produit en rupture de stock. |
| Connexion canal perdue | critical | Connexion perdue. |
| Publication échouée | important | Publication échouée. |
| Diffusion WhatsApp échouée/partielle | important | Diffusion groupée partiellement/échouée. |
| Paiement abonnement échoué | critical | Paiement échoué. |
| Abonnement expire dans 3 jours | important | Votre abonnement expire dans 3 jours. |
| Abonnement expiré | critical | Abonnement expiré. |
| Abonnement activé | important | Abonnement activé. |
| Domaine échoué | important | Demande de domaine échouée. |
| Domaine enregistré | normal | Domaine enregistré. |
| Relance automatique envoyée | normal | Relance client envoyée. |
| Add-on activé | normal | Add-on activé. |

Le clic d'une notification doit ouvrir la page métier correspondante lorsqu'elle existe.
