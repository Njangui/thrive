import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getPaymentProvider } from "@/infrastructure/providers/registry";
import { listPlans, resolvePlanPriceForCountry, type PlanKey } from "./plans-repository";
import { getOrganizationCountryCode } from "./country-service";
import { validateMoney } from "./currency-service";
import { notifyOrgAdmins } from "./notification-service";
import { notifyPlatformAdminTelegram } from "./telegram-admin-notification-service";
import { confirmAddonPurchase } from "./addons-service";
import { recordAffiliateConversion, getPromoCodeDiscountBpsForNextPayment } from "./affiliate-service";
import { computeDiscountedAmountFcfa } from "@/domain/entities/affiliate";
import { resetCreditBalanceForPlan } from "./ai-credits-service";

/**
 * Lot G, Partie 1 — Paiement d'abonnement. Flow : initiatePayment()
 * appelle le PaymentProvider actif (Fapshi depuis la migration du
 * 2026-09-20, voir registry.ts) pour obtenir une URL de checkout, PUIS
 * crée la ligne locale `pending` avec la vraie référence provider ->
 * l'utilisateur paie sur la page du provider -> handlePaymentWebhook()
 * confirme et applique l'effet (extension d'abonnement OU add-on, voir
 * markPaymentCompleted). Jamais l'inverse : aucune capacité n'est
 * accordée avant confirmation réelle du paiement (critère d'acceptation).
 *
 * ABSTRACTION PROVIDER — ce fichier ne doit JAMAIS importer un type ou un
 * nom de provider en dur (fini le `import type { NotchPayWebhookEvent }`
 * d'avant la migration Fapshi) :
 * - `handlePaymentWebhook()` ne prend qu'une référence provider (string),
 *   jamais la forme brute d'un webhook — c'est à la route webhook de
 *   CHAQUE provider de traduire son propre payload vers cette référence
 *   (voir payment/webhook-pipeline.ts).
 * - `provider.providerName` (jamais un littéral `"fapshi"`) est ce qui
 *   est stocké dans `subscription_payments.provider` — colonne libre
 *   depuis la migration 0066 (plus de CHECK figé sur un provider).
 * - `provider_reference` est TOUJOURS la valeur renvoyée par
 *   `provider.createPayment()`, jamais notre propre `paymentId` : certains
 *   providers (Fapshi) génèrent leur propre référence côté serveur et ne
 *   permettent pas d'en imposer une — voir le commentaire de
 *   `initiatePayment()` plus bas.
 */

export interface SubscriptionPaymentSummary {
  id: string;
  paymentType: "plan_subscription" | "addon";
  planKey: string | null;
  addonKey: string | null;
  addonQuantity: number | null;
  amountFcfa: number;
  currencyCode: string;
  status: "pending" | "completed" | "failed" | "refunded" | "cancelled";
  createdAt: string;
}

interface SubscriptionPaymentRow {
  id: string;
  organization_id: string;
  payment_type: "plan_subscription" | "addon" | "dedicated_number";
  plan_key: string | null;
  addon_key: string | null;
  addon_quantity: number | null;
  phone_number_id: string | null;
  amount_fcfa: number;
  currency_code: string;
  provider_reference: string;
  status: "pending" | "completed" | "failed" | "refunded" | "cancelled";
}

/** Historique de facturation tenant (abonnement + add-ons confondus) — /dashboard/subscription. */
export async function listPaymentsForOrganization(organizationId: string, limit = 20): Promise<SubscriptionPaymentSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("subscription_payments")
    .select("id, payment_type, plan_key, addon_key, addon_quantity, amount_fcfa, currency_code, status, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Erreur lecture subscription_payments: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    paymentType: r.payment_type,
    planKey: r.plan_key,
    addonKey: r.addon_key,
    addonQuantity: r.addon_quantity,
    amountFcfa: r.amount_fcfa,
    currencyCode: r.currency_code ?? "XAF",
    status: r.status,
    createdAt: r.created_at,
  }));
}

export interface AdminPaymentSummary extends SubscriptionPaymentSummary {
  organizationId: string;
  organizationName: string;
}

