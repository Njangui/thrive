import { normalizeMessage } from "./message-intents";
import type { MessageLibrary } from "./message-library";

/**
 * C3 — assistant des commentaires publics (livrable G). Code pur, sans I/O.
 *
 * Règles d'abord, IA ensuite (principe 2) : spam, compliment, intention d'achat et
 * question de prix sont reconnus par le code. Les réponses publiques sont COURTES,
 * construites depuis la bibliothèque de messages (voix de marque) et les faits de la
 * base (prix du produit de la publication) ; elles invitent à continuer en message
 * privé. Un commentaire est une donnée non fiable (principe 6) : il ne devient jamais
 * du texte de réponse.
 */

export type CommentKind = "spam" | "spam_suspected" | "strong_intent" | "price_or_availability" | "praise" | "other";

export interface CommentClassification {
  kind: CommentKind;
  /** Noms des signaux déclenchés (jamais le contenu : minimisation). */
  signals: string[];
}

// ---------------------------------------------------------------------------
// Spam
// ---------------------------------------------------------------------------

/** Une seule occurrence suffit : formulations qu'aucun client réel n'écrit sous une publication. */
const STRONG_SPAM: Array<[string, RegExp]> = [
  ["lottery", /\b(loterie|vous avez gagne|felicitations vous avez gagne|you have won)\b/],
  ["betting", /\b(1xbet|betting|casino|paris sportifs?)\b/],
  ["pharma", /\b(viagra|cialis)\b/],
  ["crypto", /\b(forex|bitcoin|binance|crypto monnaie|cryptomonnaie|trading)\b/],
  ["easy_money", /\bgagn\w* \d+ ?(fcfa|euros?|dollars?|usd) (par|en) (jour|heure|semaine)\b/],
  ["work_from_home", /\btravail a domicile\b/],
  ["romance_scam", /\bsugar (daddy|mummy|mommy)\b/],
  ["account_scam", /\b(hack\w* (de )?compte|recuper\w* votre compte)\b/],
  ["free_followers", /\b(followers|abonnes) (gratuits|offerts)\b/],
  ["click_here", /\b(cliquez ici|click here|clique sur le lien|cliquez sur le lien)\b/],
];

/** Chaque signal faible vaut 1 ; deux signaux = spam, un lien seul = suspect. */
const URL_RE = /(https?:\/\/|www\.|\bbit\.ly\b|\bt\.me\b|\b[a-z0-9-]+\.(com|net|org|info|xyz|ru|top|cc|ly|shop|store)\b)/i;
const SOLICIT_RE = /\b(dm me|ecris moi sur (telegram|whatsapp|insta\w*)|ecrivez moi sur (telegram|whatsapp|insta\w*)|contactez moi sur (telegram|whatsapp)|check (my|out)|visit my|inbox me)\b/;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function weakSignals(raw: string, normalized: string): string[] {
  const signals: string[] = [];
  if (URL_RE.test(raw)) signals.push("link");
  if (SOLICIT_RE.test(normalized)) signals.push("solicitation");
  const compact = Array.from(raw.replace(/\s/g, ""));
  if (compact.length > 8 && (raw.match(EMOJI_RE) ?? []).length / compact.length > 0.5) signals.push("emoji_flood");
  if (/(.)\1{7,}/u.test(raw)) signals.push("repeated_characters");
  const letters = raw.replace(/[^\p{L}]/gu, "");
  if (letters.length > 15 && letters.replace(/[^\p{Lu}]/gu, "").length / letters.length > 0.7) signals.push("shouting");
  const words = normalized.split(" ").filter((w) => w.length > 2);
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  if ([...counts.values()].some((n) => n >= 6)) signals.push("repeated_word");
  return signals;
}

// ---------------------------------------------------------------------------
// Intentions
// ---------------------------------------------------------------------------

