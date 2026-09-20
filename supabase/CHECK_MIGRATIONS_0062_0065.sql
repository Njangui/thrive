-- ============================================================
-- CHECK_MIGRATIONS_0062_0065.sql — LECTURE SEULE (aucune écriture).
-- Suite de CHECK_MIGRATIONS_0055_0061.sql, à coller dans le SQL Editor
-- Supabase AVANT de déployer le code de la fusion #17.
--
-- `true` = déjà appliquée (ne PAS la rejouer telle quelle) ;
-- `false` = à appliquer, dans l'ordre 0062, 0063, 0064, 0065.
--
-- Symptômes typiques d'une migration manquante :
--   0062 manquante → limites de plan (Discover/Starter/Pro) incohérentes
--   0063 manquante → /dashboard/channels et routage multi-numéros WhatsApp
--   0064 manquante → webhooks `comment.received` / `post.external.*` en échec
--                    (colonne social_posts.source, index d'idempotence)
--   0065 manquante → ⚠️ TOUTE publication Telegram échoue, même sans bouton :
--                    le code écrit toujours la colonne `buttons` dans
--                    `telegram_publications` (insert refusé : « Could not find
--                    the 'buttons' column »). À appliquer AVANT le déploiement.
--
-- 0065 est idempotente (`add column if not exists`) : sans risque même si
-- l'ancienne `0056_telegram_publications_buttons` a déjà été jouée.
-- ============================================================
select
  exists (select 1 from plan_entitlements
          where plan_key = 'starter' and entitlement_key = 'whatsapp_groups_dedicated_bonus') as "0062 plan_entitlements (bonus groupes dédiés)",
  to_regclass('public.whatsapp_accounts') is not null as "0063 whatsapp_accounts",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'social_posts' and column_name = 'source') as "0064 social_posts.source",
  to_regclass('public.idx_social_posts_org_provider_post_id_unique') is not null as "0064 index unique provider_post_id",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'telegram_publications' and column_name = 'buttons') as "0065 telegram_publications.buttons";
