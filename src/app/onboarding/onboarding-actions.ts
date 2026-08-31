"use server";

import { createOrganization } from "@/application/services/onboarding-service";
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
 */
export interface OnboardingStepResult {
  ok: boolean;
  error?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

/** Étape 1 (obligatoire) — réutilise onboarding-service.ts::createOrganization tel quel. */
export async function submitBusinessStep(
  name: string,
  industry: string,
): Promise<OnboardingStepResult & { organizationId?: string }> {
  try {
    const { organizationId } = await createOrganization({ name, industry: industry || undefined });
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
    return { ok: true };
  } catch {
    return { ok: false, error: "Erreur lors de l'enregistrement de vos coordonnées." };
  }
}

/** Étape 4 (optionnelle) — premier produit, réutilise catalog-service.ts::createProduct. */
export async function submitProductStep(organizationId: string, formData: FormData): Promise<OnboardingStepResult> {
  await requireMembership(organizationId, ["owner", "admin"]);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: true }; // étape sautée : rien à faire, jamais bloquant

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

    if (rows.length === 0) return { ok: true }; // étape sautée

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from("faqs").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch {
    return { ok: false, error: "Erreur lors de l'enregistrement de vos questions fréquentes." };
  }
}
