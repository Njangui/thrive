import { env } from "@/lib/env";
import { matchFaq } from "./faq-resolver";
import { detectBusinessInfoTopic, resolveBusinessInfo } from "./business-info-resolver";
import { getActiveProducts, searchProductsByName, formatProductDiscoveryMessage } from "./catalog-service";
import { generateAIReply } from "./ai-response-service";
import { shouldEscalate } from "./handoff-service";
import { rememberMentionedProducts, getRecentlyMentionedProducts } from "./conversation-memory-service";
import type { HandoffReason } from "@/domain/entities/conversation";

export type ConversationIntent =
  | "human_escalation"
  | "faq"
  | "product_discovery"
  | "product_query"
  | "business_info"
  | "ai";

export interface OrchestrationResult {
  intent: ConversationIntent;
  replyText: string | null; // null = pas de réponse auto (escalade silencieuse)
  aiInvoked: boolean;
  handoffReason: HandoffReason | null;
}

const PRODUCT_DISCOVERY_KEYWORDS = [
  "produits",
  "produit",
  "catalogue",
  "montrez",
  "montrer",
  "articles",
  "vous vendez quoi",
  "qu est ce que vous vendez",
];

/**
 * Point d'entrée UNIQUE entre un message WhatsApp normalisé et une
 * réponse. Ordre de résolution imposé par la section 45 du doc 2 :
 * données structurées/règles → FAQ → catalogue → business data → IA en
 * dernier recours. Ne JAMAIS inverser cet ordre (coût + fiabilité).
 */
export async function routeMessage(
  organizationId: string,
  conversationId: string,
  message: string,
): Promise<OrchestrationResult> {
  const log = (intent: ConversationIntent, aiInvoked: boolean, handoffReason: HandoffReason | null) => {
    // Observabilité du router (section 48) : message -> intent -> IA appelée ou non -> handoff ou non.
    console.info(
      `[orchestrator] org=${organizationId} intent=${intent} aiInvoked=${aiInvoked} handoff=${handoffReason ?? "-"}`,
    );
  };

  // 1. Escalade explicite (plainte, remboursement) — avant toute autre logique.
  const escalationReason = shouldEscalate(message);
  if (escalationReason) {
    log("human_escalation", false, escalationReason);
    return { intent: "human_escalation", replyText: null, aiInvoked: false, handoffReason: escalationReason };
  }

  // 2. FAQ — jamais d'appel LLM si une correspondance existe (section 18).
  const faqMatch = await matchFaq(organizationId, message);
  if (faqMatch) {
    log("faq", false, null);
    return { intent: "faq", replyText: faqMatch.answer, aiInvoked: false, handoffReason: null };
  }

  // 3. PRODUCT_DISCOVERY — demande générique de voir le catalogue (section 15).
  const normalizedMessage = normalize(message);
  if (PRODUCT_DISCOVERY_KEYWORDS.some((k) => normalizedMessage.includes(normalize(k)))) {
    const products = await getActiveProducts(organizationId, 3);
    const reply = formatProductDiscoveryMessage(
      products,
      env.NEXT_PUBLIC_APP_URL,
      `${env.NEXT_PUBLIC_APP_URL}/produits`,
    );
    // Lot D : mémorise les produits montrés pour qu'une référence comme
    // "celle à 25 000" soit compréhensible par l'IA au tour suivant.
    await rememberMentionedProducts(organizationId, conversationId, products.map((p) => p.id));
    log("product_discovery", false, null);
    return { intent: "product_discovery", replyText: reply, aiInvoked: false, handoffReason: null };
  }

  // 4. PRODUCT_QUERY — heuristique V1 simple (recherche par mots significatifs
  // du message). À affiner avec de vrais cas d'usage plutôt que d'anticiper
  // une NLU complexe maintenant (section 62 : ne pas sur-engineer).
  const candidateWords = normalizedMessage.split(/\s+/).filter((w) => w.length > 3);
  for (const word of candidateWords) {
    const matches = await searchProductsByName(organizationId, word, 3);
    if (matches.length > 0) {
      const reply = formatProductDiscoveryMessage(
        matches,
        env.NEXT_PUBLIC_APP_URL,
        `${env.NEXT_PUBLIC_APP_URL}/produits`,
      );
      // Lot D : idem — mémorise les résultats montrés pour ce mot-clé.
      await rememberMentionedProducts(organizationId, conversationId, matches.map((p) => p.id));
      log("product_query", false, null);
      return { intent: "product_query", replyText: reply, aiInvoked: false, handoffReason: null };
    }
  }

  // 5. BUSINESS_INFO — horaires/adresse/contact depuis `organizations` (section 19).
  const topic = detectBusinessInfoTopic(message);
  if (topic) {
    const info = await resolveBusinessInfo(organizationId, topic);
    if (info) {
      log("business_info", false, null);
      return { intent: "business_info", replyText: info, aiInvoked: false, handoffReason: null };
    }
    // Donnée non configurée par le commerçant : on ne invente pas (section 47),
    // on tombe sur l'IA ci-dessous, qui elle-même peut escalader si nécessaire.
  }

  // 6. IA — dernier recours (section 20/45). Si indisponible, escalade
  // plutôt que de laisser la conversation sans réponse (section 46 :
  // une absence de réponse vaut mieux qu'une invention, mais on préfère
  // encore relayer à un humain quand c'est possible).
  try {
    // Lot D : résout les derniers produits mentionnés dans CETTE conversation
    // et les injecte dans le contexte IA (nom/prix/description uniquement,
    // jamais l'historique complet des messages).
    const recentProducts = await getRecentlyMentionedProducts(organizationId, conversationId);
    const aiReply = await generateAIReply(organizationId, message, recentProducts);
    log("ai", true, null);
    return { intent: "ai", replyText: aiReply.text, aiInvoked: true, handoffReason: null };
  } catch (aiError) {
    console.warn(`[orchestrator] IA indisponible pour org ${organizationId}:`, aiError);
    log("ai", true, "ai_unavailable");
    return { intent: "ai", replyText: null, aiInvoked: true, handoffReason: "ai_unavailable" };
  }
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
