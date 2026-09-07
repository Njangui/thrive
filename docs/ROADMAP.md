# Roadmap

> Réécrit intégralement à la fusion des Lots 1/2/4 (RAPPORT_FUSION_6.md,
> périmètre hérité du Lot O). L'ancienne version de ce fichier datait de
> la toute première vague (B-E) et listait comme "manquant" une dizaine
> de choses déjà construites depuis (sync webhooks `post.*`, groupes
> WhatsApp, écran édition produit, config IA dashboard, rendez-vous,
> gestion d'équipe, mémoire conversationnelle courte...) — le code réel
> fait foi, pas cette liste.

## Ce qui reste réellement ouvert

Par ordre de valeur décroissante :

1. **Lot 3 (WhatsApp/conversations/IA/groupes/publications sociales)
   pas encore fusionné** — le master prompt d'audit a été découpé en 4
   lots parallèles ; 1, 2 et 4 sont fusionnés et vérifiés
   (`RAPPORT_FUSION_6.md`), le Lot 3 doit encore être livré. En
   attendant, tout ce périmètre fonctionne dans l'état hérité des
   vagues précédentes (B, D, F, I, M) — voir `COMPARAISON_MASTER_PROMPT.md`
   pour le détail de ce qui y est déjà solide vs à auditer.
2. **Vérification en conditions réelles.** `tests/integration/
   tenant-isolation.test.ts` existe maintenant et couvre les 24 tables
   tenant-scoped du projet, mais n'a jamais tourné : il attend un vrai
   projet Supabase dédié aux tests (`npm run test:integration`, voir
   l'en-tête du fichier pour les 3 variables d'environnement requises).
   C'est la priorité absolue avant toute mise en production réelle.
3. **Gestion FAQ et informations business depuis le dashboard** — les
   deux existent en base (`faqs`, colonnes `organizations.phone/
   address/opening_hours/...`) et sont lues par le routeur IA/la
   landing publique, mais ne s'éditent aujourd'hui qu'en SQL direct.
   Identifié à la fusion des Lots 1/2/4, hors du périmètre explicite
   des 4 lots de cette vague (voir `docs/MVP_SCOPE.md`).
4. **Écran analytics dédié** (top publications, `getAnalytics` déjà
   exposé côté `SocialPublishingProvider`) — la page d'accueil dashboard
   affiche déjà des compteurs globaux, pas encore de vue détaillée par
   publication.
5. **Recherche/filtre sur la liste de produits du dashboard**
   (identifié Lot 2, non construit faute de temps).
6. **Achat automatisé de domaine/numéro de téléphone** auprès d'un
   registrar/opérateur réel — le workflow manuel + l'abstraction
   provider existent (`DomainProvider`, inventaire `phone_numbers`),
   aucun fournisseur n'est branché en direct. `BLOCKED_EXTERNAL` par
   nature, pas un oubli.
7. **Seed de démo** (`npm run seed:demo`, "Mode Élégance") construit à
   cette fusion — jamais encore exécuté contre une vraie instance
   Supabase (même limite que le point 2 : nécessite un vrai projet).

## V2 (documenté, volontairement pas construit — voir `docs/MVP_SCOPE.md`)

- AI Recommendations / AI Insights, machine learning prédictif
- Analytics avancées (BI, A/B testing)
- Automatisations avancées (trigger/condition/action génériques)
- Segmentation, scoring de lead prédictif
- ERP, comptabilité complète
- Constructeur de site drag-and-drop libre (façon Webflow)
- Telegram, messages vocaux avancés, marketplace, application mobile
  native

## Avant une vraie mise en production

Voir `docs/DEPLOYMENT.md` section "Avant la vraie mise en production" et
`docs/SECURITY.md`. Résumé des points qui dépendent d'un accès réseau
réel (jamais disponible dans l'environnement où ce projet a été
construit, lot après lot) :

- Faire tourner `npm run test:integration` contre un vrai projet
  Supabase de test (point 2 ci-dessus).
- Faire tourner `npm run seed:demo` pour valider la démo de bout en
  bout (point 7 ci-dessus).
- Confirmer les payloads Zernio réels contre l'API — voir
  `docs/ZERNIO_INTEGRATION.md`.
- Configurer `CRON_SECRET` en production (refus fail-safe déjà en place
  si absent, voir `docs/SECURITY.md` — mais encore faut-il le renseigner
  réellement avant le premier déploiement).
