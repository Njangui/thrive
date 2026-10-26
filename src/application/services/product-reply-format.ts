import type { AssistantProductHit, ProductCategoryEntry } from "./product-search-service";
import type { ParsedProductQuery } from "./product-query-parser";
import { DEFAULT_LIBRARY, type MessageLibrary } from "./message-library";

/**
 * C3 — mise en forme (pure) des réponses produit. Les phrases de routine viennent
 * de la bibliothèque de messages (voix de marque) ; les prix, promotions et liens
 * viennent UNIQUEMENT de la base, jamais d'un gabarit ni d'un modèle.
 */

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const MAX_DESCRIPTION_LENGTH = 120;

/** Reformule la demande de prix du client avec SES chiffres (jamais un chiffre inventé). */
export function describePriceRequest(query: Pick<ParsedProductQuery, "minPrice" | "maxPrice" | "budget" | "priceIntent">): string | null {
  if (!query.priceIntent || query.budget === null) return null;
  switch (query.priceIntent) {
    case "max":
      return `à moins de ${fcfa(query.budget)}`;
    case "min":
      return `à partir de ${fcfa(query.budget)}`;
    case "between":
      return query.minPrice !== null && query.maxPrice !== null ? `entre ${fcfa(query.minPrice)} et ${fcfa(query.maxPrice)}` : null;
    case "around":
      return `autour de ${fcfa(query.budget)}`;
  }
}

function clampDescription(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_DESCRIPTION_LENGTH) return flat;
  const cut = flat.slice(0, MAX_DESCRIPTION_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_DESCRIPTION_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function productBlock(products: AssistantProductHit[], publicBaseUrl: string): string[] {
  const lines: string[] = [];
  for (const p of products) {
    lines.push(p.name);
    lines.push(p.isPromo && p.compareAtPrice !== null ? `${fcfa(p.unitPrice)} (au lieu de ${fcfa(p.compareAtPrice)})` : fcfa(p.unitPrice));
    if (p.categoryName) lines.push(p.categoryName);
    if (p.description) lines.push(clampDescription(p.description));
    if (p.slug) lines.push(`${publicBaseUrl}/produits/${p.slug}`);
    lines.push("");
  }
  return lines;
}

export interface ProductSearchReplyContext {
  publicBaseUrl: string;
  catalogUrl: string;
  itemLabelPlural: string;
  priceRequest: Pick<ParsedProductQuery, "minPrice" | "maxPrice" | "budget" | "priceIntent">;
  relaxed: boolean;
  library?: MessageLibrary;
}

/**
 * Réponse quand le client a donné un budget : dit honnêtement si rien n'entre
 * dans la fourchette, affiche le prix de base et la promotion seulement si
 * elle est en cours.
 */
export function formatProductSearchReply(products: AssistantProductHit[], context: ProductSearchReplyContext): string {
  const library = context.library ?? DEFAULT_LIBRARY;
  const request = describePriceRequest(context.priceRequest);
  const intro = context.relaxed
    ? library.render("search_relaxed", { request: request ?? "dans ce budget" })
    : request
      ? library.render("search_intro_budget", { request })
      : library.render("search_intro");
  return [intro, "", ...productBlock(products, context.publicBaseUrl), library.render("see_all", { items: context.itemLabelPlural, url: context.catalogUrl })].join("\n");
}

export interface ProductListReplyContext {
  publicBaseUrl: string;
  catalogUrl: string;
  itemLabelPlural: string;
  library?: MessageLibrary;
}

/** « Présentez-moi vos produits » : introduction de la bibliothèque + articles de la base. */
export function formatProductListReply(products: AssistantProductHit[], context: ProductListReplyContext): string {
  const library = context.library ?? DEFAULT_LIBRARY;
  return [
    library.render("product_intro", { items: context.itemLabelPlural }),
    "",
    ...productBlock(products, context.publicBaseUrl),
    library.render("see_all", { items: context.itemLabelPlural, url: context.catalogUrl }),
  ].join("\n");
}

export function formatCategoryListReply(categories: ProductCategoryEntry[], catalogUrl: string, itemLabelPlural: string, library: MessageLibrary = DEFAULT_LIBRARY): string {
  const lines = [library.render("categories_intro", { items: itemLabelPlural }), ""];
  for (const c of categories) lines.push(`• ${c.name} (${c.productCount})`);
  lines.push("", library.render("categories_outro"), library.render("see_all", { items: itemLabelPlural, url: catalogUrl }));
  return lines.join("\n");
}

