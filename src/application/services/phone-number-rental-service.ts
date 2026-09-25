import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getPaymentProvider } from "@/infrastructure/providers/registry";
import { getPlatformSettingNumber, setPlatformSetting } from "./platform-settings-service";
import { assignPhoneNumberToOrganization } from "./admin-numbers-service";
import { notifyOrgAdmins } from "./notification-service";
import { validateMoney } from "./currency-service";

/**
 * Location d'un numéro WhatsApp dédié aux Groupes, géré par la
 * plateforme — voir 0058_whatsapp_coexistence_dedicated_numbers.sql
 * pour le contexte produit complet. Réutilise le pipeline de paiement
 * existant (subscription_payments, payment_type='dedicated_number') :
 * la confirmation de paiement elle-même (webhook + réconciliation) reste
 * dans subscription-payment-service.ts::markPaymentCompleted — ce
 * fichier ne couvre que ce qui est spécifique au numéro dédié (demande,
 * assignation avec démarrage de facturation, relance, reprise).
 */

const DEDICATED_NUMBER_PRICE_SETTING_KEY = "whatsapp_dedicated_number_monthly_price_fcfa";
const DEFAULT_DEDICATED_NUMBER_PRICE_FCFA = 5000; // Valeur de repli raisonnable — à ajuster depuis /admin/numbers, jamais codée en dur ailleurs.
const RENEWAL_REMINDER_WINDOW_DAYS = 3; // Même fenêtre que processSubscriptionRenewals (subscription-payment-service.ts), pour un comportement prévisible côté commerçant.

export async function getDedicatedNumberMonthlyPriceFcfa(): Promise<number> {
  return getPlatformSettingNumber(DEDICATED_NUMBER_PRICE_SETTING_KEY, DEFAULT_DEDICATED_NUMBER_PRICE_FCFA);
}

export async function setDedicatedNumberMonthlyPriceFcfa(priceFcfa: number, actorUserId: string): Promise<void> {
  if (!Number.isInteger(priceFcfa) || priceFcfa <= 0) {
    throw new ValidationError("Le prix mensuel doit être un entier positif (FCFA).");
  }
  await setPlatformSetting(DEDICATED_NUMBER_PRICE_SETTING_KEY, priceFcfa, actorUserId);
}

/**
 * Demande commerçant (chemin payant) — un Super Admin la traite depuis
 * /admin/numbers en assignant un numéro (voir fulfillPhoneNumberRequest
 * ci-dessous). L'index unique partiel `uq_phone_number_requests_one_
 * pending_per_org` (migration 0058) empêche déjà les doublons au niveau
 * base — on transforme juste sa violation en message compréhensible.
 */
export async function requestDedicatedNumber(organizationId: string, actorUserId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("phone_number_requests")
    .insert({ organization_id: organizationId, requested_by: actorUserId, status: "pending" });

  if (error) {
    if (error.code === "23505") {
      throw new ValidationError("Une demande de numéro dédié est déjà en cours pour votre entreprise.");
    }
    throw new Error(`Impossible d'enregistrer la demande de numéro dédié: ${error.message}`);
  }
}

export interface PendingPhoneNumberRequest {
  id: string;
  organizationId: string;
  organizationName: string;
  createdAt: string;
}

/** Pour /admin/numbers — file d'attente à traiter en priorité, affichée au-dessus du pool. */
export async function listPendingPhoneNumberRequests(): Promise<PendingPhoneNumberRequest[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("phone_number_requests")
    .select("id, organization_id, created_at, organizations(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Erreur lecture phone_number_requests: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    organizationName: (r as unknown as { organizations?: { name?: string } }).organizations?.name ?? "—",
    createdAt: r.created_at,
  }));
}

export interface OrganizationDedicatedNumberStatus {
  pendingRequestId: string | null;
  assignedNumber: {
    id: string;
    phoneE164: string;
    currentPeriodEnd: string | null;
  } | null;
}