/**
 * Lot 5 (section 52 du master prompt — "Payments" dans la liste des
 * sections attendues du Super Admin). `listPaymentsForOrganization`
 * ci-dessus n'existait qu'à l'échelle d'un tenant (dashboard) ; jusqu'à
 * ce lot, l'opérateur tokoo  n'avait aucune vue d'ensemble des paiements
 * plateforme (rapprochement, paiements en attente/échoués tous tenants
 * confondus). Lecture seule : les changements de statut restent la
 * responsabilité exclusive de handlePaymentWebhook() ci-dessous — cette
 * fonction ne fait qu'observer `subscription_payments`.
 */
export async function listAllPaymentsForAdmin(limit = 200): Promise<AdminPaymentSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("subscription_payments")
    .select(
      "id, organization_id, payment_type, plan_key, addon_key, addon_quantity, amount_fcfa, currency_code, status, created_at, organizations(name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Erreur lecture subscription_payments: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    organizationName: (r as unknown as { organizations?: { name?: string } }).organizations?.name ?? "—",
    paymentType: r.payment_type,
    planKey: r.plan_key,
    addonKey: r.addon_key,
    addonQuantity: r.addon_quantity,
    amountFcfa: r.amount_fcfa,
    currencyCode: r.currency_code ?? "XAF",
    status: r.status,
    createdAt: r.created_at,
  }));
}

/**
 * Initie le paiement d'un forfait (souscription initiale ou changement de
 * forfait). `payerEmail` = email de session de l'acteur (toujours
 * disponible via Supabase Auth, contrairement à un numéro de téléphone,
 * jamais transmis à aucun provider par ce service) : c'est le Server
 * Action appelant qui le fournit, ce service reste agnostique de la
 * session.
 *
 * Country Engine (section 25/26) : le montant et la devise sont
 * TOUJOURS résolus côté serveur à partir du pays de l'organisation —
 * jamais transmis ni fait confiance depuis le client. Un pays non
 * encore configuré par le Super Admin (aucune ligne `plan_prices`)
 * retombe sur `plan.priceFcfa` + la devise du pays (ou XAF si le pays
 * lui-même est inconnu), ce qui préserve EXACTEMENT le comportement
 * antérieur au Country Engine pour le Cameroun.
 */
