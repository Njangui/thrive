/**
 * Modèles WhatsApp (Meta) du back-office et utilitaires purs : catalogue,
 * paramètres, fenêtre de 24 h, classification des échecs.
 *
 * Confirmé (docs.zernio.com/platforms/whatsapp/templates, oct. 2026) :
 *  - création : POST /v1/whatsapp/templates { accountId, name, category, language, components[] } ;
 *  - envoi hors fenêtre : POST /v1/inbox/conversations { accountId, participantId (chiffres, sans +),
 *    templateName, templateLanguage (identique à la création), templateParams (tableau plat) } ;
 *  - seuls les modèles APPROVED sont envoyables.
 * Règles Meta respectées : variables positionnelles, jamais au tout début ni à la toute fin du texte,
 * pas de retour à la ligne ni 4 espaces consécutifs dans une valeur.
 */

export type TemplateKey = "alert" | "approval_request" | "daily_summary";
export type TemplateStatus = "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED" | "IN_APPEAL" | "PAUSED" | "DISABLED" | "PENDING_DELETION";

export interface TemplateDef {
  key: TemplateKey;
  /** Nom côté Meta : minuscules/chiffres/_ ; suffixe de version pour pouvoir republier un texte modifié. */
  name: string;
  language: "fr";
  category: "UTILITY";
  body: string;
  paramCount: number;
  /** Exemples fournis à la revue Meta (un par variable). */
  example: string[];
  label: string;
}

export const TEMPLATE_CATALOG: readonly TemplateDef[] = [
  {
    key: "alert", name: "flexco_alerte_v1", language: "fr", category: "UTILITY", paramCount: 2, label: "Alerte",
    body: "Alerte Flexco : {{1}}. {{2}} Répondez VU pour confirmer que vous l'avez vue.",
    example: ["Rupture de stock", "Le produit Savon 500 g est épuisé."],
  },
  {
    key: "approval_request", name: "flexco_validation_v1", language: "fr", category: "UTILITY", paramCount: 1, label: "Demande de validation",
    body: "Flexco : une action attend votre validation ({{1}}). Ouvrez votre tableau de bord pour la valider ou la refuser.",
    example: ["Remboursement de la commande 12"],
  },
  {
    key: "daily_summary", name: "flexco_bilan_v1", language: "fr", category: "UTILITY", paramCount: 3, label: "Bilan du jour",
    body: "Bilan Flexco du jour : {{1}}. Commandes : {{2}}. Encaissements : {{3}}. Répondez à ce message pour poser une question.",
    example: ["Mardi 6 octobre", "8 commandes", "120 000 FCFA"],
  },
];

export const templateByKey = (key: string): TemplateDef | undefined => TEMPLATE_CATALOG.find((t) => t.key === key);

/** Corps du composant `body` tel qu'attendu par Zernio. */
export function buildCreateComponents(def: TemplateDef): unknown[] {
  return [{ type: "body", text: def.body, example: { body_text: [def.example] } }];
}

/**
 * Valeur de variable conforme Meta : pas de retour à la ligne/tabulation, pas de 4 espaces
 * consécutifs, jamais vide, bornée.
 */
export function sanitizeTemplateParam(value: string, max = 200): string {
  const clean = value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, max).trim();
  return clean === "" ? "-" : clean;
}

export function buildTemplateParams(def: TemplateDef, values: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < def.paramCount; i += 1) out.push(sanitizeTemplateParam(values[i] ?? ""));
  return out;
}

/** `+237 6 99…` -> `237699…` (format `participantId` de Zernio : chiffres, sans +). */
export function toParticipantId(e164: string): string | null {
  const digits = e164.replace(/\D/g, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Fenêtre de service de 24 h ouverte par le dernier message ENTRANT du membre. */
export function isSessionWindowOpen(lastInboundAt: string | null | undefined, nowMs: number): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) && nowMs - t < SESSION_WINDOW_MS && nowMs >= t;
}

export type FailureCause = "payment" | "window" | "other";

/**
 * Classification BEST-EFFORT du texte d'erreur d'un message.failed : codes d'erreur Meta
 * 131042 (problème d'éligibilité / moyen de paiement) et 131047 / 131026 (hors fenêtre de 24 h,
 * ré-engagement requis), ou mots-clés. Le format exact du champ d'erreur Zernio n'est pas
 * confirmé : une classification « payment » est une PRÉSOMPTION affichée comme telle.
 */
export function classifyFailure(errorMessage: string | undefined | null): FailureCause {
  const t = (errorMessage ?? "").toLowerCase();
  if (/\b131042\b|payment method|moyen de paiement|billing|eligibility/.test(t)) return "payment";
  if (/\b131047\b|re-?engagement|24[- ]?hour|fen[êe]tre de 24/.test(t)) return "window";
  return "other";
}
