import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { grantCredits, type CreditStatus } from "./ai-credits-service";
import {
  getOrganizationSubscription,
  listPlans,
  PLAN_KEYS,
  type OrganizationSubscriptionStatus,
  type PlanKey,
  type PlanSummary,
} from "./plans-repository";

export interface AdminOrganizationListItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  planKey: PlanKey;
  subscriptionStatus: string;
  trialEnd: string | null;
  createdAt: string;
  connectedChannels: string[];
  lastActivityAt: string | null;
  creditStatus: CreditStatus;
}

// Nombre de messages récents (toutes organisations confondues) inspectés
// pour dériver la "dernière activité" par entreprise (section 45).
// Approche volontairement simple — un vrai GROUP BY / vue matérialisée
// serait nécessaire à plus grande échelle, mais docs/SECURITY.md note
// explicitement que le projet est "cohérent avec un seul tenant pilote"
// à ce stade. Documenté ici plutôt que masqué.
const RECENT_ACTIVITY_SAMPLE_SIZE = 500;

function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

/**
 * Section 45 : liste des entreprises pour la console Super Admin.
 * Toujours via service-role (cette requête traverse volontairement tous
 * les tenants — voir 03_LOT_C_super_admin.md, "Sécurité").
 *
 * FUSION Lot B : `organizations.plan`/`trial_end` ne sont plus la source
 * de vérité (commentaire de 0012_plans_entitlements.sql) — remplacés ici
 * par `organization_subscriptions`. `organizations.status` reste, lui, la
 * seule source pour la suspension plateforme (Lot B ne touche jamais
 * cette colonne).
 *
 * OPTIMISATION : la version précédente appelait `getOrganizationSubscription()`
 * et `getCreditStatus()` (plans-repository.ts / ai-credits-service.ts) UNE
 * FOIS PAR ENTREPRISE via `Promise.all(orgs.map(async ...))` — un vrai N+1
 * (2N+3 aller-retours DB). Correct au tenant pilote unique, mais cette
 * liste est justement celle qui grossit avec le nombre réel de clients de
 * la plateforme — l'axe de croissance qui compte le plus ici. Réécrit en
 * 3 requêtes batch (une par table, quel que soit le nombre d'entreprises)
 * + une reconstruction en mémoire qui applique EXACTEMENT la même logique
 * de repli que les deux fonctions par-organisation ("pas de ligne
 * `organization_subscriptions`" → starter/trialing ; "pas de ligne
 * `ai_credit_balances`" → limite du plan, 0 consommé) — même résultat,
 * pas un raccourci qui changerait le comportement observé. Les fonctions
 * par-organisation (`getOrganizationSubscription`, `getCreditStatus`)
 * restent utilisées telles quelles ailleurs dans ce fichier et dans le
 * reste du projet — elles ne sont pas dépréciées, seule CETTE liste avait
 * besoin d'une version batch.
 */
