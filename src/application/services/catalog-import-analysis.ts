import { parseImageUrls, parseSpecifications } from "./catalog-import-service-parsers";
import type { CatalogSpecification } from "@/domain/entities/catalog";

/**
 * Analyse PURE d'un tableau de catalogue désordonné (C4, livrable A).
 * Aucun accès base, aucun appel IA : règles d'abord (principe 2). Ne
 * jamais inventer un prix ni un stock (brief C4) : une valeur absente ou
 * illisible est signalée, jamais remplacée par une valeur plausible.
 */

export type CanonicalField =
  | "name" | "price" | "cost_price" | "category" | "description"
  | "stock" | "sku" | "image_urls" | "status" | "specifications";

/** Minuscules, sans accents ni ponctuation, espaces simples. */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SYNONYMS: Record<CanonicalField, string[]> = {
  name: ["nom", "nom produit", "nom du produit", "produit", "designation", "libelle", "article", "titre", "name", "product", "product name", "item"],
  price: ["prix", "prix vente", "prix de vente", "pv", "tarif", "price", "prix ttc", "prix unitaire", "pu", "montant"],
  cost_price: ["prix achat", "prix d achat", "cout", "cout d achat", "pa", "cost", "cost price", "prix de revient"],
  category: ["categorie", "famille", "rayon", "type", "category", "collection"],
  description: ["description", "desc", "details", "detail", "presentation"],
  stock: ["stock", "quantite", "qte", "qty", "quantity", "disponible", "en stock"],
  sku: ["sku", "reference", "ref", "code", "code article", "code produit"],
  image_urls: ["image", "images", "photo", "photos", "lien image", "url image", "image url", "image urls", "image_urls"],
  status: ["statut", "status", "etat"],
  specifications: ["specifications", "caracteristiques", "attributs"],
};

export interface ColumnMapping {
  /** champ canonique -> en-tête d'origine */
  fields: Partial<Record<CanonicalField, string>>;
  /** en-têtes qu'aucune règle n'a reconnus (rien n'est perdu en silence : ils sont rapportés). */
  unmapped: string[];
}

/** Devine le mapping d'après les en-têtes. Correspondance exacte d'abord, puis mots-clés ; un en-tête n'alimente qu'un seul champ. */
export function guessColumnMapping(headers: string[]): ColumnMapping {
  const fields: Partial<Record<CanonicalField, string>> = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => ({ raw: h, key: normalizeKey(h) }));

  const claim = (field: CanonicalField, header: string) => {
    if (fields[field] === undefined && !used.has(header)) {
      fields[field] = header;
      used.add(header);
    }
  };

  // 1) correspondance exacte avec un synonyme
  for (const field of Object.keys(SYNONYMS) as CanonicalField[]) {
    const hit = normalized.find((h) => SYNONYMS[field].includes(h.key) && !used.has(h.raw));
    if (hit) claim(field, hit.raw);
  }

  // 2) repli par mot-clé — le coût AVANT le prix, car « prix d'achat » contient « prix »
  const keyword = (field: CanonicalField, test: (key: string) => boolean) => {
    if (fields[field] !== undefined) return;
    const hit = normalized.find((h) => !used.has(h.raw) && test(h.key));
    if (hit) claim(field, hit.raw);
  };
  keyword("cost_price", (k) => /\b(achat|cout|revient)\b/.test(k));
  keyword("price", (k) => /\b(prix|tarif|price)\b/.test(k));
  keyword("name", (k) => /\b(nom|produit|designation|libelle|article)\b/.test(k));
  keyword("stock", (k) => /\b(stock|quantite|qte|qty)\b/.test(k));
  keyword("image_urls", (k) => /\b(photo|photos|image|images)\b/.test(k));
  keyword("category", (k) => /\b(categorie|famille|rayon)\b/.test(k));

  return { fields, unmapped: headers.filter((h) => !used.has(h)) };
}

