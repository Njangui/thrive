-- 0051_landing_personalization.sql
-- Personnalisation avancée de la vitrine publique.

alter table organization_landing_config
  add column if not exists hero_title text,
  add column if not exists hero_subtitle text,
  add column if not exists cta_label text,
  add column if not exists cta_url text,
  add column if not exists visual_style text check (visual_style in ('soft', 'clean', 'bold'));
