import { getTenantPublicOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { matchFaq } from "./faq-resolver";
import { detectBusinessInfoTopic, resolveBusinessInfo } from "./business-info-resolver";
import { getActiveProducts, searchProductsByName, formatProductDiscoveryMessage, type CatalogProductSummary } from "./catalog-service";
import {
  searchServicesByName,
  listActiveServices,
  formatServiceDiscoveryMessage,
  formatServiceListMessage,
  type ServiceSummary,
} from "./service-catalog-service";
import { generateAIReply } from "./ai-response-service";
import { shouldEscalate } from "./handoff-service";
import { rememberMentionedProducts, getRecentlyMentionedProducts } from "./conversation-memory-service";
import { getMessagingOrgContext, type MessagingOrgContext } from "./messaging-context-service";
import {
  buildGreetingReply,
  detectCatalogBrowse,
  detectGreetingWord,
  detectSmallTalk,
  extractSearchTerms,
  GOODBYE_REPLY,
  THANKS_REPLY,
  type CatalogTarget,
} from "./message-intents";
import type { HandoffReason } from "@/domain/entities/conversation";

export type ConversationIntent =
  | "human_escalation"
  | "faq"
  | "small_talk"
  | "product_discovery"
  | "product_query"
  | "service_query"
  | "business_info"
  | "ai";

export interface OrchestrationResult {
  intent: ConversationIntent;
  replyText: string | null; // null = pas de réponse auto (escalade silencieuse)
  aiInvoked: boolean;
  handoffReason: HandoffReason | null;
  /**
   * Lot 3 (audit master prompt §28) — image du PREMIER produit
   * correspondant, à joindre au message (voir OutboundMessage.attachmentUrl).
   * Zernio n'autorise qu'une seule pièce jointe par message ; quand
   * plusieurs produits correspondent, le texte les liste tous mais seule
   * l'image du premier est jointe — compromis assumé plutôt qu'envoyer
   * plusieurs messages séparés (changement de comportement plus large,
   * hors périmètre de ce lot, voir RAPPORT_LOT_3.md).
   */
  replyImageUrl: string | null;
}

/** Nombre d'éléments présentés quand le client demande à « voir le catalogue ». */
const DISCOVERY_LIMIT = 5;
/** Nombre d'éléments renvoyés pour une recherche par nom. */
const SEARCH_RESULT_LIMIT = 3;

/**
 * Point d'entrée UNIQUE entre un message WhatsApp normalisé et une
 * réponse. Ordre de résolution imposé par la section 45 du doc 2 :
 * données structurées/règles → FAQ → catalogue → business data → IA en
 * dernier recours. Ne JAMAIS inverser cet ordre (coût + fiabilité).
 */
export interface RouteMessageOptions {
  /**
   * `false` = étapes déterministes uniquement (FAQ, catalogue, prestations,
   * infos business), jamais l'IA. Utilisé quand la conversation est en
   * attente d'un humain UNIQUEMENT parce que l'IA était indisponible (voir
   * handoff-service.ts::getAutoReplyMode) : on continue à répondre ce qui
   * peut l'être sans risque, sans consommer de crédit ni ré-escalader.
   * Défaut : `true` (comportement historique).
   */
  allowAI?: boolean;
}

/**
 * Lot P — une étape déterministe (FAQ, recherche catalogue…) qui échoue
 * (panne base, requête refusée) ne doit JAMAIS faire perdre tout le message :
 * on l'ignore et on passe à l'étape suivante. Avant, la première exception
 * remontait jusqu'au webhook et le client restait sans réponse.
 */
async function safeStep<T>(label: string, organizationId: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.warn(`[orchestrator] étape "${label}" en échec (org ${organizationId}), on passe à la suivante:`, error);
    return fallback;
  }
}

