import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import { MODULE_KEYS, INDUSTRY_MODULE_PRESETS, type ModuleKey } from "@/application/config/modules";
import { seedDefaultExpenseCategories } from "./finance-service";
import { createTrialSubscription } from "./plans-repository";
import { initializeCreditBalance } from "./ai-credits-service";

export interface CreateOrganizationInput {
  name: string;
  industry?: string;
  currency?: string;
}

/**
 * Crée l'organisation #1 d'un utilisateur (ou une organisation
 * supplémentaire) : sans ce flow, il n'existe AUCUN moyen d'obtenir un
 * tenant utilisable (le scénario d'acceptation section 58 suppose qu'une
 * entreprise et un admin existent déjà). Utilise le service-role pour
 * l'écriture (l'organisation n'existe pas encore, donc aucune policy RLS
 * "member of org" ne peut s'appliquer) mais vérifie l'authentification
 * via la session cookie AVANT toute écriture (section 35).
 */
export async function createOrganization(input: CreateOrganizationInput): Promise<{ organizationId: string }> {
  if (!input.name.trim()) {
    throw new ValidationError("Le nom de l'entreprise est requis");
  }

  const sessionClient = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    throw new AuthenticationError("Connectez-vous avant de créer votre entreprise");
  }

  const supabase = getSupabaseServiceClient();
  const slug = await generateUniqueSlug(input.name);

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({
      name: input.name.trim(),
      slug,
      industry: input.industry ?? null,
      currency: input.currency ?? "XAF",
      // Lot I, Partie 2 (onboarding reprenable) : l'étape 1 (celle-ci) vient
      // d'être complétée avec succès, donc onboarding_step=1 dès la
      // création — jamais 0 (0 = "jamais commencé", faux pour une
      // organisation qui vient d'être créée). Les étapes suivantes du
      // wizard avancent cette valeur via updateOnboardingStep ci-dessous.
      onboarding_step: 1,
    })
    .select("id")
    .single();

  if (orgError || !org) {
    throw new Error(`Impossible de créer l'organisation: ${orgError?.message}`);
  }

  const { error: membershipError } = await supabase
    .from("memberships")
    .insert({ organization_id: org.id, user_id: user.id, role: "owner" });

  if (membershipError) {
    throw new Error(`Impossible de créer le membership propriétaire: ${membershipError.message}`);
  }

  // Modules par défaut : preset industrie si connu, sinon le socle minimal
  // (crm + catalog + landing + whatsapp + faq + ai + finance) — jamais
  // marketing/inventory/orders/appointments activés par défaut, section 33 :
  // "ne jamais supposer que toutes les entreprises utilisent le même..."
  const defaultModules: ModuleKey[] =
    (input.industry ? INDUSTRY_MODULE_PRESETS[input.industry] : undefined) ??
    (["crm", "catalog", "landing", "whatsapp", "faq", "ai", "finance"] as ModuleKey[]);

  await supabase.from("tenant_modules").insert(
    MODULE_KEYS.map((module) => ({
      organization_id: org.id,
      module,
      enabled: defaultModules.includes(module),
    })),
  );

  // IA désactivée par défaut (`enabled: false`) tant que le commerçant n'a
  // pas explicitement configuré/validé un provider — section 67 doc 2 : le
  // produit doit fonctionner même si l'IA est indisponible/non configurée.
  await supabase.from("ai_config").insert({
    organization_id: org.id,
    provider: "mistral",
    model: "mistral-small-latest",
    enabled: false,
  });

  await seedDefaultExpenseCategories(org.id);

  // Lot B (section 78) : plan "starter" + essai de 14 jours par défaut.
  // Les crédits IA inclus sont résolus depuis ce plan (plan_entitlements,
  // clé 'ai_credits') — createTrialSubscription doit s'exécuter avant
  // initializeCreditBalance pour que la résolution du plan soit correcte.
  await createTrialSubscription(org.id, "starter", 14);
  await initializeCreditBalance(org.id);

  return { organizationId: org.id };
}

export interface OnboardingStatus {
  step: number;
  completedAt: string | null;
}

/**
 * Lot I, Partie 2 — persistance de la progression du wizard. Best-effort
 * côté appelant (voir onboarding-actions.ts) : ne jamais transformer une
 * étape métier réussie (produit créé, logo uploadé...) en échec juste
 * parce que la progression n'a pas pu être enregistrée — au pire, une
 * reprise imparfaite (retour à une étape légèrement antérieure) est un
 * dégradé acceptable, jamais une donnée métier perdue.
 */
export async function updateOnboardingStep(organizationId: string, step: number): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("organizations")
    .update({ onboarding_step: step })
    .eq("id", organizationId);

  if (error) {
    throw new Error(`Impossible de mettre à jour la progression de l'onboarding: ${error.message}`);
  }
}

export async function markOnboardingComplete(organizationId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("organizations")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", organizationId);

  if (error) {
    throw new Error(`Impossible de finaliser l'onboarding: ${error.message}`);
  }
}

/**
 * Lecture défensive (jamais levée) : appelée depuis /onboarding et
 * dashboard/layout.tsx sur CHAQUE navigation — une erreur de lecture
 * transitoire ici ne doit jamais empêcher un utilisateur déjà onboardé
 * d'accéder à son tableau de bord. En cas d'erreur, on retourne un état
 * "jamais commencé" plutôt que de faire planter la page ; le pire cas
 * concret est un utilisateur redirigé une fois de trop vers /onboarding,
 * jamais un blocage total.
 */
export async function getOnboardingStatus(organizationId: string): Promise<OnboardingStatus> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("onboarding_step, onboarding_completed_at")
    .eq("id", organizationId)
    .maybeSingle();

  if (error || !data) {
    console.warn(`getOnboardingStatus(${organizationId}): lecture impossible, valeur par défaut retournée:`, error?.message);
    return { step: 0, completedAt: null };
  }

  return { step: data.onboarding_step ?? 0, completedAt: data.onboarding_completed_at };
}

async function generateUniqueSlug(name: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  let candidate = base || "entreprise";
  let attempt = 0;

  while (attempt < 20) {
    const { data } = await supabase.from("organizations").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
    attempt += 1;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  throw new Error("Impossible de générer un slug unique — réessayez avec un autre nom.");
}