export async function listOrganizationsForAdmin(): Promise<AdminOrganizationListItem[]> {
  const supabase = getSupabaseServiceClient();

  const [
    { data: orgs, error: orgsError },
    { data: connections },
    { data: recentMessages },
    { data: subscriptions },
    { data: creditBalances },
    { data: aiCreditsEntitlements },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, slug, status, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("provider_connections").select("organization_id, provider_name").eq("status", "connected"),
    supabase
      .from("conversations")
      .select("organization_id, last_message_at")
      .not("last_message_at", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(RECENT_ACTIVITY_SAMPLE_SIZE),
    supabase.from("organization_subscriptions").select("organization_id, plan_key, status, trial_end"),
    supabase.from("ai_credit_balances").select("organization_id, included_credits, used_credits"),
    supabase.from("plan_entitlements").select("plan_key, limit_value").eq("entitlement_key", "ai_credits"),
  ]);

  if (orgsError) throw new Error(`Erreur lecture organizations: ${orgsError.message}`);

  const channelsByOrg = new Map<string, string[]>();
  for (const c of connections ?? []) {
    const list = channelsByOrg.get(c.organization_id) ?? [];
    list.push(c.provider_name);
    channelsByOrg.set(c.organization_id, list);
  }

  // `recentMessages` est trié desc : la première occurrence par
  // organization_id est donc sa dernière activité, dans la limite de
  // l'échantillon ci-dessus.
  const lastActivityByOrg = new Map<string, string>();
  for (const m of recentMessages ?? []) {
    if (!lastActivityByOrg.has(m.organization_id) && m.last_message_at) {
      lastActivityByOrg.set(m.organization_id, m.last_message_at);
    }
  }

  const subscriptionByOrg = new Map((subscriptions ?? []).map((s) => [s.organization_id, s]));
  const creditBalanceByOrg = new Map((creditBalances ?? []).map((b) => [b.organization_id, b]));
  // 3 lignes au plus (une par plan) — peuplé une seule fois, réutilisé pour
  // chaque entreprise sans ligne `ai_credit_balances` propre.
  const aiCreditsLimitByPlan = new Map((aiCreditsEntitlements ?? []).map((e) => [e.plan_key, e.limit_value]));

  return (orgs ?? []).map((o) => {
    const subRow = subscriptionByOrg.get(o.id);
    // Même repli que getOrganizationSubscription() : pas de ligne = starter/trialing.
    const planKey = isPlanKey(subRow?.plan_key) ? subRow.plan_key : "starter";
    const subscriptionStatus: OrganizationSubscriptionStatus = subRow?.status ?? "trialing";
    const trialEnd = subRow?.trial_end ?? null;

    const balanceRow = creditBalanceByOrg.get(o.id);
    let creditStatus: CreditStatus;
    if (balanceRow) {
      const included = balanceRow.included_credits;
      creditStatus = {
        organizationId: o.id,
        includedCredits: included,
        usedCredits: balanceRow.used_credits,
        remainingCredits: included === -1 ? -1 : Math.max(included - balanceRow.used_credits, 0),
      };
    } else {
      // Même repli que getCreditStatus() : pas de solde = limite du plan, 0 consommé.
      const included = aiCreditsLimitByPlan.get(planKey) ?? -1;
      creditStatus = { organizationId: o.id, includedCredits: included, usedCredits: 0, remainingCredits: included };
    }

    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      planKey,
      subscriptionStatus,
      trialEnd,
      createdAt: o.created_at,
      connectedChannels: channelsByOrg.get(o.id) ?? [],
      lastActivityAt: lastActivityByOrg.get(o.id) ?? null,
      creditStatus,
    };
  });
}

/** Grille tarifaire pour peupler le sélecteur de plan (section 45). */
export async function listPlansForAdmin(): Promise<PlanSummary[]> {
  return listPlans();
}

/**
 * OPTIMISATION : cette fonction existait aussi, dupliquée quasi à
 * l'identique, dans `admin-numbers-service.ts` (chaque écriture
 * `audit_logs` de la console Super Admin y réinventait le même insert).
 * Exportée ici et réutilisée par les deux fichiers — le cahier du Lot G
 * (`07_LOT_G_domaines_addons_paiement.md`) référence déjà cette fonction
 * par ce nom et cet emplacement pour ses propres écrans Super Admin, ne
 * pas la déplacer sans mettre à jour ce cahier.
 */
