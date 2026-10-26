import { CatalogSpecificationSchema, type CatalogSpecification } from "@/domain/entities/catalog";

/** Sépare sur "|", nettoie, et ne garde que des URLs http(s) valides — une URL cassée est ignorée, pas bloquante pour le reste de la ligne. */
export function parseImageUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split("|")
    .map((u) => u.trim())
    .filter(isHttpUrl);
}

/** Audit CAT1 : seuls http: et https: sont acceptés (jamais javascript:, data:, file:...). Longueur bornée. */
export function isHttpUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** `image_urls` (plusieurs) est prioritaire ; `image_url` (une seule, historique) sert de repli. */
export function resolveImageUrls(data: { image_url?: string; image_urls?: string }): string[] {
  if (data.image_urls) return parseImageUrls(data.image_urls);
  if (data.image_url) return parseImageUrls(data.image_url);
  return [];
}

/** "Libellé:Valeur|Libellé2:Valeur2" -> paires validées (CatalogSpecificationSchema), une paire mal formée est ignorée plutôt que de faire échouer les autres. Plafonné à 12, comme CatalogSpecificationsSchema. */
export function parseSpecifications(raw: string | undefined): CatalogSpecification[] {
  if (!raw) return [];
  const valid: CatalogSpecification[] = [];
  for (const entry of raw.split("|")) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex === -1) continue;
    const candidate = {
      label: entry.slice(0, separatorIndex).trim(),
      value: entry.slice(separatorIndex + 1).trim(),
    };
    const parsed = CatalogSpecificationSchema.safeParse(candidate);
    if (parsed.success) valid.push(parsed.data);
    if (valid.length >= 12) break;
  }
  return valid;
}
