import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getPaymentProvider } from "@/infrastructure/providers/registry";
import type { NotchPayWebhookEvent } from "@/infrastructure/providers/payment/notchpay/types";
import { listPlans, type PlanKey } from "./plans-repository";
import { notifyOrgAdmins } from "./notification-service";
import { confirmAddonPurchase } from "./addons-service";

/**
 * Lot G, Partie 1 — Paiement d'abonnement. Flow : initiatePayment() crée
 * une ligne `pending` + renvoie une URL de checkout NotchPay ->
 * l'utilisateur paie sur la page NotchPay -> handlePaymentWebhook()
 * confirme et applique l'effet (extension d'abonnement OU add-on, voir
 * markPaymentCompleted). Jamais l'inverse : aucune capacité n'est
 * accordée avant confirmation réelle du paiement (critère d'acceptation).
 */

export interface SubscriptionPaymentSummary {
  id: string;
  paymentType: "plan_subscription" | "addon";
  planKey: string | null;
  addonKey: string | null;
  addonQuantity: number | null;
  amountFcfa: number;
  status: "pending" | "completed" | "failed" | "refunded" | "cancelled";
  createdAt: string;
}

interface SubscriptionPaymentRow {
  id: string;
  organization_id: string;
  payment_type: "plan_subscription" | "addon";
  plan_key: string | null;
  addon_key: string | null;
  addon_quantity: number | null;
  amount_fcfa: number;
  provider_reference: string;
  status: "pending" | "completed" | "failed" | "refunded" | "cancelled";
}

/** Historique de facturation tenant (abonnement + add-ons confondus) — /dashboard/subscription. */
export async function listPaymentsForOrganization(organizationId: string, limit = 20): Promise<SubscriptionPaymentSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("subscription_payments")
    .select("id, payment_type, plan_key, addon_key, addon_quantity, amount_fcfa, status, created_at")
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
    status: r.status,
    createdAt: r.created_at,
  }));
}

export interface AdminPaymentSummary extends SubscriptionPaymentSummary {
  organizationId: string;
  organizationName: string;
}

/**
 * Lot 4 (section 52 du master prompt — "Payments" dans la liste des
 * sections attendues du Super Admin). `listPaymentsForOrganization`
 * ci-dessus n'existait qu'à l'échelle d'un tenant (dashboard) ; jusqu'à
 * ce lot, l'opérateur SME-OS n'avait aucune vue d'ensemble des paiements
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
      "id, organization_id, payment_type, plan_key, addon_key, addon_quantity, amount_fcfa, status, created_at, organizations(name)",
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
    status: r.status,
    createdAt: r.created_at,
  }));
}

/**
 * Initie le paiement d'un forfait (souscription initiale ou changement de
 * forfait). `payerEmail` = email de session de l'acteur (toujours
 * disponible via Supabase Auth, contrairement à un numéro de téléphone —
 * voir NotchPayAdapter.createPayment) : c'est le Server Action appelant
 * qui le fournit, ce service reste agnostique de la session.
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

  const supabase = getSupabaseServiceClient();
  // Générée AVANT l'appel NotchPay (convention node:crypto randomUUID du
  // projet) pour pouvoir insérer la ligne "pending" avant même la
  // réponse HTTP — c'est ce qui rend le webhook idempotent par design
  // (voir commentaire de tête de 0019_subscription_payments.sql).
  const paymentId = randomUUID();

  const { error: insertError } = await supabase.from("subscription_payments").insert({
    id: paymentId,
    organization_id: organizationId,
    payment_type: "plan_subscription",
    plan_key: planKey,
    amount_fcfa: plan.priceFcfa,
    provider: "notchpay",
    provider_reference: paymentId,
    status: "pending",
  });

  if (insertError) {
    throw new Error(`Impossible de créer le paiement: ${insertError.message}`);
  }

  const provider = await getPaymentProvider(organizationId);
  const result = await provider.createPayment({
    organizationId,
    orderId: paymentId,
    amount: plan.priceFcfa,
    currency: "XAF",
    customerEmail: payerEmail,
    description: `Abonnement SME-OS — forfait ${plan.name}`,
  });

  if (result.providerReference !== paymentId) {
    console.error(
      `initiatePayment: providerReference (${result.providerReference}) diffère du paymentId local (${paymentId}) — à surveiller.`,
    );
  }

  console.info(`[audit] actor=${actorUserId} org=${organizationId} action=SUBSCRIPTION_PAYMENT_INITIATED plan=${planKey}`);

  return { paymentId, paymentUrl: result.paymentUrl ?? "" };
}

/**
 * Annule un paiement encore `pending` (initié par erreur, changement
 * d'avis avant complétion). Best-effort côté provider : si NotchPay
 * refuse (le paiement a déjà avancé côté utilisateur), on logue sans
 * bloquer — le webhook fera foi de l'issue réelle si le paiement aboutit
 * malgré tout côté NotchPay.
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
 * Traite un événement webhook NotchPay DÉJÀ vérifié (signature) et parsé
 * — jamais de body brut/signature ici, c'est le rôle de
 * infrastructure/providers/payment/notchpay/webhook-handler.ts et de la
 * route /api/webhooks/notchpay (pipeline External Webhook -> Signature
 * Verification -> Provider Adapter -> Normalize Event -> Application
 * Service, même discipline que le webhook Zernio).
 */
