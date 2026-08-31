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
| `0019`-`0021` | Réservées au Lot G (non fusionné à ce jour) |
| `0022_seo_fields.sql` | `organizations.seo_title`/`seo_description`/`seo_og_image_url`, `products.seo_title`/`seo_description` (Lot H) — repli géré par `src/lib/seo.ts`, jamais lu comme source de vérité brute |
| `0023_analytics_events.sql` | `analytics_events` (Lot H) — événements bruts (vue de page, clic CTA, lead/commande créés, publication diffusée...), écriture service-role uniquement, voir `analytics-service.ts` |
| `0024_push_subscriptions.sql` | `push_subscriptions` (Lot I) — souscriptions Web Push par utilisateur/organisation |
| `0025_onboarding_progress.sql` | `organizations.onboarding_step`/`onboarding_completed_at` (Lot I) — inclut un `UPDATE` rétroactif pour les organisations déjà existantes, voir `RAPPORT_LOT_I.md` |
| `0026_social_comments.sql` | `social_comments` (Lot I) — lecture/réponse aux commentaires sociaux, capacités confirmées Facebook/Instagram/Threads uniquement |
| `0030_performance_indexes.sql` | 5 index ciblés sur des requêtes réelles (voir `RAPPORT_OPTIMISATION.md`) — numérotée hors de la plage 0018-0026 réservée aux Lots F-J pour ne provoquer aucune collision |

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
> collision — Lots F, H, I fusionnés à ce jour (0018, 0022-0023,
> 0024-0026), Lots G et J restent réservés/en attente (0019-0021,
> au-delà de 0026).

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

## Idempotence webhooks

`webhook_events` a une contrainte unique `(provider, external_event_id)`.
Le handler insère AVANT tout traitement métier ; en cas de
`unique_violation` (code Postgres `23505`), l'événement est ignoré comme
doublon.
