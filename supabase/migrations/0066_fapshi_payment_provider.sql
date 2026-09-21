-- Migration NotchPay -> Fapshi (2026-09-20).
--
-- 1) subscription_payments.provider était verrouillée par
--    `check (provider in ('notchpay'))` (0019_subscription_payments.sql).
--    Cette contrainte n'a jamais existé sur les colonnes `provider`
--    équivalentes du projet (webhook_events.provider — 0006 — et
--    payment_channels.provider — 0040 — sont toutes deux du texte libre
--    non contraint) : c'était donc une incohérence, pas une garantie
--    voulue. On l'aligne sur le reste du schéma pour qu'un futur
--    changement de PaymentProvider (voir registry.ts::getPaymentProvider,
--    commentaire "ABSTRACTION") n'exige plus JAMAIS de migration SQL
--    juste pour autoriser un nouveau nom de provider.
alter table subscription_payments drop constraint if exists subscription_payments_provider_check;
alter table subscription_payments alter column provider set default 'fapshi';

comment on column subscription_payments.provider is
  'Nom du PaymentProvider actif au moment du paiement (provider.providerName, '
  'voir src/domain/ports/payment-provider.ts) — texte libre, sans contrainte '
  'figée depuis cette migration. Permet de savoir avec quel provider un '
  'paiement passé a été traité même après un changement de provider actif.';

-- 2) provider_reference — le commentaire d'origine (0019) affirmait
--    qu'elle n'est "jamais générée par le provider" : vrai pour NotchPay
--    (référence fournie par nous, échouée telle quelle), FAUX pour
--    Fapshi (transId généré côté serveur Fapshi). Corrigé pour refléter
--    le comportement réel désormais attendu de TOUT provider — voir
--    subscription-payment-service.ts / addons-service.ts /
--    phone-number-rental-service.ts, qui créent la ligne locale APRÈS
--    l'appel provider avec sa vraie référence.
comment on column subscription_payments.provider_reference is
  'Référence de transaction telle que renvoyée par provider.createPayment() '
  '(ex: transId Fapshi) — jamais un identifiant choisi par nous à l''avance : '
  'certains providers le génèrent côté serveur. Sert de clé de lookup pour '
  'handlePaymentWebhook() (voir infrastructure/providers/payment/webhook-pipeline.ts).';
