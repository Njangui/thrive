# Déploiement

## Prérequis

- Un projet Supabase (Postgres + Auth activés)
- Un compte Zernio avec au moins un profile + un compte WhatsApp connecté
- Une clé API Mistral (ou Claude/OpenAI) si l'IA doit être activée
- Un compte Vercel

## 1. Base de données

Exécuter les migrations de `supabase/migrations/` **dans l'ordre
numérique** (0001 → 0026 à ce jour — voir `docs/DATABASE.md` et
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
puis activer `ai_config.enabled = true` pour le tenant concerné, ou le
configurer directement depuis `/dashboard/ai` (Lot L).
Pour les invitations d'équipe par email : `RESEND_API_KEY`/
`EMAIL_FROM_ADDRESS` (Lot L) — optionnel, repli console sinon.
Pour la recherche de domaine en direct : `OPENPROVIDER_USERNAME`/
`OPENPROVIDER_PASSWORD` (Lot N) — optionnel, repli manuel sinon.

## 2bis. Connexion Google (OAuth)

`/login` et `/signup` proposent un bouton "Continuer avec Google" (section
95, sept. 2026). Le code applicatif ne suffit pas : le provider doit être
activé côté Supabase, sinon `signInWithOAuth({ provider: "google" })`
échoue immédiatement (aucune variable d'environnement supplémentaire côté
app — tout se configure dans le dashboard Supabase).

1. **Google Cloud Console** (console.cloud.google.com) → APIs & Services
   → Credentials → Create Credentials → OAuth client ID → type
   "Application Web". Dans "Authorized redirect URIs", ajouter EXACTEMENT
   l'URL que Supabase affiche à l'étape suivante (`.../auth/v1/callback`)
   — jamais l'URL `/auth/callback` de ce dépôt, qui est une étape
   ultérieure et distincte du flux.
2. **Supabase Dashboard** → Authentication → Providers → Google → activer,
   coller le Client ID et le Client Secret obtenus à l'étape 1.
3. **Supabase Dashboard** → Authentication → URL Configuration →
   Redirect URLs : ajouter `https://votre-domaine.com/auth/callback` (et
   `http://localhost:3000/auth/callback` en dev) — sans cette entrée,
   Supabase refuse le `redirectTo` envoyé par l'app et le flux échoue
   silencieusement après le consentement Google.

Aucune autre modification nécessaire : `/auth/callback` (déjà existant,
utilisé aussi par le magic link et la réinitialisation de mot de passe)
gère l'échange du code de façon identique quel que soit le provider.

## 3. Webhook Zernio

Configurer dans le dashboard Zernio une souscription webhook pointant
vers `https://votre-domaine.com/api/webhooks/zernio`, en cochant au
minimum les événements `message.received` et `post.*` (statuts de
publication sociale — synchronisation réelle depuis le Lot M, voir
`docs/ZERNIO_INTEGRATION.md`).

Utiliser la fonctionnalité "Test webhook" du dashboard Zernio avant
d'aller en prod, pour confirmer le format exact des payloads (voir
`docs/ZERNIO_INTEGRATION.md`).

## 3bis. Webhook NotchPay (Lot G)

Configurer dans Settings > Webhooks du dashboard NotchPay
(business.notchpay.co) une souscription pointant vers
`https://votre-domaine.com/api/webhooks/notchpay`. Le secret de signature
qui y est affiché va dans `NOTCHPAY_WEBHOOK_SECRET` (**distinct** de
`NOTCHPAY_API_KEY`). Le webhook n'est jamais cru sur parole : chaque
paiement confirmé est re-vérifié via l'API NotchPay avant tout crédit —
voir `docs/PAYMENT_INTEGRATION.md` pour le détail des verdicts
SUPPORTED/PARTIAL/NOT_SUPPORTED (paiement récurrent réel et remboursement
via API : NOT_SUPPORTED, aucune ressource "subscription"/"refund" dans
l'API NotchPay).

## 4. Déploiement Vercel

```bash
vercel --prod
```

Ou connecter le repo GitHub directement dans Vercel (déploiement auto sur
push).

## 4bis. Diffusions groupées WhatsApp (Lot F) — cron externe

`app/api/cron/process-broadcasts/route.ts` traite les diffusions
programmées (`group_broadcasts.scheduled_at <= now()`). Aucun scheduler
interne ne l'appelle tout seul — il faut le déclencher périodiquement de
l'extérieur (Vercel Cron, ou un service gratuit comme cron-job.org) :

1. Définir `CRON_SECRET` dans les variables d'environnement (une valeur
   aléatoire longue — `openssl rand -hex 32`, par exemple). Sans elle, la
   route reste fonctionnelle mais accessible sans authentification (un
   avertissement est loggé à chaque appel — voir `route.ts`).
