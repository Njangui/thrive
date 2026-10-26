import { getTenantPublicOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { matchFaq } from "./faq-resolver";
import { recordFaqHit, recordQuestionForLearning, resolveFaqAnswerVariables } from "./faq-learning-service";
import { detectBusinessInfoTopic, resolveBusinessInfo } from "./business-info-resolver";
import { getActiveProducts, searchProductsByName, formatProductDiscoveryMessage, type CatalogProductSummary } from "./catalog-service";
import {
  searchServicesByName,
  listActiveServices,
  formatServiceDiscoveryMessage,
  formatServiceListMessage,
  type ServiceSummary,
} from "./service-catalog-service";
import { runAssistantTurn } from "./assistant-turn-service";
import { formatCategoryListReply, formatProductListReply, formatProductSearchReply } from "./product-reply-format";
import { loadVoiceAndLibrary } from "./message-library-service";
import { answerDeliveryQuestion, detectDeliveryQuestion } from "./delivery-rules";
import { loadDeliveryRules } from "./delivery-rules-service";
import { renderGreeting, type MessageLibrary } from "./message-library";
import { shouldEscalate } from "./handoff-service";
import { rememberMentionedProducts, getRecentlyMentionedProducts } from "./conversation-memory-service";
import { getMessagingOrgContext, type MessagingOrgContext } from "./messaging-context-service";
import {
  detectCatalogBrowse,
  detectGreetingWord,
  detectSmallTalk,
  type CatalogTarget,
} from "./message-intents";
import {
  browseProducts,
  searchProducts,
  listProductCategories,
  type AssistantProductHit,
  type ProductCategoryEntry,
  type ProductSearchOutcome,
} from "./product-search-service";
import { detectCategoryListRequest, hasPriceFilter, parseProductQuery, type ParsedProductQuery } from "./product-query-parser";
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
/** Intentions dont les questions répétées peuvent devenir une FAQ (jamais produit, commande, réclamation, humain). */
const LEARNABLE_INTENTS = new Set(["delivery_payment", "business_info", "smalltalk", "other"]);

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
  // Voix de marque et messages du commerçant : chargés une seule fois, à la demande, sans jamais échouer.
  let voicePromise: ReturnType<typeof loadVoiceAndLibrary> | undefined;
  const getVoice = () => (voicePromise ??= loadVoiceAndLibrary(organizationId));

  // 1. Escalade explicite (plainte, remboursement) — avant toute autre logique.
  const escalationReason = shouldEscalate(message);
  if (escalationReason) {
    log("human_escalation", false, escalationReason);
    return { intent: "human_escalation", replyText: null, aiInvoked: false, handoffReason: escalationReason, replyImageUrl: null };
  }

  // 2. FAQ — jamais d'appel LLM si une correspondance existe (section 18).
  const faqMatch = await safeStep("faq", organizationId, () => matchFaq(organizationId, message), null);
  if (faqMatch) {
    // Variables dynamiques ({price:…}, {hours}…) lues MAINTENANT ; valeur introuvable → cette FAQ n'est pas
    // utilisée (jamais de réponse périmée) et la chaîne continue.
    const resolved = await safeStep("faq_variables", organizationId, () => resolveFaqAnswerVariables(organizationId, faqMatch.answer), null);
    if (resolved !== null) {
      // Un tour d'IA évité : compté pour le compteur de crédits économisés (ne lève jamais).
      if (faqMatch.id) await recordFaqHit(organizationId, faqMatch.id);
      return answer("faq", resolved);
    }
  }

  // 3. Politesses (bonjour / merci / au revoir) — jamais l'IA, jamais une escalade.
  // Pas sur un commentaire public : un accueil complet sous une publication n'a pas de sens.
  if (!isPublicComment) {
    const smallTalk = detectSmallTalk(message);
    if (smallTalk) {
      const { library } = await getVoice();
      if (smallTalk === "thanks") return answer("small_talk", library.render("thanks"));
      if (smallTalk === "goodbye") return answer("small_talk", library.render("goodbye"));
      const context = await getContext();
      return answer(
        "small_talk",
        renderGreeting(library, {
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

  // 3ter. Livraison, retrait, paiement à la livraison (C3) — règles DÉTERMINISTES du commerçant, lues en base
  // (zones, frais, gratuité, délais : jamais figés ni inventés). Réponse seulement si elle est entièrement connue ;
  // sinon la chaîne continue (jamais de oui/non sur ce qui n'est pas renseigné).
  if (detectDeliveryQuestion(message).any) {
    const rules = await safeStep("livraison", organizationId, () => loadDeliveryRules(organizationId), null);
    if (rules?.configured) {
      const { library } = await getVoice();
      const deliveryAnswer = answerDeliveryQuestion(message, rules, library);
      if (deliveryAnswer) return answer("business_info", deliveryAnswer);
    }
  }

  // 3bis. Parcours par catégorie (C3) — « quelles catégories avez-vous ? ».
  // Liste calculée en base (jamais inventée) ; si le tenant n'a aucune catégorie
  // utile, on continue la chaîne normale.
  if (detectCategoryListRequest(message)) {
    const categories = await safeStep("categories", organizationId, () => listProductCategories(organizationId), [] as ProductCategoryEntry[]);
    if (categories.length > 0) {
      const [origin, context, { library }] = await Promise.all([getTenantPublicOrigin(organizationId), getContext(), getVoice()]);
      return answer("product_discovery", formatCategoryListReply(categories, `${origin}${STOREFRONT_PATHS.catalog}`, context.itemLabelPlural, library));
    }
  }

  // Compréhension déterministe de la demande (budget + mots significatifs) :
  // pure, sans I/O, partagée par les étapes 4 et 5.
  const parsedQuery = parseProductQuery(message);

  // 4. PRODUCT_DISCOVERY — demande de présenter le catalogue (section 15),
  // dans le vocabulaire du secteur du tenant (biens, propriétés, plats…).
  // Pré-test tous secteurs : évite de lire le contexte du tenant pour un
  // message qui ne parle manifestement pas de catalogue.
  if (detectCatalogBrowse(message, "*")) {
    const context = await getContext();
    const browse = detectCatalogBrowse(message, context.sector);
    if (browse) {
      const presented = await safeStep("catalogue", organizationId, async () => presentCatalog(organizationId, conversationId, browse.order, context, parsedQuery, (await getVoice()).library), null);
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
  const terms = parsedQuery.terms;
  if (terms.length > 0) {
    const outcome = await searchWithLegacyFallback(organizationId, parsedQuery);
    const products = outcome.products;
    if (products.length > 0) {
      const [origin, context, { library }] = await Promise.all([getTenantPublicOrigin(organizationId), getContext(), getVoice()]);
      const catalogUrl = `${origin}${STOREFRONT_PATHS.catalog}`;
      // Budget donné ET appliqué : message qui dit honnêtement s'il n'y a rien dans la fourchette.
      const reply =
        outcome.priceApplied && hasPriceFilter(parsedQuery)
          ? formatProductSearchReply(products, { publicBaseUrl: origin, catalogUrl, itemLabelPlural: context.itemLabelPlural, priceRequest: parsedQuery, relaxed: outcome.relaxed, library })
          : formatProductListReply(products, { publicBaseUrl: origin, catalogUrl, itemLabelPlural: context.itemLabelPlural, library });
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
    const [origin, context, { voice, library }] = await Promise.all([getTenantPublicOrigin(organizationId), getContext(), getVoice()]);
    // C3 (étape 2) : garde anti-injection, compréhension structurée, faits depuis
    // la base, rédaction, contrôle qualité — voir assistant-turn-service.ts.
    const turn = await runAssistantTurn({
      organizationId,
      conversationId,
      message,
      recentProducts,
      parsed: parsedQuery,
      origin,
      catalogUrl: `${origin}${STOREFRONT_PATHS.catalog}`,
      context,
      voice,
      library,
    });
    if (conversationId && turn.productIds.length > 0) await rememberMentionedProducts(organizationId, conversationId, turn.productIds);
    // FAQ qui apprend : une question générale qui revient (hors produit, commande, réclamation) est comptée ;
    // au-delà du seuil hebdomadaire, une FAQ est PROPOSÉE au propriétaire. Désactivé par défaut (opt-in).
    if ((turn.outcome === "llm_reply" || turn.outcome === "verify") && turn.productIds.length === 0 && turn.intent && LEARNABLE_INTENTS.has(turn.intent)) {
      await recordQuestionForLearning(organizationId, { question: message, resolution: turn.outcome === "verify" ? "verify" : "ai", replyText: turn.replyText, catalogUrl: `${origin}${STOREFRONT_PATHS.catalog}` });
    }
    log("ai", turn.aiInvoked, turn.handoffReason);
    return { intent: "ai", replyText: turn.replyText, aiInvoked: turn.aiInvoked, handoffReason: turn.handoffReason, replyImageUrl: turn.imageUrl };
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
  parsedQuery: ParsedProductQuery,
  library: MessageLibrary,
): Promise<OrchestrationResult | null> {
  const origin = await getTenantPublicOrigin(organizationId);
  const catalogUrl = `${origin}${STOREFRONT_PATHS.catalog}`;
  for (const target of order) {
    if (target === "products") {
      const outcome = await safeStep("catalogue_produits", organizationId, () => browseWithLegacyFallback(organizationId, parsedQuery), null);
      const products = outcome?.products ?? [];
      if (!outcome || products.length === 0) continue;
      // Lot D : mémorise les produits montrés pour qu'une référence comme
      // "celle à 25 000" soit compréhensible par l'IA au tour suivant.
      if (conversationId) await rememberMentionedProducts(organizationId, conversationId, products.map((p) => p.id));
      return {
        intent: "product_discovery",
        replyText:
          outcome.priceApplied && hasPriceFilter(parsedQuery)
            ? formatProductSearchReply(products, { publicBaseUrl: origin, catalogUrl, itemLabelPlural: context.itemLabelPlural, priceRequest: parsedQuery, relaxed: outcome.relaxed, library })
            : formatProductListReply(products, { publicBaseUrl: origin, catalogUrl, itemLabelPlural: context.itemLabelPlural, library }),
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

/** Résultat de recherche + indication que le filtre de prix a réellement été appliqué par la base. */
type ResolvedSearch = ProductSearchOutcome & { priceApplied: boolean };

function legacyToHits(products: CatalogProductSummary[]): AssistantProductHit[] {
  return products.map((p) => ({ ...p, compareAtPrice: null, isPromo: false, score: 0 }));
}

/**
 * Recherche classée (0140). Si la fonction SQL n'est pas encore déployée (ou
 * échoue), on retombe sur l'ancienne recherche par nom : jamais de client sans
 * réponse pendant un déploiement. Dans ce cas le prix n'est PAS filtré, donc
 * `priceApplied = false` et le message ne prétend rien sur le budget.
 */
async function searchWithLegacyFallback(organizationId: string, query: ParsedProductQuery): Promise<ResolvedSearch> {
  try {
    return { ...(await searchProducts(organizationId, query, { limit: SEARCH_RESULT_LIMIT })), priceApplied: true };
  } catch (error) {
    console.warn(`[orchestrator] recherche classée indisponible (org ${organizationId}), repli sur la recherche par nom:`, error);
    return { products: legacyToHits(await findProductMatches(organizationId, query.terms)), relaxed: false, priceApplied: false };
  }
}

async function browseWithLegacyFallback(organizationId: string, query: ParsedProductQuery): Promise<ResolvedSearch> {
  try {
    return { ...(await browseProducts(organizationId, query, { limit: DISCOVERY_LIMIT })), priceApplied: true };
  } catch (error) {
    console.warn(`[orchestrator] catalogue classé indisponible (org ${organizationId}), repli sur les derniers produits:`, error);
    return { products: legacyToHits(await getActiveProducts(organizationId, DISCOVERY_LIMIT)), relaxed: false, priceApplied: false };
  }
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