export async function initiatePayment(
  organizationId: string,
  planKey: PlanKey,
  actorUserId: string,
  payerEmail: string,
): Promise<{ paymentId: string; paymentUrl: string }> {
  const plans = await listPlans();
  const plan = plans.find((p) => p.key === planKey);
  if (!plan) {
    throw new ValidationError(`Forfait "${planKey}" introuvable.`);
  }
  if (planKey === "free") {
    // Rien à facturer — le downgrade vers "free" passe par
    // plans-repository.ts::switchToFreePlan (dashboard/subscription/
    // page.tsx en fait un chemin distinct de payPlanAction), jamais par
    // ce pipeline de paiement provider.
    throw new ValidationError('Le plan "free" ne nécessite aucun paiement — utilisez switchToFreePlan().');
  }

  const countryCode = await getOrganizationCountryCode(organizationId);
  const { amount: listedAmount, currencyCode } = await resolvePlanPriceForCountry(plan, countryCode);

  // Code promo (0052) : remise sur le tout PREMIER paiement d'une
  // organisation référée par un code promo (jamais les suivants — voir
  // affiliate-service.ts::getPromoCodeDiscountBpsForNextPayment, qui
  // renvoie 0 dès que conversions_count > 0). N'affecte jamais les
  // organisations référées par un lien cliqué (0% de remise dans ce cas)
  // ni celles non référées du tout (aucune ligne affiliate_referrals).
  const promoDiscountBps = await getPromoCodeDiscountBpsForNextPayment(organizationId);
  const amount = promoDiscountBps > 0 ? computeDiscountedAmountFcfa(listedAmount, promoDiscountBps) : listedAmount;

  // Le prix résolu (country-specific ou repli, remise code promo
  // éventuellement déduite) doit rester un entier valide dans la plus
  // petite unité de sa devise avant toute écriture financière (section
  // 16/62) — une configuration Super Admin corrompue (ex: prix négatif
  // saisi par erreur) ne doit jamais atteindre le provider.
  validateMoney(amount, currencyCode);

  // Convention node:crypto randomUUID du projet — notre id local
  // (subscription_payments.id), transmis au provider comme `orderId`
  // pour réconciliation manuelle éventuelle (ex: Fapshi le stocke en
  // `externalId`), MAIS jamais utilisé comme provider_reference : voir
  // le commentaire d'en-tête de ce fichier ("ABSTRACTION PROVIDER").
  const paymentId = randomUUID();

  const provider = await getPaymentProvider(organizationId);
  const result = await provider.createPayment({
    organizationId,
    orderId: paymentId,
    amount,
    currency: currencyCode,
    customerEmail: payerEmail,
    description: `Abonnement tokoo  — forfait ${plan.name}`,
  });

  // La ligne locale n'est créée qu'APRÈS l'appel provider, avec sa vraie
  // référence (`result.providerReference`) : certains providers (Fapshi)
  // génèrent cette référence côté serveur et ne permettent pas de la
  // choisir à l'avance — l'ancienne convention "insérer avant l'appel
  // avec provider_reference = paymentId" ne fonctionnait que par
  // coïncidence avec NotchPay (qui échouait la référence transmise).
  const supabase = getSupabaseServiceClient();
  const { error: insertError } = await supabase.from("subscription_payments").insert({
    id: paymentId,
    organization_id: organizationId,
    payment_type: "plan_subscription",
    plan_key: planKey,
    amount_fcfa: amount,
    currency_code: currencyCode,
    provider: provider.providerName,
    provider_reference: result.providerReference,
    status: "pending",
  });

  if (insertError) {
    throw new Error(`Impossible de créer le paiement: ${insertError.message}`);
  }

  console.info(
    `[audit] actor=${actorUserId} org=${organizationId} action=SUBSCRIPTION_PAYMENT_INITIATED plan=${planKey} country=${countryCode} currency=${currencyCode} promoDiscountBps=${promoDiscountBps}`,
  );

  return { paymentId, paymentUrl: result.paymentUrl ?? "" };
}

/**
 * Annule un paiement encore `pending` (initié par erreur, changement
 * d'avis avant complétion). Best-effort côté provider (via
 * `provider.cancelPayment?.()`, optionnel dans le port — voir
 * domain/ports/payment-provider.ts) : si le provider refuse (le paiement
 * a déjà avancé côté utilisateur), on logue sans bloquer — le webhook
 * fera foi de l'issue réelle si le paiement aboutit malgré tout.
 */
