import { checkVoiceCompliance, countEmojis, emojiCap, DEFAULT_BRAND_VOICE, type BrandVoice, type EmojiLevel, type Register } from "./brand-voice";

/**
 * C3 — bibliothèque de messages prédéfinis (livrable E). Code pur, sans I/O.
 *
 * Les messages de routine (accueil, merci, au revoir, « je vérifie », introductions
 * de listes) ne passent JAMAIS par le modèle : règles d'abord, IA ensuite
 * (principe 2). Chaque message existe en tutoiement et vouvoiement ; les emojis
 * sont des jetons (`{wave}`, `{smile}`, `{sparkle}`) rendus selon le niveau choisi.
 *
 * Les valeurs par défaut vivent ici. Le commerçant peut les remplacer par SES
 * formulations (table `predefined_messages`) : seules les surcharges validées
 * (`approved`) ET conformes à `validateOverrideBody` sont utilisées ; sinon on
 * retombe sur le défaut — jamais un gabarit cassé envoyé à un client.
 *
 * Variables dynamiques : prix, stock, livraison, coordonnées ne sont JAMAIS
 * écrits dans un gabarit (ils changent) ; un gabarit qui en contient est refusé.
 */

export const MESSAGE_KEYS = [
  "greeting",
  "thanks",
  "goodbye",
  "verify",
  "product_intro",
  "search_intro",
  "search_intro_budget",
  "search_relaxed",
  "categories_intro",
  "categories_outro",
  "see_all",
  // Commentaires publics (étape 5) : réponses COURTES, invitation en message privé.
  "comment_price",
  "comment_intent",
  "comment_intent_generic",
  "comment_follow_up",
  "comment_dm_invite",
  "comment_dm_invite_only",
  "comment_complaint_ack",
  "comment_praise",
  // Livraison, retrait, paiement à la livraison (règles du commerçant, lues en base).
  "delivery_zone",
  "delivery_zones_list",
  "delivery_pickup_yes",
  "delivery_pickup_no",
  "delivery_cod_yes",
  "delivery_cod_no",
] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];

interface MessageDef {
  vous: string;
  tu: string;
  /** Variables autorisées dans le texte. */
  allowed: string[];
  /** Variables qui doivent apparaître (sinon le message perd son sens). */
  required: string[];
}

const EMOJI_TOKENS = ["wave", "smile", "sparkle"] as const;

