-- ============================================================
-- 0023_analytics_events.sql
-- Lot H, Partie 2 — Analytics de base (master prompt section 55-56).
-- Le master prompt est explicite : "le MVP doit rester simple", pas de
-- funnels/cohortes/A-B testing (docs/ROADMAP.md exclut déjà "Analytics
-- avancées" du V1). Cette table ne fait qu'une chose : compter des
-- événements bruts par type, pour affichage direct (getAnalyticsSummary,
-- analytics-service.ts) — aucune table de session/funnel à côté.
-- ============================================================

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_type text not null check (event_type in (
    'page_view',
    'product_view',
    'product_click',
    'cta_click',
    'lead_created',
    'conversation_started',
    'order_created',
    'publication_published'
  )),
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- L'agrégation par (org, type, fenêtre de temps) est la seule requête qui
-- compte réellement (getAnalyticsSummary/getPlatformUsageByOrganization) —
-- pas la lecture ligne à ligne. Index composite dans cet ordre précis pour
-- que Postgres puisse satisfaire `eq(organization_id).eq(event_type).gte(created_at)`
-- avec un seul scan d'index.
create index idx_analytics_events_org_type_date
  on analytics_events(organization_id, event_type, created_at);

comment on table analytics_events is
  'Lot H — événements bruts (vue de page, vue produit, clic CTA, lead créé, '
  'commande créée, publication diffusée...). Écriture EXCLUSIVEMENT via '
  'service-role (application/services/analytics-service.ts::trackEvent) — '
  'jamais depuis le navigateur avec la clé anon, pour éviter la '
  'falsification triviale d''événements (voir policies RLS ci-dessous : '
  'aucune policy INSERT pour le rôle authentifié/anon, même pattern que '
  'webhook_events, 0006_webhooks_and_audit.sql).';

comment on column analytics_events.entity_id is
  'Référence libre (product_id, order_id, lead_id, social_post_id...) selon '
  'entity_type — pas de foreign key stricte : un événement analytics ne '
  'doit jamais échouer à s''écrire parce que l''entité référencée a été '
  'supprimée entre-temps (contrairement à audit_logs qui, lui, documente '
  'une action encore pertinente au moment où elle est écrite).';

alter table analytics_events enable row level security;

-- Lecture : membres de l'organisation uniquement (même pattern que
-- audit_logs, 0006_webhooks_and_audit.sql). Écriture : AUCUNE policy pour
-- authenticated/anon — seul le service-role (qui bypass RLS) peut insérer,
-- ce qui est le comportement voulu, pas un oubli.
create policy "members can read analytics_events of their org"
  on analytics_events for select
  using (is_member_of_org(organization_id));
