-- ============================================================
-- 0062_plan_limits_discover_starter_pro.sql
-- Active commercial grid: Discover / Starter / Pro.
-- ============================================================

update plans set
  name = 'Discover',
  price_fcfa = 0,
  description = 'Le socle professionnel pour démarrer gratuitement.'
where key = 'free';

update plans set
  name = 'Starter',
  price_fcfa = 15000,
  description = 'Pour automatiser votre activité et développer vos premiers canaux.'
where key = 'starter';

update plans set
  name = 'Pro',
  price_fcfa = 30000,
  description = 'Pour les entreprises qui gèrent plusieurs canaux et une équipe plus large.'
where key = 'pro';

insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  ('free',    'catalog_products', 100),
  ('starter', 'catalog_products', 1000),
  ('pro',     'catalog_products', 2000),

  ('free',    'whatsapp', 0),
  ('starter', 'whatsapp', 1),
  ('pro',     'whatsapp', 3),

  ('free',    'whatsapp_groups', 0),
  ('free',    'whatsapp_groups_dedicated_bonus', 0),
  ('starter', 'whatsapp_groups', 3),
  ('starter', 'whatsapp_groups_dedicated_bonus', 2),
  ('pro',     'whatsapp_groups', 6),
  ('pro',     'whatsapp_groups_dedicated_bonus', 4),

  ('free',    'telegram_bots', 1),
  ('starter', 'telegram_bots', 3),
  ('pro',     'telegram_bots', 10),
  ('free',    'telegram_groups', 2),
  ('starter', 'telegram_groups', 5),
  ('pro',     'telegram_groups', 20),

  ('free',    'youtube_accounts', 1),
  ('starter', 'youtube_accounts', 3),
  ('pro',     'youtube_accounts', 10),

  ('free',    'facebook_pages', 0),
  ('starter', 'facebook_pages', 1),
  ('pro',     'facebook_pages', 3),
  ('free',    'linkedin_pages', 0),
  ('starter', 'linkedin_pages', 0),
  ('pro',     'linkedin_pages', 1),
  ('free',    'instagram_accounts', 0),
  ('starter', 'instagram_accounts', 0),
  ('pro',     'instagram_accounts', 2),
  ('free',    'tiktok_accounts', 0),
  ('starter', 'tiktok_accounts', 0),
  ('pro',     'tiktok_accounts', 2),
  ('free',    'twitter_accounts', 0),
  ('starter', 'twitter_accounts', 0),
  ('pro',     'twitter_accounts', 0),
  ('free',    'facebook_auto_comments', 0),
  ('starter', 'facebook_auto_comments', 1),
  ('pro',     'facebook_auto_comments', 1),
  ('free',    'instagram_auto_comments', 0),
  ('starter', 'instagram_auto_comments', 0),
  ('pro',     'instagram_auto_comments', 1),
  ('free',    'unified_comments', 0),
  ('starter', 'unified_comments', 0),
  ('pro',     'unified_comments', 1),

  ('free',    'ai_credits', 0),
  ('starter', 'ai_credits', 150),
  ('pro',     'ai_credits', 300),
  ('free',    'broadcast_contacts', 0),
  ('starter', 'broadcast_contacts', 50),
  ('pro',     'broadcast_contacts', 100),

  ('free',    'team_members', 1),
  ('starter', 'team_members', 3),
  ('pro',     'team_members', 6),

  ('free',    'site_customization', 0),
  ('starter', 'site_customization', 1),
  ('pro',     'site_customization', 1),

  ('free',    'scheduled_publications', 1),
  ('starter', 'scheduled_publications', 1),
  ('pro',     'scheduled_publications', 1),
  ('free',    'immediate_publications', 1),
  ('starter', 'immediate_publications', 1),
  ('pro',     'immediate_publications', 1),
  ('free',    'analytics', 1),
  ('starter', 'analytics', 1),
  ('pro',     'analytics', 1),
  ('free',    'push_notifications', 1),
  ('starter', 'push_notifications', 1),
  ('pro',     'push_notifications', 1),
  ('free',    'finance', 1),
  ('starter', 'finance', 1),
  ('pro',     'finance', 1),
  ('free',    'prospect_notes', 1),
  ('starter', 'prospect_notes', 1),
  ('pro',     'prospect_notes', 1),
  ('free',    'crm', 1),
  ('starter', 'crm', 1),
  ('pro',     'crm', 1),
  ('free',    'semi_automatic_messaging', 1),
  ('starter', 'semi_automatic_messaging', 1),
  ('pro',     'semi_automatic_messaging', 1),
  ('free',    'automatic_messaging', 0),
  ('starter', 'automatic_messaging', 1),
  ('pro',     'automatic_messaging', 1),

  ('free',    'social_accounts', 0),
  ('starter', 'social_accounts', 100),
  ('pro',     'social_accounts', 100)
on conflict (plan_key, entitlement_key) do update set limit_value = excluded.limit_value;

update organization_subscriptions
set plan_key = 'starter'
where plan_key = 'business';

update plan_prices pp
set amount = p.price_fcfa
from plans p
where pp.plan_key = p.key
  and pp.country_code = 'CM'
  and pp.billing_interval = 'monthly'
  and pp.is_active = true;
