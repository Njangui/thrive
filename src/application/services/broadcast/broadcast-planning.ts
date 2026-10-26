/**
 * C5 — planification d'une diffusion : estimation de coût, modèles hors
 * fenêtre de 24 h, palier du numéro, horaire suggéré.
 *
 * Tout est CALCULÉ EN CODE (le LLM ne calcule pas). Aucune fonction ici ne fait
 * d'appel réseau ni d'accès base : elles prennent des données en entrée et
 * rendent un résultat, ce qui les rend testables et sûres.
 *
 * Les tarifs Meta sont une CARTE DE TARIFS injectable, pas des constantes dans
 * la logique. La valeur par défaut vient du brief (source tierce, octobre 2026)
 * et reste marquée « à confirmer » ; une valeur inconnue (`null`) n'est jamais
 * inventée : elle est comptée dans `unknownCount`.
 */

export interface RateCard {
  region: string;
  currency: "USD";
  /** Coût d'un message modèle de catégorie « marketing », par message. */
  marketingTemplateUsd: number | null;
  /** Messages de service (réponse dans la fenêtre) gratuits par mois et par numéro. */
  serviceFreeMonthly: number | null;
  /** Coût d'un message de service au-delà du quota gratuit (inconnu = null). */
  serviceOverageUsd: number | null;
  verified: boolean;
  source: string;
}

export const DEFAULT_META_RATE_CARD: RateCard = {
  region: "rest_of_africa",
  currency: "USD",
  marketingTemplateUsd: 0.0259,
  serviceFreeMonthly: 1000,
  serviceOverageUsd: null,
  verified: false,
  source: "Brief C5 (octobre 2026, sources tierces) — à confirmer sur la grille Meta officielle",
};

/**
 * Frais de MESSAGES de la plateforme Zernio (distincts du tarif Meta, qui est facturé au compte WhatsApp
 * Business du tenant). Source : documentation Zernio « Pricing » consultée le 09/10/2026 : messages sortants
 * « 10 000 gratuits par mois, puis 1 $ par tranche de 10 000, tous canaux confondus », depuis le 1er octobre 2026.
 * Décision de Marc-well : on retient ce que dit leur documentation. À confirmer au contrat : le quota gratuit
 * s'applique-t-il à la clé de la PLATEFORME (partagé entre tous les tenants) ou à chaque tenant ? Tant que ce
 * n'est pas tranché, l'estimation donne un MAXIMUM (quota gratuit ignoré), jamais une promesse de gratuité.
 */
export interface PlatformFeeCard {
  usdPer10kMessages: number;
  freeMonthlyMessages: number;
  source: string;
}

export const DEFAULT_ZERNIO_MESSAGE_FEE: PlatformFeeCard = {
  usdPer10kMessages: 1,
  freeMonthlyMessages: 10000,
  source: "Documentation Zernio (Pricing), consultée le 09/10/2026 — application au contrat à confirmer",
};

/** Palier par défaut d'un nouveau numéro (contacts uniques démarrés par jour) — à vérifier chez Meta. */
export const DEFAULT_NEW_NUMBER_DAILY_UNIQUE_CONTACTS = 250;

export type BroadcastRecipientChannel = "whatsapp" | "telegram" | "facebook" | "instagram";

export interface PlanningRecipient {
  contactId: string;
  channel: BroadcastRecipientChannel;
  /** Le contact a-t-il écrit dans les dernières 24 h (fenêtre de messagerie libre) ? */
  withinWindow: boolean;
}

// ---------------------------------------------------------------------------
// Estimation de coût
// ---------------------------------------------------------------------------
export interface CostLine {
  channel: BroadcastRecipientChannel;
  kind: "template" | "free_form_in_quota" | "free_form_over_quota" | "no_fee";
  count: number;
  unitUsd: number | null;
  subtotalUsd: number | null;
}

export interface CostEstimate {
  lines: CostLine[];
  /** Coût attendu si la fenêtre de 24 h de chaque contact reste telle qu'aujourd'hui. */
  expectedUsd: number;
  /** Plafond : tous les contacts WhatsApp traités comme hors fenêtre (modèle payant). */
  maxUsd: number;
  /** Messages dont le coût est inconnu (tarif non confirmé) : NON inclus dans les totaux. */
  unknownCount: number;
  /** Messages réellement envoyés (hors ignorés faute de modèle) : base des frais de plateforme. */
  sentMessages: number;
  /**
   * Frais Zernio (plateforme) MAXIMUM pour ces messages : quota gratuit mensuel ignoré. NE FAIT PAS partie de
   * `expectedUsd` / `maxUsd` (tarif Meta, payé par le tenant) : c'est un coût de Flexco.
   */
  platformFeeMaxUsd: number;
  expectedXaf: number | null;
  maxXaf: number | null;
  confirmed: boolean;
  notes: string[];
}

