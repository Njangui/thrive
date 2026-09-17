-- ============================================================
-- 0053_country_engine_expansion_seed.sql
-- Seed des 7 pays cités par la documentation/FAQ officielle NotchPay
-- (developer.notchpay.co, consulté le 16/09/2026) comme couverture
-- prévue, en statut 'coming_soon' — visibles "bientôt disponible" sur
-- la carte Afrique de la landing (src/app/_components/africa-availability-map.tsx),
-- inscription toujours fermée. Activation réelle = décision Super
-- Admin, pays par pays, depuis /admin/countries (bouton "Activer").
--
-- Migration strictement ADDITIVE (même règle que 0040) : ne modifie
-- aucune ligne existante, ne touche pas au Cameroun.
--
-- ⚠️ NIVEAU DE CONFIANCE — À LIRE AVANT D'ACTIVER UN PAYS
-- (détail complet : docs/notchpay-resources.md, section "Retrait
-- complet (16/09/2026, deuxième passe)") :
--
--   - devise, indicatif téléphonique : faits ISO standards, fiables à
--     100%, indépendants de NotchPay.
--
--   - notchpay_supported = true : reflète la revendication PUBLIQUE
--     de NotchPay (page-guide "Resources API" + FAQ), PAS une
--     vérification technique indépendante. Mis à true uniquement pour
--     ne pas bloquer le bouton "Activer" sur ce critère précis
--     (assertActivationReadiness, admin-countries-service.ts) — la
--     vraie synchronisation automatique qui alimentait cette colonne
--     a été retirée (endpoint NotchPay inexistant, 404 constaté en
--     prod), donc cette colonne est désormais gérée à la main, comme
--     le reste de cette ligne.
--
--   - payment_channels.is_available = FALSE pour les 7 nouveaux pays
--     (contrairement au Cameroun) : VOLONTAIRE. La page technique
--     "Transfers" de NotchPay (developer.notchpay.co/send-money/transfers,
--     consultée le 16/09/2026) ne confirme QUE cm.mtn/cm.orange/cm.mobile
--     comme canaux réellement supportés aujourd'hui — les channel_code
--     ci-dessous sont des PLACEHOLDERS construits à partir des
--     catégories larges citées par NotchPay (Mobile Money, Cards,
--     Wave, M-Pesa), jamais vérifiés en direct. Ne JAMAIS les utiliser
--     pour un vrai paiement avant vérification auprès du support
--     NotchPay ou par un test réel. C'est précisément pour ça qu'ils
--     sont is_available=false : le bouton "Activer" de
--     /admin/countries restera bloqué ("Aucun canal de paiement
--     disponible") jusqu'à ce qu'un canal soit volontairement repassé
--     à true pour un pays donné (voir requête en bas de fichier).
--
--   - Aucun plan_prices n'est inséré ici (décision tarifaire
--     commerciale qui revient au Super Admin) — l'activation sera
--     aussi bloquée tant que les 3 plans n'ont pas un prix
--     pays-spécifique via /admin/countries/{code}
--     ("Prix non configurés pour: ...").
-- ============================================================

insert into countries (
  iso_code, name, native_name, currency_code, currency_name, currency_symbol,
  phone_code, notchpay_supported, launch_status, display_order, metadata
) values
  ('NG', 'Nigeria', 'Nigeria', 'NGN', 'Naira nigérian', '₦', '+234', true, 'coming_soon', 10,
   '{"source": "notchpay_docs_2026-09-16", "confidence": "public_claim_unverified"}'::jsonb),
  ('GH', 'Ghana', 'Ghana', 'GHS', 'Cedi ghanéen', 'GH₵', '+233', true, 'coming_soon', 20,
   '{"source": "notchpay_docs_2026-09-16", "confidence": "public_claim_unverified"}'::jsonb),
  ('CI', 'Côte d''Ivoire', 'Côte d''Ivoire', 'XOF', 'Franc CFA (UEMOA)', 'CFA', '+225', true, 'coming_soon', 30,
   '{"source": "notchpay_docs_2026-09-16", "confidence": "public_claim_unverified"}'::jsonb),
  ('SN', 'Sénégal', 'Sénégal', 'XOF', 'Franc CFA (UEMOA)', 'CFA', '+221', true, 'coming_soon', 40,
   '{"source": "notchpay_docs_2026-09-16", "confidence": "public_claim_unverified"}'::jsonb),
  ('GA', 'Gabon', 'Gabon', 'XAF', 'Franc CFA (CEMAC)', 'FCFA', '+241', true, 'coming_soon', 50,
   '{"source": "notchpay_docs_2026-09-16", "confidence": "public_claim_unverified"}'::jsonb),
  ('KE', 'Kenya', 'Kenya', 'KES', 'Shilling kényan', 'KSh', '+254', true, 'coming_soon', 60,
   '{"source": "notchpay_docs_2026-09-16", "confidence": "public_claim_unverified"}'::jsonb),
  ('UG', 'Ouganda', 'Uganda', 'UGX', 'Shilling ougandais', 'USh', '+256', true, 'coming_soon', 70,
   '{"source": "notchpay_docs_2026-09-16", "confidence": "public_claim_unverified"}'::jsonb)
on conflict (iso_code) do nothing;

-- Canaux placeholder — is_available=false partout (voir avertissement
-- en tête de fichier). type reste du texte libre (pas d'enum fermé,
-- voir 0040_country_engine.sql) pour rester cohérent avec le
-- catalogue existant ('mobile_money' | 'card' | 'bank' | 'wallet').
insert into payment_channels (country_code, provider, channel_code, channel_name, type, currency_code, is_available, metadata)
values
  ('NG', 'notchpay', 'ng.card',          'Carte bancaire (Visa/Mastercard)', 'card',         'NGN', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('NG', 'notchpay', 'ng.bank_transfer', 'Virement bancaire',                'bank',         'NGN', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('GH', 'notchpay', 'gh.mobile_money',  'Mobile Money (Ghana)',             'mobile_money', 'GHS', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('GH', 'notchpay', 'gh.card',          'Carte bancaire (Visa/Mastercard)', 'card',         'GHS', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('CI', 'notchpay', 'ci.mobile_money',  'Mobile Money (Côte d''Ivoire)',    'mobile_money', 'XOF', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('CI', 'notchpay', 'ci.card',          'Carte bancaire (Visa/Mastercard)', 'card',         'XOF', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('SN', 'notchpay', 'sn.mobile_money',  'Mobile Money (Sénégal)',           'mobile_money', 'XOF', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('SN', 'notchpay', 'sn.wave',          'Wave',                             'wallet',       'XOF', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('GA', 'notchpay', 'ga.mobile_money',  'Mobile Money (Gabon)',             'mobile_money', 'XAF', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('GA', 'notchpay', 'ga.card',          'Carte bancaire (Visa/Mastercard)', 'card',         'XAF', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('KE', 'notchpay', 'ke.mpesa',         'M-Pesa',                           'mobile_money', 'KES', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('KE', 'notchpay', 'ke.card',          'Carte bancaire (Visa/Mastercard)', 'card',         'KES', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('UG', 'notchpay', 'ug.mobile_money',  'Mobile Money (Ouganda)',           'mobile_money', 'UGX', false, '{"confidence": "placeholder_unverified"}'::jsonb),
  ('UG', 'notchpay', 'ug.card',          'Carte bancaire (Visa/Mastercard)', 'card',         'UGX', false, '{"confidence": "placeholder_unverified"}'::jsonb)
on conflict (provider, channel_code) do nothing;

-- Commentaires de table mis à jour (plus de synchronisation
-- automatique depuis NotchPay — voir 0040_country_engine.sql pour le
-- commentaire original, conservé tel quel pour l'historique).
comment on table countries is
  'Country Engine — table de référence plateforme (pas de organization_id, '
  'jamais scopée par tenant). Alimentée MANUELLEMENT (SQL direct pour '
  'l''ajout initial, voir 0040/0052) — plus de synchronisation automatique '
  'depuis NotchPay (retirée le 16/09/2026, voir docs/notchpay-resources.md). '
  'La décision commerciale (launch_status) reste EXCLUSIVEMENT entre les '
  'mains du Super Admin (admin-countries-service.ts).';

comment on table payment_channels is
  'Canaux de paiement par pays — gérés MANUELLEMENT (SQL direct), plus de '
  'synchronisation automatique depuis NotchPay (retirée le 16/09/2026, voir '
  'docs/notchpay-resources.md). NE JAMAIS supposer que MTN/Orange sont les '
  'seuls moyens de paiement : cette table reste la SEULE source pour '
  'peupler un sélecteur de canal, jamais une liste en dur.';

-- ------------------------------------------------------------
-- Pour activer un pays plus tard, une fois vérifié auprès de NotchPay
-- (support ou test réel) : repasser SES canaux à disponible, puis
-- utiliser le bouton "Activer" de /admin/countries (qui bloquera
-- encore sur le pricing tant qu'il n'est pas configuré pour les 3
-- plans, via /admin/countries/{code}). Exemple pour le Ghana :
--
--   update payment_channels set is_available = true
--   where country_code = 'GH' and channel_code in ('gh.mobile_money', 'gh.card');
-- ------------------------------------------------------------