export const DEFAULT_TEMPLATES: Record<MessageKey, MessageDef> = {
  greeting: {
    vous: "{hello} ! {wave} {welcome}\nJe peux vous aider tout de suite, par exemple : {asks}.\nQue souhaitez-vous ? {sparkle}",
    tu: "{hello} ! {wave} {welcome}\nJe peux t'aider tout de suite, par exemple : {asks}.\nQu'est-ce qui te ferait plaisir ? {sparkle}",
    allowed: ["hello", "welcome", "asks"],
    required: ["hello"],
  },
  thanks: {
    vous: "Avec plaisir ! N'hésitez pas si vous avez d'autres questions. {smile}",
    tu: "Avec plaisir ! N'hésite pas si tu as d'autres questions. {smile}",
    allowed: [],
    required: [],
  },
  goodbye: {
    vous: "Merci pour votre message, à très bientôt ! {wave}",
    tu: "Merci pour ton message, à très bientôt ! {wave}",
    allowed: [],
    required: [],
  },
  verify: {
    vous: "Je vérifie cette information auprès de l'équipe et je reviens vers vous très vite.",
    tu: "Je vérifie cette information auprès de l'équipe et je reviens vers toi très vite.",
    allowed: [],
    required: [],
  },
  product_intro: {
    vous: "{wave} Bien sûr ! Voici quelques-uns de nos {items} disponibles :",
    tu: "{wave} Bien sûr ! Voici quelques-uns de nos {items} disponibles :",
    allowed: ["items"],
    required: [],
  },
  search_intro: {
    vous: "Voici ce qui correspond à votre recherche :",
    tu: "Voici ce qui correspond à ta recherche :",
    allowed: [],
    required: [],
  },
  search_intro_budget: {
    vous: "Voici ce que j'ai trouvé {request} :",
    tu: "Voici ce que j'ai trouvé {request} :",
    allowed: ["request"],
    required: ["request"],
  },
  search_relaxed: {
    vous: "Je n'ai rien trouvé {request}. Voici ce qui s'en rapproche :",
    tu: "Je n'ai rien trouvé {request}. Voici ce qui s'en rapproche :",
    allowed: ["request"],
    required: ["request"],
  },
  categories_intro: {
    vous: "Voici nos catégories de {items} :",
    tu: "Voici nos catégories de {items} :",
    allowed: ["items"],
    required: [],
  },
  categories_outro: {
    vous: "Dites-moi laquelle vous intéresse, ou ce que vous cherchez.",
    tu: "Dis-moi laquelle t'intéresse, ou ce que tu cherches.",
    allowed: [],
    required: [],
  },
  see_all: {
    vous: "Voir tous les {items} : {url}",
    tu: "Voir tous les {items} : {url}",
    allowed: ["items", "url"],
    required: ["url"],
  },
  comment_price: {
    vous: "Le {product} est à {price}. {dm}",
    tu: "Le {product} est à {price}. {dm}",
    allowed: ["product", "price", "dm"],
    required: ["product", "price"],
  },
  comment_intent: {
    vous: "Merci pour votre intérêt ! Le {product} est à {price}. {dm}",
    tu: "Merci pour ton intérêt ! Le {product} est à {price}. {dm}",
    allowed: ["product", "price", "dm"],
    required: ["product", "price"],
  },
  comment_intent_generic: {
    vous: "Merci pour votre intérêt ! {dm}",
    tu: "Merci pour ton intérêt ! {dm}",
    allowed: ["dm"],
    required: [],
  },
  comment_follow_up: {
    vous: "Nous revenons vers vous très vite.",
    tu: "Nous revenons vers toi très vite.",
    allowed: [],
    required: [],
  },
  comment_dm_invite: {
    vous: "Écrivez-nous en message privé pour commander.",
    tu: "Écris-nous en message privé pour commander.",
    allowed: [],
    required: [],
  },
  comment_dm_invite_only: {
    vous: "Merci pour votre message ! Écrivez-nous en message privé, nous vous répondons avec tous les détails. {smile}",
    tu: "Merci pour ton message ! Écris-nous en message privé, nous te répondons avec tous les détails. {smile}",
    allowed: [],
    required: [],
  },
  comment_complaint_ack: {
    vous: "Nous sommes désolés de cette situation. Écrivez-nous en message privé : nous revenons vers vous rapidement.",
    tu: "Nous sommes désolés de cette situation. Écris-nous en message privé : nous revenons vers toi rapidement.",
    allowed: [],
    required: [],
  },
  comment_praise: {
    vous: "Merci beaucoup pour votre message ! {smile}",
    tu: "Merci beaucoup pour ton message ! {smile}",
    allowed: [],
    required: [],
  },
  delivery_zone: {
    vous: "Oui, nous livrons à {zone} : {details}.",
    tu: "Oui, nous livrons à {zone} : {details}.",
    allowed: ["zone", "details"],
    required: ["zone", "details"],
  },
  delivery_zones_list: {
    vous: "Nous livrons à : {zones}. Pour une autre zone, écrivez-nous et nous vérifions.",
    tu: "Nous livrons à : {zones}. Pour une autre zone, écris-nous et nous vérifions.",
    allowed: ["zones"],
    required: ["zones"],
  },
  delivery_pickup_yes: {
    vous: "Oui, le retrait est possible. {note}",
    tu: "Oui, le retrait est possible. {note}",
    allowed: ["note"],
    required: [],
  },
  delivery_pickup_no: {
    vous: "Nous ne proposons pas de retrait pour le moment.",
    tu: "Nous ne proposons pas de retrait pour le moment.",
    allowed: [],
    required: [],
  },
  delivery_cod_yes: {
    vous: "Oui, vous pouvez payer à la livraison.",
    tu: "Oui, tu peux payer à la livraison.",
    allowed: [],
    required: [],
  },
  delivery_cod_no: {
    vous: "Nous n'acceptons pas le paiement à la livraison.",
    tu: "Nous n'acceptons pas le paiement à la livraison.",
    allowed: [],
    required: [],
  },
};