export async function routeMessage(
  organizationId: string,
  /** `null` = commentaire public (aucun historique de conversation, aucune mémoire de produits, aucune politesse). */
  conversationId: string | null,
  message: string,
  options: RouteMessageOptions = {},
): Promise<OrchestrationResult> {
  const allowAI = options.allowAI ?? true;
  const isPublicComment = conversationId === null;
  const log = (intent: ConversationIntent, aiInvoked: boolean, handoffReason: HandoffReason | null) => {
    // Observabilité du router (section 48) : message -> intent -> IA appelée ou non -> handoff ou non.
    console.info(
      `[orchestrator] org=${organizationId} intent=${intent} aiInvoked=${aiInvoked} handoff=${handoffReason ?? "-"}`,
    );
  };
  const answer = (intent: ConversationIntent, replyText: string, replyImageUrl: string | null = null): OrchestrationResult => {
    log(intent, false, null);
    return { intent, replyText, aiInvoked: false, handoffReason: null, replyImageUrl };
  };

  // Contexte du tenant (secteur, libellés, infos renseignées) : lu au plus une
  // fois, et seulement quand une étape en a besoin.
  let contextPromise: Promise<MessagingOrgContext> | null = null;
  const getContext = () => (contextPromise ??= getMessagingOrgContext(organizationId));

  // 1. Escalade explicite (plainte, remboursement) — avant toute autre logique.
  const escalationReason = shouldEscalate(message);
  if (escalationReason) {
    log("human_escalation", false, escalationReason);
    return { intent: "human_escalation", replyText: null, aiInvoked: false, handoffReason: escalationReason, replyImageUrl: null };
  }

  // 2. FAQ — jamais d'appel LLM si une correspondance existe (section 18).
  const faqMatch = await safeStep("faq", organizationId, () => matchFaq(organizationId, message), null);
  if (faqMatch) return answer("faq", faqMatch.answer);

  // 3. Politesses (bonjour / merci / au revoir) — jamais l'IA, jamais une escalade.
  // Pas sur un commentaire public : un accueil complet sous une publication n'a pas de sens.
  if (!isPublicComment) {
    const smallTalk = detectSmallTalk(message);
    if (smallTalk === "thanks") return answer("small_talk", THANKS_REPLY);
    if (smallTalk === "goodbye") return answer("small_talk", GOODBYE_REPLY);
    if (smallTalk === "greeting") {
      const context = await getContext();
      return answer(
        "small_talk",
        buildGreetingReply({
          greetingWord: detectGreetingWord(message),
          businessName: context.name,
          itemLabelPlural: context.itemLabelPlural,
          hasHours: context.hasHours,
          hasAddress: context.hasAddress,
          hasContact: context.hasContact,
        }),
      );
    }
  }

  // 4. PRODUCT_DISCOVERY — demande de présenter le catalogue (section 15),
  // dans le vocabulaire du secteur du tenant (biens, propriétés, plats…).
  // Pré-test tous secteurs : évite de lire le contexte du tenant pour un
  // message qui ne parle manifestement pas de catalogue.
  if (detectCatalogBrowse(message, "*")) {
    const context = await getContext();
    const browse = detectCatalogBrowse(message, context.sector);
    if (browse) {
      const presented = await safeStep("catalogue", organizationId, () => presentCatalog(organizationId, conversationId, browse.order, context), null);
      if (presented) {
        log(presented.intent, false, null);
        return presented;
      }
    }
  }

  // 5. PRODUCT_QUERY / SERVICE_QUERY — recherche par nom sur les mots
  // significatifs du message (sans mots vides, sans verbes de demande, sans
  // noms génériques de catalogue). Recherches lancées EN PARALLÈLE : avant,
  // une requête par mot, l'une après l'autre.
  const terms = extractSearchTerms(message);
  if (terms.length > 0) {
    const products = await findProductMatches(organizationId, terms);
    if (products.length > 0) {
      const [origin, context] = await Promise.all([getTenantPublicOrigin(organizationId), getContext()]);
      const reply = formatProductDiscoveryMessage(products, origin, `${origin}${STOREFRONT_PATHS.catalog}`, { itemLabelPlural: context.itemLabelPlural });
      // Lot D : mémorise les résultats montrés pour qu'une référence comme
      // "celle à 25 000" soit compréhensible par l'IA au tour suivant.
      if (conversationId) await rememberMentionedProducts(organizationId, conversationId, products.map((p) => p.id));
      return answer("product_query", reply, products[0]?.imageUrl ?? null);
    }

    // SERVICE_QUERY (Lot 3, audit master prompt §17/§26) — même heuristique
    // sur le catalogue de prestations plutôt que de laisser une question sur
    // un service tomber directement à l'IA (qui n'a alors aucune donnée
    // fiable de prix/durée et risquerait d'en inventer une, section 90).
    const services = await findServiceMatches(organizationId, terms);
    if (services.length > 0) return answer("service_query", formatServiceDiscoveryMessage(services));
  }

  // 6. BUSINESS_INFO — horaires/adresse/contact depuis `organizations` (section 19).
  const topic = detectBusinessInfoTopic(message);
  if (topic) {
    const info = await safeStep("business_info", organizationId, () => resolveBusinessInfo(organizationId, topic), null);
    if (info) return answer("business_info", info);
    // Donnée non configurée par le commerçant : on ne invente pas (section 47),
    // on tombe sur l'IA ci-dessous, qui elle-même peut escalader si nécessaire.
  }

  // 6bis. Mode « déterministe seulement » : rien ne correspond, et l'IA n'est
  // pas autorisée pour cette conversation. Aucune réponse ni nouvelle
  // escalade ICI — c'est `processInboundAutoReply` qui accuse réception au
  // client (une fois) et prévient le commerçant.
  if (!allowAI) {
    log("human_escalation", false, null);
    return { intent: "human_escalation", replyText: null, aiInvoked: false, handoffReason: null, replyImageUrl: null };
  }

  // 7. IA — dernier recours (section 20/45). Si indisponible, escalade
  // plutôt que de laisser la conversation sans réponse (section 46 :
  // une absence de réponse vaut mieux qu'une invention, mais on préfère
  // encore relayer à un humain quand c'est possible).
  try {
    // Lot D : résout les derniers produits mentionnés dans CETTE conversation
    // et les injecte dans le contexte IA (nom/prix/description uniquement,
    // jamais l'historique complet des messages).
    const recentProducts = conversationId ? await getRecentlyMentionedProducts(organizationId, conversationId) : [];
    const aiReply = await generateAIReply(organizationId, message, recentProducts);
    log("ai", true, null);
    return { intent: "ai", replyText: aiReply.text, aiInvoked: true, handoffReason: null, replyImageUrl: null };
  } catch (aiError) {
    console.warn(`[orchestrator] IA indisponible pour org ${organizationId}:`, aiError);
    log("ai", true, "ai_unavailable");
    return { intent: "ai", replyText: null, aiInvoked: true, handoffReason: "ai_unavailable", replyImageUrl: null };
  }
}