export async function handlePaymentWebhook(event: NotchPayWebhookEvent): Promise<void> {
  const reference = event.data.reference;
  const supabase = getSupabaseServiceClient();

  const { data: payment, error } = await supabase
    .from("subscription_payments")
    .select("id, organization_id, payment_type, plan_key, addon_key, addon_quantity, amount_fcfa, provider_reference, status")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (error) {
    console.error(`handlePaymentWebhook: erreur lecture subscription_payments (${reference}):`, error.message);
    return;
  }
  if (!payment) {
    console.warn(`handlePaymentWebhook: aucun paiement local pour la référence "${reference}" — ignoré.`);
    return;
  }

  // Idempotence (critère d'acceptation) : un webhook rejoué deux fois
  // (même provider_reference, NotchPay documente des retries) ne doit
  // produire aucun second effet.
  if (payment.status !== "pending") {
    return;
  }

  // Ne JAMAIS faire confiance au seul corps du webhook — revérifier via
  // l'API avant de livrer quoi que ce soit ("Best Practices" NotchPay :
  // "Always verify the payment status using the API before fulfilling").
  const provider = await getPaymentProvider(payment.organization_id);
  const verified = await provider.verifyPayment(reference);

  if (verified.status === "succeeded") {
    await markPaymentCompleted(payment as SubscriptionPaymentRow);
    return;
  }

  if (verified.status === "failed") {
    const { data: updated } = await supabase
      .from("subscription_payments")
      .update({ status: "failed", webhook_received_at: new Date().toISOString() })
      .eq("id", payment.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!updated) return; // course perdue contre une autre exécution — rien à notifier deux fois

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
  }
  // 'pending'/'processing' côté NotchPay : rien à faire, un futur event le confirmera.
}

/**
 * Trouve un email de contact pour porter un paiement déclenché par le
 * SYSTÈME (cron), sans session utilisateur — NotchPay exige email OU
 * phone (voir NotchPayAdapter). On prend l'owner le plus ancien de
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
 * Pour chaque abonnement `trialing` (échéance = trial_end) ou `active`
 * (échéance = current_period_end) :
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
    .in("status", ["trialing", "active"]);

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
        body: "Votre période d'essai ou d'abonnement est arrivée à échéance sans paiement. Renouvelez depuis Mon abonnement pour continuer à utiliser SME-OS.",
        relatedEntityType: "organization_subscription",
        relatedEntityId: row.organization_id,
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

    const { error: auditError } = await supabase.from("audit_logs").insert({
      organization_id: payment.organization_id,
      actor_user_id: null, // déclenché par le webhook, aucun acteur humain à cet instant
      action: "SUBSCRIPTION_PAYMENT_COMPLETED",
      entity_type: "subscription_payment",
      entity_id: payment.id,
      after_state: { planKey: payment.plan_key, amountFcfa: payment.amount_fcfa },
    });
    if (auditError) {
      console.error("markPaymentCompleted: échec journalisation audit_logs:", auditError.message);
    }

    await notifyOrgAdmins({
      organizationId: payment.organization_id,
      title: "Abonnement activé.",
      body: `Votre abonnement (forfait ${payment.plan_key}) est actif jusqu'au ${currentPeriodEnd.toLocaleDateString("fr-FR")}.`,
      relatedEntityType: "subscription_payment",
      relatedEntityId: payment.id,
    });
  }
}