/** Pour /dashboard/channels — ce que le commerçant voit du chemin payant (sa demande en cours, ou son numéro loué + échéance). */
export async function getOrganizationDedicatedNumberStatus(organizationId: string): Promise<OrganizationDedicatedNumberStatus> {
  const supabase = getSupabaseServiceClient();

  const [{ data: request, error: requestError }, { data: number, error: numberError }] = await Promise.all([
    supabase
      .from("phone_number_requests")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .maybeSingle(),
    supabase
      .from("phone_numbers")
      .select("id, phone_e164, current_period_end")
      .eq("organization_id", organizationId)
      .eq("status", "assigned")
      .maybeSingle(),
  ]);

  if (requestError) throw new Error(`Erreur lecture phone_number_requests: ${requestError.message}`);
  if (numberError) throw new Error(`Erreur lecture phone_numbers: ${numberError.message}`);

  return {
    pendingRequestId: request?.id ?? null,
    assignedNumber: number
      ? { id: number.id, phoneE164: number.phone_e164, currentPeriodEnd: number.current_period_end }
      : null,
  };
}

/**
 * Traite une demande commerçant en lui assignant un numéro du pool —
 * réutilise assignPhoneNumberToOrganization() (admin-numbers-service.ts,
 * comportement inchangé) puis démarre le premier cycle de facturation
 * (échéance à J+1 mois, comme un premier mois offert le temps que la
 * première relance/paiement intervienne — même simplification que
 * markPaymentCompleted pour un abonnement de forfait : une seule
 * mécanique pour "premier cycle" et "renouvellement").
 */
export async function fulfillPhoneNumberRequest(requestId: string, phoneNumberId: string, actorUserId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: request, error: requestError } = await supabase
    .from("phone_number_requests")
    .select("id, organization_id, status")
    .eq("id", requestId)
    .maybeSingle();

  if (requestError) throw new Error(`Erreur lecture phone_number_requests: ${requestError.message}`);
  if (!request) throw new NotFoundError("Demande introuvable.");
  if (request.status !== "pending") throw new ValidationError("Cette demande a déjà été traitée.");

  await assignPhoneNumberToOrganization(phoneNumberId, request.organization_id, actorUserId);

  const currentPeriodEnd = new Date();
  currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

  const { error: billingError } = await supabase
    .from("phone_numbers")
    .update({ current_period_end: currentPeriodEnd.toISOString(), last_renewal_reminder_sent_at: null })
    .eq("id", phoneNumberId);
  if (billingError) throw new Error(`Numéro assigné mais démarrage de facturation impossible: ${billingError.message}`);

  const { error: updateRequestError } = await supabase
    .from("phone_number_requests")
    .update({ status: "fulfilled", fulfilled_phone_number_id: phoneNumberId })
    .eq("id", requestId)
    .eq("status", "pending");
  if (updateRequestError) {
    console.error(`fulfillPhoneNumberRequest: numéro assigné mais marquage de la demande échoué (${requestId}):`, updateRequestError.message);
  }

  await notifyOrgAdmins({
    organizationId: request.organization_id,
    title: "Votre numéro dédié aux groupes est prêt.",
    body: "Connectez-le depuis Canaux pour activer vos Groupes WhatsApp. Premier renouvellement dans 30 jours.",
    relatedEntityType: "phone_number",
    relatedEntityId: phoneNumberId,
  });
}

/**
 * Email de contact pour porter un paiement déclenché par le SYSTÈME
 * (cron, pas de session utilisateur) — copie volontairement locale de
 * subscription-payment-service.ts::findOwnerEmailForRenewal (non
 * exportée là-bas) plutôt qu'un import croisé entre les deux fichiers
 * de paiement : garder ces deux entrées de cycle de facturation
 * (forfait vs numéro dédié) indépendantes l'une de l'autre.
 */
async function findOwnerEmailForPhoneNumberRenewal(organizationId: string): Promise<{ userId: string; email: string } | null> {
  const supabase = getSupabaseServiceClient();

  const { data: ownerMembership, error: membershipError } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError || !ownerMembership) return null;

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(ownerMembership.user_id);
  if (userError || !userData?.user?.email) return null;

  return { userId: ownerMembership.user_id, email: userData.user.email };
}

/**
 * Initie le paiement du loyer mensuel — depuis /dashboard/channels
 * (bouton "Payer maintenant" côté commerçant) OU depuis la relance
 * automatique J-3 (processPhoneNumberRenewals ci-dessous). Prix unique
 * plateforme (pas de résolution par pays, contrairement au forfait —
 * décision explicite du produit) : toujours en FCFA/XAF.
 */
