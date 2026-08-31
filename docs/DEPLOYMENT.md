# Déploiement

## Prérequis

- Un projet Supabase (Postgres + Auth activés)
- Un compte Zernio avec au moins un profile + un compte WhatsApp connecté
- Une clé API Mistral (ou Claude/OpenAI) si l'IA doit être activée
- Un compte Vercel

## 1. Base de données

Exécuter les migrations de `supabase/migrations/` **dans l'ordre
numérique** (0001 → 0017 à ce jour — voir `docs/DATABASE.md` et
`RAPPORT_FUSION.md` pour le détail de la fusion multi-lots), via le SQL
Editor Supabase ou la CLI :

```bash
supabase link --project-ref <votre-ref>
supabase db push
```

### Bucket de médias tenant (Lot E)

La migration `0013_storage_tenant_media_bucket.sql` crée le bucket et ses
policies via SQL sur `storage.buckets`/`storage.objects`. **Si votre
projet Supabase ne permet pas d'exécuter du SQL sur ces tables** (certains
plans/rôles restreignent l'accès direct au schéma `storage`), procédure
manuelle équivalente depuis le Dashboard Supabase :

1. **Storage → New bucket** : nom `tenant-media`, coché **Public**,
   limite de taille de fichier `5 MB`.
2. **Storage → tenant-media → Policies** : créer 4 policies (SELECT,
   INSERT, UPDATE, DELETE) avec pour condition, sur chacune :
   ```sql
   bucket_id = 'tenant-media' AND is_member_of_org((storage.foldername(name))[1]::uuid)
   ```
   (`is_member_of_org` existe déjà depuis `0002_rls_policies.sql`.)
3. Vérifier que le bucket est bien listé comme **Public** dans
   Storage → Configuration — nécessaire pour que les images produit/logo/
   bannière/favicon s'affichent sur la vitrine publique sans authentification.

Sans ce bucket, `getStorageProvider()` fonctionnera toujours (aucune
erreur au démarrage) mais tout upload échouera avec un message explicite
("Échec de l'upload...") — jamais silencieusement.

## 2. Variables d'environnement

Toutes documentées dans `.env.example`. Sur Vercel : Project Settings →
Environment Variables. Ne jamais committer `.env.local`.

Minimum pour un déploiement fonctionnel (sans IA ni Zernio, juste le
dashboard/catalogue/finance) :
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL
```

Pour activer WhatsApp : `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SIGNING_SECRET`.
Pour activer l'IA : `MISTRAL_API_KEY` (ou l'équivalent du provider choisi),
puis activer `ai_config.enabled = true` pour le tenant concerné.

## 3. Webhook Zernio

Configurer dans le dashboard Zernio une souscription webhook pointant
vers `https://votre-domaine.com/api/webhooks/zernio`, en cochant au
minimum les événements `message.received` (et, pour la Phase Marketing,
les événements `post.*` — non encore branchés côté sync, voir
`docs/ROADMAP.md`).

Utiliser la fonctionnalité "Test webhook" du dashboard Zernio avant
d'aller en prod, pour confirmer le format exact des payloads (voir
`docs/ZERNIO_INTEGRATION.md`).

## 4. Déploiement Vercel

```bash
vercel --prod
```

Ou connecter le repo GitHub directement dans Vercel (déploiement auto sur
push).

## 5. Domaines custom par tenant

`middleware.ts` gère déjà la résolution par sous-domaine
(`tenant.sme-os.app`). Pour un domaine client (`client.com`) :
1. Le commerçant pointe son DNS vers Vercel
2. Ajouter le domaine dans Vercel (Project Settings → Domains)
3. Créer la ligne correspondante dans `tenant_domains` (`verified: true`)

## 6. Console Super Admin (`/admin/*`)

La console plateforme (Lot C) n'a **aucune UI de self-service** pour
devenir super admin, volontairement — c'est la surface la plus sensible
du projet. En V1, devenir super admin = insertion manuelle en base,
après avoir créé un compte normal via le flux d'auth habituel :

```sql
insert into platform_admins (user_id, role)
values ('<uuid de l'utilisateur dans auth.users>', 'super_admin');
```

Pas de policy RLS `select`/`update` sur `platform_admins` pour les
clients — cette table n'est lisible que par le service-role, exclusivement
via `requirePlatformAdmin()` côté serveur (voir
`src/application/services/platform-admin-service.ts` et
`supabase/migrations/0015_platform_admins.sql`). Un utilisateur qui
n'est pas dans cette table reçoit un 404 générique sur tout `/admin/*`
(pas de page "Accès refusé" qui confirmerait l'existence de la console).

## 7. Avant la vraie mise en production

- [ ] Exécuter les tests contre un vrai projet Supabase de test (voir `docs/ROADMAP.md`)
- [ ] Confirmer les payloads webhook Zernio réels (section précédente)
- [ ] Remplacer la résolution de credentials mono-tenant par une vraie
      résolution per-tenant si plusieurs comptes Zernio/IA distincts sont
      nécessaires (voir `docs/SECURITY.md`)
- [ ] Vérifier le test de sécurité multi-tenant (tenant A ne peut pas lire
      les données de tenant B) contre la vraie instance
- [ ] Confirmer que le bucket `tenant-media` existe et est public (Lot E —
      voir section 1 ci-dessus) avant d'annoncer l'upload de médias comme
      disponible aux commerçants
- [ ] Le service worker (`public/sw.js`) et le manifest PWA nécessitent
      HTTPS pour être actifs (hors `localhost`) — tester l'installabilité
      sur le domaine de prod réel, pas seulement en local
