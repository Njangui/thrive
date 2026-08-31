"use server";

import { createOrganization, updateOnboardingStep, markOnboardingComplete } from "@/application/services/onboarding-service";
import { requireMembership } from "@/application/services/auth-service";
import { resolveImageFromFormData } from "@/application/services/media-service";
import { updateSiteMedia } from "@/application/services/site-service";
import { createProduct } from "@/application/services/catalog-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { AppError } from "@/lib/errors";

/**
 * Server Actions de l'onboarding multi-étapes (Lot E, Partie 2, section
 * 50/77). Fichier dédié avec directive "use server" au niveau fichier :
 * chaque fonction exportée devient une action appelable DIRECTEMENT par le
 * composant client (`onboarding-wizard.tsx`), sans passer par un
 * `<form action={...}>` — nécessaire ici puisque le wizard garde son état
 * de navigation en local (useState), pas en rechargement de page.
 *
 * Chaque étape est indépendante et retourne { ok, error? } plutôt que de
 * lever une exception côté client : le wizard affiche l'erreur inline et
 * reste sur l'étape en cours, il ne redirige jamais (contrairement aux
 * Server Actions "classiques" du reste du projet qui utilisent
 * redirect() — ce pattern ne s'applique pas à un wizard client-side).
 *
 * Lot I, Partie 2 : chaque étape qui réussit persiste sa progression via
 * `persistStep` — TOUJOURS en best-effort (jamais de `throw`, jamais
 * transformé en `{ ok: false }`). Une étape métier réussie (produit créé,
 * logo uploadé...) ne doit jamais être rapportée comme un échec juste
 * parce que l'écriture de `onboarding_step` a échoué : au pire, la reprise
 * ultérieure retombera une étape trop tôt, ce qui reste inoffensif
 * (aucune re-saisie destructive, chaque étape est idempotente ou skippable).
 */
export interface OnboardingStepResult {
  ok: boolean;
  error?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

async function persistStep(organizationId: string, step: number): Promise<void> {
  await updateOnboardingStep(organizationId, step).catch((err) =>
    console.warn(`[onboarding] échec persistStep(${organizationId}, ${step}):`, err),
  );
}

/**
 * Server Action dédiée au bouton "Passer pour plus tard" des étapes 2 à 5 :
 * ces étapes n'exécutent aucun traitement métier quand on les saute (voir
 * onboarding-wizard.tsx::skip), mais la progression doit tout de même
 * avancer pour qu'une reprise ultérieure ne renvoie pas l'utilisateur à une
 * étape qu'il a déjà quittée.
 */
export async function advanceOnboardingStep(organizationId: string, step: number): Promise<void> {
  try {
    await requireMembership(organizationId, ["owner", "admin"]);
  } catch (err) {
    console.warn(`[onboarding] advanceOnboardingStep(${organizationId}, ${step}) refusé:`, err);
    return;
  }
  await persistStep(organizationId, step);
}

/** Appelée quand le wizard atteint l'étape finale (6) — voir onboarding-wizard.tsx. */
export async function completeOnboarding(organizationId: string): Promise<void> {
  try {
    await requireMembership(organizationId, ["owner", "admin"]);
    await markOnboardingComplete(organizationId);
  } catch (err) {
    console.warn(`[onboarding] échec completeOnboarding(${organizationId}):`, err);
  }
}

/** Étape 1 (obligatoire) — réutilise onboarding-service.ts::createOrganization tel quel. */
export async function submitBusinessStep(
  name: string,
  industry: string,
): Promise<OnboardingStepResult & { organizationId?: string }> {
  try {
    const { organizationId } = await createOrganization({ name, industry: industry || undefined });
    await persistStep(organizationId, 2);
    return { ok: true, organizationId };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Erreur lors de la création de l'entreprise.") };
  }
}

/** Étape 2 (optionnelle) — logo, via le storage réel de la Partie 1. */
export async function submitLogoStep(organizationId: string, formData: FormData): Promise<OnboardingStepResult> {
  await requireMembership(organizationId, ["owner", "admin"]);

  try {
    const logoUrl = await resolveImageFromFormData(formData, {
      organizationId,
      mediaType: "logo",
      fileField: "logoFile",
      urlField: "logoUrl",
    });
    if (logoUrl) {
      await updateSiteMedia(organizationId, { logoUrl });
    }
    await persistStep(organizationId, 3);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Erreur lors de l'ajout du logo.") };
  }
}

/** Étape 3 (optionnelle) — coordonnées, colonnes déjà existantes sur organizations (0008). */
export async function submitContactStep(organizationId: string, formData: FormData): Promise<OnboardingStepResult> {
  await requireMembership(organizationId, ["owner", "admin"]);

  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("organizations")
      .update({
        phone: String(formData.get("phone") ?? "").trim() || null,
        whatsapp_number: String(formData.get("whatsapp") ?? "").trim() || null,
        address: String(formData.get("address") ?? "").trim() || null,
      })
      .eq("id", organizationId);

    if (error) throw new Error(error.message);
    await persistStep(organizationId, 4);
    return { ok: true };
  } catch {
    return { ok: false, error: "Erreur lors de l'enregistrement de vos coordonnées." };
  }
}

/** Étape 4 (optionnelle) — premier produit, réutilise catalog-service.ts::createProduct. */
export async function submitProductStep(organizationId: string, formData: FormData): Promise<OnboardingStepResult> {
  await requireMembership(organizationId, ["owner", "admin"]);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    await persistStep(organizationId, 5);
    return { ok: true }; // étape sautée : rien à faire, jamais bloquant
  }

  try {
    const imageUrl = await resolveImageFromFormData(formData, {
      organizationId,
      mediaType: "product",
      fileField: "imageFile",
      urlField: "imageUrl",
    });

    await createProduct({
      organizationId,
      name,
      unitPrice: Number(formData.get("price") ?? 0),
      currentStock: Number(formData.get("stock") ?? 0),
      imageUrl: imageUrl ?? undefined,
    });
    await persistStep(organizationId, 5);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Erreur lors de la création du produit.") };
  }
}

/** Étape 5 (optionnelle) — 2-3 FAQ suggérées, table `faqs` déjà existante (0008). */
export async function submitFaqStep(organizationId: string, formData: FormData): Promise<OnboardingStepResult> {
  await requireMembership(organizationId, ["owner", "admin"]);

  try {
    const rows: { organization_id: string; question: string; answer: string; keywords: string[] }[] = [];

    for (let i = 0; i < 3; i += 1) {
      const question = String(formData.get(`question${i}`) ?? "").trim();
      const answer = String(formData.get(`answer${i}`) ?? "").trim();
      if (question && answer) {
        rows.push({ organization_id: organizationId, question, answer, keywords: [] });
      }
    }

    if (rows.length === 0) {
      await persistStep(organizationId, 6);
      return { ok: true }; // étape sautée
    }

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from("faqs").insert(rows);
    if (error) throw new Error(error.message);
    await persistStep(organizationId, 6);
    return { ok: true };
  } catch {
    return { ok: false, error: "Erreur lors de l'enregistrement de vos questions fréquentes." };
  }
}
