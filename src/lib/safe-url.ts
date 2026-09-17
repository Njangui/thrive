/**
 * Garde-fou sur les URL saisies par un commerçant et rendues telles
 * quelles dans un `href` de la vitrine publique (CTA de l'en-tête, second
 * bouton, liens de réseaux sociaux).
 *
 * Le risque est réel et pré-existant : `organization_landing_config.cta_url`
 * et `organizations.social_links` sont écrits depuis /dashboard/site sans
 * aucune validation de schéma d'URL, puis injectés dans un `<a href>`.
 * Un `javascript:...` collé là s'exécute dans le navigateur de CHAQUE
 * visiteur de la vitrine, avec le domaine du tenant dans la barre
 * d'adresse. Le `Content-Security-Policy` posé dans next.config.mjs
 * n'arrête pas ce cas : il autorise `'unsafe-inline'` pour les scripts
 * (hydratation Next.js), ce qui laisse passer les URL `javascript:`.
 *
 * La liste est volontairement une LISTE BLANCHE : tout ce qui n'est pas
 * explicitement reconnu est refusé. Ajouter un schéma exotique demande un
 * geste délibéré, là où une liste noire laisserait passer le prochain
 * schéma auquel personne n'a pensé (`data:`, `vbscript:`, `blob:`…).
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "whatsapp:"]);

export function isSafePublicUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  // Lien interne à la vitrine (`/contact`, `/produits?tri=prix`). Le
  // double slash initial est refusé : `//evil.example` est une URL
  // protocol-relative, donc une redirection hors du domaine déguisée en
  // chemin interne.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;

  // Ancre interne (`#contact`), utilisée par les CTA de section.
  if (trimmed.startsWith("#")) return true;

  try {
    return ALLOWED_PROTOCOLS.has(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/**
 * Variante non levante pour l'AFFICHAGE : retourne `null` au lieu de
 * refuser, pour qu'une URL déjà en base (écrite avant l'introduction de
 * cette validation) fasse simplement disparaître le lien au lieu de
 * casser le rendu de toute la vitrine.
 */
export function toSafeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  return isSafePublicUrl(value) ? value.trim() : null;
}
