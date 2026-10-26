import { ValidationError } from "@/lib/errors";

/**
 * Lecture d'un classeur Excel (.xlsx) pour l'import de catalogue (C4).
 *
 * Le classeur est converti en TEXTE CSV, puis suit exactement le même chemin
 * que l'import CSV (analyse, doublons, brouillons) : une seule logique métier.
 * Aucune formule n'est évaluée (on lit le dernier résultat enregistré), aucune
 * macro n'est lue, rien n'est envoyé à un service externe.
 *
 * Dépendance : `exceljs` (à installer : `npm install exceljs@4.4.0 --save-exact`,
 * qui met à jour package.json ET le lockfile). Le code pur de ce fichier
 * (garde d'archive, normalisation, détection d'en-tête, CSV) n'en dépend pas.
 */

export const MAX_XLSX_ROWS = 20_000;
export const MAX_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const MAX_XLSX_ZIP_ENTRIES = 1_000;
const HEADER_SEARCH_ROWS = 15;

// ---------------------------------------------------------------------------
// Garde d'archive (bombe de décompression)
// ---------------------------------------------------------------------------

/** `true` si les octets commencent par la signature d'une archive ZIP (« PK »), ce qu'est un .xlsx. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

/**
 * Refuse une archive dont la taille décompressée DÉCLARÉE est excessive, AVANT de la
 * charger en mémoire. Lecture du seul répertoire central du ZIP. Garde de base : les
 * tailles déclarées peuvent être falsifiées, donc ce n'est qu'une première barrière
 * (la taille du fichier envoyé reste bornée à 5 Mo en amont) — pas une garantie complète.
 */
export function assertSafeXlsxArchive(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => new ValidationError("Fichier Excel illisible ou non pris en charge. Enregistrez-le de nouveau en .xlsx ou en CSV.");

  // Fin de répertoire central : signature 0x06054b50, dans les 66 Ko de fin du fichier.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw invalid();

  const entryCount = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) throw invalid(); // ZIP64 : non pris en charge
  if (entryCount > MAX_XLSX_ZIP_ENTRIES) throw new ValidationError("Fichier Excel trop complexe.");

  let offset = directoryOffset;
  let total = 0;
  for (let n = 0; n < entryCount; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw invalid();
    total += view.getUint32(offset + 24, true);
    if (total > MAX_XLSX_UNCOMPRESSED_BYTES) throw new ValidationError("Fichier Excel trop volumineux une fois décompressé.");
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

// ---------------------------------------------------------------------------
// Normalisation (pur)
// ---------------------------------------------------------------------------

/** Valeur de cellule ExcelJS -> texte. Formules : dernier résultat ; lien hypertexte : l'adresse ; jamais « [object Object] ». */
export function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.hyperlink === "string" && v.hyperlink) return v.hyperlink.trim();
    if (Array.isArray(v.richText)) return v.richText.map((part) => String((part as { text?: unknown }).text ?? "")).join("").trim();
    if ("result" in v) return normalizeCellValue(v.result); // formule / formule partagée
    if (typeof v.text === "string") return v.text.trim();
    if (typeof v.error === "string") return ""; // #N/A, #REF!… : valeur absente, pas inventée
  }
  return "";
}

const nonEmptyCount = (row: string[]) => row.filter((cell) => cell !== "").length;

/**
 * Ligne d'en-tête : la première des 15 premières lignes qui a au moins 2 cellules remplies
 * ET est suivie d'une ligne d'au moins 2 cellules. Ignore les titres, logos et lignes vides
 * placés au-dessus du tableau. Repli : la première ligne.
 */
export function pickHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, rows.length); i++) {
    if (nonEmptyCount(rows[i]!) >= 2 && nonEmptyCount(rows[i + 1] ?? []) >= 2) return i;
  }
  return 0;
}

function csvCell(value: string): string {
  return /[",;\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface RowsToCsvResult { csv: string; skippedRowsAboveHeader: number; columns: number }

/** Lignes de texte -> CSV (virgule, guillemets doublés). En-têtes vides nommés « Colonne N » ; lignes vides et colonnes vides de fin retirées. */
export function rowsToCsv(rows: string[][]): RowsToCsvResult {
  const headerIndex = pickHeaderRow(rows);
  const headerRow = rows[headerIndex] ?? [];
  let width = headerRow.length;
  while (width > 0 && headerRow[width - 1] === "") width--; // colonnes vides à droite
  const header = Array.from({ length: width }, (_, i) => headerRow[i] || `Colonne ${i + 1}`);

  const body = rows
    .slice(headerIndex + 1)
    .filter((row) => nonEmptyCount(row) > 0)
    .map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));

  const csv = [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n");
  return { csv, skippedRowsAboveHeader: headerIndex, columns: width };
}

// ---------------------------------------------------------------------------
// Lecture du classeur (dépend d'exceljs)
// ---------------------------------------------------------------------------

export interface XlsxConversion {
  csv: string;
  sheetName: string;
  /** Autres feuilles contenant des données, NON lues (le commerçant doit le savoir). */
  ignoredSheets: string[];
  skippedRowsAboveHeader: number;
}

export async function xlsxToCsv(bytes: Uint8Array): Promise<XlsxConversion> {
  if (!looksLikeZip(bytes)) {
    throw new ValidationError("Ce fichier n'est pas un classeur .xlsx. Les anciens fichiers .xls ne sont pas pris en charge : enregistrez-le en .xlsx ou en CSV.");
  }
  assertSafeXlsxArchive(bytes);

  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    throw new ValidationError("Fichier Excel illisible (protégé par mot de passe ou endommagé ?). Enregistrez-le de nouveau en .xlsx ou en CSV.");
  }

  const withData: { name: string; rows: string[][] }[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible") continue; // feuilles masquées : jamais lues
    if (sheet.rowCount > MAX_XLSX_ROWS + HEADER_SEARCH_ROWS) {
      throw new ValidationError(`La feuille « ${sheet.name} » dépasse ${MAX_XLSX_ROWS.toLocaleString("fr-FR")} lignes : découpez le fichier.`);
    }
    const columns = sheet.columnCount;
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      rows.push(Array.from({ length: columns }, (_, c) => normalizeCellValue(row.getCell(c + 1).value)));
    });
    if (rows.some((row) => nonEmptyCount(row) > 0)) withData.push({ name: sheet.name, rows });
  }

  const first = withData[0];
  if (!first) throw new ValidationError("Le classeur ne contient aucune donnée dans ses feuilles visibles.");

  const { csv, skippedRowsAboveHeader } = rowsToCsv(first.rows);
  return { csv, sheetName: first.name, ignoredSheets: withData.slice(1).map((s) => s.name), skippedRowsAboveHeader };
}
