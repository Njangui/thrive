/**
 * Identité juridique de l'éditeur de CRESYVA — l'UNIQUE endroit à remplir
 * pour les trois pages légales (mentions légales, CGU, confidentialité).
 *
 * Jusqu'ici, les `[À COMPLÉTER]` étaient disséminés dans le texte de trois
 * pages : impossible de savoir d'un coup d'œil ce qui manquait, et rien
 * n'empêchait de mettre en ligne (et d'indexer) une page à trous.
 *
 * Règles :
 *  - Une valeur vide s'affiche comme `[À COMPLÉTER — libellé]` (voir
 *    `legalField`) : on n'invente JAMAIS une donnée légale.
 *  - Tant qu'un champ obligatoire est vide (`isLegalEntityComplete`), les
 *    trois pages restent `noindex` : Google n'indexe pas une page légale à trous.
 *  - Les valeurs sont des faits (n° RCCM, NIU…) ou des engagements pris par
 *    l'éditeur (durée de conservation, tribunal compétent) : à confirmer
 *    par l'éditeur — et à faire relire par un juriste avant mise en
 *    production (droit camerounais/OHADA).
 */
export interface LegalEntity {
  /** Dénomination sociale (ou nom de l'entrepreneur individuel). */
  companyName: string;
  /** Forme juridique : « SARL », « SAS », « Entreprise individuelle »… */
  legalForm: string;
  /** Capital social en FCFA, chiffres seulement (ex. « 1 000 000 »). Vide pour une entreprise sans capital : la mention est alors omise. */
  shareCapital: string;
  /** N° d'immatriculation au RCCM. */
  rccm: string;
  /** Numéro d'identifiant unique du contribuable (NIU). */
  niu: string;
  /** Adresse du siège social (rue, quartier). */
  address: string;
  /** Ville du siège social. */
  city: string;
  /** Pays du siège social. */
  country: string;
  /** Téléphone de l'éditeur — facultatif, affiché s'il est renseigné. */
  phone: string;
  /** Email de contact général (mentions légales, CGU, questions). */
  contactEmail: string;
  /** Email dédié aux demandes de données personnelles — facultatif, `contactEmail` à défaut. */
  privacyEmail: string;
  /** Nom du représentant légal, directeur de la publication. */
  publicationDirector: string;
  /** Ville dont les tribunaux sont compétents en cas de litige (souvent celle du siège). */
  jurisdictionCity: string;
  /**
   * Durée pendant laquelle les données restent disponibles pour export après
   * la fermeture d'un compte, avant suppression définitive (ex. « 90 jours »).
   * Engagement de l'éditeur : à ne renseigner que si la suppression est
   * réellement mise en œuvre.
   */
  postClosureRetention: string;
  /** Date de dernière mise à jour des CGU et de la politique de confidentialité, telle qu'affichée. */
  lastUpdated: string;
}

export const LEGAL_ENTITY: LegalEntity = {
  companyName: "",
  legalForm: "",
  shareCapital: "",
  rccm: "",
  niu: "",
  address: "",
  city: "",
  country: "Cameroun",
  phone: "",
  contactEmail: "",
  privacyEmail: "",
  publicationDirector: "",
  jurisdictionCity: "",
  postClosureRetention: "",
  lastUpdated: "20 septembre 2026",
};

/** Champs sans lesquels une page légale n'a pas de valeur — `shareCapital`, `phone` et `privacyEmail` sont facultatifs. */
const REQUIRED_FIELDS: readonly (keyof LegalEntity)[] = [
  "companyName",
  "legalForm",
  "rccm",
  "niu",
  "address",
  "city",
  "country",
  "contactEmail",
  "publicationDirector",
  "jurisdictionCity",
  "postClosureRetention",
];

export function missingLegalFields(entity: LegalEntity = LEGAL_ENTITY): (keyof LegalEntity)[] {
  return REQUIRED_FIELDS.filter((key) => !entity[key].trim());
}

export function isLegalEntityComplete(entity: LegalEntity = LEGAL_ENTITY): boolean {
  return missingLegalFields(entity).length === 0;
}

/** Valeur renseignée, sinon un repère visible `[À COMPLÉTER — libellé]` — jamais une valeur inventée. */
export function legalField(value: string, label: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : `[À COMPLÉTER — ${label}]`;
}
