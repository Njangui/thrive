/**
 * Lot P — compréhension DÉTERMINISTE d'un message entrant (aucune I/O,
 * aucun appel IA). Ce module remplace les listes de mots-clés figées de
 * `conversation-orchestrator.ts`, qui ne reconnaissaient qu'un vocabulaire
 * de boutique (« produits », « catalogue »…) : un commerçant immobilier dont
 * le client écrit « présentez-moi vos propriétés » n'obtenait aucune
 * réponse, la demande tombait jusqu'à l'IA (souvent non activée) puis en
 * escalade silencieuse.
 *
 * Trois familles :
 *  1. politesses (bonjour / merci / au revoir) — répondues sans IA ;
 *  2. demande de présentation du catalogue, adaptée au SECTEUR du tenant ;
 *  3. mots significatifs à chercher par nom dans le catalogue.
 */

export function normalizeMessage(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeMessage(text);
  return normalized ? normalized.split(" ") : [];
}

const IRREGULAR_SINGULAR: Record<string, string> = { locaux: "local" };

/** Singulier naïf (biens → bien, propriétés → propriété) — suffisant pour un lookup de vocabulaire. */
export function singularize(token: string): string {
  if (token.length <= 3) return token;
  const irregular = IRREGULAR_SINGULAR[token];
  if (irregular) return irregular;
  if (token.endsWith("s") || token.endsWith("x")) return token.slice(0, -1);
  return token;
}

const words = (list: string): Set<string> => new Set(list.split(/\s+/).filter(Boolean));

// ---------------------------------------------------------------------------
// 1. Politesses
// ---------------------------------------------------------------------------

export type SmallTalkKind = "greeting" | "thanks" | "goodbye";

const GREETING_TRIGGERS = words("bonjour bonsoir salut salutations hello hi hey coucou slt bjr bsr allo alo hola yo");
const THANKS_TRIGGERS = words("merci mercii thanks thank remercie remercions ok okay okey parfait super genial entendu nickel compris top cool accord note recu");
const GOODBYE_TRIGGERS = words("revoir bientot bye ciao tchao adieu demain journee soiree nuit tard");
const SMALL_TALK_SUPPORT = words(
  "svp stp s il vous plait te tu monsieur madame mademoiselle mr mme messieurs mesdames cher chers chere cheres a au tous toutes tout toute l equipe le la les monde comment allez ca va bien et toi je j espere que qu votre vos d de du c est tres beaucoup encore un une non oui plus bon bonne pour reponse rapide moi nous",
);
const POSITIVE_EMOJIS = ["👍", "🙏", "😊", "😀", "😃", "😄", "🙂", "❤", "♥", "👌", "✅", "🤝", "😍"];

/**
 * Le message est-il UNIQUEMENT une politesse ? Tous ses mots doivent appartenir
 * au vocabulaire de politesse : « bonjour, vous avez des maisons ? » n'en est
 * pas une (il contient une vraie demande), « bonjour monsieur » en est une.
 */
export function detectSmallTalk(message: string): SmallTalkKind | null {
  const tokens = tokenize(message);
  if (tokens.length === 0) {
    // Message réduit à un ou plusieurs émojis positifs (👍 🙏 😊…) ; un émoji
    // négatif (😡) n'est jamais traité comme un remerciement.
    if (message.includes("👋")) return "greeting";
    let rest = message;
    let found = false;
    for (const emoji of POSITIVE_EMOJIS) {
      if (rest.includes(emoji)) found = true;
      rest = rest.split(emoji).join("");
    }
    rest = rest.replace(/[\s\u200d\ufe0f\ufe0e!?.,;:]+/g, "");
    return found && rest === "" ? "thanks" : null;
  }
  if (tokens.length > 8) return null;

  const allKnown = tokens.every((t) => GREETING_TRIGGERS.has(t) || THANKS_TRIGGERS.has(t) || GOODBYE_TRIGGERS.has(t) || SMALL_TALK_SUPPORT.has(t));
  if (!allKnown) return null;

  const padded = ` ${tokens.join(" ")} `;
  if (tokens.some((t) => GOODBYE_TRIGGERS.has(t)) || padded.includes(" a plus ")) return "goodbye";
  if (tokens.some((t) => GREETING_TRIGGERS.has(t))) return "greeting";
  if (tokens.some((t) => THANKS_TRIGGERS.has(t))) return "thanks";
  return null;
}

export function detectGreetingWord(message: string): "Bonjour" | "Bonsoir" {
  return normalizeMessage(message).split(" ").includes("bonsoir") ? "Bonsoir" : "Bonjour";
}

