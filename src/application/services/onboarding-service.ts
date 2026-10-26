import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import { MODULE_KEYS, INDUSTRY_MODULE_PRESETS, type ModuleKey } from "@/application/config/modules";
import { seedDefaultExpenseCategories } from "./finance-service";
import { isReservedSlug } from "@/domain/reserved-slugs";
import { validateCountryForSignup } from "./country-service";
import { attributeReferral, attributeReferralByPromoCode, validatePromoCode } from "./affiliate-service";
import { seedDefaultCategories } from "./catalog-service";
import { notifyPlatformAdminTelegram } from "./telegram-admin-notification-service";

export interface CreateOrganizationInput {
  name: string;
  industry?: string;
  /**
   * Country Engine (section 12/13) — REQUIS, remplace l'ancien champ
   * `currency` libre non validé (un appelant pouvait auparavant passer
   * n'importe quelle devise sans rapport avec le pays réel, exactement
   * l'anti-pattern interdit par le cahier : "Cameroon + Currency=GHS
   * sans raison métier explicite"). La devise n'est plus JAMAIS choisie
   * indépendamment : elle est TOUJOURS dérivée de `countryCode` via
   * `validateCountryForSignup` ci-dessous, seule source de vérité.
   */
  countryCode: string;
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
/**
 * `referralCookieValue` — voir affiliate-service.ts::attributeReferral :
 * lu par l'APPELANT (Server Action, onboarding-actions.ts) via
 * `cookies()` puis transmis ici tel quel, jamais lu directement dans ce
 * fichier. `next/headers` ne fonctionne que dans un vrai contexte de
 * requête Next.js — l'appeler ici casserait
 * onboarding-service.test.ts (exécuté en simple script Node par
 * vitest, hors tout contexte de requête).
 */
export async function createOrganization(
  input: CreateOrganizationInput,
  referralCookieValue?: string | null,
  promoCode?: string | null,
): Promise<{ organizationId: string }> {
  if (!input.name.trim()) {
    throw new ValidationError("Le nom de l'entreprise est requis");
  }

  // Country Engine (section 13) : seuls les pays `active` permettent
  // l'inscription normale — lève un message adapté (coming_soon/waitlist/
  // disabled/inconnu) AVANT toute écriture, jamais une organisation à
  // moitié créée avec un pays invalide.
  const { countryCode, currencyCode } = await validateCountryForSignup(input.countryCode);

  const sessionClient = await getSupabaseServerSessionClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    throw new AuthenticationError("Connectez-vous avant de créer votre entreprise");
  }

  // Code promo (0052) : validé AVANT toute écriture — contrairement au
  // cookie d'affiliation (silencieux, best-effort), un code TAPÉ par
  // l'utilisateur doit produire une erreur claire s'il est invalide,
  // et on ne veut jamais avoir à annuler une organisation déjà créée
  // pour ça. Prioritaire sur le cookie s'il est fourni ("plutôt" —
  // décision produit : un utilisateur qui tape un code exprime un choix
  // explicite, qui l'emporte sur un clic de lien antérieur éventuel).
  const trimmedPromoCode = promoCode?.trim();
  const validatedPromoCode = trimmedPromoCode ? await validatePromoCode(trimmedPromoCode, user.id) : null;
  if (trimmedPromoCode && !validatedPromoCode) {
    throw new ValidationError("Code promo invalide.");
  }

  const supabase = getSupabaseServiceClient();

  // Modules par défaut : preset industrie si connu, sinon le socle minimal
  // (crm + catalog + landing + whatsapp + faq + ai + finance) — jamais
  // marketing/inventory/orders/appointments activés par défaut, section 33 :
  // "ne jamais supposer que toutes les entreprises utilisent le même..."
  const defaultModules: ModuleKey[] =
    (input.industry ? INDUSTRY_MODULE_PRESETS[input.industry] : undefined) ??
    (["crm", "catalog", "landing", "whatsapp", "faq", "ai", "finance"] as ModuleKey[]);
  const modulesPayload = MODULE_KEYS.map((module) => ({ module, enabled: defaultModules.includes(module) }));

