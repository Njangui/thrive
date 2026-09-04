import { randomUUID } from "node:crypto";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getPaymentProvider } from "@/infrastructure/providers/registry";
import { notifyOrgAdmins } from "./notification-service";
import { grantCredits } from "./ai-credits-service";

/**
 * Lot G, Partie 2 — Add-ons. Un achat d'add-on suit exactement le même
 * flow qu'un paiement d'abonnement (subscription_payments,
 * payment_type='addon') : `purchaseAddon()` initie le paiement et
 * renvoie une URL de checkout, `confirmAddonPurchase()` (appelée depuis
 * subscription-payment-service.ts::handlePaymentWebhook une fois le
 * paiement confirmé) incrémente réellement la capacité — jamais l'inverse
 * (critère d'acceptation : un paiement en échec n'incrémente aucun
 * entitlement).
 */

export interface AddonSummary {
  key: string;
  name: string;
  description: string | null;
  priceFcfa: number;
  entitlementKey: string;
  incrementValue: number;
  active: boolean;
}

export interface OrganizationAddonSummary {
  addonKey: string;
  name: string;
  description: string | null;
  quantity: number;
  purchasedAt: string;
}

function mapAddonRow(row: {
  key: string;
  name: string;
  description: string | null;
  price_fcfa: number;
  entitlement_key: string;
  increment_value: number;
  active: boolean;
}): AddonSummary {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    priceFcfa: row.price_fcfa,
    entitlementKey: row.entitlement_key,
    incrementValue: row.increment_value,
    active: row.active,
  };
}

/** `includeInactive` réservé à l'admin (voir admin-addons-service.ts) — le catalogue tenant ne montre jamais un add-on retiré de la vente. */
export async function listAddons(includeInactive = false): Promise<AddonSummary[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase.from("addons").select("*").order("price_fcfa", { ascending: true });
  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture addons: ${error.message}`);
  return (data ?? []).map(mapAddonRow);
}

export async function getOrganizationAddons(organizationId: string): Promise<OrganizationAddonSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organization_addons")
    .select("addon_key, quantity, purchased_at, addons(name, description)")
    .eq("organization_id", organizationId)
    .gt("quantity", 0)
    .order("purchased_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture organization_addons: ${error.message}`);

  return (data ?? []).map((row) => {
    const addon = row.addons as unknown as { name?: string; description?: string | null } | null;
    return {
      addonKey: row.addon_key,
      name: addon?.name ?? row.addon_key,
      description: addon?.description ?? null,
      quantity: row.quantity,
      purchasedAt: row.purchased_at,
    };
  });
}

/**
 * Somme (déjà calculée, jamais recalculée) du bonus des add-ons actifs
 * de l'organisation ciblant `entitlementKey`. Ne lève JAMAIS (consommée
 * depuis entitlements-service.ts::canUseFeature — un échec ici ne doit
 * pas casser une vérification de droits, même filet de sécurité que
 * plans-repository.ts).
 *
 * MODIFIÉ Lot N (0036_recurring_billing.sql) : lit directement
 * `organization_addons.total_increment_granted` (bonus figé au moment de
 * chaque achat) au lieu de `quantity × addons.increment_value` (valeur
 * COURANTE) — un changement de `increment_value` après coup n'affecte
 * plus les achats déjà confirmés. Voir RAPPORT_LOT_N.md.
 */
export async function getOrganizationAddonBonus(organizationId: string, entitlementKey: string): Promise<number> {
  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("organization_addons")
      .select("total_increment_granted, addons(entitlement_key)")
      .eq("organization_id", organizationId);

    if (error) {
      console.error(`getOrganizationAddonBonus(${organizationId}, ${entitlementKey}) erreur de lecture:`, error.message);
      return 0;
    }

    return (data ?? []).reduce((sum, row) => {
      const addon = row.addons as unknown as { entitlement_key?: string } | null;
      if (!addon || addon.entitlement_key !== entitlementKey) return sum;
      return sum + (row.total_increment_granted ?? 0);
    }, 0);
  } catch (err) {
    console.error(`getOrganizationAddonBonus(${organizationId}, ${entitlementKey}) erreur inattendue:`, err);
    return 0;
  }
}

/**
 * Initie l'achat d'un add-on. Ne modifie AUCUNE capacité tout de suite —
 * crée une ligne `subscription_payments` (payment_type='addon',
 * status='pending') et renvoie l'URL de checkout NotchPay.
 * `confirmAddonPurchase()` fait le vrai travail, uniquement sur webhook
 * confirmé (voir subscription-payment-service.ts).
 */
