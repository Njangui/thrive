/**
 * C5 — profils de limites et de style par plateforme de publication.
 *
 * Valeurs VOLONTAIREMENT PRUDENTES : on ne dépasse jamais une limite connue,
 * mieux vaut une légende un peu plus courte qu'un post refusé. Les plateformes
 * changent leurs règles : toute valeur marquée « a_verifier » doit être
 * confrontée à la documentation de la plateforme (ou à un post de test)
 * avant d'être relevée. Ce fichier est du code déterministe : le LLM ne
 * décide JAMAIS d'une limite, il rédige à l'intérieur de celles-ci.
 *
 * Telegram est un canal DIRECT (bot du tenant), hors Zernio.
 */
export const PUBLICATION_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "linkedin",
  "twitter",
  "pinterest",
  "youtube",
  "telegram",
] as const;
export type PublicationPlatform = (typeof PUBLICATION_PLATFORMS)[number];

/** Comment le premier commentaire est publié sur cette plateforme. */
export type FirstCommentMode = "zernio" | "deferred_job" | "none";

export interface PlatformProfile {
  platform: PublicationPlatform;
  label: string;
  /** Passe par Zernio (false = connecteur direct, ex. Telegram). */
  viaZernio: boolean;
  /** Titre distinct de la légende (null = pas de champ titre). */
  titleMax: number | null;
  titleRequired: boolean;
  /** Longueur maximale du texte / de la légende (points de code Unicode). */
  bodyMax: number;
  /** Limite quand un média est joint, si elle diffère (ex. légende Telegram). */
  bodyMaxWithMedia?: number;
  /** Nombre maximal de hashtags que Flexco accepte d'envoyer. */
  hashtagsMax: number;
  /** Nombre conseillé (qualité), utilisé dans le prompt de rédaction. */
  hashtagsRecommended: number;
  firstComment: FirstCommentMode;
  mediaRequired: boolean;
  /** Consigne de style transmise au rédacteur (LLM). */
  style: string;
  /** « verifie » = confirmé par une source documentée ; sinon à vérifier. */
  verification: "verifie" | "a_verifier";
  note?: string;
}

export const PLATFORM_PROFILES: Record<PublicationPlatform, PlatformProfile> = {
  instagram: {
    platform: "instagram", label: "Instagram", viaZernio: true,
    titleMax: null, titleRequired: false, bodyMax: 2200, hashtagsMax: 30, hashtagsRecommended: 5,
    firstComment: "zernio", mediaRequired: true,
    style: "Accroche forte sur la première ligne, ton chaleureux, émojis mesurés, appel à l'action vers la conversation WhatsApp ou le lien en bio.",
    verification: "a_verifier",
    note: "Instagram recommande peu de hashtags ; le plafond de 30 est une limite technique, 3 à 5 est conseillé. Un média est obligatoire.",
  },
  facebook: {
    platform: "facebook", label: "Facebook", viaZernio: true,
    titleMax: null, titleRequired: false, bodyMax: 5000, hashtagsMax: 5, hashtagsRecommended: 2,
    firstComment: "zernio", mediaRequired: false,
    style: "Ton conversationnel, phrases courtes, prix en FCFA visible, lien produit ou numéro WhatsApp en fin de message.",
    verification: "a_verifier",
    note: "La limite technique est bien plus haute ; on plafonne à 5 000 pour la lisibilité (voir le plafond de Flexco, pas celui de Meta).",
  },
  tiktok: {
    platform: "tiktok", label: "TikTok", viaZernio: true,
    titleMax: null, titleRequired: false, bodyMax: 2200, hashtagsMax: 5, hashtagsRecommended: 4,
    firstComment: "deferred_job", mediaRequired: true,
    style: "Légende très courte et rythmée, hashtags tendance locaux, ton jeune et direct.",
    verification: "a_verifier",
    note: "Limite de légende prudente (2 200) ; TikTok peut accepter davantage. Vidéo obligatoire. Premier commentaire via tâche différée (URL de la vidéo connue plus tard).",
  },
  linkedin: {
    platform: "linkedin", label: "LinkedIn", viaZernio: true,
    titleMax: null, titleRequired: false, bodyMax: 3000, hashtagsMax: 5, hashtagsRecommended: 3,
    firstComment: "zernio", mediaRequired: false,
    style: "Ton professionnel mais humain, une idée par paragraphe, chiffres concrets, pas de familiarité excessive.",
    verification: "a_verifier",
    note: "Les commentaires ne sont exposés que pour une page d'entreprise (limite de la plateforme).",
  },
  twitter: {
    platform: "twitter", label: "X", viaZernio: true,
    titleMax: null, titleRequired: false, bodyMax: 280, hashtagsMax: 2, hashtagsRecommended: 1,
    firstComment: "none", mediaRequired: false,
    style: "Un seul message court et percutant, un hashtag au plus, le lien compte dans la limite.",
    verification: "a_verifier",
    note: "280 = compte standard (les comptes payants ont plus). Les URL comptent pour une longueur fixe sur X : on reste volontairement en dessous.",
  },
  pinterest: {
    platform: "pinterest", label: "Pinterest", viaZernio: true,
    titleMax: 100, titleRequired: true, bodyMax: 500, hashtagsMax: 5, hashtagsRecommended: 3,
    firstComment: "none", mediaRequired: true,
    style: "Titre descriptif avec mots-clés (ce que la personne chercherait), description utile, visuel vertical.",
    verification: "a_verifier",
    note: "Image obligatoire, titre requis. Limites de titre/description prudentes.",
  },
  youtube: {
    platform: "youtube", label: "YouTube", viaZernio: true,
    titleMax: 100, titleRequired: true, bodyMax: 5000, hashtagsMax: 3, hashtagsRecommended: 3,
    firstComment: "zernio", mediaRequired: true,
    style: "Titre clair avec le mot-clé principal, description structurée (ce que contient la vidéo, liens, contact).",
    verification: "a_verifier",
    note: "Vidéo obligatoire. YouTube est téléversé directement à la programmation (voir omnichannel-publication-service).",
  },
  telegram: {
    platform: "telegram", label: "Telegram", viaZernio: false,
    titleMax: null, titleRequired: false, bodyMax: 4096, bodyMaxWithMedia: 1024, hashtagsMax: 5, hashtagsRecommended: 2,
    firstComment: "none", mediaRequired: false,
    style: "Message direct et utile, prix en FCFA, boutons « Voir » plutôt que liens en clair (voir buildProductButtons).",
    verification: "verifie",
    note: "Canal direct (bot du tenant), hors Zernio. 4 096 caractères de texte, 1 024 pour une légende de média (limites de l'API Bot Telegram).",
  },
};

/** « x » et « twitter » désignent la même plateforme côté Zernio (« twitter »). */
export function normalizePlatform(value: string): PublicationPlatform | null {
  const key = value.trim().toLowerCase();
  const alias = key === "x" ? "twitter" : key;
  return (PUBLICATION_PLATFORMS as readonly string[]).includes(alias) ? (alias as PublicationPlatform) : null;
}

export function getPlatformProfile(platform: string): PlatformProfile | null {
  const normalized = normalizePlatform(platform);
  return normalized ? PLATFORM_PROFILES[normalized] : null;
}