2. Programmer un appel `GET` (ou `POST`) toutes les 5 à 15 minutes vers
   `https://votre-domaine.com/api/cron/process-broadcasts`, avec l'en-tête :
   ```
   Authorization: Bearer <CRON_SECRET>
   ```
3. La réponse JSON (`{ ok, processedBroadcasts, sentTargets, failedTargets }`)
   permet de vérifier rapidement que le cron tourne.

**Attention** : à ce jour, `sentTargets` restera à 0 pour toute diffusion
vers un groupe fraîchement connecté — voir `docs/ZERNIO_INTEGRATION.md`,
section "Groupes WhatsApp", pour la limitation réelle et documentée de
l'API Zernio (pas un bug de cette route).

## 4ter. Publications Telegram programmées — cron externe

`app/api/cron/process-telegram-publications/route.ts` envoie les publications Telegram dont `scheduled_for` est arrivé. Configurez le même `CRON_SECRET` que les autres routes cron.

1. Appeler `GET` ou `POST` toutes les 1 à 5 minutes vers `/api/cron/process-telegram-publications`.
2. Envoyer `Authorization: Bearer <CRON_SECRET>`.
3. Vérifier la réponse JSON `{ ok, sent, failed, skipped }`.

Une publication en échec est conservée avec son message d'erreur et déclenche une notification commerçant.

## 4ter. Réconciliation des paiements NotchPay (section 62, 07/09/2026) — cron externe

`app/api/cron/process-payment-reconciliation/route.ts` reprend tout
paiement resté `pending` plus de 20 minutes et le revérifie directement
auprès de l'API NotchPay — filet de sécurité pour le cas où le webhook
NotchPay n'est simplement jamais arrivé (livraison échouée, endpoint
indisponible au mauvais moment) : sans ce job, un tel paiement resterait
`pending` indéfiniment bien que le client ait réellement payé.

Même mise en place que `process-broadcasts` ci-dessus (même
`CRON_SECRET`) :
1. Programmer un appel `GET` (ou `POST`) toutes les 15 à 30 minutes vers
   `https://votre-domaine.com/api/cron/process-payment-reconciliation`,
   avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.
2. La réponse JSON (`{ ok, checked, completed, failed, stillPending }`)
   permet de vérifier rapidement que le cron tourne et de repérer un
   volume anormal de paiements bloqués.

## 4quater. Numéros WhatsApp dédiés aux Groupes (Coexistence) — cron externe