export interface EstimateOptions {
  rateCard?: RateCard;
  platformFee?: PlatformFeeCard;
  /** Taux de change fourni par l'appelant (aucun taux n'est inventé ici). */
  xafPerUsd?: number | null;
  /** Messages de service WhatsApp déjà envoyés ce mois-ci par ce numéro. */
  serviceMessagesUsedThisMonth?: number;
  /** Un modèle approuvé est-il choisi ? Sans modèle, les hors-fenêtre sont ignorés (donc sans coût). */
  hasTemplate: boolean;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function estimateBroadcastCost(recipients: PlanningRecipient[], options: EstimateOptions): CostEstimate {
  const card = options.rateCard ?? DEFAULT_META_RATE_CARD;
  const whatsapp = recipients.filter((r) => r.channel === "whatsapp");
  const inWindow = whatsapp.filter((r) => r.withinWindow).length;
  const outWindow = whatsapp.length - inWindow;
  const used = options.serviceMessagesUsedThisMonth ?? 0;
  const lines: CostLine[] = [];
  const notes: string[] = [];
  let unknownCount = 0;
  let expected = 0;

  // Hors fenêtre : modèle obligatoire (payant). Sans modèle, ces contacts sont ignorés.
  const templateCount = options.hasTemplate ? outWindow : 0;
  if (templateCount > 0) {
    const unit = card.marketingTemplateUsd;
    if (unit === null) unknownCount += templateCount;
    else expected += unit * templateCount;
    lines.push({ channel: "whatsapp", kind: "template", count: templateCount, unitUsd: unit, subtotalUsd: unit === null ? null : round(unit * templateCount) });
  }
  if (!options.hasTemplate && outWindow > 0) {
    notes.push(`${outWindow} contact(s) WhatsApp hors fenêtre de 24 h seront ignorés : un modèle approuvé est obligatoire pour les joindre.`);
  }

  // Dans la fenêtre : message libre, gratuit dans le quota mensuel de service.
  if (inWindow > 0) {
    const freeLeft = card.serviceFreeMonthly === null ? 0 : Math.max(0, card.serviceFreeMonthly - used);
    const inQuota = Math.min(inWindow, freeLeft);
    const over = inWindow - inQuota;
    if (inQuota > 0) lines.push({ channel: "whatsapp", kind: "free_form_in_quota", count: inQuota, unitUsd: 0, subtotalUsd: 0 });
    if (over > 0) {
      const unit = card.serviceOverageUsd;
      if (unit === null) unknownCount += over;
      else expected += unit * over;
      lines.push({ channel: "whatsapp", kind: "free_form_over_quota", count: over, unitUsd: unit, subtotalUsd: unit === null ? null : round(unit * over) });
    }
  }

  // Autres canaux : aucun frais par message connu côté Flexco.
  for (const channel of ["telegram", "facebook", "instagram"] as const) {
    const count = recipients.filter((r) => r.channel === channel).length;
    if (count > 0) lines.push({ channel, kind: "no_fee", count, unitUsd: 0, subtotalUsd: 0 });
  }

  // Plafond : si la fenêtre de chacun expire avant l'envoi, tous passent par un modèle.
  const maxTemplates = options.hasTemplate ? whatsapp.length : 0;
  const maxUsd = card.marketingTemplateUsd === null ? 0 : card.marketingTemplateUsd * maxTemplates;

  if (!card.verified) notes.push("Tarifs Meta à confirmer : estimation indicative, Meta facture directement le compte WhatsApp Business du tenant.");
  if (unknownCount > 0) notes.push(`${unknownCount} message(s) au tarif inconnu ne sont pas inclus dans le total.`);
  // Frais Zernio (plateforme) : tous les messages réellement envoyés, quel que soit le canal.
  const fee = options.platformFee ?? DEFAULT_ZERNIO_MESSAGE_FEE;
  const sentMessages = recipients.length - (options.hasTemplate ? 0 : outWindow);
  const platformFeeMaxUsd = (sentMessages * fee.usdPer10kMessages) / 10000;
  if (sentMessages > 0) notes.push(`Frais Zernio (plateforme, hors tarif Meta) : au plus ${round(platformFeeMaxUsd).toLocaleString("fr-FR", { maximumFractionDigits: 4 })} $ pour ${sentMessages.toLocaleString("fr-FR")} message(s) ; ${fee.freeMonthlyMessages.toLocaleString("fr-FR")} messages/mois sont gratuits selon la documentation Zernio (application au contrat à confirmer).`);
  const rate = options.xafPerUsd && options.xafPerUsd > 0 ? options.xafPerUsd : null;
  if (rate === null) notes.push("Taux de change non fourni : montants en FCFA indisponibles.");

  return {
    lines,
    expectedUsd: round(expected),
    maxUsd: round(maxUsd),
    unknownCount,
    sentMessages,
    platformFeeMaxUsd: round(platformFeeMaxUsd),
    expectedXaf: rate === null ? null : Math.round(expected * rate),
    maxXaf: rate === null ? null : Math.round(maxUsd * rate),
    confirmed: card.verified && unknownCount === 0,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Décision par destinataire + palier du numéro
// ---------------------------------------------------------------------------
export type DeliveryDecision = "send_free_form" | "send_template" | "skip_template_required" | "defer_daily_limit";

export interface DeliveryPlan {
  decisions: Array<{ contactId: string; channel: BroadcastRecipientChannel; decision: DeliveryDecision }>;
  counts: Record<DeliveryDecision, number>;
  /** Contacts démarrés par modèle repoussés aux jours suivants (palier du numéro). */
  deferredByDay: Array<{ dayOffset: number; count: number }>;
  notes: string[];
}

export interface PlanDeliveryOptions {
  hasTemplate: boolean;
  /** Palier du numéro : contacts uniques démarrés par jour (à vérifier chez Meta). */
  dailyUniqueLimit: number;
  /** Contacts uniques déjà démarrés aujourd'hui par modèle sur ce numéro. */
  alreadyStartedToday?: number;
}

/**
 * Hypothèse (à vérifier chez Meta) : le palier de contacts uniques/jour ne
 * s'applique qu'aux conversations démarrées par l'entreprise (modèles). Un
 * message libre à un contact qui a écrit dans les 24 h n'est pas compté.
 */
export function planDelivery(recipients: PlanningRecipient[], options: PlanDeliveryOptions): DeliveryPlan {
  const counts: Record<DeliveryDecision, number> = { send_free_form: 0, send_template: 0, skip_template_required: 0, defer_daily_limit: 0 };
  const decisions: DeliveryPlan["decisions"] = [];
  const limit = Math.max(1, Math.floor(options.dailyUniqueLimit));
  let capacityToday = Math.max(0, limit - (options.alreadyStartedToday ?? 0));
  const deferredPerDay = new Map<number, number>();
  let deferredIndex = 0;
  const seenTemplateContacts = new Set<string>();

  for (const r of recipients) {
    let decision: DeliveryDecision;
    if (r.channel !== "whatsapp" || r.withinWindow) {
      decision = "send_free_form";
    } else if (!options.hasTemplate) {
      decision = "skip_template_required";
    } else if (seenTemplateContacts.has(r.contactId)) {
      decision = "send_template"; // même contact déjà compté : un seul contact unique
    } else if (capacityToday > 0) {
      capacityToday--;
      seenTemplateContacts.add(r.contactId);
      decision = "send_template";
    } else {
      // Jour 1 = demain : `limit` contacts par jour au maximum.
      const dayOffset = 1 + Math.floor(deferredIndex / limit);
      deferredIndex++;
      deferredPerDay.set(dayOffset, (deferredPerDay.get(dayOffset) ?? 0) + 1);
      decision = "defer_daily_limit";
    }
    counts[decision]++;
    decisions.push({ contactId: r.contactId, channel: r.channel, decision });
  }

  const notes: string[] = [];
  if (counts.skip_template_required > 0) notes.push(`${counts.skip_template_required} contact(s) hors fenêtre ignorés faute de modèle approuvé.`);
  if (counts.defer_daily_limit > 0) notes.push(`Palier du numéro (${limit} contacts uniques/jour) : ${counts.defer_daily_limit} contact(s) repoussé(s) aux jours suivants.`);
  return {
    decisions,
    counts,
    deferredByDay: [...deferredPerDay.entries()].sort((a, b) => a[0] - b[0]).map(([dayOffset, count]) => ({ dayOffset, count })),
    notes,
  };
}

// ---------------------------------------------------------------------------
// Horaire suggéré d'après les données
// ---------------------------------------------------------------------------
export interface SendHourSuggestion {
  /** Heure locale de Douala (0-23). */
  hour: number;
  basis: "data" | "default";
  sampleSize: number;
  /** Les 3 meilleures heures avec leur nombre de messages entrants. */
  top: Array<{ hour: number; count: number }>;
}

export const DOUALA_UTC_OFFSET_HOURS = 1;
export const DEFAULT_SEND_HOUR = 18;
export const MIN_SAMPLE_FOR_SUGGESTION = 30;
const WINDOW_START = 8;
const WINDOW_END = 20;

/** Heure d'envoi conseillée : l'heure (8 h-20 h, Douala) où les contacts écrivent le plus. Faute de données, défaut explicite. */
export function suggestSendHour(inboundTimestamps: string[]): SendHourSuggestion {
  const counts = new Map<number, number>();
  let sample = 0;
  for (const iso of inboundTimestamps) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) continue;
    const hour = (new Date(t).getUTCHours() + DOUALA_UTC_OFFSET_HOURS + 24) % 24;
    sample++;
    if (hour >= WINDOW_START && hour <= WINDOW_END) counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const top = ranked.slice(0, 3).map(([hour, count]) => ({ hour, count }));
  if (sample < MIN_SAMPLE_FOR_SUGGESTION || top.length === 0) {
    return { hour: DEFAULT_SEND_HOUR, basis: "default", sampleSize: sample, top };
  }
  return { hour: top[0]!.hour, basis: "data", sampleSize: sample, top };
}
