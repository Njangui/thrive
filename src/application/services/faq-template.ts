/**
 * C3 — variables dynamiques des réponses de FAQ (livrable F). Code pur, sans dépendance.
 * Prix, horaires, adresse, contact et lien catalogue ne sont JAMAIS figés dans une
 * réponse : ils sont lus au moment de répondre (principe 3).
 */

// Tout ce qui est entre accolades est une variable : une faute de frappe doit être signalée, pas affichée au client.
const VARIABLE_RE = /\{([^{}\n]{1,60})\}/g;
const FIXED_VARIABLES = new Set(["hours", "address", "contact", "catalog_url", "delivery_zones"]);
const DELIVERY_VARIABLE_RE = /^delivery:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRICE_VARIABLE_RE = /^price:[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FAQ_AMOUNT_RE = /\d[\d  .,]*\s?(?:fcfa|cfa|xaf|francs?)\b/i;

export function extractFaqVariables(answer: string): string[] {
  return [...new Set([...answer.matchAll(VARIABLE_RE)].map((m) => m[1] ?? "").filter(Boolean))];
}

export interface FaqTemplateCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Erreurs : variable inconnue (le client verrait « {xyz} »). Avertissements :
 * montant écrit en dur — un prix change, il doit venir de la base (`{price:slug}`).
 * Avertissement et non erreur : une FAQ existante (« Livraison 1 500 FCFA ») ne doit pas
 * devenir impossible à modifier tant qu'aucune variable de livraison n'existe.
 */
export function checkFaqTemplate(answer: string): FaqTemplateCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const variable of extractFaqVariables(answer)) {
    if (!FIXED_VARIABLES.has(variable) && !PRICE_VARIABLE_RE.test(variable) && !DELIVERY_VARIABLE_RE.test(variable)) errors.push(`variable {${variable}} inconnue (disponibles : {hours}, {address}, {contact}, {catalog_url}, {delivery_zones}, {delivery:identifiant-de-la-zone}, {price:identifiant-du-produit})`);
  }
  if (FAQ_AMOUNT_RE.test(answer)) warnings.push("montant écrit en dur : s'il change, cette réponse deviendra fausse (pour un produit, utilisez {price:identifiant-du-produit})");
  return { errors, warnings };
}

/** Remplace les variables par leurs valeurs ; `null` si l'une est introuvable (la FAQ n'est alors PAS utilisée : jamais de donnée périmée). */
export function renderFaqAnswer(answer: string, values: Record<string, string | null | undefined>): string | null {
  let missing = false;
  const out = answer.replace(VARIABLE_RE, (_m, name: string) => {
    const value = values[name];
    if (value === null || value === undefined || value === "") {
      missing = true;
      return "";
    }
    return value;
  });
  return missing ? null : out;
}