export async function purchaseAddon(
  organizationId: string,
  addonKey: string,
  quantity: number,
  actorUserId: string,
  payerEmail: string,
): Promise<{ paymentId: string; paymentUrl: string }> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError("La quantité doit être un entier positif.");
  }

  const supabase = getSupabaseServiceClient();
  const { data: addon, error: addonError } = await supabase.from("addons").select("*").eq("key", addonKey).maybeSingle();

  if (addonError) throw new Error(`Erreur lecture addons: ${addonError.message}`);
  if (!addon || !addon.active) {
    throw new NotFoundError("Cet add-on est introuvable ou n'est plus disponible à la vente.");
  }

  const amountFcfa = addon.price_fcfa * quantity;
  const paymentId = randomUUID();

  const { error: insertError } = await supabase.from("subscription_payments").insert({
    id: paymentId,
    organization_id: organizationId,
    payment_type: "addon",
    addon_key: addonKey,
    addon_quantity: quantity,
    amount_fcfa: amountFcfa,
    provider: "notchpay",
    provider_reference: paymentId,
    status: "pending",
  });

  if (insertError) {
    throw new Error(`Impossible de créer le paiement de l'add-on: ${insertError.message}`);
  }

  const provider = await getPaymentProvider(organizationId);
  const result = await provider.createPayment({
    organizationId,
    orderId: paymentId,
    amount: amountFcfa,
    currency: "XAF",
    customerEmail: payerEmail,
    description: `Add-on SME-OS : ${addon.name} × ${quantity}`,
  });

  if (result.providerReference !== paymentId) {
    // Ne devrait jamais arriver (NotchPay renvoie la référence qu'on lui
    // a transmise) — loggué plutôt qu'une exception qui bloquerait un
    // checkout par ailleurs valide ; le webhook retrouvera quand même la
    // ligne par provider_reference réellement renvoyée s'il le fallait,
    // mais ce cas signalerait un changement de comportement côté
    // NotchPay à surveiller.
    console.error(
      `purchaseAddon: providerReference (${result.providerReference}) diffère de paymentId (${paymentId}) — à surveiller.`,
    );
  }

  console.info(`[audit] actor=${actorUserId} org=${organizationId} action=ADDON_PURCHASE_INITIATED addon=${addonKey} qty=${quantity}`);

  return { paymentId, paymentUrl: result.paymentUrl ?? "" };
}

/**
 * Appelée UNIQUEMENT par subscription-payment-service.ts::handlePaymentWebhook
 * une fois `payment.status = 'completed'` confirmé. Incrémente
 * `organization_addons` (upsert cumulatif), et pour un add-on ciblant
 * 'ai_credits' spécifiquement, top-up directement `ai_credit_balances`
 * via `grantCredits()` — ce chemin d'entitlement est spécial-casé dans
 * entitlements-service.ts::canUseFeature et ne lit jamais
 * organization_addons (voir commentaire à cet endroit).
 *
 * MODIFIÉ Lot N : accumule aussi `total_increment_granted` en ADDITIONNANT
 * (quantité de CET achat × addon.increment_value ACTUEL) au total déjà
 * accordé — jamais en le recalculant depuis `quantity` — pour qu'un
 * futur changement de `addons.increment_value` n'affecte jamais un achat
 * déjà confirmé (voir 0036_recurring_billing.sql).
 */
export async function confirmAddonPurchase(payment: {
  id: string;
  organizationId: string;
  addonKey: string;
  addonQuantity: number;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: addon, error: addonError } = await supabase
    .from("addons")
    .select("*")
    .eq("key", payment.addonKey)
    .maybeSingle();

  if (addonError || !addon) {
    throw new Error(`confirmAddonPurchase: add-on "${payment.addonKey}" introuvable (${addonError?.message ?? "aucune ligne"})`);
  }

  const { data: existing, error: existingError } = await supabase
    .from("organization_addons")
    .select("quantity, total_increment_granted")
    .eq("organization_id", payment.organizationId)
    .eq("addon_key", payment.addonKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`confirmAddonPurchase: erreur lecture organization_addons: ${existingError.message}`);
  }

  const newQuantity = (existing?.quantity ?? 0) + payment.addonQuantity;
  const bonusFromThisPurchase = payment.addonQuantity * addon.increment_value;
  const newTotalIncrementGranted = (existing?.total_increment_granted ?? 0) + bonusFromThisPurchase;

  const { error: upsertError } = await supabase.from("organization_addons").upsert(
    {
      organization_id: payment.organizationId,
      addon_key: payment.addonKey,
      quantity: newQuantity,
      total_increment_granted: newTotalIncrementGranted,
      subscription_payment_id: payment.id,
      purchased_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,addon_key" },
  );

  if (upsertError) {
    throw new Error(`confirmAddonPurchase: échec incrémentation organization_addons: ${upsertError.message}`);
  }

  if (addon.entitlement_key === "ai_credits") {
    await grantCredits(payment.organizationId, bonusFromThisPurchase, "addon_purchase");
  }

  await notifyOrgAdmins({
    organizationId: payment.organizationId,
    title: "Add-on activé.",
    body: `${addon.name} × ${payment.addonQuantity} a été ajouté à votre compte.`,
    relatedEntityType: "organization_addon",
    relatedEntityId: payment.id,
  });
}