const NEGATED_INTENT_RE = /\b(ne (le |la |les )?(veux|prends|prend|commande|achete)|pas interess\w*|plus interess\w*|not interested)\b/;
const STRONG_INTENT_RE = /\b(je (le |la |les )?(veux|prends|prend|commande|achete|reserve)|je voudrais (en )?(commander|acheter|prendre|reserver)|comment (commander|acheter|passer commande)|ou (acheter|commander)|passer commande|passez commande|interess\w*|i (want|will take|need) (to )?(buy|order|it)|how (do i|to) (order|buy)|where (to|can i) (buy|order))\b/;
const CONTACT_ME_RE = /\b(appelez|contactez|rappelez|call|contact) (moi|me)\b/;
const PHONE_RE = /\+?\d[\d ().\-]{7,}\d/;
const PRICE_OR_AVAILABILITY_RE = /\b(prix|combien|c est combien|tarif|how much|price|dispo\w*|disponible|en stock|il reste|taille|pointure|couleur)\b/;
const PRAISE_RE = /\b(super|magnifique|beau|belle|jolie?|top|genial|excellent|j adore|love|nice|wow|bravo|felicitations|waouh)\b/;

export function classifyComment(text: string): CommentClassification {
  const raw = text.normalize("NFKC").trim();
  const normalized = normalizeMessage(raw);

  const strong = STRONG_SPAM.filter(([, re]) => re.test(normalized)).map(([name]) => name);
  const weak = weakSignals(raw, normalized);
  if (strong.length > 0) return { kind: "spam", signals: [...strong, ...weak] };
  if (weak.length >= 2) {
    // Deux signaux faibles = spam seulement s'il s'agit de promotion (lien, sollicitation) : une rafale d'emojis ou de
    // majuscules sans lien est « suspecte » (ignorée), jamais masquée — un fan enthousiaste n'est pas un spammeur.
    const promotional = weak.includes("link") || weak.includes("solicitation");
    return { kind: promotional ? "spam" : "spam_suspected", signals: weak };
  }

  const negated = NEGATED_INTENT_RE.test(normalized);
  const intentSignals: string[] = [];
  if (!negated && STRONG_INTENT_RE.test(normalized)) intentSignals.push("buy_phrase");
  if (CONTACT_ME_RE.test(normalized) || (PHONE_RE.test(raw) && /\b(appelez|rappelez|contactez|whatsapp|commande|veux)\b/.test(normalized))) intentSignals.push("contact_request");
  if (intentSignals.length > 0) return { kind: "strong_intent", signals: intentSignals };

  // Un lien seul n'est qu'un indice : signalé, jamais masqué.
  if (weak.length === 1 && weak[0] === "link") return { kind: "spam_suspected", signals: weak };

  if (PRICE_OR_AVAILABILITY_RE.test(normalized)) return { kind: "price_or_availability", signals: ["price_or_availability"] };
  if (!negated && PRAISE_RE.test(normalized) && !raw.includes("?") && raw.length <= 80) return { kind: "praise", signals: ["praise"] };
  return { kind: "other", signals: weak };
}

// ---------------------------------------------------------------------------
// Réglages et plan d'action
// ---------------------------------------------------------------------------

export interface CommentAssistantSettings {
  /** Retrouver le produit via la publication pour répondre au prix (base, jamais le modèle). */
  usePostProduct: boolean;
  /** Terminer les réponses par une invitation en message privé. */
  inviteToDm: boolean;
  /** Créer un prospect (contact + lead) à partir d'une intention d'achat explicite. Données personnelles : opt-in. */
  createLeads: boolean;
  /** Masquer automatiquement le spam évident (Facebook / Instagram seulement). Opt-in. */
  hideSpam: boolean;
  /** Répondre publiquement à une plainte (accusé de réception + message privé) en plus de l'escalade. Opt-in. */
  complaintPublicAck: boolean;
  /** Remercier les compliments. Opt-in. */
  replyToPraise: boolean;
}

/** Valeurs quand le commerçant n'a rien réglé : utiles sans engager personne. */
export const DEFAULT_COMMENT_SETTINGS: CommentAssistantSettings = {
  usePostProduct: true,
  inviteToDm: true,
  createLeads: false,
  hideSpam: false,
  complaintPublicAck: false,
  replyToPraise: false,
};

/** Valeurs si la lecture des réglages échoue : ne rien faire de nouveau (comportement d'avant). */
export const FAIL_SAFE_COMMENT_SETTINGS: CommentAssistantSettings = {
  usePostProduct: false,
  inviteToDm: false,
  createLeads: false,
  hideSpam: false,
  complaintPublicAck: false,
  replyToPraise: false,
};

