import { normalizeMessage } from "./message-intents";
import type { MessageLibrary } from "./message-library";

/**
 * C3 — règles de livraison du commerçant (brief, point G). Code pur, sans I/O.
 *
 * Zones, frais, gratuité, délais, retrait, paiement à la livraison : tout vient de la
 * base (principe 3, le LLM ne calcule pas) et RIEN n'est figé dans un gabarit. Règles
 * d'abord (principe 2) : une question de livraison reçoit une réponse déterministe quand
 * la réponse est connue ; sinon on ne répond ni oui ni non (« je vérifie »).
 */

export interface DeliveryZone {
  name: string;
  /** Identifiant stable dérivé du nom (utilisé par la variable de FAQ `{delivery:identifiant}`). */
  slug: string;
  aliases: string[];
  /** Frais en FCFA. `null` et non gratuit = « communiqués à la commande ». */
  feeAmount: number | null;
  isFree: boolean;
  /** Livraison gratuite à partir de ce montant d'achat. */
  freeAboveAmount: number | null;
  etaText: string | null;
}

export interface DeliverySettings {
  /** `null` = non renseigné : on ne répond ni oui ni non. */
  pickupAvailable: boolean | null;
  pickupNote: string | null;
  acceptsCashOnDelivery: boolean | null;
}

export interface DeliveryRules {
  zones: DeliveryZone[];
  settings: DeliverySettings;
  /** Le commerçant a renseigné au moins une information de livraison. */
  configured: boolean;
}

export const EMPTY_DELIVERY_SETTINGS: DeliverySettings = { pickupAvailable: null, pickupNote: null, acceptsCashOnDelivery: null };
export const EMPTY_DELIVERY_RULES: DeliveryRules = { zones: [], settings: EMPTY_DELIVERY_SETTINGS, configured: false };

export function buildDeliveryRules(zones: DeliveryZone[], settings: DeliverySettings): DeliveryRules {
  const configured = zones.length > 0 || settings.pickupAvailable !== null || settings.acceptsCashOnDelivery !== null;
  return { zones, settings, configured };
}

export const MAX_ZONE_NAME_LENGTH = 80;
export const MAX_ZONE_ALIASES = 10;
export const MAX_ZONE_ALIAS_LENGTH = 40;
export const MAX_ETA_LENGTH = 80;
export const MAX_PICKUP_NOTE_LENGTH = 200;

export const zoneSlug = (name: string): string => normalizeMessage(name).replace(/ /g, "-").slice(0, MAX_ZONE_NAME_LENGTH);

// ---------------------------------------------------------------------------
// Validation des saisies du commerçant
// ---------------------------------------------------------------------------

export type ZoneParseResult = { ok: true; zone: DeliveryZone & { isActive: boolean } } | { ok: false; errors: string[] };

function optionalAmount(value: unknown, label: string, errors: string[], { positive }: { positive: boolean }): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || (positive && n === 0) || n > 100_000_000) {
    errors.push(`${label} : montant ${positive ? "positif" : "positif ou nul"} attendu`);
    return null;
  }
  return Math.round(n * 100) / 100;
}