const EMOJI_BY_LEVEL: Record<(typeof EMOJI_TOKENS)[number], Record<EmojiLevel, string>> = {
  wave: { none: "", light: "👋", rich: "👋" },
  smile: { none: "", light: "😊", rich: "😊" },
  sparkle: { none: "", light: "", rich: "✨" },
};

const TOKEN_RE = /\{(\w+)\}/g;

/** Rend un gabarit ; `null` si une variable manque (l'appelant retombe alors sur le défaut). */
export function renderTemplate(body: string, vars: Record<string, string>, level: EmojiLevel): string | null {
  let missing = false;
  const out = body.replace(TOKEN_RE, (_m, name: string) => {
    if ((EMOJI_TOKENS as readonly string[]).includes(name)) return EMOJI_BY_LEVEL[name as (typeof EMOJI_TOKENS)[number]][level];
    if (name in vars) return vars[name] ?? "";
    missing = true;
    return "";
  });
  if (missing) return null;
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export interface LibraryOverride {
  key: string;
  register: "any" | Register;
  emojiLevel: "any" | EmojiLevel;
  body: string;
  status: "draft" | "approved";
}

const MAX_BODY_LENGTH = 600;
const MONEY_RE = /\d[\d ]*\s?(fcfa|cfa|xaf|francs?)\b/i;
const URL_IN_BODY_RE = /(https?:\/\/|www\.)/i;
const EMAIL_IN_BODY_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const LONG_NUMBER_RE = /\d[\d ().\-]{6,}\d/;
const FREE_RE = /\b(gratuit\w*|offert\w*|free)\b/i;

/** Erreurs (liste vide = valide). Appelée à l'enregistrement ET au chargement : défense en profondeur. */
export function validateOverrideBody(key: string, body: string, scope: { register?: "any" | Register; emojiLevel?: "any" | EmojiLevel } = {}): string[] {
  const errors: string[] = [];
  if (!(MESSAGE_KEYS as readonly string[]).includes(key)) return [`message inconnu : « ${key} »`];
  const def = DEFAULT_TEMPLATES[key as MessageKey];
  const text = body.trim();
  if (text.length === 0) return ["texte vide"];
  if (text.length > MAX_BODY_LENGTH) errors.push(`${MAX_BODY_LENGTH} caractères maximum`);

  const used = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) used.add(m[1] ?? "");
  for (const name of used) {
    if (!(EMOJI_TOKENS as readonly string[]).includes(name) && !def.allowed.includes(name)) errors.push(`variable {${name}} non autorisée pour « ${key} »`);
  }
  for (const name of def.required) if (!used.has(name)) errors.push(`variable {${name}} obligatoire pour « ${key} »`);

  // Rien qui change dans le temps ou qui engage le commerçant ne s'écrit en dur.
  if (MONEY_RE.test(text)) errors.push("pas de montant écrit en dur (les prix changent : ils viennent de la base)");
  if (FREE_RE.test(text)) errors.push("pas de promesse de gratuité écrite en dur");
  if (EMAIL_IN_BODY_RE.test(text) || LONG_NUMBER_RE.test(text)) errors.push("pas de numéro ni d'email écrit en dur");
  if (URL_IN_BODY_RE.test(text)) errors.push("pas de lien écrit en dur (utiliser {url})");

  // Cohérence avec le ton annoncé pour cette variante.
  const register = scope.register && scope.register !== "any" ? scope.register : null;
  const emoji = scope.emojiLevel && scope.emojiLevel !== "any" ? scope.emojiLevel : null;
  if (register || emoji) {
    const probeVoice: BrandVoice = { ...DEFAULT_BRAND_VOICE, register: register ?? "vous", emojiLevel: emoji ?? "rich" };
    const probe = text.replace(TOKEN_RE, "x");
    const found = checkVoiceCompliance(probe, probeVoice);
    if (register && found.includes("register_mismatch")) errors.push(register === "vous" ? "le texte tutoie alors qu'il est prévu pour le vouvoiement" : "le texte vouvoie alors qu'il est prévu pour le tutoiement");
    if (emoji && countEmojis(text) > emojiCap(emoji)) errors.push(`trop d'emojis pour le niveau « ${emoji} »`);
  }
  return errors;
}