export async function initiateDedicatedNumberPayment(
  organizationId: string,
  phoneNumberId: string,
  actorUserId: string,
  payerEmail: string,
): Promise<{ paymentId: string; paymentUrl: string }> {
  const supabase = getSupabaseServiceClient();

  const { data: number, error: numberError } = await supabase
    .from("phone_numbers")
    .select("id, organization_id, status, phone_e164")
    .eq("id", phoneNumberId)
    .maybeSingle();

  if (numberError) throw new Error(`Erreur lecture phone_numbers: ${numberError.message}`);
  if (!number || number.organization_id !== organizationId || number.status !== "assigned") {
    throw new ValidationError("Ce numéro dédié n'est pas assigné à votre entreprise.");
  }

  const amount = await getDedicatedNumberMonthlyPriceFcfa();
  const currencyCode = "XAF";
  validateMoney(amount, currencyCode);

  // Notre id local — transmis au provider comme `orderId` pour
  // réconciliation, jamais utilisé comme provider_reference (voir
  // "ABSTRACTION PROVIDER" en tête de subscription-payment-service.ts).
  const paymentId = randomUUID();

  const provider = await getPaymentProvider(organizationId);
  const result = await provider.createPayment({
    organizationId,
    orderId: paymentId,
    amount,
    currency: currencyCode,
    customerEmail: payerEmail,
    description: `flexco  — Numéro WhatsApp dédié aux groupes (${number.phone_e164})`,
  });

  // Créée APRÈS l'appel provider, avec sa vraie référence : certains
  // providers (Fapshi) la génèrent côté serveur et ne permettent pas
  // d'en imposer une à l'avance.
  const { error: insertError } = await supabase.from("subscription_payments").insert({
    id: paymentId,
    organization_id: organizationId,
    payment_type: "dedicated_number",
    phone_number_id: phoneNumberId,
    amount_fcfa: amount,
    currency_code: currencyCode,
    provider: provider.providerName,
    provider_reference: result.providerReference,
    status: "pending",
  });
  if (insertError) throw new Error(`Impossible de créer le paiement: ${insertError.message}`);

  console.info(`[audit] actor=${actorUserId} org=${organizationId} action=DEDICATED_NUMBER_PAYMENT_INITIATED phoneNumberId=${phoneNumberId}`);

  return { paymentId, paymentUrl: result.paymentUrl ?? "" };
}

async function generateDedicatedNumberRenewalPaymentLink(organizationId: string, phoneNumberId: string): Promise<{ paymentUrl: string } | null> {
  const owner = await findOwnerEmailForPhoneNumberRenewal(organizationId);
  if (!owner) return null;
  try {
    const result = await initiateDedicatedNumberPayment(organizationId, phoneNumberId, owner.userId, owner.email);
    return result.paymentUrl ? { paymentUrl: result.paymentUrl } : null;
  } catch (err) {
    console.error(`generateDedicatedNumberRenewalPaymentLink(${organizationId}): échec:`, err);
    return null;
  }
}

/**
 * Reprise automatique d'un numéro dédié non renouvelé — décision produit
 * explicite : reprise immédiate (retour au pool) + suspension des
 * Groupes WhatsApp qu'il alimentait, plutôt qu'un statut "en retard"
 * laissé à l'appréciation d'un Super Admin. `actor_user_id: null` en
 * écriture directe d'audit_logs (pas writeAdminAuditLog, qui exige un
 * acteur humain) — même précédent que subscription-payment-service.ts::
 * markPaymentCompleted pour une action déclenchée par le cron.
 */
