# SME-OS

Plateforme SaaS de gestion et d'automatisation commerciale pour petites
entreprises, commerçants et prestataires de services — pensée pour le
contexte camerounais (WhatsApp, FCFA, mobile-first).

**Principe fondamental** : une entreprise saisit ses données une fois
(catalogue, infos business). Ces données alimentent automatiquement la
landing page, WhatsApp, les publications sociales et les commandes — jamais
de ressaisie manuelle à plusieurs endroits.

> Ce projet a été construit par blocs successifs, chacun audité et
> documenté. Voir [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md) pour
> l'historique des décisions et arbitrages, notamment le passage d'une
> première vision (plateforme multi-tenant générique) à la vision actuelle
> (catalogue-first, discipline ROI stricte).

## Stack

- **Frontend/Backend** : Next.js 14 (App Router) + TypeScript strict
- **UI** : Tailwind CSS
- **Base de données** : Supabase (PostgreSQL + Auth + RLS)
- **Hébergement** : Vercel
- **Messaging & Social** : Zernio (WhatsApp + publication multi-réseaux)
- **IA** : Mistral (par défaut), Claude et OpenAI en adapters alternatifs
- **Tests** : Vitest

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour le détail de
l'architecture (hexagonale : domain / application / infrastructure).

## Démarrage

```bash
npm install
cp .env.example .env.local   # puis remplir avec vos vraies clés
```

1. Créer un projet Supabase, exécuter les migrations dans l'ordre :
   ```bash
   # via Supabase CLI, ou en collant chaque fichier dans le SQL Editor
   supabase/migrations/0001_core_tenancy.sql
   supabase/migrations/0002_rls_policies.sql
   ... (dans l'ordre numérique, voir docs/DATABASE.md)
   ```
2. Renseigner `.env.local` (voir `.env.example` — toutes les variables y
   sont documentées).
3. `npm run dev` — l'app tourne sur `http://localhost:3000`.
4. Créer un compte via `/login` (lien magique par email), puis `/onboarding`
   pour créer votre première entreprise.

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm run typecheck` | Vérification TypeScript stricte |
| `npm run lint` | ESLint |
| `npm test` | Suite de tests (Vitest) |

## Structure

```
src/
  app/                  Routes Next.js (App Router)
    (public)            Landing tenant, catalogue public, page produit
    dashboard/          Admin authentifié (KPIs, catalogue, finance, conversations)
    api/                Webhooks + routes admin (import CSV...)
  domain/               Entités métier, ports (interfaces), événements — zéro dépendance externe
  application/          Services applicatifs (orchestrateur, catalogue, finance...)
  infrastructure/       Adapters concrets (Zernio, Supabase, IA) — implémentent les ports
supabase/migrations/    Schéma SQL, dans l'ordre d'exécution
docs/                   Documentation détaillée (voir liste ci-dessous)
tests/                  Setup Vitest
```

## Documentation

- [`docs/GAP_ANALYSIS.md`](docs/GAP_ANALYSIS.md) — historique des décisions d'architecture/scope
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — couches, ports/adapters
- [`docs/DATABASE.md`](docs/DATABASE.md) — schéma, migrations, RLS
- [`docs/ZERNIO_INTEGRATION.md`](docs/ZERNIO_INTEGRATION.md) — ce qui est confirmé vs à vérifier avant prod
- [`docs/AI.md`](docs/AI.md) — AI Gateway, ordre de résolution (règles avant IA)
- [`docs/SECURITY.md`](docs/SECURITY.md) — RLS, secrets, vulnérabilités connues des dépendances
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — déploiement Vercel + Supabase
- [`docs/MVP_SCOPE.md`](docs/MVP_SCOPE.md) — ce qui est dans le MVP, ce qui est explicitement V2
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — ce qu'il reste à faire, y compris dans ce dépôt précis

## État actuel (honnête)

Le cœur du produit fonctionne de bout en bout, structurellement : signup →
création d'entreprise → catalogue → landing publique → WhatsApp (routeur
déterministe + IA en dernier recours) → human handoff → commande → revenu →
dashboard. Testé : 52 tests unitaires/logique (Vitest), typecheck strict,
build de production, lint — tous passants. **Non testé** : tout ce qui
touche réellement une instance Supabase (aucune instance de test connectée
dans l'environnement où ce projet a été construit) — voir
`docs/ROADMAP.md`.