/** Refuse au lieu de deviner : un frais ou un délai faux coûte cher au commerçant. */
export function parseZoneInput(raw: unknown): ZoneParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["zone attendue sous forme d'objet"] };
  const o = raw as Record<string, unknown>;
  const errors: string[] = [];

  const name = typeof o.name === "string" ? o.name.replace(/\s+/g, " ").trim() : "";
  if (!name) errors.push("nom de la zone requis");
  else if (name.length > MAX_ZONE_NAME_LENGTH) errors.push(`nom : ${MAX_ZONE_NAME_LENGTH} caractères maximum`);
  const slug = name ? zoneSlug(name) : "";
  if (name && !slug) errors.push("nom : doit contenir des lettres ou des chiffres");

  const aliases: string[] = [];
  if (o.aliases !== undefined && o.aliases !== null) {
    if (!Array.isArray(o.aliases)) errors.push("alias : liste attendue");
    else {
      for (const a of o.aliases) {
        const t = typeof a === "string" ? a.replace(/\s+/g, " ").trim() : "";
        if (!t) continue;
        if (t.length > MAX_ZONE_ALIAS_LENGTH) errors.push(`alias « ${t.slice(0, 15)}… » : ${MAX_ZONE_ALIAS_LENGTH} caractères maximum`);
        else if (!aliases.some((x) => normalizeMessage(x) === normalizeMessage(t)) && normalizeMessage(t) !== normalizeMessage(name)) aliases.push(t);
      }
      if (aliases.length > MAX_ZONE_ALIASES) errors.push(`alias : ${MAX_ZONE_ALIASES} maximum`);
    }
  }

  const isFree = o.isFree === true;
  const feeAmount = optionalAmount(o.feeAmount, "frais de livraison", errors, { positive: false });
  const freeAboveAmount = optionalAmount(o.freeAboveAmount, "gratuité à partir de", errors, { positive: true });
  if (isFree && feeAmount !== null && feeAmount > 0) errors.push("une livraison gratuite ne peut pas avoir de frais");

  let etaText: string | null = null;
  if (o.etaText !== undefined && o.etaText !== null && String(o.etaText).trim() !== "") {
    etaText = String(o.etaText).replace(/\s+/g, " ").trim();
    if (etaText.length > MAX_ETA_LENGTH) errors.push(`délai : ${MAX_ETA_LENGTH} caractères maximum`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    zone: { name, slug, aliases: aliases.slice(0, MAX_ZONE_ALIASES), feeAmount: isFree ? null : feeAmount, isFree, freeAboveAmount, etaText, isActive: o.isActive !== false },
  };
}

// ---------------------------------------------------------------------------
// Reconnaître la question
// ---------------------------------------------------------------------------

export interface DeliveryQuestion {
  delivery: boolean;
  pickup: boolean;
  cashOnDelivery: boolean;
  any: boolean;
}

const COD_RE = /\b(payer|paiement|paye|paie|reglement|regler|cash) (a|a la|sur|en) (la )?(livraison|reception)\b|\bpayer (cash|en liquide) (a|a la) (la )?(livraison|reception)\b|\bcash on delivery\b|\bpay on delivery\b/;
const PICKUP_RE = /\b(retrait|retirer|click and collect)\b|\bvenir (chercher|prendre|recuperer)\b|\brecuperer (sur place|en boutique|au magasin)\b|\bpasser (au|a la) (magasin|boutique|point de vente)\b|\bsur place\b/;
const DELIVERY_RE = /\b(livr\w*|expedi\w*|delivery|deliver|ship\w*|frais d envoi|frais de port)\b/;

// Ce qui parle de SA livraison ou la remercie n'est pas une question sur les zones desservies :
// « merci pour la livraison », « ma livraison est arrivée », « quand arrive mon colis ? » (suivi de commande).
const THANKS_RE = /\b(merci|thanks?|thank you)\b/;
const OWN_ORDER_RE = /\b(ma|mon|mes|notre|ta|ton) (livraison|colis|commande|achat|paquet)s?\b/;
const NO_DELIVERY_QUESTION: DeliveryQuestion = { delivery: false, pickup: false, cashOnDelivery: false, any: false };

export function detectDeliveryQuestion(message: string): DeliveryQuestion {
  const text = normalizeMessage(message);
  if (OWN_ORDER_RE.test(text)) return NO_DELIVERY_QUESTION;
  if (!message.includes("?") && THANKS_RE.test(text)) return NO_DELIVERY_QUESTION;
  const cashOnDelivery = COD_RE.test(text);
  const pickup = PICKUP_RE.test(text);
  // « payer à la livraison » parle de paiement, pas de zones : la question de zones n'est posée que s'il y a un autre signal.
  const delivery = DELIVERY_RE.test(text.replace(COD_RE, " "));
  return { delivery, pickup, cashOnDelivery, any: delivery || pickup || cashOnDelivery };
}

