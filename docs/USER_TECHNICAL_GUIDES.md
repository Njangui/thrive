# Guides techniques visibles côté marchand

CRESYVA masque volontairement les fournisseurs et détails d'infrastructure. L'utilisateur doit voir **quoi faire**, pas « quel API/SDK tourne derrière ».

## Connexion Telegram marchand
1. Ouvrir `Canaux → Telegram`.
2. Dans Telegram, ouvrir `@BotFather` et lancer `/newbot`.
3. Choisir le nom et le username du bot.
4. Copier le token fourni par Telegram.
5. Le coller dans CRESYVA puis cliquer `Connecter mon bot`.
6. CRESYVA vérifie le token et configure le webhook automatiquement.

Le token n'est jamais affiché après connexion et est conservé dans Supabase Vault.

## Connexion YouTube
1. Ouvrir `Canaux → YouTube`.
2. Cliquer `Connecter YouTube`.
3. Choisir le compte Google propriétaire de la chaîne.
4. Autoriser les permissions demandées.
5. Revenir automatiquement dans CRESYVA.

YouTube est un connecteur natif séparé des autres réseaux. Les futures évolutions ne nécessitent pas de modifier le CRM ou le moteur marketing.

## Relances clients
- Engagement élevé : relance à partir de 24 h sans nouvelle réponse.
- Engagement standard : relance à partir de 48 h.
- Une réponse du client annule la relance en attente.
- Le système utilise d'abord des règles et des messages déterministes.
- L'IA n'intervient qu'après cette étape pour personnaliser le texte et ne décide pas qui doit être relancé.
- Les clients `customer` et `lost` sont exclus.

Le traitement est idempotent : une même relance ne doit pas être envoyée deux fois pour la même étape.

## Telegram opérateur (Super Admin)
Le bot Telegram plateforme utilise :
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`
- `TELEGRAM_BOT_WEBHOOK_SECRET` pour les webhooks entrants lorsque le bot en utilise un.

Les alertes opérateur restent best-effort. Une panne Telegram ne doit jamais bloquer une opération métier.

Les alertes ciblent les événements importants (paiement, nouvelle commande, nouveau prospect, rupture, domaine, affiliation/fraude, changements administratifs majeurs), pas chaque log technique.

## Architecture remplaçable
Les services métier dépendent de ports (`MessagingProvider`, `SocialPublishingProvider`, `AIProvider`) et non des fournisseurs concrets.

- Telegram marchand : adapter natif Telegram.
- YouTube : adapter natif Google/YouTube.
- Autres réseaux sociaux : adaptateurs spécialisés.
- Une façade composite peut répartir une publication entre plusieurs adaptateurs.

Pour remplacer progressivement un fournisseur social tiers, il suffit donc de remplacer/ajouter l'adaptateur et le routage du Provider Registry. Les pages CRM, catalogue, commandes et conversations restent inchangées.