  // Correctif d'audit C8/Q6 : organisation, propriétaire, modules, config IA (désactivée par défaut), abonnement
  // gratuit et solde de crédits sont créés dans UNE transaction SQL (0193, `create_organization_atomic`) — une
  // erreur à mi-parcours ne laisse plus d'entreprise à moitié créée — qui applique aussi la limite par
  // utilisateur (1 entreprise gratuite à la fois, 5 au maximum).
  let orgId: string | null = null;
  for (let attempt = 0; attempt < 5 && !orgId; attempt++) {
    const slug = await generateUniqueSlug(input.name, attempt > 0);
    const { data, error } = await supabase.rpc("create_organization_atomic", {
      p_user: user.id,
      p_name: input.name.trim(),
      p_slug: slug,
      p_industry: input.industry ?? null,
      p_currency: currencyCode,
      p_country: countryCode,
      p_modules: modulesPayload,
    });
    if (!error && data) {
      orgId = data as string;
      break;
    }
    const message = error?.message ?? "";
    if (message.includes("organization_limit_free")) {
      throw new ValidationError("Vous avez déjà une entreprise sur l'offre gratuite. Passez-la sur un forfait payant avant d'en créer une autre.");
    }
    if (message.includes("organization_limit_total")) {
      throw new ValidationError("Vous avez atteint le nombre maximum d'entreprises (5). Contactez le support pour en créer davantage.");
    }
    // Slug déjà pris entre la vérification et l'insertion (course) ou réservé : on retente avec un autre.
    if (error?.code === "23505" || error?.code === "23514") continue;
    throw new Error(`Impossible de créer l'organisation: ${message}`);
  }
  if (!orgId) throw new Error("Impossible de générer un nom d'adresse unique — réessayez avec un autre nom.");
  const org = { id: orgId };

  // Seeds non critiques : l'entreprise est déjà utilisable ; un échec ici est journalisé, jamais bloquant.
  try {
    await seedDefaultExpenseCategories(org.id);
  } catch (error) {
    console.error(`createOrganization(${org.id}): catégories de dépenses non créées:`, error);
  }

  // Catégories produit/service par défaut (section design, sept. 2026 —
  // "les catégories doivent être sélectionnées selon le secteur d'activité,
  // pas retapées à chaque produit") — même moment que le seed des modules
  // ci-dessus, distinct de `seedDefaultExpenseCategories` (dépenses de
  // comptabilité, table différente). Voir catalog-service.ts::seedDefaultCategories.
  try {
    await seedDefaultCategories(org.id, input.industry ?? null);
  } catch (error) {
    console.error(`createOrganization(${org.id}): catégories par défaut non créées:`, error);
  }

  // Programme d'affiliation (0044 + 0052) — best-effort par contrat de
  // fonction (voir affiliate-service.ts) : jamais lu via next/headers ici
  // (voir JSDoc de la fonction) — un échec ne doit JAMAIS faire échouer
  // la création d'organisation elle-même. Code promo prioritaire sur le
  // cookie (voir validation plus haut) ; à défaut, retombe sur
  // l'attribution par lien cliqué, inchangée.
  if (validatedPromoCode) {
    await attributeReferralByPromoCode(org.id, validatedPromoCode, user.id);
  } else {
    await attributeReferral(org.id, user.id, referralCookieValue);
  }

  await notifyPlatformAdminTelegram("ORGANIZATION_CREATED", {
    organizationId: org.id,
    entityType: "organization",
    entityId: org.id,
    details: {
      nom: input.name.trim(),
      pays: countryCode,
      secteur: input.industry ?? "non précisé",
    },
  });

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

async function generateUniqueSlug(name: string, forceSuffix = false): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  // Décision Q29 : un nom qui donnerait un sous-domaine réservé (« admin », « mail »…) reçoit toujours un suffixe.
  let candidate = base || "entreprise";
  if (forceSuffix || isReservedSlug(candidate)) candidate = `${candidate}-${Math.random().toString(36).slice(2, 6)}`;
  let attempt = 0;

  while (attempt < 20) {
    const { data } = await supabase.from("organizations").select("id").eq("slug", candidate).maybeSingle();
    if (!data && !isReservedSlug(candidate)) return candidate;
    attempt += 1;
    candidate = `${base || "entreprise"}-${Math.random().toString(36).slice(2, 6)}`;
  }

  throw new Error("Impossible de générer un slug unique — réessayez avec un autre nom.");
}