export interface GreetingReplyInput {
  greetingWord?: "Bonjour" | "Bonsoir";
  businessName: string | null;
  itemLabelPlural: string;
  hasHours: boolean;
  hasAddress: boolean;
  hasContact: boolean;
}

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ou ${items[items.length - 1]}`;
}

/** Accueil : ne propose que ce que le commerçant a réellement renseigné (jamais une promesse creuse). */
export function buildGreetingReply(input: GreetingReplyInput): string {
  const asks = [`« présentez-moi vos ${input.itemLabelPlural} »`];
  if (input.hasHours) asks.push("« quels sont vos horaires ? »");
  if (input.hasAddress) asks.push("« où êtes-vous situés ? »");
  if (input.hasContact) asks.push("« comment vous contacter ? »");
  const hello = input.greetingWord ?? "Bonjour";
  const intro = input.businessName ? `${hello} ! 👋 Bienvenue chez ${input.businessName}.` : `${hello} ! 👋 Bienvenue.`;
  return `${intro}\nJe peux vous aider tout de suite, par exemple : ${joinOr(asks)}.\nQue souhaitez-vous ?`;
}

export const THANKS_REPLY = "Avec plaisir ! N'hésitez pas si vous avez d'autres questions. 😊";
export const GOODBYE_REPLY = "Merci pour votre message, à très bientôt ! 👋";

// ---------------------------------------------------------------------------
// 2. Demande de présentation du catalogue
// ---------------------------------------------------------------------------

export type CatalogTarget = "products" | "services";

export interface CatalogBrowseIntent {
  /** Ordre dans lequel présenter les catalogues (le premier non vide est utilisé). */
  order: CatalogTarget[];
}

/** Noms de catalogue valables dans tous les secteurs. */
const PRODUCT_NOUNS = words("produit catalogue article offre nouveaute collection marchandise");
const SERVICE_NOUNS = words("service prestation tarif soin formule forfait activite");
/** Vocabulaire immobilier sans ambiguïté : reconnu quel que soit le secteur déclaré du tenant. */
const REAL_ESTATE_GLOBAL_NOUNS = words("propriete logement appartement villa terrain immeuble annonce residence parcelle duplex immobilier");
/** Mots qui ne désignent le catalogue QUE dans leur secteur (« carte », « bien », « local »…). */
const SECTOR_NOUNS: Record<string, Set<string>> = {
  real_estate: words("bien maison studio chambre local bureau location loyer"),
  restaurant: words("menu carte plat boisson dessert repas"),
  retail: new Set<string>(),
  beauty: new Set<string>(),
  professional_services: new Set<string>(),
};
/** Ambigus hors de leur secteur (« bien » = adverbe, « carte » = carte bancaire) : exclus quand le secteur est inconnu. */
const AMBIGUOUS_NOUNS = words("bien maison carte local bureau location studio chambre loyer menu plat boisson dessert repas");
/** Pluriel sans ambiguïté : « vos biens » désigne le catalogue dans tous les secteurs. */
const ALWAYS_NOUN_RAW = words("biens");
const SERVICE_FIRST_SECTORS = new Set(["beauty", "professional_services"]);

function productLikeNouns(sector: string): Set<string> {
  if (sector === "*") {
    return new Set([...PRODUCT_NOUNS, ...REAL_ESTATE_GLOBAL_NOUNS, ...Object.values(SECTOR_NOUNS).flatMap((s) => [...s])]);
  }
  const own = SECTOR_NOUNS[sector];
  if (own) return new Set([...PRODUCT_NOUNS, ...REAL_ESTATE_GLOBAL_NOUNS, ...own]);
  const unknown = Object.values(SECTOR_NOUNS).flatMap((s) => [...s]).filter((w) => !AMBIGUOUS_NOUNS.has(w));
  return new Set([...PRODUCT_NOUNS, ...REAL_ESTATE_GLOBAL_NOUNS, ...unknown]);
}

/** Radicaux de verbes/expressions qui signalent « je veux voir / savoir ce que vous avez ». */
const BROWSE_CUE_STEMS = [
  "present", "montr", "list", "propos", "offr", "dispo", "vend", "cherch", "recherch", "souhait", "voudr", "veux", "aimer",
  "interess", "decouvr", "consult", "envoy", "partag", "donn", "avez", "avons", "quel", "combien", "quoi", "louer", "acheter", "achat",
];
const BROWSE_CUE_EXACT = words("voir voit liste");
/** Le client parle d'une commande/d'un article qu'il possède déjà : ce n'est pas une demande de catalogue. */
const NEGATIVE_STEMS = ["probleme", "cass", "defectu", "defaut", "retard", "erreur", "annul", "echang", "retour", "arrive", "recu"];
const FIRST_PERSON_POSSESSIVES = words("mon ma mes");
const BROWSE_PHRASES: RegExp[] = [
  /\bvous (vendez|proposez|offrez|faites|avez) quoi\b/,
  /\bque (vendez|proposez|offrez|faites|avez) vous\b/,
  /\bqu est ce que vous (vendez|proposez|offrez|faites|avez)\b/,
  /\bqu (avez|vendez|proposez|offrez|faites) vous\b/,
  /\bqu est ce qui est disponible\b/,
  /\bvos (offres|activites)\b/,
];

export function isBrowseCue(token: string): boolean {
  return BROWSE_CUE_EXACT.has(token) || BROWSE_CUE_STEMS.some((stem) => token.startsWith(stem));
}

/**
 * Le message demande-t-il de PRÉSENTER le catalogue (biens, produits, menu,
 * prestations…) ? `sector` = secteur du tenant (`retail`, `real_estate`, …),
 * `""` si inconnu, `"*"` pour un pré-test tous secteurs confondus (sert à
 * éviter de charger le contexte du tenant quand le message n'a aucune chance
 * d'être une demande de catalogue).
 */
export function detectCatalogBrowse(message: string, sector: string): CatalogBrowseIntent | null {
  const tokens = tokenize(message);
  if (tokens.length === 0) return null;
  if (tokens.some((t) => NEGATIVE_STEMS.some((stem) => t.startsWith(stem)))) return null;

  const productNouns = productLikeNouns(sector);
  let productNoun = false;
  let serviceNoun = false;
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    if (previous && FIRST_PERSON_POSSESSIVES.has(previous)) return; // « mon article », « ma villa »
    const singular = singularize(token);
    if (productNouns.has(singular) || ALWAYS_NOUN_RAW.has(token)) productNoun = true;
    else if (SERVICE_NOUNS.has(singular)) serviceNoun = true;
  });

  const normalized = tokens.join(" ");
  const phrase = BROWSE_PHRASES.some((re) => re.test(normalized));
  if (!productNoun && !serviceNoun && !phrase) return null;
  // Un long message qui contient un mot de catalogue sans verbe de demande
  // (« mon article est arrivé cassé ») n'est pas une demande de présentation.
  if (!phrase && tokens.length > 5 && !tokens.some(isBrowseCue)) return null;

  const servicesFirst = serviceNoun
    ? !productNoun || SERVICE_FIRST_SECTORS.has(sector)
    : !productNoun && SERVICE_FIRST_SECTORS.has(sector);
  return { order: servicesFirst ? ["services", "products"] : ["products", "services"] };
}

// ---------------------------------------------------------------------------
// 3. Mots à chercher par nom dans le catalogue
// ---------------------------------------------------------------------------

const SEARCH_STOP_WORDS = words(`
  dans avec pour chez vers sous sans vous vos votre nous notre nos leur leurs elle elles ils mais donc alors aussi comme cela cette
  celle celles celui ceux quel quels quelle quelles quoi quand comment combien pourquoi sont etes suis sommes etre avez avons avoir avais
  avait fait faire faites peut peux peuvent pouvez pouvoir veut voulez voudrais voudrait aimerais besoin chose toute tout tous toutes plus
  moins tres bien encore deja aujourd hui demain hier merci bonjour bonsoir salut svp stp plait monsieur madame mademoiselle dispo
  disponible disponibles prix cout coute coutent numero adresse horaire horaires ouvert ouverts ouverte ferme fermes heure heures contact
  telephone email mail joindre appeler situe situes info infos information informations renseignement renseignements detail details photo
  photos image images video lien site voici voila oui non autre autres meme juste seulement question questions moi toi lui eux ici
`);

/**
 * Mots significatifs d'un message à chercher par NOM dans le catalogue :
 * ni mots vides, ni verbes de demande, ni noms génériques de catalogue
 * (« produits », « biens », « propriétés »…), ni vocabulaire d'informations
 * pratiques (horaires, adresse) — qui ne désignent jamais un article précis.
 * Renvoyés au SINGULIER (« jeans » → « jean » trouve aussi « Jeans slim »).
 */
export function extractSearchTerms(message: string, max = 4): string[] {
  const nouns = productLikeNouns("*");
  const terms: string[] = [];
  for (const token of tokenize(message)) {
    if (token.length < 4) continue;
    if (SEARCH_STOP_WORDS.has(token) || isBrowseCue(token)) continue;
    const singular = singularize(token);
    if (SEARCH_STOP_WORDS.has(singular) || nouns.has(singular) || SERVICE_NOUNS.has(singular) || ALWAYS_NOUN_RAW.has(token)) continue;
    const term = token.length >= 5 ? singular : token;
    if (!terms.includes(term)) terms.push(term);
    if (terms.length >= max) break;
  }
  return terms;
}