/** Zones citées dans le message (nom ou alias, mot entier), la plus longue correspondance d'abord. */
export function matchZones(message: string, zones: DeliveryZone[]): DeliveryZone[] {
  const text = ` ${normalizeMessage(message)} `;
  const hits: Array<{ zone: DeliveryZone; length: number }> = [];
  for (const zone of zones) {
    const names = [zone.name, ...zone.aliases].map((n) => normalizeMessage(n)).filter(Boolean);
    const found = names.filter((n) => text.includes(` ${n} `)).sort((a, b) => b.length - a.length)[0];
    if (found) hits.push({ zone, length: found.length });
  }
  return hits.sort((a, b) => b.length - a.length).map((h) => h.zone).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/** Frais, tels que renseignés par le commerçant. */
export function describeFee(zone: DeliveryZone): string {
  if (zone.isFree) return "livraison gratuite";
  if (zone.feeAmount !== null) {
    const base = `frais de livraison : ${fcfa(zone.feeAmount)}`;
    return zone.freeAboveAmount !== null ? `${base}, gratuite dès ${fcfa(zone.freeAboveAmount)} d'achat` : base;
  }
  if (zone.freeAboveAmount !== null) return `livraison gratuite dès ${fcfa(zone.freeAboveAmount)} d'achat, sinon frais communiqués à la commande`;
  return "frais communiqués à la commande";
}

export function zoneDetails(zone: DeliveryZone): string {
  return zone.etaText ? `${describeFee(zone)}, délai : ${zone.etaText}` : describeFee(zone);
}

/** Texte d'une zone pour la variable de FAQ `{delivery:identifiant}`. */
export function zoneLine(zone: DeliveryZone): string {
  return `${zone.name} : ${zoneDetails(zone)}`;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ou ${names[names.length - 1]}`;
}

/**
 * Réponse DÉTERMINISTE à une question de livraison / retrait / paiement à la livraison, ou `null`
 * si elle ne peut pas être entièrement répondue avec ce que le commerçant a renseigné
 * (on ne répond jamais oui ou non à ce qu'on ne sait pas : l'étape suivante prend le relais).
 */
export function answerDeliveryQuestion(message: string, rules: DeliveryRules, library: MessageLibrary): string | null {
  const question = detectDeliveryQuestion(message);
  if (!question.any || !rules.configured) return null;
  const parts: string[] = [];

  if (question.delivery) {
    if (rules.zones.length === 0) return null;
    const matched = matchZones(message, rules.zones);
    if (matched.length > 0) {
      for (const zone of matched) parts.push(library.render("delivery_zone", { zone: zone.name, details: zoneDetails(zone) }));
    } else {
      parts.push(library.render("delivery_zones_list", { zones: listNames(rules.zones.map((z) => z.name)) }));
    }
  }
  if (question.pickup) {
    if (rules.settings.pickupAvailable === null) return null;
    parts.push(rules.settings.pickupAvailable ? library.render("delivery_pickup_yes", { note: rules.settings.pickupNote ?? "" }) : library.render("delivery_pickup_no"));
  }
  if (question.cashOnDelivery) {
    if (rules.settings.acceptsCashOnDelivery === null) return null;
    parts.push(library.render(rules.settings.acceptsCashOnDelivery ? "delivery_cod_yes" : "delivery_cod_no"));
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

export interface DeliveryFacts {
  lines: string[];
  /** Montants que la réponse a le droit de citer (frais, seuils de gratuité). */
  allowedAmounts: number[];
  /** « Gratuit » n'est une affirmation fondée que si une zone est réellement gratuite ou gratuite dès un seuil. */
  allowFree: boolean;
}

/** Faits de livraison pour le prompt de rédaction (et pour le contrôle qualité). */
export function buildDeliveryFacts(rules: DeliveryRules): DeliveryFacts {
  const lines: string[] = [];
  const allowedAmounts: number[] = [];
  let allowFree = false;
  for (const zone of rules.zones) {
    lines.push(`- Livraison ${zoneLine(zone)}`);
    if (zone.feeAmount !== null) allowedAmounts.push(zone.feeAmount);
    if (zone.freeAboveAmount !== null) allowedAmounts.push(zone.freeAboveAmount);
    if (zone.isFree || zone.freeAboveAmount !== null) allowFree = true;
  }
  const { pickupAvailable, pickupNote, acceptsCashOnDelivery } = rules.settings;
  if (pickupAvailable !== null) lines.push(pickupAvailable ? `- Retrait possible.${pickupNote ? ` ${pickupNote}` : ""}` : "- Retrait non proposé.");
  if (acceptsCashOnDelivery !== null) lines.push(acceptsCashOnDelivery ? "- Paiement à la livraison accepté." : "- Paiement à la livraison non accepté.");
  return { lines, allowedAmounts, allowFree };
}
