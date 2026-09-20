-- ============================================================
-- 0057_promotion_deadline.sql
-- Chantier « catalogue V2 », itération 2 (compte à rebours des promotions).
--
-- Une session précédente avait délibérément renoncé à un compte à rebours
-- sur la section Promotions (voir le commentaire encore présent en tête de
-- `src/app/_components/landing-sections/promotions.tsx`) : le modèle de
-- données n'avait qu'un prix barré (`products.compare_at_price`), jamais
-- de date de fin. Un compte à rebours branché sur une échéance inventée se
-- serait réinitialisé à chaque rechargement et aurait menti au client du
-- commerçant — un faux signal d'urgence que ce projet s'interdit
-- explicitement. Cette migration ajoute la donnée réelle qui manquait ;
-- rien d'autre ne change dans la façon dont une promotion est déclarée.
--
-- `promotion_ends_at` reste NULLABLE et n'affecte AUCUNE promotion
-- existante : une promotion sans échéance renseignée continue de se
-- comporter exactement comme avant (prix barré permanent, sans compte à
-- rebours ni expiration automatique). Le champ n'active un compte à
-- rebours que pour le commerçant qui choisit explicitement d'en fixer un.
--
-- Aucune tâche planifiée (cron) n'est nécessaire pour « clôturer » une
-- promotion expirée : l'application calcule à la lecture si l'échéance est
-- dépassée (compare_at_price + promotion_ends_at + horloge serveur) et
-- cesse alors de présenter le produit comme en promotion — voir
-- `catalog-service.ts::isPromotionCurrentlyOn`. Aucune tâche de fond
-- ne modifie jamais compare_at_price ou promotion_ends_at eux-mêmes ; le
-- commerçant reste seul maître de ces deux champs.
-- ============================================================

alter table products add column if not exists promotion_ends_at timestamptz;

comment on column products.promotion_ends_at is
  'Échéance optionnelle de la promotion en cours (compare_at_price). NULL '
  '= promotion sans date de fin (comportement historique, inchangé) — '
  'renseignée UNIQUEMENT par une action explicite du commerçant depuis '
  '/dashboard/products/[id]/edit, jamais déduite ou générée automatiquement. '
  'Une fois l''échéance dépassée, l''application cesse de présenter le '
  'produit comme en promotion (voir catalog-service.ts) ; ni ce champ ni '
  'compare_at_price ne sont modifiés automatiquement en base pour autant — '
  'le commerçant garde la main pour relancer ou clore la promotion.';