export async function cancelPendingPayment(organizationId: string, paymentId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { data: payment, error } = await supabase
    .from("subscription_payments")
    .select("id, organization_id, provider_reference, status")
    .eq("id", paymentId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture subscription_payments: ${error.message}`);
  if (!payment) throw new NotFoundError("Paiement introuvable.");
  if (payment.status !== "pending") {
    throw new ValidationError("Seul un paiement en attente peut être annulé.");
  }

  const provider = await getPaymentProvider(organizationId);
  try {
    await provider.cancelPayment?.(payment.provider_reference);
  } catch (cancelError) {
    console.warn(`cancelPendingPayment(${paymentId}): annulation côté provider échouée:`, cancelError);
  }

  const { error: updateError } = await supabase
    .from("subscription_payments")
    .update({ status: "cancelled" })
    .eq("id", paymentId)
    .eq("status", "pending");

  if (updateError) throw new Error(`Erreur mise à jour du paiement: ${updateError.message}`);
}

/**
 * Traite un webhook de paiement — reçoit UNIQUEMENT la référence
 * provider déjà extraite d'un payload authentifié (signature/secret
 * vérifié) et parsé par le pipeline générique
 * (infrastructure/providers/payment/webhook-pipeline.ts) + la route
 * `/api/webhooks/<provider>` correspondante. Volontairement une simple
 * `string`, jamais une forme de payload spécifique à un SDK provider :
 * c'est ce qui permet à CE fichier de ne dépendre d'aucun provider
 * concret (voir "ABSTRACTION PROVIDER" en tête de fichier). On ne fait
 * d'ailleurs JAMAIS confiance au statut annoncé par le webhook lui-même
 * — seulement à cette référence, pour retrouver la ligne locale et la
 * revérifier via `provider.verifyPayment()` (voir
 * `verifyAndReconcilePayment` ci-dessous).
 */
export async function handlePaymentWebhook(providerReference: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: payment, error } = await supabase
    .from("subscription_payments")
    .select(
      "id, organization_id, payment_type, plan_key, addon_key, addon_quantity, phone_number_id, amount_fcfa, currency_code, provider_reference, status",
    )
    .eq("provider_reference", providerReference)
    .maybeSingle();

  if (error) {
    console.error(`handlePaymentWebhook: erreur lecture subscription_payments (${providerReference}):`, error.message);
    return;
  }
  if (!payment) {
    console.warn(`handlePaymentWebhook: aucun paiement local pour la référence "${providerReference}" — ignoré.`);
    return;
  }

  await verifyAndReconcilePayment(payment as SubscriptionPaymentRow);
}

/**
 * Repasse fiabilité P0 (07/09/2026, section 62 de la mission :
 * "réconciliation... ne jamais dépendre exclusivement du navigateur ou
 * d'un seul webhook") — extrait de `handlePaymentWebhook` (comportement
 * strictement inchangé pour le webhook lui-même) pour être réutilisable
 * par `reconcileStalePayments()` ci-dessous : un paiement `pending`
 * n'arrive ici QUE si le provider a effectivement livré un webhook pour
 * sa référence. Si la livraison échoue purement et simplement (retries
 * limités dans le temps côté provider, ou notre endpoint était
 * indisponible au mauvais moment), rien ne déclenchait jamais de seconde
 * vérification — le paiement restait `pending` indéfiniment, l'abonnement
 * jamais activé bien que le client ait payé.
 */
async function verifyAndReconcilePayment(payment: SubscriptionPaymentRow): Promise<"completed" | "failed" | "still_pending"> {
  const supabase = getSupabaseServiceClient();

  // Idempotence (critère d'acceptation) : un webhook rejoué deux fois
  // (même provider_reference — les providers documentent généralement
  // des retries) — ou cette même fonction appelée à la fois par le
  // webhook et par la réconciliation programmée pour le même paiement —
  // ne doit produire aucun second effet.
  if (payment.status !== "pending") {
    return payment.status === "completed" ? "completed" : "failed";
  }

  // Ne JAMAIS faire confiance au seul corps du webhook — revérifier via
  // l'API avant de livrer quoi que ce soit (recommandation standard de
  // tout provider de paiement, explicite chez NotchPay comme chez
  // Fapshi : le webhook peut être rejoué, retardé, voire falsifié si la
  // vérification de signature/secret échouait un jour silencieusement).
  const provider = await getPaymentProvider(payment.organization_id);
  const verified = await provider.verifyPayment(payment.provider_reference);

  if (verified.status === "succeeded") {
    await markPaymentCompleted(payment);
    return "completed";
  }

  if (verified.status === "failed") {
    const { data: updated } = await supabase
      .from("subscription_payments")
      .update({ status: "failed", webhook_received_at: new Date().toISOString() })
      .eq("id", payment.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!updated) return "failed"; // course perdue contre une autre exécution — rien à notifier deux fois

    await notifyOrgAdmins({
      organizationId: payment.organization_id,
      title: "Paiement échoué.",
      body:
        payment.payment_type === "plan_subscription"
          ? `Le paiement de votre abonnement (forfait ${payment.plan_key}) a échoué.`
          : "Le paiement de votre add-on a échoué.",
      relatedEntityType: "subscription_payment",
      relatedEntityId: payment.id,
    });
    await notifyPlatformAdminTelegram("SUBSCRIPTION_PAYMENT_FAILED", {
      organizationId: payment.organization_id,
      entityType: "subscription_payment",
      entityId: payment.id,
      details: {
        forfait: payment.plan_key,
        montantFcfa: payment.amount_fcfa,
      },
    });
    return "failed";
  }

  // Statut encore transitoire côté provider (CREATED/PENDING chez
  // Fapshi) : rien à faire, un futur event (ou la prochaine
  // réconciliation) le confirmera.
  return "still_pending";
}

/**
 * Section 62 de la mission : job de réconciliation. Reprend tout paiement
 * resté `pending` plus de `staleAfterMinutes` (défaut 20 — le temps
 * qu'un webhook provider arrive normalement, avec de la marge avant de
 * le considérer suspect) et le revérifie via l'API du provider,
 * exactement comme le ferait un webhook — même fonction partagée
 * (`verifyAndReconcilePayment`), donc mêmes garanties d'idempotence et
 * la même règle "jamais confiance au corps, toujours revérifier via
 * l'API". Conçu pour tourner sur cron (voir
 * `/api/cron/process-payment-reconciliation`), mais reste une fonction
 * de service ordinaire — testable indépendamment de la route.
 */
export async function reconcileStalePayments(staleAfterMinutes = 20): Promise<{
  checked: number;
  completed: number;
  failed: number;
  stillPending: number;
}> {
  const supabase = getSupabaseServiceClient();
  const staleThreshold = new Date(Date.now() - staleAfterMinutes * 60 * 1000).toISOString();

  const { data: stalePayments, error } = await supabase
    .from("subscription_payments")
    .select(
      "id, organization_id, payment_type, plan_key, addon_key, addon_quantity, phone_number_id, amount_fcfa, currency_code, provider_reference, status",
    )
    .eq("status", "pending")
    .lt("created_at", staleThreshold)
    .not("provider_reference", "is", null);

  if (error) {
    throw new Error(`reconcileStalePayments: erreur lecture subscription_payments: ${error.message}`);
  }

  const result = { checked: 0, completed: 0, failed: 0, stillPending: 0 };
  for (const payment of stalePayments ?? []) {
    result.checked += 1;
    try {
      const outcome = await verifyAndReconcilePayment(payment as SubscriptionPaymentRow);
      if (outcome === "completed") result.completed += 1;
      else if (outcome === "failed") result.failed += 1;
      else result.stillPending += 1;
    } catch (reconcileError) {
      // Un paiement dont la réconciliation échoue (ex: provider
      // temporairement indisponible) ne doit jamais bloquer les
      // suivants — repris automatiquement au prochain passage du cron.
      console.error(`reconcileStalePayments: échec réconciliation ${payment.id}:`, reconcileError);
    }
  }
  return result;
}

/**
 * Trouve un email de contact pour porter un paiement déclenché par le
 * SYSTÈME (cron), sans session utilisateur — tous les appelants de ce
 * fichier transmettent toujours un email au provider, jamais un
 * téléphone (voir FapshiAdapter.createPayment). On prend l'owner le plus
 * ancien de
 * l'organisation (memberships.role='owner') et son email réel via
 * l'API Admin Supabase (`auth.admin.getUserById` — service-role
 * uniquement, jamais exposée côté client, voir
 * https://supabase.com/docs/reference/javascript/auth-admin-getuserbyid).
 * Renvoie `null` proprement si aucun owner/email n'est trouvable — la
 * relance de CETTE organisation est alors sautée sans faire échouer le
 * cron pour les autres (voir processSubscriptionRenewals).
 */
async function findOwnerEmailForRenewal(organizationId: string): Promise<{ userId: string; email: string } | null> {
  const supabase = getSupabaseServiceClient();

  const { data: ownerMembership, error: membershipError } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError || !ownerMembership) {
    console.error(
      `findOwnerEmailForRenewal(${organizationId}): aucun owner trouvé.`,
      membershipError?.message,
    );
    return null;
  }

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(ownerMembership.user_id);
  if (userError || !userData?.user?.email) {
    console.error(`findOwnerEmailForRenewal(${organizationId}): email introuvable pour l'owner.`, userError?.message);
    return null;
  }

  return { userId: ownerMembership.user_id, email: userData.user.email };
}

