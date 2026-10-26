import { getPlatformProfile, type PlatformProfile } from "./platform-profiles";

/**
 * C5 — métadonnées de publication et adaptation DÉTERMINISTE à chaque
 * plateforme. Le LLM propose un titre, une légende, des hashtags, un
 * premier commentaire et un appel à l'action ; ce module, lui, garantit que
 * le résultat respecte les limites de la plateforme (principe : règles en
 * code, pas en prompt). Il ne fait aucun appel réseau ni appel IA.
 */
export interface PublicationMetadata {
  title?: string;
  caption: string;
  hashtags: string[];
  firstComment?: string;
  callToAction?: string;
}

export type PublicationIssueCode =
  | "caption_truncated"
  | "title_truncated"
  | "hashtags_trimmed"
  | "hashtags_normalized"
  | "first_comment_unsupported"
  | "first_comment_truncated"
  | "title_missing"
  | "media_missing"
  | "caption_empty";

export interface PublicationIssue {
  code: PublicationIssueCode;
  /** `adjusted` : corrigé automatiquement ; `blocking` : à corriger avant l'envoi. */
  severity: "adjusted" | "blocking";
  message: string;
}

export interface FittedPublication {
  platform: string;
  metadata: PublicationMetadata;
  /** Texte final envoyé à la plateforme (légende + appel à l'action + hashtags). */
  text: string;
  length: number;
  issues: PublicationIssue[];
  /** Vrai s'il n'y a aucune anomalie bloquante. */
  ok: boolean;
}

/** Longueur en points de code (un émoji = 1), pas en unités UTF-16. */
export function textLength(value: string): number {
  return Array.from(value).length;
}

function truncateAtWord(value: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  const cut = chars.slice(0, Math.max(0, max - 1)).join("");
  const lastSpace = cut.search(/\s\S*$/);
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/** « #Promo Noël », « promo », « #promo » → « #PromoNoël » sans espace ni ponctuation. */
export function normalizeHashtag(raw: string): string | null {
  const body = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]+/gu, "");
  return body ? `#${body}` : null;
}

export function normalizeHashtags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const tag = normalizeHashtag(item);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function compose(parts: { caption: string; callToAction?: string; hashtags: string[] }): string {
  const blocks = [parts.caption.trim()];
  if (parts.callToAction?.trim()) blocks.push(parts.callToAction.trim());
  if (parts.hashtags.length) blocks.push(parts.hashtags.join(" "));
  return blocks.filter(Boolean).join("\n\n");
}

export interface FitOptions {
  /** Un média est-il joint ? Conditionne la limite de légende (Telegram) et l'exigence de média. */
  hasMedia?: boolean;
}

export function fitMetadataToPlatform(platform: string, input: PublicationMetadata, options: FitOptions = {}): FittedPublication {
  const profile = getPlatformProfile(platform);
  if (!profile) throw new Error(`Plateforme de publication inconnue : ${platform}`);
  return fitWithProfile(profile, input, options);
}

export function fitWithProfile(profile: PlatformProfile, input: PublicationMetadata, options: FitOptions = {}): FittedPublication {
  const issues: PublicationIssue[] = [];
  const bodyMax = options.hasMedia && profile.bodyMaxWithMedia ? profile.bodyMaxWithMedia : profile.bodyMax;

  // Titre.
  let title = input.title?.trim() || undefined;
  if (profile.titleMax === null) {
    title = undefined; // plateforme sans champ titre : ignoré, pas une erreur.
  } else if (title && textLength(title) > profile.titleMax) {
    title = truncateAtWord(title, profile.titleMax);
    issues.push({ code: "title_truncated", severity: "adjusted", message: `Titre raccourci à ${profile.titleMax} caractères (${profile.label}).` });
  }
  if (profile.titleRequired && !title) {
    issues.push({ code: "title_missing", severity: "blocking", message: `${profile.label} exige un titre.` });
  }

  // Hashtags : normalisation puis plafond.
  const rawTags = input.hashtags ?? [];
  let hashtags = normalizeHashtags(rawTags);
  if (hashtags.join("|") !== rawTags.map((t) => t.trim()).join("|")) {
    issues.push({ code: "hashtags_normalized", severity: "adjusted", message: "Hashtags nettoyés (symbole #, espaces, doublons)." });
  }
  if (hashtags.length > profile.hashtagsMax) {
    hashtags = hashtags.slice(0, profile.hashtagsMax);
    issues.push({ code: "hashtags_trimmed", severity: "adjusted", message: `Hashtags limités à ${profile.hashtagsMax} (${profile.label}).` });
  }

  // Légende : on réserve la place de l'appel à l'action et des hashtags,
  // puis on raccourcit la légende elle-même (jamais le lien ni le CTA).
  const caption = input.caption.trim();
  if (!caption) issues.push({ code: "caption_empty", severity: "blocking", message: "La légende est vide." });
  const callToAction = input.callToAction?.trim() || undefined;
  const withoutCaption = textLength(compose({ caption: "", callToAction, hashtags }));
  const separators = (callToAction ? 2 : 0) + (hashtags.length ? 2 : 0);
  const room = bodyMax - withoutCaption - separators;
  let fittedCaption = caption;
  if (textLength(caption) > room) {
    fittedCaption = truncateAtWord(caption, Math.max(0, room));
    issues.push({ code: "caption_truncated", severity: "adjusted", message: `Légende raccourcie pour tenir dans ${bodyMax} caractères (${profile.label}).` });
  }
  let text = compose({ caption: fittedCaption, callToAction, hashtags });
  // Garde-fou final : l'appel à l'action seul peut dépasser la limite.
  if (textLength(text) > bodyMax) {
    text = truncateAtWord(text, bodyMax);
    issues.push({ code: "caption_truncated", severity: "adjusted", message: `Texte tronqué à ${bodyMax} caractères (${profile.label}).` });
  }

  // Premier commentaire.
  let firstComment = input.firstComment?.trim() || undefined;
  if (firstComment && profile.firstComment === "none") {
    firstComment = undefined;
    issues.push({ code: "first_comment_unsupported", severity: "adjusted", message: `${profile.label} ne gère pas le premier commentaire automatique : ignoré.` });
  } else if (firstComment && textLength(firstComment) > 2000) {
    firstComment = truncateAtWord(firstComment, 2000);
    issues.push({ code: "first_comment_truncated", severity: "adjusted", message: "Premier commentaire raccourci à 2 000 caractères." });
  }

  if (profile.mediaRequired && options.hasMedia === false) {
    issues.push({ code: "media_missing", severity: "blocking", message: `${profile.label} exige un média (image ou vidéo).` });
  }

  return {
    platform: profile.platform,
    metadata: { title, caption: fittedCaption, hashtags, firstComment, callToAction },
    text,
    length: textLength(text),
    issues,
    ok: !issues.some((issue) => issue.severity === "blocking"),
  };
}