export interface MessageLibrary {
  readonly voice: BrandVoice;
  /** Rend un message ; ne lève jamais (défaut en cas de surcharge inutilisable). */
  render(key: MessageKey, vars?: Record<string, string>): string;
}

function pickOverride(key: MessageKey, voice: BrandVoice, overrides: LibraryOverride[]): LibraryOverride | null {
  let best: { o: LibraryOverride; score: number } | null = null;
  for (const o of overrides) {
    if (o.key !== key || o.status !== "approved") continue;
    if (o.register !== "any" && o.register !== voice.register) continue;
    if (o.emojiLevel !== "any" && o.emojiLevel !== voice.emojiLevel) continue;
    if (validateOverrideBody(key, o.body, { register: o.register, emojiLevel: o.emojiLevel }).length > 0) continue;
    const score = (o.register === "any" ? 1 : 2) * 10 + (o.emojiLevel === "any" ? 1 : 2);
    if (!best || score > best.score) best = { o, score };
  }
  return best ? best.o : null;
}

export function createMessageLibrary(voice: BrandVoice, overrides: LibraryOverride[] = []): MessageLibrary {
  return {
    voice,
    render(key, vars = {}) {
      const override = pickOverride(key, voice, overrides);
      if (override) {
        const rendered = renderTemplate(override.body, vars, voice.emojiLevel);
        if (rendered) return rendered;
      }
      const fallback = renderTemplate(DEFAULT_TEMPLATES[key][voice.register], vars, voice.emojiLevel);
      if (fallback === null) throw new Error(`message-library: variable manquante pour « ${key} » (erreur de programmation)`);
      return fallback;
    },
  };
}

/** Bibliothèque par défaut (vouvoiement, emojis légers) : le comportement historique. */
export const DEFAULT_LIBRARY: MessageLibrary = createMessageLibrary(DEFAULT_BRAND_VOICE);

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ou ${items[items.length - 1]}`;
}

export interface GreetingInput {
  greetingWord?: "Bonjour" | "Bonsoir";
  businessName: string | null;
  itemLabelPlural: string;
  hasHours: boolean;
  hasAddress: boolean;
  hasContact: boolean;
}

/** Accueil : ne propose que ce que le commerçant a réellement renseigné (jamais une promesse creuse). */
export function renderGreeting(library: MessageLibrary, input: GreetingInput): string {
  const tu = library.voice.register === "tu";
  const asks = [tu ? `« montre-moi tes ${input.itemLabelPlural} »` : `« présentez-moi vos ${input.itemLabelPlural} »`];
  if (input.hasHours) asks.push(tu ? "« quels sont tes horaires ? »" : "« quels sont vos horaires ? »");
  if (input.hasAddress) asks.push(tu ? "« t'es où ? »" : "« où êtes-vous situés ? »");
  if (input.hasContact) asks.push(tu ? "« comment te contacter ? »" : "« comment vous contacter ? »");
  return library.render("greeting", {
    hello: input.greetingWord ?? "Bonjour",
    welcome: input.businessName ? `Bienvenue chez ${input.businessName}.` : "Bienvenue.",
    asks: joinOr(asks),
  });
}
