-- ============================================================
-- CHECK_MIGRATIONS_0055_0061.sql — LECTURE SEULE (aucune écriture).
--
-- À coller dans le SQL Editor Supabase AVANT d'appliquer 0055 → 0061, pour
-- savoir lesquelles sont déjà en base. `true` = déjà appliquée (ne PAS la
-- rejouer : `create table` / `create policy` ne sont pas idempotents) ;
-- `false` = à appliquer, dans l'ordre 0055, 0056, 0057, 0058, 0059, 0060, 0061.
--
-- Symptômes typiques d'une migration manquante (le code déployé suppose
-- qu'elle existe, la requête échoue, la page affiche « Une erreur est
-- survenue ») :
--   0055 manquante → /dashboard/marketing (liste des publications Telegram)
--   0056 manquante → vitrine publique (services : service_images ; fiches
--                    produit/service : specifications) et écrans d'édition
--   0057 manquante → vitrine publique (liste de produits : promotion_ends_at)
--   0058 manquante → /dashboard/channels, /admin/numbers, groupes WhatsApp
--   0059 manquante → vidéos du catalogue (catalog_videos), fiches et édition
--   0060 manquante → événement `video_play` refusé PAR LA BASE, silencieusement
--                    (trackEvent ne lève jamais) : analytique vitrine incomplète
--   0061 manquante → aucun plan « Discover » : l'onboarding freemium échoue
-- La cause exacte figure dans les logs serveur (Vercel → Logs) : chercher
-- « does not exist » ou « Could not find a relationship ».
--
-- ⚠️ 0061 est une migration de DONNÉES (elle bascule les organisations en
-- essai vers le plan gratuit) : à relire avant de l'appliquer en production.
-- ============================================================
select
  to_regclass('public.telegram_publications') is not null as "0055 telegram_publications",
  to_regclass('public.service_images') is not null as "0056 service_images",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'products' and column_name = 'specifications') as "0056 products.specifications",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'services' and column_name = 'specifications') as "0056 services.specifications",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'products' and column_name = 'promotion_ends_at') as "0057 products.promotion_ends_at",
  to_regclass('public.phone_number_requests') is not null as "0058 phone_number_requests",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'phone_numbers' and column_name = 'current_period_end') as "0058 phone_numbers.current_period_end",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'subscription_payments' and column_name = 'phone_number_id') as "0058 subscription_payments.phone_number_id",
  to_regclass('public.catalog_videos') is not null as "0059 catalog_videos",
  exists (select 1 from pg_constraint
          where conname = 'analytics_events_event_type_check'
            and pg_get_constraintdef(oid) like '%video_play%') as "0060 analytics video_play autorisé",
  exists (select 1 from plans where key = 'free') as "0061 plan free (Discover)";