/**
 * Génère un lien de paiement de renouvellement pour une organisation —
 * même mécanisme qu'un clic "Renouveler" côté tenant (initiatePayment),
 * mais déclenché par le cron (Lot N, Partie 1), sans acteur humain en
 * session. Renvoie `null` (jamais ne lève) si l'organisation n'a pas
 * d'owner identifiable ou si l'initiation échoue — le cron continue avec
 * les autres organisations plutôt que d'échouer entièrement pour une
 * seule ligne problématique (voir processSubscriptionRenewals).
 */
export async function generateRenewalPaymentLink(organizationId: string): Promise<{ paymentUrl: string } | null> {
  const supabase = getSupabaseServiceClient();

  const { data: sub, error: subError } = await supabase
    .from("organization_subscriptions")
    .select("plan_key")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (subError) {
    console.error(`generateRenewalPaymentLink(${organizationId}): erreur lecture abonnement:`, subError.message);
    return null;
  }

  const planKey = (sub?.plan_key ?? "starter") as PlanKey;

  const owner = await findOwnerEmailForRenewal(organizationId);
  if (!owner) return null;

  try {
    const result = await initiatePayment(organizationId, planKey, owner.userId, owner.email);
    return result.paymentUrl ? { paymentUrl: result.paymentUrl } : null;
  } catch (err) {
    console.error(`generateRenewalPaymentLink(${organizationId}): échec initiatePayment:`, err);
    return null;
  }
}

