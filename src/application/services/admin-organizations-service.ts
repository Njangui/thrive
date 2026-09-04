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
  /** Lot N, Partie 3 : "type:name" pour chaque provider ayant un compte dédié configuré (jamais le secret lui-même, voir requête ci-dessous). */
  dedicatedCredentials: string[];
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
    { data: dedicatedCredentialRows },
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
    // Lot N, Partie 3 : JAMAIS credential_reference dans ce select — même
    // discipline que admin-channels-service.ts ("ne jamais sélectionner
    // credential_reference, même en lecture"). Le filtre `.not(...)`
    // porte sur la colonne sans jamais la faire transiter en application.
    supabase
      .from("provider_connections")
      .select("organization_id, provider_type, provider_name")
      .not("credential_reference", "is", null),
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

  const dedicatedCredentialsByOrg = new Map<string, string[]>();
  for (const c of dedicatedCredentialRows ?? []) {
    const list = dedicatedCredentialsByOrg.get(c.organization_id) ?? [];
    list.push(`${c.provider_type}:${c.provider_name}`);
    dedicatedCredentialsByOrg.set(c.organization_id, list);
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
      dedicatedCredentials: dedicatedCredentialsByOrg.get(o.id) ?? [],
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
  /**
   * Par défaut `organizationId` — à préciser explicitement quand l'entité
   * modifiée n'est pas l'organisation elle-même (ex: un numéro de
   * téléphone, un add-on). `entity_id` est typé `uuid` en base
   * (0006_webhooks_and_audit.sql) — jamais une clé texte (ex: `addon.key`,
   * un TLD) : ces clés-là vivent dans `before_state`/`after_state` à la
   * place (remarque du Lot G, adoptée ici).
   */
  entityId?: string | null;
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

// ------------------------------------------------------------
// Lot N, Partie 3 — credentials dédiés par tenant. Réservé Super Admin
// (jamais au commerçant lui-même, voir 10_LOT_J.../cahier N : "identifiants
// sensibles d'infrastructure, pas un réglage produit"). Écrit dans
// `provider_connections` (déjà existante, voir migration 0037) via les
// fonctions Vault wrapper — jamais un secret en clair en base.
// ------------------------------------------------------------

const TENANT_CREDENTIAL_PROVIDERS: Record<string, readonly string[]> = {
  messaging: ["zernio"],
  social: ["zernio"],
  ai: ["mistral", "claude", "openai"],
};

function assertValidTenantCredentialTarget(providerType: string, providerName: string): void {
  const validNames = TENANT_CREDENTIAL_PROVIDERS[providerType];
  if (!validNames || !validNames.includes(providerName)) {
    throw new ValidationError(`Combinaison provider_type/provider_name invalide : ${providerType}/${providerName}`);
  }
}

/**
 * Configure (crée ou remplace) le compte dédié d'une organisation pour un
 * provider donné. `secretValue` est écrit dans Supabase Vault — jamais en
 * clair dans `provider_connections` (seule `credential_reference`, un id
 * Vault, y est stockée). Si une ligne existe déjà SANS credential_reference
 * (connexion créée par un autre flux, ex: onboarding Zernio du tenant
 * lui-même), on y ajoute la référence plutôt que d'écraser ses autres
 * colonnes (`metadata`, `status`).
 */
export async function configureTenantProviderCredential(
  organizationId: string,
  providerType: string,
  providerName: string,
  secretValue: string,
  actorUserId: string,
): Promise<void> {
  assertValidTenantCredentialTarget(providerType, providerName);
  if (!secretValue.trim()) {
    throw new ValidationError("La valeur du credential est requise.");
  }

  const supabase = getSupabaseServiceClient();

  const { data: existing, error: existingError } = await supabase
    .from("provider_connections")
    .select("id, credential_reference")
    .eq("organization_id", organizationId)
    .eq("provider_type", providerType)
    .eq("provider_name", providerName)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Erreur lecture provider_connections: ${existingError.message}`);
  }

  const secretName = `${providerType}:${providerName}:${organizationId}`;

  if (existing?.credential_reference) {
    // Compte dédié déjà configuré -> on met à jour LE MÊME secret Vault
    // (même id), pas un nouveau (évite d'accumuler des secrets orphelins
    // à chaque reconfiguration).
    const { error: vaultError } = await supabase.rpc("vault_update_secret", {
      secret_id: existing.credential_reference,
      new_secret_value: secretValue,
    });
    if (vaultError) throw new Error(`Erreur mise à jour du secret: ${vaultError.message}`);
  } else {
    const { data: newSecretId, error: vaultError } = await supabase.rpc("vault_create_secret", {
      secret_value: secretValue,
      secret_name: secretName,
    });
    if (vaultError) throw new Error(`Erreur création du secret: ${vaultError.message}`);

    const { error: upsertError } = await supabase.from("provider_connections").upsert(
      {
        organization_id: organizationId,
        provider_type: providerType,
        provider_name: providerName,
        status: "connected",
        credential_reference: newSecretId,
      },
      { onConflict: "organization_id,provider_type,provider_name" },
    );
    if (upsertError) throw new Error(`Erreur écriture provider_connections: ${upsertError.message}`);
  }

  // JAMAIS secretValue dans l'audit log — seulement le fait qu'un compte
  // dédié a été configuré (before/after ne portent qu'un booléen, jamais
  // la valeur ni même la référence Vault).
  await writeAdminAuditLog({
    actorUserId,
    organizationId,
    action: "TENANT_PROVIDER_CREDENTIAL_CONFIGURED",
    entityType: "provider_connection",
    beforeState: { providerType, providerName, hadDedicatedCredential: !!existing?.credential_reference },
    afterState: { providerType, providerName, hadDedicatedCredential: true },
  });
}

/**
 * Retire le compte dédié d'une organisation — supprime le secret Vault et
 * vide `credential_reference` (la ligne `provider_connections` elle-même
 * est conservée si elle porte d'autres données utiles, ex: `metadata`
 * Zernio issu de l'onboarding tenant). L'organisation retombe alors sur
 * la clé plateforme au prochain appel (resolveCredential).
 */
export async function removeTenantProviderCredential(
  organizationId: string,
  providerType: string,
  providerName: string,
  actorUserId: string,
): Promise<void> {
  assertValidTenantCredentialTarget(providerType, providerName);

  const supabase = getSupabaseServiceClient();

  const { data: existing, error: existingError } = await supabase
    .from("provider_connections")
    .select("credential_reference")
    .eq("organization_id", organizationId)
    .eq("provider_type", providerType)
    .eq("provider_name", providerName)
    .maybeSingle();

  if (existingError) throw new Error(`Erreur lecture provider_connections: ${existingError.message}`);
  if (!existing?.credential_reference) {
    throw new NotFoundError("Aucun compte dédié configuré pour ce provider.");
  }

  const { error: vaultError } = await supabase.rpc("vault_delete_secret", {
    secret_id: existing.credential_reference,
  });
  if (vaultError) throw new Error(`Erreur suppression du secret: ${vaultError.message}`);

  const { error: updateError } = await supabase
    .from("provider_connections")
    .update({ credential_reference: null })
    .eq("organization_id", organizationId)
    .eq("provider_type", providerType)
    .eq("provider_name", providerName);
  if (updateError) throw new Error(`Erreur mise à jour provider_connections: ${updateError.message}`);

  await writeAdminAuditLog({
    actorUserId,
    organizationId,
    action: "TENANT_PROVIDER_CREDENTIAL_REMOVED",
    entityType: "provider_connection",
    beforeState: { providerType, providerName, hadDedicatedCredential: true },
    afterState: { providerType, providerName, hadDedicatedCredential: false },
  });
}