async function reclaimDedicatedNumber(phoneNumberId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: number, error: numberError } = await supabase
    .from("phone_numbers")
    .select("id, organization_id, phone_e164")
    .eq("id", phoneNumberId)
    .maybeSingle();

  if (numberError) {
    console.error(`reclaimDedicatedNumber(${phoneNumberId}): erreur lecture phone_numbers:`, numberError.message);
    return;
  }
  if (!number || !number.organization_id) return; // déjà repris entre-temps

  const organizationId = number.organization_id;

  const { error: updateError } = await supabase
    .from("phone_numbers")
    .update({ organization_id: null, status: "available", current_period_end: null, last_renewal_reminder_sent_at: null })
    .eq("id", phoneNumberId)
    .eq("organization_id", organizationId); // évite une course avec une réassignation entre-temps

  if (updateError) {
    console.error(`reclaimDedicatedNumber(${phoneNumberId}): échec reprise:`, updateError.message);
    return;
  }

  // Best-effort : la connexion Zernio réelle (côté Meta/WhatsApp) sur ce
  // numéro n'est PAS coupée automatiquement ici (aucun endpoint Zernio
  // confirmé pour ça) — on marque seulement notre propre bookkeeping
  // comme déconnecté pour que l'UI cesse immédiatement d'y compter,
  // et pour que getWhatsAppGroupsProvider() ne retourne plus ce
  // provider. Un Super Admin peut avoir à couper la connexion côté
  // Zernio/Meta manuellement si le numéro n'est pas immédiatement
  // réassigné à un autre commerçant.
  await supabase
    .from("provider_connections")
    .update({ status: "disconnected" })
    .eq("organization_id", organizationId)
    .eq("provider_type", "whatsapp_groups")
    .eq("provider_name", "zernio");

  await supabase
    .from("whatsapp_groups")
    .update({ status: "suspended" })
    .eq("organization_id", organizationId)
    .eq("status", "connected");

  const { error: auditError } = await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    actor_user_id: null,
    action: "PHONE_NUMBER_RECLAIMED",
    entity_type: "phone_number",
    entity_id: phoneNumberId,
    before_state: { phone_e164: number.phone_e164, organization_id: organizationId },
    after_state: { phone_e164: number.phone_e164, organization_id: null },
  });
  if (auditError) console.error("reclaimDedicatedNumber: échec journalisation audit_logs:", auditError.message);

  await notifyOrgAdmins({
    organizationId,
    title: "Numéro dédié repris.",
    body: "Le loyer de votre numéro WhatsApp dédié aux groupes n'a pas été renouvelé à temps : il a été repris et vos Groupes WhatsApp sont suspendus. Demandez un nouveau numéro ou connectez le vôtre depuis Canaux.",
    relatedEntityType: "phone_number",
    relatedEntityId: phoneNumberId,
  });
}

/**
 * Cron /api/cron/process-phone-number-renewals — même pattern exact que
 * subscription-payment-service.ts::processSubscriptionRenewals, sur un
 * cycle d'échéance VOLONTAIREMENT indépendant (phone_numbers.
 * current_period_end, jamais organization_subscriptions).
 */
export async function processPhoneNumberRenewals(): Promise<{ remindersSent: number; reclaimed: number; skipped: number }> {
  const supabase = getSupabaseServiceClient();
  const now = new Date();
  const reminderThreshold = new Date(now.getTime() + RENEWAL_REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data: candidates, error } = await supabase
    .from("phone_numbers")
    .select("id, organization_id, current_period_end, last_renewal_reminder_sent_at")
    .eq("status", "assigned")
    .not("current_period_end", "is", null)
    .not("organization_id", "is", null);

  if (error) throw new Error(`Erreur lecture phone_numbers: ${error.message}`);

  let remindersSent = 0;
  let reclaimed = 0;
  let skipped = 0;

  for (const row of candidates ?? []) {
    const dueDate = new Date(row.current_period_end as string);

    if (dueDate <= now) {
      await reclaimDedicatedNumber(row.id);
      reclaimed++;
      continue;
    }

    if (dueDate <= reminderThreshold && !row.last_renewal_reminder_sent_at) {
      const link = await generateDedicatedNumberRenewalPaymentLink(row.organization_id as string, row.id);
      if (!link) {
        skipped++;
        continue;
      }

      const { error: reminderUpdateError } = await supabase
        .from("phone_numbers")
        .update({ last_renewal_reminder_sent_at: now.toISOString() })
        .eq("id", row.id)
        .is("last_renewal_reminder_sent_at", null); // idempotence : jamais deux relances pour la même échéance

      if (reminderUpdateError) {
        console.error(`processPhoneNumberRenewals: échec marquage relance (${row.id}):`, reminderUpdateError.message);
        skipped++;
        continue;
      }

      await notifyOrgAdmins({
        organizationId: row.organization_id as string,
        title: "Votre numéro dédié aux groupes expire dans 3 jours.",
        body: `Renouvelez maintenant pour ne pas perdre vos Groupes WhatsApp : ${link.paymentUrl}`,
        relatedEntityType: "phone_number",
        relatedEntityId: row.id,
      });
      remindersSent++;
      continue;
    }

    skipped++;
  }

  return { remindersSent, reclaimed, skipped };
}