const RENEWAL_REMINDER_WINDOW_DAYS = 3;

interface RenewalCandidate {
  organization_id: string;
  status: "trialing" | "active" | "past_due" | "cancelled";
  trial_end: string | null;
  current_period_end: string | null;
  last_renewal_reminder_sent_at: string | null;
}

/**
 * Traite les échéances d'abonnement (Lot N, Partie 1) — destinée à
 * `/api/cron/process-subscription-renewals`, même pattern que
 * `whatsapp-group-service.ts::processScheduledBroadcasts` (Lot F) :
 * fonction pure métier appelée par une route protégée par CRON_SECRET,
 * jamais l'inverse.
 *
 * Pour chaque abonnement PAYANT `active` (échéance = current_period_end) — ou `trialing`
 * (échéance = trial_end), état hérité de l'ancien essai, qui ne peut plus être créé depuis le
 * freemium mais reste traité tant qu'une telle ligne existe. Le plan gratuit est exclu dès la
 * requête : sans échéance par construction, il forme désormais la grande majorité des lignes
 * (les charger à chaque passage du cron serait du travail perdu, et les compter en `skipped`
 * noierait ce compteur) :
 * - échéance dans J-3 ET aucune relance déjà envoyée pour CETTE échéance
 *   (`last_renewal_reminder_sent_at` NULL) -> génère un lien de paiement +
 *   notifie + marque la relance envoyée (jamais une seconde fois pour la
 *   même échéance, critère d'acceptation).
 * - échéance déjà dépassée -> passe `past_due` + notifie (transition
 *   d'état elle-même idempotente : une fois `past_due`, la requête
 *   `status in ('trialing','active')` ci-dessous l'exclut déjà des
 *   exécutions suivantes — pas besoin d'un second garde-fou).
 */