/**
 * Présente le catalogue dans l'ordre demandé (produits/biens d'abord, ou
 * prestations d'abord pour un salon ou un cabinet). Le premier catalogue non
 * vide répond ; si tous sont vides, message honnête propre au secteur.
 */
async function presentCatalog(
  organizationId: string,
  conversationId: string | null,
  order: CatalogTarget[],
  context: MessagingOrgContext,
): Promise<OrchestrationResult | null> {
  const origin = await getTenantPublicOrigin(organizationId);
  for (const target of order) {
    if (target === "products") {
      const products = await safeStep("catalogue_produits", organizationId, () => getActiveProducts(organizationId, DISCOVERY_LIMIT), [] as CatalogProductSummary[]);
      if (products.length === 0) continue;
      // Lot D : mémorise les produits montrés pour qu'une référence comme
      // "celle à 25 000" soit compréhensible par l'IA au tour suivant.
      if (conversationId) await rememberMentionedProducts(organizationId, conversationId, products.map((p) => p.id));
      return {
        intent: "product_discovery",
        replyText: formatProductDiscoveryMessage(products, origin, `${origin}${STOREFRONT_PATHS.catalog}`, { itemLabelPlural: context.itemLabelPlural }),
        aiInvoked: false,
        handoffReason: null,
        replyImageUrl: products[0]?.imageUrl ?? null,
      };
    }
    const services = await safeStep("catalogue_prestations", organizationId, () => listActiveServices(organizationId, DISCOVERY_LIMIT), [] as ServiceSummary[]);
    if (services.length === 0) continue;
    return {
      intent: "service_query",
      replyText: formatServiceListMessage(services, `${origin}${STOREFRONT_PATHS.services}`),
      aiInvoked: false,
      handoffReason: null,
      replyImageUrl: null,
    };
  }
  return {
    intent: "product_discovery",
    replyText: formatProductDiscoveryMessage([], origin, `${origin}${STOREFRONT_PATHS.catalog}`, {
      itemLabelPlural: context.itemLabelPlural,
      emptyMessage: context.emptyCatalogMessage,
    }),
    aiInvoked: false,
    handoffReason: null,
    replyImageUrl: null,
  };
}

/** Recherche par nom pour chaque mot, en parallèle ; les produits touchés par le plus de mots passent devant. */
async function findProductMatches(organizationId: string, terms: string[]): Promise<CatalogProductSummary[]> {
  const perTerm = await Promise.all(
    terms.map((term) => safeStep("recherche_produit", organizationId, () => searchProductsByName(organizationId, term, SEARCH_RESULT_LIMIT), [] as CatalogProductSummary[])),
  );
  const scored = new Map<string, { product: CatalogProductSummary; hits: number; firstTerm: number }>();
  perTerm.forEach((matches, termIndex) => {
    for (const product of matches) {
      const entry = scored.get(product.id);
      if (entry) entry.hits += 1;
      else scored.set(product.id, { product, hits: 1, firstTerm: termIndex });
    }
  });
  return [...scored.values()]
    .sort((a, b) => b.hits - a.hits || a.firstTerm - b.firstTerm)
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((entry) => entry.product);
}

async function findServiceMatches(organizationId: string, terms: string[]): Promise<ServiceSummary[]> {
  const perTerm = await Promise.all(
    terms.map((term) => safeStep("recherche_prestation", organizationId, () => searchServicesByName(organizationId, term, SEARCH_RESULT_LIMIT), [] as ServiceSummary[])),
  );
  const scored = new Map<string, { service: ServiceSummary; hits: number; firstTerm: number }>();
  perTerm.forEach((matches, termIndex) => {
    for (const service of matches) {
      const entry = scored.get(service.id);
      if (entry) entry.hits += 1;
      else scored.set(service.id, { service, hits: 1, firstTerm: termIndex });
    }
  });
  return [...scored.values()]
    .sort((a, b) => b.hits - a.hits || a.firstTerm - b.firstTerm)
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((entry) => entry.service);
}