Depuis le lot WhatsApp Coexistence (migration `0058_whatsapp_coexistence_dedicated_numbers.sql`),
la messagerie WhatsApp 1:1 passe en Coexistence et les **Groupes** exigent un
second numéro, dédié (voir l'en-tête de la migration pour le contexte produit
complet). Un commerçant peut soit connecter lui-même son propre numéro
(gratuit), soit en demander un à la plateforme (loyer mensuel, séparé du
forfait ; un Super Admin l'assigne depuis `/admin/numbers`).

`app/api/cron/process-phone-number-renewals/route.ts` gère l'échéance de ces
loyers : relance J-3, puis **reprise automatique du numéro et suspension des
groupes qu'il alimente** si le loyer n'est pas renouvelé. Même mise en place que
`process-subscription-renewals` (même `CRON_SECRET`) :

1. Programmer un appel `GET` (ou `POST`) toutes les 1 à 4 heures vers
   `https://votre-domaine.com/api/cron/process-phone-number-renewals`, avec
   l'en-tête `Authorization: Bearer <CRON_SECRET>`.
2. Vérifier la réponse JSON `{ ok, remindersSent, reclaimed, skipped }`.

Sans ce déclencheur, la route existe mais rien ne s'exécute : aucun numéro loué
n'est relancé ni repris. Le prix mensuel se règle depuis `/admin/addons`
(affiché sur `/admin/numbers` ; valeur de repli : 5 000 FCFA).

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

Depuis la fusion #12 (sept. 2026), un utilisateur présent dans
`platform_admins` voit en plus un lien "Console Admin" apparaître dans
son propre dashboard marchand (`/dashboard`, groupe "Plateforme" en bas
de la nav) — simple confort d'accès pour un compte à la fois marchand et
admin plateforme, voir `getPlatformAdminStatus()` dans
`platform-admin-service.ts`. La protection réelle ci-dessus reste
strictement inchangée : ce lien n'est qu'un affichage conditionnel,
jamais une vérification de sécurité.

## 7. Avant la vraie mise en production

- [ ] Exécuter `npm run test:integration` contre un vrai projet Supabase
      de test dédié (voir l'en-tête de `tests/integration/
      tenant-isolation.test.ts` pour les 3 variables requises) — jamais
      encore exécuté à ce jour
- [ ] Confirmer les payloads webhook Zernio réels (section précédente)
- [ ] Confirmer que le bucket `tenant-media` existe et est public (Lot E —
      voir section 1 ci-dessus) avant d'annoncer l'upload de médias comme
      disponible aux commerçants
- [ ] Le service worker (`public/sw.js`) et le manifest PWA nécessitent
      HTTPS pour être actifs (hors `localhost`) — tester l'installabilité
      sur le domaine de prod réel, pas seulement en local
- [ ] Configurer `CRON_SECRET` et le déclencheur externe pour
      `/api/cron/process-broadcasts`, `/api/cron/process-subscription-renewals`
      ET `/api/cron/process-payment-reconciliation` (Lot F, Lot N, puis
      section 62 du 07/09/2026) — sans lui, ces trois routes refusent
      désormais la requête en production (`NODE_ENV === "production"`,
      correctif Lot 1, voir `docs/SECURITY.md`) plutôt que de l'accepter
      silencieusement
- [ ] Programmer aussi `/api/cron/process-phone-number-renewals` (toutes les
      1 à 4 h, même `CRON_SECRET`, section 4quater) — sans lui, aucun numéro
      WhatsApp dédié n'est relancé ni repris à échéance
- [ ] Configurer le webhook NotchPay + `NOTCHPAY_WEBHOOK_SECRET` (Lot G,
      section 3bis) avant d'annoncer le paiement d'abonnement/add-ons
- [ ] Vérifier l'activation carte bancaire NotchPay dans le dashboard du
      compte marchand de production (Mobile Money confirmé fonctionnel
      dès l'intégration, carte bancaire à confirmer par pays — voir
      `docs/PAYMENT_INTEGRATION.md`)
- [ ] Configurer `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS` (Lot L) avant
      d'annoncer les invitations d'équipe par email comme disponibles —
      sans clé, un repli console (log serveur) s'active automatiquement,
      jamais un crash, mais l'email n'est alors pas réellement envoyé
- [ ] Configurer `OPENPROVIDER_USERNAME`/`OPENPROVIDER_PASSWORD` (Lot N)
      pour activer la recherche réelle de disponibilité de domaine —
      sans ça, repli automatique sur le flux manuel (`ManualDomainAdapter`)
- [ ] Exécuter `npm run seed:demo` pour valider la démo "Mode Élégance"
      de bout en bout avant toute démonstration commerciale — jamais
      encore exécuté à ce jour (voir `docs/ROADMAP.md`)
