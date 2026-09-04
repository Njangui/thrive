# Base de données

PostgreSQL via Supabase. Toutes les tables métier portent `organization_id`
et sont protégées par RLS (`is_member_of_org()` — voir migration 0002).

## Migrations (ordre d'exécution obligatoire)

| Fichier | Contenu |
|---|---|
| `0001_core_tenancy.sql` | `organizations`, `profiles`, `memberships`, `tenant_modules`, `tenant_domains` |
| `0002_rls_policies.sql` | Fonctions `is_member_of_org()`/`current_org_role()` + policies RLS |
| `0003_crm.sql` | `contacts`, `leads`, `lead_events`, `follow_up_tasks`, `conversations`, `messages` |
| `0004_revenue_light.sql` | `orders`, `order_items`, `payments`, `expenses`, `expense_categories`, `receivables` |
| `0005_providers_and_ai.sql` | `provider_connections`, `ai_config` |
| `0006_webhooks_and_audit.sql` | `webhook_events` (idempotence), `audit_logs` |
| `0007_inventory_appointments.sql` | `products` (version initiale), `inventory_movements`, `appointments` |
| `0008_catalog_faq_business.sql` | Catalogue complet (`categories`, `products` enrichi, `product_images`, `services`), `faqs`, extension `organizations` (business data), `notifications`, `revenues` |
| `0009_align_orders_status.sql` | Simplification `orders.status` (pending/confirmed/completed/cancelled) |
| `0010_marketing_social_publishing.sql` | `social_campaigns`, `social_posts`, `social_post_targets` |
| `0011_ai_credits.sql` | `ai_credit_balances`, `ai_credit_ledger` (Lot B) — solde et historique de crédits IA par entreprise |
| `0012_plans_entitlements.sql` | `plans`, `entitlements`, `organization_subscriptions` (Lot B) — source de vérité du plan/statut d'abonnement, remplace l'usage de `organizations.plan`/`trial_end` |
| `0013_storage_tenant_media_bucket.sql` | Bucket Supabase Storage `tenant-media` + policies (Lot E) — logos, bannières, favicons, photos produit |
| `0014_organizations_site_media.sql` | `organizations.logo_url`/`banner_url`/`favicon_url` (Lot E) — vitrine tenant |
| `0015_platform_admins.sql` | `platform_admins` — console Super Admin (Lot C), RLS activée sans aucune policy client (service-role uniquement) |
| `0016_conversation_memory.sql` | `conversations.last_mentioned_product_ids` (Lot D) — mémoire courte des derniers produits mentionnés |
| `0017_phone_numbers.sql` | `phone_numbers` — inventaire des numéros dédiés (Lot C, stub minimal en l'absence d'un Lot A construisant déjà cette table). Renumérotée de `0016` à `0017` à la fusion, collision avec la migration Lot D ci-dessus — voir `RAPPORT_FUSION.md` |
| `0018_whatsapp_groups.sql` | `whatsapp_groups`, `group_broadcasts`, `group_broadcast_targets`, `group_broadcast_products` (Lot F) — voir `RAPPORT_LOT_F.md` pour l'état réel de l'intégration Zernio (envoi partiel, hors scope tant que la réception de messages de groupe n'est pas câblée) |
| `0019_subscription_payments.sql` | `subscription_payments` (Lot G) — paiement d'abonnement NotchPay ET achat d'add-on, discriminés par `payment_type` (voir en-tête de la migration pour le raisonnement) |
| `0020_addons.sql` | `addons` (catalogue Super Admin), `organization_addons` (Lot G) |
| `0021_domain_pricing.sql` | `domain_tld_pricing`, `domain_requests` (Lot G) — achat de domaine 100% manuel tant qu'aucun registrar n'est sous contrat, voir `docs/PAYMENT_INTEGRATION.md` |
| `0022_seo_fields.sql` | `organizations.seo_title`/`seo_description`/`seo_og_image_url`, `products.seo_title`/`seo_description` (Lot H) — repli géré par `src/lib/seo.ts`, jamais lu comme source de vérité brute |
| `0023_analytics_events.sql` | `analytics_events` (Lot H) — événements bruts (vue de page, clic CTA, lead/commande créés, publication diffusée...), écriture service-role uniquement, voir `analytics-service.ts` |
| `0024_push_subscriptions.sql` | `push_subscriptions` (Lot I) — souscriptions Web Push par utilisateur/organisation |
| `0025_onboarding_progress.sql` | `organizations.onboarding_step`/`onboarding_completed_at` (Lot I) — inclut un `UPDATE` rétroactif pour les organisations déjà existantes, voir `RAPPORT_LOT_I.md` |
| `0026_social_comments.sql` | `social_comments` (Lot I) — lecture/réponse aux commentaires sociaux, capacités confirmées Facebook/Instagram/Threads uniquement |
| `0030_performance_indexes.sql` | 5 index ciblés sur des requêtes réelles (voir `RAPPORT_OPTIMISATION.md`) — numérotée hors de la plage 0018-0026 réservée aux Lots F-J pour ne provoquer aucune collision |
| `0031_landing_sections.sql` | `organization_landing_config` (sections activées/ordre/couleurs/police), `testimonials` (Lot K) — voir `RAPPORT_LOT_K.md` |
| `0033_team_invitations.sql` | `team_invitations` (Lot L) — invitations d'équipe par email, token à 256 bits, une seule "pending" par (org, email) (index partiel) |
| `0035_post_platform_id.sql` | `social_post_targets.platform_post_id` (Lot M) — id natif par plateforme renvoyé par Zernio (`platforms[].platformPostId`), distinct de l'URL publique déjà stockée |
| `0036_recurring_billing.sql` | `organization_subscriptions.last_renewal_reminder_sent_at` (Lot N) — garde-fou anti-spam pour la relance J-3 ; facturation récurrente construite côté application (NotchPay n'a pas de prélèvement automatique, voir `docs/PAYMENT_INTEGRATION.md`) |
| `0037_tenant_credentials.sql` | `provider_connections.credential_reference`, fonctions Vault `vault_create_secret`/`vault_read_secret`/`vault_update_secret`/`vault_delete_secret` (Lot N) — résolution de credentials PAR TENANT (Zernio/IA), réservées `service_role` |
| `0038_atomic_order_stock_transaction.sql` | `adjust_product_stock()`, `complete_order_transaction()` (Lot 1, audit sécurité/DB/stock) — corrige une race condition réelle (double complétion de commande / double décrément de stock sous appels concurrents) via verrouillage de ligne (`FOR UPDATE`) en transaction unique, réservées `service_role` |
| `0039_plan_whatsapp_groups_correction.sql` | Correction des limites `whatsapp_groups` du plan (2/5/10, alignées sur le master prompt) + nouvelle clé `whatsapp_groups_dedicated_bonus` (1/3/5, bonus numéro dédié) (Lot 4) — **renumérotée à la fusion** : livrée en `0038_*.sql` par le Lot 4, entrait en collision avec le fichier `0038_atomic_order_stock_transaction.sql` du Lot 1 (deux lots indépendants ayant pris le même numéro sans se voir) ; contenu inchangé, seuls le nom de fichier et son commentaire d'en-tête ont été mis à jour |

> Note (mise à jour Lot 1) : cette table listait encore, avant cet audit,
> les migrations jusqu'à `0033` seulement alors que `0035`-`0037`
> existaient déjà dans le dépôt (Lots M/N) — corrigé ici, section 81/98
> du master prompt ("le code est la source de vérité, la doc doit
> suivre"). Pas de trou de numérotation réel : `0034` n'a jamais été
> assigné à ce jour (voir `00_CONVENTIONS_COMMUNES_V3.md`, plage Lot L =
> 0033-0034, Lot L n'en a eu besoin que d'une).
>
> **Collision `0038` résolue à la fusion** (RAPPORT_FUSION_6.md) : le Lot
> 1 (audit sécurité/DB/stock) et le Lot 4 (Super Admin/abonnements) ont
> chacun livré un fichier `0038_*.sql` distinct, sans visibilité l'un sur
> l'autre. Le fichier du Lot 1 a gardé son numéro (premier appliqué dans
> l'ordre logique — le stock/commande est un socle dont le reste dépend),
> celui du Lot 4 a été renommé en `0039`. Même traitement que la
> collision `0016` déjà rencontrée et documentée dans `RAPPORT_FUSION.md`.
> Le Lot 3 (WhatsApp/IA/social), pas encore fusionné au moment d'écrire
> cette note, réservera très probablement lui aussi un numéro déjà bas
> (`0038`/`0039`) pour la même raison — à renuméroter en `0040`+ à sa
> fusion, ne JAMAIS appliquer deux migrations portant le même numéro.

> **Schéma des groupes WhatsApp (Lot F)** :
> ```
>   whatsapp_groups ── group_broadcasts ── group_broadcast_targets
>                              └── group_broadcast_products
> ```
> Statuts : `whatsapp_groups.status` = `connected` ⇄ `disconnected` (action
> du commerçant) / `error` (disparu côté Zernio, détecté par
> synchronisation) ; `group_broadcasts.status` = `scheduled` →
> `processing` → `completed`/`failed`, ou `cancelled` (uniquement depuis
> `scheduled`) ; `group_broadcast_targets.status` = `pending` →
> `sent`/`failed` (une ligne par GROUPE ciblé, jamais par produit — voir
> `RAPPORT_LOT_F.md`).

> **`organizations.plan`/`organizations.trial_end` sont vestigiaux depuis
> Lot B** : toujours présentes en base (aucune migration ne les
> supprime), mais plus lues/écrites par le code applicatif — la vérité du
> plan/abonnement vit désormais dans `organization_subscriptions`.
> `organizations.status`, en revanche, reste réelle et active : c'est le
> kill-switch plateforme du Super Admin (suspendre/activer), orthogonal
> à `organization_subscriptions.status` (facturation), et Lot B n'y
> touche jamais.

> Note numérotation : ce projet est développé en plusieurs lots parallèles
> (voir `00_CONVENTIONS_COMMUNES.md`). Après fusion de B/C/D/E (Lot A
> absent des livraisons reçues), la séquence 0001-0017 était complète sans
> trou ni collision restante — une seule renumérotation avait été
> nécessaire (`0016_phone_numbers.sql` → `0017`, collision avec Lot D),
> voir `RAPPORT_FUSION.md`. Une seconde vague de lots (F à J) a ensuite
> reçu des plages de numéros disjointes assignées à l'avance
> (`00_CONVENTIONS_COMMUNES_V2.md`) pour éviter de reproduire cette
> collision — Lots F, G, H, I fusionnés à ce jour (0018, 0019-0021,
> 0022-0023, 0024-0026), séquence 0001-0026 complète sans trou. Lot J
> reste attendu (au-delà de 0026).

## Entités centrales

```
organizations (= tenant / business)
  ├── memberships (user <-> org, rôle)
  ├── tenant_modules (modules activés)
  ├── categories
  ├── products ──── product_images
  │      └── inventory_movements
  ├── services
  ├── faqs
  ├── contacts
  │      ├── leads ── lead_events, follow_up_tasks
  │      └── conversations ── messages
  ├── orders ── order_items
  ├── payments, revenues, expenses, receivables
  ├── social_campaigns ── social_posts ── social_post_targets
  ├── whatsapp_groups ── group_broadcasts ── group_broadcast_targets
  │                              └── group_broadcast_products
  ├── team_invitations (Lot L — invitations, distinct de memberships)
  ├── provider_connections, ai_config
  ├── webhook_events, audit_logs, notifications
```

## RLS — comment ça marche

```sql
create or replace function is_member_of_org(target_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from memberships m
    where m.organization_id = target_org_id and m.user_id = auth.uid()
  );
$$;
```

Chaque table applique `using (is_member_of_org(organization_id))`. Le
`service_role` (webhooks, onboarding) bypass RLS par design Supabase —
raison pour laquelle tout code utilisant `service_role` filtre lui-même
explicitement par `organization_id` (voir commentaire dans
`infrastructure/supabase/server-client.ts`).

## Statuts importants (jamais de suppression, transitions uniquement)

- `products.status` : `draft` → `active` ⇄ `out_of_stock`, ou `inactive`.
  Jamais de `DELETE` sur un produit vendu.
- `orders.status` : `pending` → `confirmed` → `completed`, ou `cancelled`.
- `social_posts.status` : `draft` → `scheduled` → `published`/`failed`/`partial`,
  ou `paused` (produit devenu indisponible), ou `cancelled`.
- `conversations.handoff_status` : `ai` ⇄ `pending_human` → `human` → `resolved`.
- `team_invitations.status` (Lot L) : `pending` → `accepted`/`revoked`/`expired`.
  Revérifié à CHAQUE usage de `acceptInvitation` (jamais mis en cache) — un
  index partiel garantit une seule invitation `pending` par (org, email).
- `lead_status` réel (0003_crm.sql) : `visitor` → `lead` → `qualified` →
  `opportunity` → `customer`, ou `lost`. Le cahier Lot L citait par erreur
  `new/contacted/interested/customer/lost` — non repris, voir `RAPPORT_LOT_L.md`.

## Idempotence webhooks

`webhook_events` a une contrainte unique `(provider, external_event_id)`.
Le handler insère AVANT tout traitement métier ; en cas de
`unique_violation` (code Postgres `23505`), l'événement est ignoré comme
doublon.
