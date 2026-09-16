-- 0049_pricing_v2.sql
-- Pricing v2: replace the original illustrative values with the commercial
-- grid used by the public pricing page. The quotas concentrate variable
-- costs (AI, social connections and broadcasts) while keeping the core
-- business workspace useful on every paid tier.
--
-- Recommended retail prices:
--   Starter  9,900 FCFA / month
--   Business 19,900 FCFA / month
--   Pro      39,900 FCFA / month
--
-- These are commercial assumptions, not provider invoices: actual Zernio,
-- AI, email and infrastructure invoices should be monitored in production
-- and the Super Admin can adjust prices/limits without a code change.

update plans set
  price_fcfa = 9900,
  description = 'Pour démarrer avec une présence professionnelle, WhatsApp et les outils essentiels.'
where key = 'starter';

update plans set
  price_fcfa = 19900,
  description = 'Pour les entreprises actives qui veulent développer leurs ventes et leurs canaux.'
where key = 'business';

update plans set
  price_fcfa = 39900,
  description = 'Pour les équipes et activités à fort volume avec davantage de canaux et de capacité.'
where key = 'pro';

insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  ('starter', 'whatsapp_groups', 2),
  ('starter', 'broadcast_contacts', 50),
  ('starter', 'ai_credits', 150),
  ('starter', 'social_accounts', 1),
  ('starter', 'facebook_messenger', 0),
  ('starter', 'instagram_messages', 0),
  ('starter', 'linkedin', 0),
  ('starter', 'tiktok', 0),
  ('starter', 'whatsapp_groups_dedicated_bonus', 1),
  ('business', 'whatsapp_groups', 5),
  ('business', 'broadcast_contacts', 100),
  ('business', 'ai_credits', 500),
  ('business', 'social_accounts', 3),
  ('business', 'facebook_messenger', 1),
  ('business', 'instagram_messages', 1),
  ('business', 'linkedin', 0),
  ('business', 'tiktok', 0),
  ('business', 'whatsapp_groups_dedicated_bonus', 3),
  ('pro', 'whatsapp_groups', 10),
  ('pro', 'broadcast_contacts', 200),
  ('pro', 'ai_credits', 1500),
  ('pro', 'social_accounts', 6),
  ('pro', 'facebook_messenger', 1),
  ('pro', 'instagram_messages', 1),
  ('pro', 'linkedin', 1),
  ('pro', 'tiktok', 1),
  ('pro', 'whatsapp_groups_dedicated_bonus', 5)
on conflict (plan_key, entitlement_key) do update set limit_value = excluded.limit_value;

-- Keep the already-seeded Cameroon price rows aligned with plans.price_fcfa.
update plan_prices pp
set amount = p.price_fcfa
from plans p
where pp.plan_key = p.key
  and pp.country_code = 'CM'
  and pp.billing_interval = 'monthly'
  and pp.is_active = true;
