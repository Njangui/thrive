# Canaux sociaux — architecture flexco 

flexco  ne présente jamais le nom d'un fournisseur d'infrastructure dans le dashboard marchand.

## Périmètre

- Instagram / Facebook / LinkedIn / TikTok / X et autres réseaux pris en charge : connecteur social interchangeable.
- WhatsApp : connecteur de messagerie interchangeable.
- Telegram : **API Telegram directe**, sans connecteur social tiers.
- YouTube : **API YouTube/Google directe**, sans connecteur social tiers.

## Abstraction

Le code métier consomme `SocialPublishingProvider` et `MessagingProvider`. Le `ProviderRegistry` construit les adaptateurs actifs et peut les combiner via `CompositeSocialAdapter`.

Ainsi :

```text
Dashboard / CRM / Marketing
          |
          v
   Ports métier flexco 
          |
    Provider Registry
      /      |      \
 Social   YouTube   Telegram
 adapter   natif      natif
```

Remplacer un fournisseur social tiers ne demande donc pas de réécrire les écrans, le CRM, le catalogue ou le moteur marketing.

## YouTube direct

OAuth Google stocke le refresh token dans Supabase Vault. Le connecteur utilise YouTube Data API pour les vidéos et YouTube Analytics API pour les métriques quotidiennes. Les scopes sont limités aux besoins du module.

## Telegram direct

Le marchand crée son propre bot via BotFather. Le token est validé, stocké dans Vault et utilisé pour enregistrer un webhook dédié à l'organisation.

Le bot Telegram plateforme (`TELEGRAM_BOT_TOKEN`) reste séparé et sert uniquement aux alertes opérateur / Super Admin.
