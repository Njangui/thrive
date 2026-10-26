-- ============================================================
-- 0181_c5_broadcast_cost_templates.sql
-- C5 — diffusion : trace d'annulation, modèle WhatsApp choisi, estimation de
-- coût figée au moment de la création (affichée AVANT l'envoi), palier du
-- numéro WhatsApp par tenant.
-- ============================================================
alter table contact_broadcasts
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists template_name text,
  add column if not exists template_params jsonb not null default '{}'::jsonb,
  add column if not exists estimated_cost jsonb;

comment on column contact_broadcasts.estimated_cost is
  'C5 — estimation affichée avant envoi (tarifs Meta « à confirmer », voir broadcast-planning.ts). '
  'Jamais une facture : Meta facture directement le compte WhatsApp Business du tenant.';

-- Palier d'envoi : nombre de contacts uniques que le numéro peut démarrer par jour.
-- Défaut prudent (nouveau numéro) ; le tenant/l'admin le relève quand Meta relève le palier.
alter table growth_settings
  add column if not exists whatsapp_daily_unique_contacts integer not null default 250
    check (whatsapp_daily_unique_contacts between 1 and 1000000);