export async function processSubscriptionRenewals(): Promise<{
  remindersSent: number;
  markedPastDue: number;
  skipped: number;
}> {
  const supabase = getSupabaseServiceClient();
  const now = new Date();
  const reminderThreshold = new Date(now.getTime() + RENEWAL_REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data: candidates, error } = await supabase
    .from("organization_subscriptions")
    .select("organization_id, status, trial_end, current_period_end, last_renewal_reminder_sent_at")
    .in("status", ["trialing", "active"])
    .neq("plan_key", "free");

  if (error) throw new Error(`Erreur lecture organization_subscriptions: ${error.message}`);

  let remindersSent = 0;
  let markedPastDue = 0;
  let skipped = 0;

  for (const row of (candidates ?? []) as RenewalCandidate[]) {
    const dueDateRaw = row.status === "trialing" ? row.trial_end : row.current_period_end;
    if (!dueDateRaw) {
      skipped++;
      continue;
    }
    const dueDate = new Date(dueDateRaw);

    if (dueDate <= now) {
      // Échéance dépassée sans paiement confirmé (un paiement confirmé
      // aurait déjà fait passer `status` à 'active' avec une nouvelle
      // `current_period_end` via markPaymentCompleted, sortant cette
      // ligne du lot `in(['trialing','active'])` qui compte ici comme
      // "dépassée").
      const { error: updateError } = await supabase
        .from("organization_subscriptions")
        .update({ status: "past_due" })
        .eq("organization_id", row.organization_id)
        .eq("status", row.status); // évite d'écraser un statut déjà changé entre temps (course cron/paiement)

      if (updateError) {
        console.error(`processSubscriptionRenewals: échec passage past_due (${row.organization_id}):`, updateError.message);
        skipped++;
        continue;
      }

      await notifyOrgAdmins({
        organizationId: row.organization_id,
        title: "Abonnement expiré.",
        body: "Votre abonnement est arrivé à échéance sans paiement. Renouvelez-le depuis Mon abonnement pour conserver votre offre, ou repassez à l'offre gratuite.",
        relatedEntityType: "organization_subscription",
        relatedEntityId: row.organization_id,
      });
      await notifyPlatformAdminTelegram("SUBSCRIPTION_EXPIRED", {
        organizationId: row.organization_id,
        entityType: "organization_subscription",
        entityId: row.organization_id,
        details: { statut: row.status },
      });
      markedPastDue++;
      continue;
    }

    if (dueDate <= reminderThreshold && !row.last_renewal_reminder_sent_at) {
      const link = await generateRenewalPaymentLink(row.organization_id);
      if (!link) {
        skipped++;
        continue;
      }

      const { error: reminderUpdateError } = await supabase
        .from("organization_subscriptions")
        .update({ last_renewal_reminder_sent_at: now.toISOString() })
        .eq("organization_id", row.organization_id)
        .is("last_renewal_reminder_sent_at", null); // idempotence : jamais deux relances pour la même échéance

      if (reminderUpdateError) {
        console.error(
          `processSubscriptionRenewals: échec marquage relance (${row.organization_id}):`,
          reminderUpdateError.message,
        );
        skipped++;
        continue;
      }

      await notifyOrgAdmins({
        organizationId: row.organization_id,
        title: "Votre abonnement expire dans 3 jours.",
        body: `Renouvelez maintenant pour ne pas interrompre votre service : ${link.paymentUrl}`,
        relatedEntityType: "organization_subscription",
        relatedEntityId: row.organization_id,
      });
      remindersSent++;
      continue;
    }

    skipped++;
  }

  return { remindersSent, markedPastDue, skipped };
}

