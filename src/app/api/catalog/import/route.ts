import { NextResponse } from "next/server";
import { requireMembership } from "@/application/services/auth-service";
import { importProductsFromCsv } from "@/application/services/catalog-import-service";
import { importCatalogSmart } from "@/application/services/catalog-smart-import-service";
import { looksLikeZip, xlsxToCsv } from "@/application/services/catalog-xlsx";
import { isModuleEnabled } from "@/application/services/module-service";
import { AppError, toClientErrorResponse, ValidationError } from "@/lib/errors";

const MAX_SMART_IMPORT_BYTES = 5 * 1024 * 1024;
/** Audit CAT2 : durée maximale déclarée (import séquentiel). */
export const maxDuration = 60;

/**
 * Lit le fichier envoyé : classeur Excel (.xlsx, reconnu à sa signature ZIP) converti en CSV
 * puis traité comme un CSV, ou CSV décodé. Les CSV exportés par Excel (français) sont souvent
 * en Windows-1252, pas en UTF-8 : lus en UTF-8 les accents deviendraient « � » — on tente
 * UTF-8 strict, puis Windows-1252. `notes` : ce que le commerçant doit savoir de la lecture
 * (feuilles ignorées, lignes au-dessus de l'en-tête sautées). Mode smart uniquement.
 */
async function readCatalogFile(file: Blob): Promise<{ text: string; notes: string[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file instanceof File ? file.name.toLowerCase() : "";

  if (looksLikeZip(bytes)) {
    const sheet = await xlsxToCsv(bytes);
    const notes = [`Feuille « ${sheet.sheetName} » lue.`];
    if (sheet.ignoredSheets.length > 0) notes.push(`Autres feuilles contenant des données, NON lues : ${sheet.ignoredSheets.join(", ")}.`);
    if (sheet.skippedRowsAboveHeader > 0) notes.push(`${sheet.skippedRowsAboveHeader} ligne(s) au-dessus de l'en-tête ignorée(s).`);
    return { text: sheet.csv, notes };
  }
  if (name.endsWith(".xls") || name.endsWith(".ods")) {
    throw new ValidationError("Ce format n'est pas pris en charge. Enregistrez le fichier en .xlsx ou en CSV.");
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), notes: [] };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), notes: [] };
  }
}

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

    // `mode` (champ optionnel) : absent = import CSV historique, inchangé.
    //  - "smart_preview" : analyse seule (aucune écriture), pour afficher le rapport avant d'importer.
    //  - "smart"         : colonnes devinées, doublons ignorés, tout créé en brouillon.
    const mode = formData.get("mode");
    if (mode === "smart" || mode === "smart_preview") {
      if (file.size > MAX_SMART_IMPORT_BYTES) throw new ValidationError("Fichier trop volumineux (5 Mo maximum).");
      const { text, notes } = await readCatalogFile(file);
      const report = await importCatalogSmart(organizationId, text, membership.userId, { dryRun: mode === "smart_preview" });
      return NextResponse.json({ ...report, warnings: [...notes, ...report.warnings] });
    }

    if (file.size > MAX_SMART_IMPORT_BYTES) throw new ValidationError("Fichier trop volumineux (5 Mo maximum).");
    const result = await importProductsFromCsv(organizationId, await file.text(), membership.userId);

    return NextResponse.json(result);
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("Import CSV catalogue: erreur inattendue:", error);
    }
    const { status, body } = toClientErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
