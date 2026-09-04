-- ============================================================
-- 0036_recurring_billing.sql
-- Lot N, Partie 1 — Facturation récurrente réelle (côté application,
-- NotchPay n'a pas de prélèvement automatique — voir
-- docs/PAYMENT_INTEGRATION.md) + correction du bonus add-ons figé à
-- l'achat (RAPPORT_LOT_G.md documentait explicitement ce trou).
-- ============================================================

-- --- Relance d'échéance : garde-fou anti-spam --------------------------
-- Une seule ligne par organisation (organization_subscriptions est déjà
-- 1:1 avec organization_id, PK sur organization_id) — un simple
-- timestamp suffit, pas besoin d'une table de log séparée : le cron
-- (process-subscription-renewals) ne renvoie une relance J-3 que si
-- cette colonne est NULL ou antérieure à la fenêtre J-3 courante.
alter table organization_subscriptions
  add column last_renewal_reminder_sent_at timestamptz;

comment on column organization_subscriptions.last_renewal_reminder_sent_at is
  'Horodatage de la dernière relance "expire dans 3 jours" envoyée pour '
  'l''échéance COURANTE (trial_end ou current_period_end selon le '
  'statut). Remis à NULL implicitement à chaque renouvellement réussi '
  '(nouvelle échéance = nouvelle fenêtre de relance) via '
  'subscription-payment-service.ts::markPaymentCompleted, qui écrit une '
  'nouvelle valeur de current_period_end sans reporter l''ancien '
  'timestamp de relance.';

-- --- Add-ons : incrément figé au moment de l'achat ----------------------
-- RAPPORT_LOT_G.md, section "Hypothèses" : le bonus était jusqu'ici
-- recalculé à la volée depuis addons.increment_value (valeur COURANTE),
-- donc un changement de tarif/incrément après coup affectait
-- rétroactivement des achats déjà payés.
--
-- `organization_addons` accumule déjà les achats répétés d'un même
-- add-on dans UNE SEULE ligne par (organization_id, addon_key)
-- (0020_addons.sql, quantity incrémentée à chaque achat confirmé). Une
-- simple colonne "increment_value au moment de l'achat" ne suffit donc
-- PAS : un second achat après un changement de tarif écraserait la
-- valeur du premier. On accumule directement le BONUS déjà calculé
-- (quantité achetée × increment_value AU MOMENT de CET achat précis),
-- jamais recalculé après coup — `quantity` reste un simple compteur
-- d'unités possédées à titre d'affichage, plus la source du calcul de
-- bonus.
alter table organization_addons
  add column total_increment_granted integer;

-- Backfill des lignes existantes : la seule valeur disponible est
-- quantity × la valeur COURANTE d'addons.increment_value (l'historique
-- réel des achats successifs n'a jamais été capturé avant ce lot) —
-- mieux qu'une valeur nulle, mais peut différer de ce qui a été
-- réellement accordé si l'add-on a changé de valeur depuis un achat
-- antérieur. Documenté dans RAPPORT_LOT_N.md, section "Hypothèses".
update organization_addons oa
set total_increment_granted = oa.quantity * a.increment_value
from addons a
where a.key = oa.addon_key
  and oa.total_increment_granted is null;

alter table organization_addons
  alter column total_increment_granted set not null,
  alter column total_increment_granted set default 0;

comment on column organization_addons.total_increment_granted is
  'Bonus d''entitlement DÉJÀ CALCULÉ et accumulé (jamais recalculé après '
  'coup) — addons-service.ts::confirmAddonPurchase y ADDITIONNE '
  '(quantité de CET achat × addons.increment_value AU MOMENT de CET '
  'achat) à chaque confirmation de paiement. entitlements-service.ts lit '
  'directement cette colonne (somme sur les add-ons de l''organisation '
  'ciblant la clé demandée), plus jamais addons.increment_value. Un '
  'changement futur de addons.increment_value n''affecte QUE les '
  'NOUVEAUX achats. `quantity` reste un simple compteur d''unités '
  'possédées, affiché tel quel côté tenant, mais n''entre plus dans le '
  'calcul du bonus.';