async function markPaymentCompleted(payment: SubscriptionPaymentRow): Promise<void> {
  const supabase = getSupabaseServiceClient();

  // Garde d'idempotence au niveau SQL : `.eq("status", "pending")` fait
  // qu'entre deux exécutions concurrentes de ce même webhook (delivery
  // dupliquée réellement simultanée, pas juste rejouée plus tard), une
  // seule des deux peut gagner cette mise à jour — `updated` est alors
  // null pour l'autre, qui s'arrête avant de dupliquer l'effet
  // (extension d'abonnement / incrément add-on).
  const { data: updated, error: updateError } = await supabase
    .from("subscription_payments")
    .update({ status: "completed", webhook_received_at: new Date().toISOString() })
    .eq("id", payment.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw new Error(`markPaymentCompleted: échec mise à jour subscription_payments: ${updateError.message}`);
  }
  if (!updated) {
    return;
  }

  if (payment.payment_type === "addon" && payment.addon_key && payment.addon_quantity) {
    await confirmAddonPurchase({
      id: payment.id,
      organizationId: payment.organization_id,
      addonKey: payment.addon_key,
      addonQuantity: payment.addon_quantity,
    });
    return;
  }

  // Loyer du numéro WhatsApp dédié aux groupes (0058_whatsapp_
  // coexistence_dedicated_numbers.sql) — cycle indépendant de
  // organization_subscriptions ci-dessous, volontairement traité ici
  // (pas dans phone-number-rental-service.ts) pour éviter tout import
  // croisé entre les deux fichiers de paiement (voir ce fichier,
  // findOwnerEmailForPhoneNumberRenewal).
  if (payment.payment_type === "dedicated_number" && payment.phone_number_id) {
    const currentPeriodEnd = new Date();
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

    const { error: numberError } = await supabase
      .from("phone_numbers")
      .update({ current_period_end: currentPeriodEnd.toISOString(), last_renewal_reminder_sent_at: null })
      .eq("id", payment.phone_number_id);

    if (numberError) {
      throw new Error(`markPaymentCompleted: échec mise à jour phone_numbers: ${numberError.message}`);
    }

    await notifyOrgAdmins({
      organizationId: payment.organization_id,
      title: "Numéro dédié renouvelé.",
      body: `Votre numéro WhatsApp dédié aux groupes est reconduit jusqu'au ${currentPeriodEnd.toLocaleDateString("fr-FR")}.`,
      relatedEntityType: "phone_number",
      relatedEntityId: payment.phone_number_id,
    });
    return;
  }

  if (payment.payment_type === "plan_subscription" && payment.plan_key) {
    const currentPeriodEnd = new Date();
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

    const { error: subError } = await supabase.from("organization_subscriptions").upsert(
      {
        organization_id: payment.organization_id,
        plan_key: payment.plan_key,
        status: "active",
        current_period_end: currentPeriodEnd.toISOString(),
      },
      { onConflict: "organization_id" },
    );

    if (subError) {
      throw new Error(`markPaymentCompleted: échec mise à jour organization_subscriptions: ${subError.message}`);
    }

    // CORRECTIF (20/09/2026, audit suite signalement utilisateur) — voir
    // ai-credits-service.ts::resetCreditBalanceForPlan pour le détail du
    // bug corrigé (le plafond de crédits IA ne suivait jamais un
    // changement RÉEL de palier). Best-effort délibéré, même principe que
    // `recordAffiliateConversion` juste en dessous : un échec ici
    // n'affecte JAMAIS la confirmation du paiement, déjà actée ci-dessus
    // — au pire, le plafond de crédits reste à corriger manuellement,
    // jamais le paiement du client.
    await resetCreditBalanceForPlan(payment.organization_id, payment.plan_key as PlanKey).catch((err) => {
      console.error(
        `markPaymentCompleted: échec réinitialisation crédits IA (org ${payment.organization_id}, plan ${payment.plan_key}):`,
        err,
      );
    });

    const { error: auditError } = await supabase.from("audit_logs").insert({
      organization_id: payment.organization_id,
      actor_user_id: null, // déclenché par le webhook, aucun acteur humain à cet instant
      action: "SUBSCRIPTION_PAYMENT_COMPLETED",
      entity_type: "subscription_payment",
      entity_id: payment.id,
      after_state: { planKey: payment.plan_key, amountFcfa: payment.amount_fcfa, currencyCode: payment.currency_code },
    });
    if (auditError) {
      console.error("markPaymentCompleted: échec journalisation audit_logs:", auditError.message);
    }

    // Programme d'affiliation (0044) — best-effort par contrat de
    // fonction (voir affiliate-service.ts) : n'affecte jamais la
    // confirmation du paiement lui-même, qui est déjà actée ci-dessus.
    // Scopé aux paiements d'abonnement uniquement (jamais un addon,
    // section suivante) — c'est la valeur d'abonnement, pas un achat
    // ponctuel, qui fonde la commission (voir 0044_affiliate_system.sql).
    await recordAffiliateConversion({
      id: payment.id,
      organizationId: payment.organization_id,
      amountFcfa: payment.amount_fcfa,
      currencyCode: payment.currency_code,
    });

    await notifyOrgAdmins({
      organizationId: payment.organization_id,
      title: "Abonnement activé.",
      body: `Votre abonnement (forfait ${payment.plan_key}) est actif jusqu'au ${currentPeriodEnd.toLocaleDateString("fr-FR")}.`,
      relatedEntityType: "subscription_payment",
      relatedEntityId: payment.id,
    });
    await notifyPlatformAdminTelegram("SUBSCRIPTION_PAYMENT_COMPLETED", {
      organizationId: payment.organization_id,
      entityType: "subscription_payment",
      entityId: payment.id,
      details: { forfait: payment.plan_key, montantFcfa: payment.amount_fcfa },
    });
  }
}
