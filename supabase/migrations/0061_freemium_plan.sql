-- ============================================================
-- 0061_freemium_plan.sql
--
-- Passage en mode freemium (demande explicite : "retire la période
-- d'essai, je veux passer en mode freemium, je configurerai les plans
-- plus tard") + grille commerciale réelle à 3 paliers, transmise
-- ensuite : Discover (gratuit) / Starter (15 000 FCFA) / Pro
-- (30 000 FCFA). Un 4e palier ("Business") viendra plus tard une fois
-- ses fonctionnalités terminées — volontairement PAS ajouté ici (voir
-- PLAN_KEYS dans plans-repository.ts, unique autre source de vérité sur
-- les clés valides : un 4e palier est un changement de code, pas un
-- réglage d'administration, même logique que le commentaire de tête de
-- admin-plans-service.ts).
--
-- Un plan "free" (affiché "Discover") permanent remplace l'essai limité
-- dans le temps comme point d'entrée à l'onboarding — voir
-- plans-repository.ts::createFreemiumSubscription (remplace
-- createTrialSubscription) et onboarding-service.ts.
--
-- ⚠️ Les limites ci-dessous ne couvrent QUE les clés d'entitlement déjà
-- modélisées par le système existant (whatsapp_groups, broadcast_
-- contacts, ai_credits, social_accounts, facebook_messenger,
-- instagram_messages, linkedin, tiktok, whatsapp_groups_dedicated_
-- bonus). Plusieurs dimensions de la grille réelle transmise (bots/
-- canaux Telegram, comptes YouTube multiples, comptes WhatsApp
-- multiples, taille d'équipe, quota catalogue, réponse auto aux
-- commentaires Instagram/TikTok, commentaires unifiés) n'ont PAS encore
-- de clé d'entitlement ni d'application dans le code — voir le message
-- de livraison de ce lot pour le détail, plutôt que de les deviner ici.
-- ============================================================

-- La contrainte sur plans.key limitait explicitement les clés possibles
-- à ('starter','business','pro') — 'free' est un 4e plan ajouté au
-- modèle commercial, pas un simple réglage (voir aussi PLAN_KEYS dans
-- plans-repository.ts, seule autre source de vérité sur les clés
-- valides). 'business' reste autorisé ici volontairement : voir le
-- filet de sécurité en bas de fichier, qui réaffecte toute ligne
-- existante avant de laisser la contrainte inchangée pour ce palier
-- (retiré du modèle actif, pas supprimé de la base).
alter table plans drop constraint plans_key_check;
alter table plans add constraint plans_key_check check (key in ('free', 'starter', 'business', 'pro'));

insert into plans (key, name, price_fcfa, description) values
  ('free', 'Discover', 0, 'Pour démarrer avec un site professionnel et l''essentiel, sans engagement.')
on conflict (key) do update set name = excluded.name, price_fcfa = excluded.price_fcfa, description = excluded.description;

update plans set
  price_fcfa = 15000,
  description = 'Pour une entreprise active qui automatise WhatsApp, Facebook et l''IA au quotidien.'
where key = 'starter';

update plans set
  price_fcfa = 30000,
  description = 'Pour une équipe qui gère plusieurs canaux (Facebook, Instagram, LinkedIn) à fort volume.'
where key = 'pro';

-- Discover : aucun réseau social payant, aucune IA, aucun WhatsApp (ni
-- messagerie ni groupes) dans la grille transmise — uniquement le socle
-- (site, catalogue, messagerie unifiée sans IA, finance, CRM léger).
insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  ('free', 'whatsapp', 0),
  ('free', 'whatsapp_groups', 0),
  ('free', 'broadcast_contacts', 0),
  ('free', 'ai_credits', 0),
  ('free', 'social_accounts', 0),
  ('free', 'facebook_messenger', 0),
  ('free', 'instagram_messages', 0),
  ('free', 'linkedin', 0),
  ('free', 'tiktok', 0),
  ('free', 'whatsapp_groups_dedicated_bonus', 0)
on conflict (plan_key, entitlement_key) do update set limit_value = excluded.limit_value;

-- Starter : "3 groupes WhatsApp (numéro dédié ou payant : +2 offerts)"
-- correspond exactement au mécanisme déjà câblé whatsapp_groups (base) +
-- whatsapp_groups_dedicated_bonus (bonus conditionnel à un numéro
-- dédié, self-serve ou loué — voir phone-number-rental-service.ts) :
-- base=3, bonus=2.
insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  ('starter', 'whatsapp', 1),
  ('starter', 'whatsapp_groups', 3),
  ('starter', 'whatsapp_groups_dedicated_bonus', 2),
  ('starter', 'broadcast_contacts', 50),
  ('starter', 'ai_credits', 150),
  ('starter', 'social_accounts', 1),
  ('starter', 'facebook_messenger', 1),
  ('starter', 'instagram_messages', 0),
  ('starter', 'linkedin', 0),
  ('starter', 'tiktok', 0)
on conflict (plan_key, entitlement_key) do update set limit_value = excluded.limit_value;

-- Pro : même mécanique, "6 groupes (+4 offerts)".
insert into plan_entitlements (plan_key, entitlement_key, limit_value) values
  ('pro', 'whatsapp', 1),
  ('pro', 'whatsapp_groups', 6),
  ('pro', 'whatsapp_groups_dedicated_bonus', 4),
  ('pro', 'broadcast_contacts', 100),
  ('pro', 'ai_credits', 300),
  ('pro', 'social_accounts', 3),
  ('pro', 'facebook_messenger', 1),
  ('pro', 'instagram_messages', 1),
  ('pro', 'linkedin', 1),
  ('pro', 'tiktok', 1)
on conflict (plan_key, entitlement_key) do update set limit_value = excluded.limit_value;

-- Organisations déjà en essai (status='trialing') au moment de ce
-- déploiement : jamais coupées par une échéance de trial_end passée
-- entre-temps — basculées directement en plan "free" (Discover), actif,
-- permanent. Les organisations déjà 'active' (donc déjà payantes) ne
-- sont PAS touchées.
update organization_subscriptions
set
  plan_key = 'free',
  status = 'active',
  trial_start = null,
  trial_end = null,
  current_period_end = null,
  last_renewal_reminder_sent_at = null
where status = 'trialing';

-- Filet de sécurité : toute organisation qui se retrouverait sur l'ex-
-- palier 'business' (retiré du modèle pour l'instant, voir en-tête)
-- retombe sur 'starter' plutôt que de laisser une valeur orpheline —
-- correspond au comportement défensif déjà documenté dans
-- getOrganizationSubscription (plans-repository.ts) pour un plan_key
-- non reconnu par isPlanKey().
update organization_subscriptions set plan_key = 'starter' where plan_key = 'business';

comment on column organization_subscriptions.trial_end is
  'Hérité du modèle "essai limité dans le temps" (0012), retiré au '
  'profit du plan "free"/Discover permanent (voir en-tête de '
  '0061_freemium_plan.sql). Conservé pour compatibilité historique '
  '(paiements/audits passés) — plus jamais renseigné par le code '
  'applicatif depuis ce lot (createFreemiumSubscription ne l''utilise '
  'plus).';