export async function writeAdminAuditLog(params: {
  actorUserId: string;
  organizationId: string | null;
  /** Par défaut `organizationId` — à préciser explicitement quand l'entité modifiée n'est pas l'organisation elle-même (ex: un numéro de téléphone). */
  entityId?: string;
  action: string;
  entityType: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("audit_logs").insert({
    organization_id: params.organizationId,
    actor_user_id: params.actorUserId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? params.organizationId,
    before_state: params.beforeState ?? null,
    after_state: params.afterState ?? null,
  });
  if (error) {
    // Section sécurité Lot C : chaque action de modification DOIT écrire
    // un audit log. On lève plutôt que de laisser une action admin passer
    // silencieusement sans trace.
    throw new Error(`Erreur écriture audit_logs: ${error.message}`);
  }
}

/**
 * Suspendre / réactiver une entreprise (section 45). Continue de
 * gouverner `organizations.status` (migration 0001) — c'est le kill-switch
 * plateforme du Super Admin, distinct et orthogonal au statut
 * d'abonnement/facturation (`organization_subscriptions.status`, Lot B),
 * que Lot B ne touche jamais. Les deux notions coexistent volontairement.
 */
export async function setOrganizationStatus(
  organizationId: string,
  newStatus: "active" | "suspended",
  actorUserId: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data: org, error: fetchError } = await supabase
    .from("organizations")
    .select("status")
    .eq("id", organizationId)
    .single();

  if (fetchError || !org) throw new NotFoundError("Entreprise introuvable");

  const { error: updateError } = await supabase
    .from("organizations")
    .update({ status: newStatus })
    .eq("id", organizationId);

  if (updateError) throw new Error(`Erreur mise à jour du statut: ${updateError.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId,
    action: newStatus === "suspended" ? "ORGANIZATION_SUSPENDED" : "ORGANIZATION_ACTIVATED",
    entityType: "organization",
    beforeState: { status: org.status },
    afterState: { status: newStatus },
  });
}

/**
 * Changer le plan d'une entreprise. FUSION Lot B : écrit désormais
 * `organization_subscriptions.plan_key` (source de vérité réelle du
 * gating, 0012_plans_entitlements.sql) plutôt que l'ancienne colonne
 * `organizations.plan`, devenue vestigiale. `plan_key` est
 * contrainte par clé étrangère vers `plans.key` — on valide donc contre
 * `PLAN_KEYS` plutôt qu'un simple "non vide" (l'UI expose un menu
 * déroulant peuplé par `listPlansForAdmin()`, pas un champ libre).
 * Upsert plutôt qu'update : un tenant créé avant Lot B peut n'avoir
 * aucune ligne `organization_subscriptions` — l'update silencieux ne
 * ferait alors rien.
 */
export async function changeOrganizationPlan(
  organizationId: string,
  newPlanKey: string,
  actorUserId: string,
): Promise<void> {
  if (!(PLAN_KEYS as readonly string[]).includes(newPlanKey)) {
    throw new ValidationError(`Plan invalide — attendu l'un de : ${PLAN_KEYS.join(", ")}`);
  }
  const planKey = newPlanKey as PlanKey;

  const before = await getOrganizationSubscription(organizationId);

  const supabase = getSupabaseServiceClient();
  const { error: upsertError } = await supabase
    .from("organization_subscriptions")
    .upsert({ organization_id: organizationId, plan_key: planKey }, { onConflict: "organization_id" });

  if (upsertError) throw new Error(`Erreur mise à jour du plan: ${upsertError.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId,
    action: "ORGANIZATION_PLAN_CHANGED",
    entityType: "organization_subscription",
    beforeState: { planKey: before.planKey },
    afterState: { planKey },
  });
}

/**
 * Ajouter des crédits IA à une entreprise. Réutilise `grantCredits()`
 * (Lot B, ai-credits-service.ts — remplace le stub initial de Lot C).
 * L'audit log reste écrit ICI, comme prévu dès la livraison initiale.
 */
export async function grantAiCreditsToOrganization(
  organizationId: string,
  amount: number,
  actorUserId: string,
): Promise<void> {
  await grantCredits(organizationId, amount, "super_admin_grant");

  await writeAdminAuditLog({
    actorUserId,
    organizationId,
    action: "AI_CREDITS_GRANTED",
    entityType: "ai_credits",
    afterState: { amount },
  });
}
