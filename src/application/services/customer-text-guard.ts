import { normalizeMessage } from "./message-intents";

/**
 * C3 — hygiène des messages clients avant tout appel à un modèle (principe 6 :
 * un message client est une DONNÉE non fiable, jamais une instruction).
 *
 * Deux couches, volontairement indépendantes :
 *  1. `sanitizeCustomerText` retire ce qui sert à cacher ou à échapper :
 *     caractères invisibles, de contrôle, balises qui imitent nos délimiteurs ;
 *  2. `detectPromptInjection` repère les tentatives d'instruction connues
 *     (FR/EN). Un message signalé n'est JAMAIS envoyé au modèle : un humain le
 *     lit (le client reçoit l'accusé de réception habituel).
 *
 * Ces règles sont une barrière parmi d'autres, pas la seule : même si une
 * tentative passe, le contrôle qualité des réponses (reply-quality.ts) et le
 * fait que le modèle n'a ni outil ni droit d'écriture limitent les dégâts.
 *
 * Compromis assumé : quelques messages légitimes peuvent être signalés (faux
 * positifs) ; ils partent vers un humain, ce qui est sûr. À mesurer sur le jeu
 * de conversations réelles anonymisées (livrable I) et à ajuster.
 */

export const MAX_CUSTOMER_TEXT_LENGTH = 1000;

// Contrôles (sauf \t \n \r), zéro-largeur, marques directionnelles, BOM.
// eslint-disable-next-line no-control-regex
const INVISIBLE_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const FAKE_TAG_RE = /<\/?\s*(customer_message|system|assistant|user|faits|facts)\s*>/gi;

export function sanitizeCustomerText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE_RE, "")
    .replace(FAKE_TAG_RE, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CUSTOMER_TEXT_LENGTH);
}

/** Enveloppe le message pour le modèle : le délimiteur de fermeture ne peut pas apparaître dans le texte (retiré ci-dessus). */
export function wrapUntrustedCustomerText(sanitized: string): string {
  return `<customer_message>\n${sanitized}\n</customer_message>`;
}

// Motifs appliqués au texte normalisé (minuscules, sans accents, ponctuation → espaces).
const NORMALIZED_SIGNALS: Array<[string, RegExp]> = [
  ["ignore_instructions", /\b(ignor\w*|oubli\w*|neglig\w*|desobei\w*|contourn\w*|disregard|forget|override)\b.{0,40}\b(instructions?|consignes?|regles?|directives?|prompts?|rules|guidelines|programmation)\b/],
  ["ignore_previous", /\b(ignore|disregard|forget)\b.{0,20}\b(previous|above|prior|earlier|everything|all)\b/],
  ["reveal_prompt", /\b(revele\w*|affich\w*|montr\w*|donn\w*|repet\w*|ecri\w*|dis moi|reveal|show|print|repeat|display|output|leak)\b.{0,30}\b(system prompt|prompt systeme|ton prompt|votre prompt|tes instructions|tes consignes|vos instructions|vos consignes|your instructions|your prompt|initial prompt|instructions initiales)\b/],
  ["system_prompt_word", /\b(system prompt|prompt systeme|developer message|message systeme)\b/],
  ["role_override_now", /\b(tu es|vous etes|you are)\s+(maintenant|desormais|now)\b/],
  ["role_override_act", /\b(agis|agissez|act|behave|comporte toi|comportez vous|fais semblant|faites semblant|pretend)\b.{0,12}\b(comme|as|que tu es|to be|d etre)\b/],
  ["mode_switch", /\b(jailbreak|dan mode|mode dan|mode developpeur|developer mode|mode debug|debug mode|do anything now|sans (aucune )?(restriction|limite|filtre)s?)\b/],
  ["new_instructions", /\b(nouvelles? (instructions?|consignes?|regles?)|new (instructions?|rules)|a partir de maintenant|from now on)\b/],
  ["owner_claim_command", /\bje suis (le|la|l) (proprietaire|admin\w*|patron|gerant|developpeur)\b.{0,60}\b(donne\w*|mets|met|change\w*|modifi\w*|applique\w*|accorde\w*|offre|reponds|envoie\w*)\b/],
  ["free_or_discount_command", /\b(mets|mettez|met|applique\w*|accorde\w*|confirme\w*|promets|promettez|garanti\w*)\b.{0,30}\b(gratuit\w*|free|0 fcfa|zero fcfa|100 ?%|remise de 100)\b/],
];

// Motifs appliqués au texte brut (la structure compte : début de ligne, balises de rôle).
const RAW_SIGNALS: Array<[string, RegExp]> = [
  // « Message du propriétaire : … » (forme d'ordre, avec deux-points ou tiret) — pas « un message du propriétaire hier ».
  ["authority_claim", /\b(message|instruction|ordre|consigne)s? (du|de la|de l'?)\s*(propri[eé]taire|admin\w*|patron|g[eé]rant|d[eé]veloppeur|syst[eè]me|[eé]quipe technique)\s*[:：\-–]/i],
  ["full_discount_command", /\b(accorde\w*|applique\w*|mets|met|mettez|offre\w*|donne\w*)\b.{0,30}\b100\s?%/i],
  ["role_marker", /^\s*(system|assistant|developer|admin)\s*[:：]/im],
  ["chat_template_token", /<\|?(im_start|im_end|system|endoftext)\|?>/i],
  ["inst_token", /\[\/?(INST|SYS)\]/i],
  ["markdown_system_header", /^#{2,}\s*(system|instructions?)\b/im],
];

export interface InjectionVerdict {
  flagged: boolean;
  /** Noms des signaux déclenchés (jamais le contenu du message : minimisation). */
  signals: string[];
}

export function detectPromptInjection(text: string): InjectionVerdict {
  const sanitized = sanitizeCustomerText(text);
  const normalized = normalizeMessage(sanitized);
  const signals: string[] = [];
  for (const [name, re] of NORMALIZED_SIGNALS) if (re.test(normalized)) signals.push(name);
  for (const [name, re] of RAW_SIGNALS) if (re.test(sanitized)) signals.push(name);
  return { flagged: signals.length > 0, signals };
}
