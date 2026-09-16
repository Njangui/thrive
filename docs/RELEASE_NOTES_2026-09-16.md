# SME-OS — refonte console et automatisation — 16 septembre 2026

## Livré
- Guide contextuel `Guide` dans le dashboard marchand pour les écrans techniques.
- Relances CRM 24 h / 48 h avec table d'idempotence et cron sécurisé.
- IA positionnée en dernière étape de personnalisation des relances.
- YouTube sorti du périmètre du connecteur social tiers : OAuth Google + stockage Vault + adapter natif.
- Telegram marchand entièrement direct via BotFather + webhook dédié.
- Notifications Telegram Super Admin pour les actions majeures.
- Interface IA marchand débarrassée des noms de fournisseurs et paramètres techniques.
- Personnalisation avancée de la landing : presets secteur, hero, sous-titre, CTA, style visuel.
- Nouvelle présentation du catalogue avec indicateurs et hiérarchie visuelle renforcée.
- Harmonisation globale des cartes, tableaux, titres et responsive dans la console marchand.

## Variables supplémentaires
```env
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_OAUTH_STATE_SECRET=
```

## Cron
Appeler régulièrement :
`GET /api/cron/process-follow-ups`
avec `Authorization: Bearer <CRON_SECRET>`.

Une fréquence de 15 minutes convient : le moteur applique lui-même les échéances 24 h / 48 h.
