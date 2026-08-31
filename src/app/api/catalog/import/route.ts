import { NextResponse } from "next/server";
import { requireMembership } from "@/application/services/auth-service";
import { importProductsFromCsv } from "@/application/services/catalog-import-service";
import { isModuleEnabled } from "@/application/services/module-service";
import { AppError, toClientErrorResponse, ValidationError } from "@/lib/errors";

/**
 * Première route "admin" authentifiée du projet — sert aussi de gabarit
 * pour toutes les prochaines (produit CRUD, finance, etc.) :
 *   1. requireMembership (section 34/35 : auth + rôle, seconde barrière
 *      en plus de RLS)
 *   2. isModuleEnabled (section 33 : le module catalog doit être actif)
 *   3. validation d'entrée
 *   4. logique métier déléguée au service applicatif
 *   5. erreurs mappées via AppError -> jamais de détail interne exposé
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const organizationId = formData.get("organizationId");
    const file = formData.get("file");

    if (typeof organizationId !== "string" || !organizationId) {
      throw new ValidationError("organizationId requis");
    }
    if (!(file instanceof Blob)) {
      throw new ValidationError("Fichier CSV requis (champ 'file')");
    }

    const membership = await requireMembership(organizationId, ["owner", "admin", "manager"]);

    if (!(await isModuleEnabled(organizationId, "catalog"))) {
      throw new ValidationError("Module catalogue désactivé pour cette organisation");
    }

    const csvText = await file.text();
    const result = await importProductsFromCsv(organizationId, csvText, membership.userId);

    return NextResponse.json(result);
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("Import CSV catalogue: erreur inattendue:", error);
    }
    const { status, body } = toClientErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