/** Masquage CONFIRMÉ uniquement sur Facebook, Instagram, Threads (voir le port de publication sociale). */
const HIDE_SUPPORTED = new Set(["facebook", "instagram", "threads"]);
export const supportsHide = (platform: string): boolean => HIDE_SUPPORTED.has(platform);

/** Un commentaire public reste court : au-delà, on invite à continuer en message privé. */
export const PUBLIC_SHORT_LIMIT = 320;

export interface CommentProduct {
  id: string;
  name: string;
  slug: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  /** Promotion réellement en cours (prix barré > prix, échéance non dépassée). */
  isPromo: boolean;
}

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/** Prix tel que stocké ; prix barré seulement si la promotion est en cours. */
export function formatCommentPrice(product: Pick<CommentProduct, "unitPrice" | "compareAtPrice" | "isPromo">): string {
  return product.isPromo && product.compareAtPrice !== null ? `${fcfa(product.unitPrice)} (au lieu de ${fcfa(product.compareAtPrice)})` : fcfa(product.unitPrice);
}

export type PreRoutingAction =
  | { type: "ignore_spam"; moderation: "spam" | "spam_suspected"; hide: boolean }
  | { type: "ignore_praise" }
  | { type: "reply"; text: string; intent: string; createLead: boolean }
  | { type: "route"; createLead: boolean };

export interface PreRoutingInput {
  classification: CommentClassification;
  settings: CommentAssistantSettings;
  /** Produit de la publication (déjà lu en base), ou null. */
  product: CommentProduct | null;
  platform: string;
  library: MessageLibrary;
}

/** Que faire AVANT d'appeler l'orchestrateur (donc sans IA, sans crédit) ? */
export function planPreRouting(input: PreRoutingInput): PreRoutingAction {
  const { classification, settings, product, platform, library } = input;
  const dm = settings.inviteToDm ? library.render("comment_dm_invite") : "";

  switch (classification.kind) {
    case "spam":
      return { type: "ignore_spam", moderation: "spam", hide: settings.hideSpam && supportsHide(platform) };
    case "spam_suspected":
      return { type: "ignore_spam", moderation: "spam_suspected", hide: false };
    case "praise":
      return settings.replyToPraise ? { type: "reply", text: library.render("comment_praise"), intent: "comment_praise", createLead: false } : { type: "ignore_praise" };
    case "strong_intent": {
      const createLead = settings.createLeads;
      if (product && settings.usePostProduct) {
        return { type: "reply", text: library.render("comment_intent", { product: product.name, price: formatCommentPrice(product), dm }), intent: "comment_intent", createLead };
      }
      const followUp = settings.inviteToDm ? dm : library.render("comment_follow_up");
      return { type: "reply", text: library.render("comment_intent_generic", { dm: followUp }), intent: "comment_intent", createLead };
    }
    case "price_or_availability":
      if (product && settings.usePostProduct) {
        return { type: "reply", text: library.render("comment_price", { product: product.name, price: formatCommentPrice(product), dm }), intent: "comment_price", createLead: false };
      }
      return { type: "route", createLead: false };
    default:
      return { type: "route", createLead: false };
  }
}

export interface PostRoutingInput {
  routing: { replyText: string | null; handoffReason: string | null };
  settings: CommentAssistantSettings;
  library: MessageLibrary;
}

export type PostRoutingAction =
  | { type: "escalate"; publicAck: string | null }
  | { type: "reply"; text: string; shortened: boolean };

const PUBLIC_ACK_REASONS = new Set(["complaint", "refund_request"]);

/** Que faire du résultat de l'orchestrateur sur un commentaire PUBLIC ? */
export function planPostRouting(input: PostRoutingInput): PostRoutingAction {
  const { routing, settings, library } = input;
  if (routing.handoffReason) {
    const ack = settings.complaintPublicAck && PUBLIC_ACK_REASONS.has(routing.handoffReason) ? library.render("comment_complaint_ack") : null;
    return { type: "escalate", publicAck: ack };
  }
  if (!routing.replyText) return { type: "escalate", publicAck: null };
  // Réponse trop longue pour un fil public (liste de produits, détails) : invitation en message privé.
  if (settings.inviteToDm && routing.replyText.length > PUBLIC_SHORT_LIMIT) {
    return { type: "reply", text: library.render("comment_dm_invite_only"), shortened: true };
  }
  return { type: "reply", text: routing.replyText, shortened: false };
}