/**
 * Lecture tolérante d'un prix : « 35 000 FCFA », « 35.000 », « 1,500 », « 12,5 ».
 * Retourne null si la valeur est absente ou ambiguë — jamais une valeur devinée.
 * Convention : un séparateur suivi d'exactement 3 chiffres est un séparateur de milliers (le FCFA n'a pas de décimales).
 */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let text = raw
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/(fcfa|f\.?cfa|xaf|xof|cfa|frs?|€|\$|eur|usd)/gi, "")
    .replace(/f$/i, ""); // « 5000F »
  if (text === "") return null;
  if (!/^\d[\d.,]*$/.test(text) || /[.,]$/.test(text)) return null;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  const countOf = (c: string) => text.split(c).length - 1;

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    text = text.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const digitsAfter = text.length - text.lastIndexOf(sep) - 1;
    if (countOf(sep) > 1) {
      // Séparateur répété : seulement valable comme milliers (groupes de 3 chiffres), sinon ambigu.
      if (!new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(text)) return null;
      text = text.split(sep).join("");
    } else if (digitsAfter === 3) {
      text = text.split(sep).join(""); // milliers
    } else if (digitsAfter >= 1 && digitsAfter <= 2) {
      text = text.replace(sep, "."); // décimale
    } else {
      return null;
    }
  }
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export interface PreparedProduct {
  row: number;
  name: string;
  price: number;
  costPrice?: number;
  /** Stock lu ; 0 + stockKnown=false si la colonne est absente ou vide (la colonne SQL est non nulle). */
  stock: number;
  stockKnown: boolean;
  sku?: string;
  category?: string;
  description?: string;
  imageUrls: string[];
  specifications: CatalogSpecification[];
}

export interface ClarificationItem { row: number; name: string; reasons: string[] }
export interface DuplicateItem { row: number; name: string; reason: "sku" | "name"; scope: "file" | "catalog" }

export interface CatalogAnalysis {
  mapping: ColumnMapping;
  ready: PreparedProduct[];
  needsClarification: ClarificationItem[];
  duplicates: DuplicateItem[];
  warnings: string[];
}

export interface ExistingCatalogKeys {
  names: Set<string>; // normalizeKey(nom)
  skus: Set<string>;  // sku en minuscules
}

export function analyzeCatalogRows(
  rows: Record<string, string>[],
  headers: string[],
  existing: ExistingCatalogKeys,
): CatalogAnalysis {
  const mapping = guessColumnMapping(headers);
  const warnings: string[] = [];
  const f = mapping.fields;
  if (!f.name) warnings.push("Aucune colonne « nom » reconnue : aucun produit ne peut être créé.");
  if (!f.price) warnings.push("Aucune colonne « prix » reconnue : tous les produits demanderont une précision.");
  if (!f.stock) warnings.push("Aucune colonne « stock » reconnue : les stocks restent à 0 (non renseignés), rien n'est inventé.");
  if (mapping.unmapped.length > 0) warnings.push(`Colonnes ignorées : ${mapping.unmapped.join(", ")}.`);

  const cell = (row: Record<string, string>, field: CanonicalField): string => {
    const header = f[field];
    return header ? (row[header] ?? "").toString().trim() : "";
  };

  const ready: PreparedProduct[] = [];
  const needsClarification: ClarificationItem[] = [];
  const duplicates: DuplicateItem[] = [];
  const seenNames = new Set<string>();
  const seenSkus = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // en-tête = ligne 1
    const name = cell(row, "name");
    const reasons: string[] = [];

    if (!name) reasons.push("nom manquant");
    const price = parseAmount(cell(row, "price"));
    if (price === null) reasons.push(cell(row, "price") ? "prix illisible" : "prix manquant");

    const rawStock = cell(row, "stock");
    const stockParsed = rawStock === "" ? null : parseAmount(rawStock);
    if (rawStock !== "" && stockParsed === null) reasons.push("stock illisible");

    if (reasons.length > 0 || price === null) {
      needsClarification.push({ row: rowNumber, name: name || "(sans nom)", reasons });
      return;
    }

    const sku = cell(row, "sku") || undefined;
    const nameKey = normalizeKey(name);
    const skuKey = sku?.toLowerCase();

    if (skuKey && (existing.skus.has(skuKey) || seenSkus.has(skuKey))) {
      duplicates.push({ row: rowNumber, name, reason: "sku", scope: existing.skus.has(skuKey) ? "catalog" : "file" });
      return;
    }
    if (existing.names.has(nameKey) || seenNames.has(nameKey)) {
      duplicates.push({ row: rowNumber, name, reason: "name", scope: existing.names.has(nameKey) ? "catalog" : "file" });
      return;
    }
    seenNames.add(nameKey);
    if (skuKey) seenSkus.add(skuKey);

    const rawCost = cell(row, "cost_price");
    const cost = rawCost ? parseAmount(rawCost) : null;
    if (rawCost && cost === null) warnings.push(`Ligne ${rowNumber} : prix d'achat illisible, ignoré.`);

    ready.push({
      row: rowNumber,
      name,
      price,
      costPrice: cost ?? undefined,
      stock: stockParsed ?? 0,
      stockKnown: stockParsed !== null,
      sku,
      category: cell(row, "category") || undefined,
      description: cell(row, "description") || undefined,
      imageUrls: parseImageUrls(cell(row, "image_urls")),
      specifications: parseSpecifications(cell(row, "specifications")),
    });
  });

  return { mapping, ready, needsClarification, duplicates, warnings };
}
