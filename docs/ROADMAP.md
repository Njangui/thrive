# Roadmap

## Immédiat — ce qui manque encore dans CE dépôt

Par ordre de valeur décroissante :

1. **Vérification en conditions réelles.** Tout ce qui touche Supabase
   (création produit, onboarding, dashboard queries, RLS) est écrit
   proprement et typé strict, mais n'a jamais tourné contre une vraie
   instance — aucune n'était disponible dans l'environnement où ce projet
   a été construit. C'est la priorité absolue avant toute démo réelle.
2. **Sync webhooks `post.*`** — on programme des publications sociales
   mais on n'apprend pas encore automatiquement leur résultat
   (published/failed/partial). Actuellement il faut vérifier côté
   dashboard Zernio. Nécessite d'étendre `app/api/webhooks/zernio/route.ts`
   pour distinguer catégorie Inbox vs Post (même endpoint, `event` field
   différent).
3. **Analytics / Top Publications** (section 32) — `getAnalytics` existe
   côté `SocialPublishingProvider`, pas encore d'écran dashboard.
4. **Confirmation des payloads Zernio réels** — voir `docs/ZERNIO_INTEGRATION.md`.
5. **Résolution de credentials per-tenant** — nécessaire dès qu'un 2e
   tenant avec son propre compte Zernio/IA est onboardé (voir `docs/SECURITY.md`).
6. **Écrans admin manquants** : édition de produit (seule la création
   existe), gestion des rendez-vous, configuration IA depuis le dashboard
   (actuellement `ai_config` ne se modifie qu'en SQL direct), gestion des
   comptes/rôles d'équipe.
7. **Contexte conversationnel court** (section 21) — résolution de
   référence ("celle à 25 000" → le produit mentionné juste avant).

## V2 (documenté, volontairement pas construit — voir `docs/MVP_SCOPE.md`)

- Groupes WhatsApp
- AI Recommendations / AI Insights
- Analytics avancées
- Automatisations avancées (trigger/condition/action génériques)
- Segmentation, scoring de lead avancé
- Campagnes marketing avancées
- Paiement intégré
- Fonctionnalités financières avancées (comptabilité complète)
- Autres intégrations

## Tests restants avant une vraie mise en production

Voir `docs/DEPLOYMENT.md` section "Avant la vraie mise en production" et
`docs/SECURITY.md` pour le test d'isolation multi-tenant en particulier.
