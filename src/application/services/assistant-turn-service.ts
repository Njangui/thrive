import { getAIProvider } from "@/infrastructure/providers/registry";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { AIProvider } from "@/domain/ports/ai-provider";
import type { HandoffReason } from "@/domain/entities/conversation";
import { QuotaExceededError } from "@/lib/errors";
import { consumeCredit, releaseCredit } from "./ai-credits-service";
import { chargeTokenSurcharge, recordTokenUsage } from "./ai-metering";
import { routeTask } from "@/domain/ai-routing";
import type { CatalogProductSummary } from "./catalog-service";
import { detectBusinessInfoTopic, resolveBusinessInfo } from "./business-info-resolver";
import { buildDeliveryFacts, detectDeliveryQuestion, EMPTY_DELIVERY_RULES } from "./delivery-rules";
import { loadDeliveryRules } from "./delivery-rules-service";
import { extractSearchTerms } from "./message-intents";
import type { MessagingOrgContext } from "./messaging-context-service";
import { detectPromptInjection, sanitizeCustomerText, wrapUntrustedCustomerText } from "./customer-text-guard";
import { buildUnderstandingSystemPrompt, parseUnderstanding, understandingSearchText, UNDERSTANDING_SCHEMA_DESCRIPTION, type MessageUnderstanding, type UnderstandingIntent } from "./message-understanding";
import { hasPriceFilter, MAX_QUERY_TERMS, type ParsedProductQuery } from "./product-query-parser";
import { formatProductListReply, formatProductSearchReply } from "./product-reply-format";
import { searchProducts, type AssistantProductHit } from "./product-search-service";
import { formatVoiceForPrompt, type BrandVoice } from "./brand-voice";
import { DEFAULT_LIBRARY, type MessageLibrary } from "./message-library";
import { checkReplyQuality, type ReplyFacts } from "./reply-quality";
import { ASSISTANT_PROTECTED_MARKERS, buildTenantAIContext } from "./tenant-ai-context";

/**
 * C3 — un tour d'assistant client (étape 2). Remplace l'appel direct à
 * `generateAIReply` dans l'orchestrateur ; n'est atteint qu'après les règles
 * déterministes (FAQ, politesses, catalogue, infos entreprise : principe 2).
 *
 *  1. Garde : un message qui ressemble à une injection de prompt n'est JAMAIS
 *     envoyé au modèle (un humain le lit).
 *  2. UN seul crédit pour tout le tour, même avec deux appels au modèle
 *     (compréhension puis rédaction) ; remboursé si rien n'a pu être généré.
 *  3. Compréhension structurée (petit modèle, sortie validée) → intention.
 *  4. Les faits (produits, prix, liens, coordonnées) viennent de la base ; le
 *     prix vient du parseur déterministe, jamais du modèle (principe 3).
 *  5. Rédaction avec le message client enveloppé comme donnée non fiable.
 *  6. Contrôle qualité en code ; si la réponse est écartée : réponse
 *     déterministe depuis la base, ou « je vérifie » avec escalade.
 *
 * Le modèle n'a aucun outil et aucun droit d'écriture : il ne peut que rédiger
 * un texte qui est ensuite vérifié (principe 6, agent vitrine = lecture seule).
 */

/** Texte « je vérifie » de la voix par défaut ; le rendu réel suit la voix du commerçant (bibliothèque). */
export const VERIFY_REPLY = DEFAULT_LIBRARY.render("verify");
const MAX_FACT_PRODUCTS = 3;
const MAX_FACT_DESCRIPTION = 100;
const SEARCH_INTENTS = new Set<UnderstandingIntent>(["product_search", "product_question", "other"]);

export interface AssistantTurnParams {
  organizationId: string;
  conversationId: string | null;
  message: string;
  recentProducts: CatalogProductSummary[];
  parsed: ParsedProductQuery;
  origin: string;
  catalogUrl: string;
  context: MessagingOrgContext;
  /** Voix et messages du commerçant ; défaut : vouvoiement, emojis légers. */
  voice?: BrandVoice;
  library?: MessageLibrary;
}

export type AssistantTurnOutcome = "llm_reply" | "fallback_catalog" | "verify" | "escalated" | "blocked_injection";

export interface AssistantTurnResult {
  replyText: string | null;
  handoffReason: HandoffReason | null;
  imageUrl: string | null;
  /** Produits présentés (pour la mémoire de conversation). */
  productIds: string[];
  /** `true` si au moins un appel au modèle a eu lieu (crédit consommé). */
  aiInvoked: boolean;
  intent: UnderstandingIntent | null;
  outcome: AssistantTurnOutcome;
}

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export interface FactsBlock {
  text: string;
  allowedAmounts: number[];
  allowedPhones: string[];
  allowedEmails: string[];
  /** « Gratuit » est fondé par une zone de livraison réellement gratuite (jamais autrement). */
  allowFree: boolean;
}

function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Section FAITS du prompt + liste de ce que la réponse a le droit de citer.
 * Jamais de stock : le modèle ne peut donc pas le « connaître », et le
 * contrôle qualité refuse toute quantité.
 */
export function buildFactsBlock(input: {
  products: Array<Pick<AssistantProductHit, "name" | "slug" | "unitPrice" | "compareAtPrice" | "isPromo" | "categoryName" | "description">>;
  searched: boolean;
  origin: string;
  businessLines: string[];
  customerBudget: number | null;
  /** Règles de livraison du commerçant (zones, frais, retrait…) : lues en base, jamais écrites par le modèle. */
  delivery?: { lines: string[]; allowedAmounts: number[]; allowFree: boolean };
}): FactsBlock {
  const lines: string[] = [];
  const amounts: number[] = [];
  for (const p of input.products.slice(0, MAX_FACT_PRODUCTS)) {
    amounts.push(p.unitPrice);
    let line = `- ${p.name} — ${fcfa(p.unitPrice)}`;
    if (p.isPromo && p.compareAtPrice !== null) {
      amounts.push(p.compareAtPrice);
      line += ` (promotion en cours, au lieu de ${fcfa(p.compareAtPrice)})`;
    }
    if (p.categoryName) line += ` — catégorie ${p.categoryName}`;
    if (p.description) line += ` — ${clamp(p.description, MAX_FACT_DESCRIPTION)}`;
    if (p.slug) line += ` — ${input.origin}/produits/${p.slug}`;
    lines.push(line);
  }
  if (input.products.length === 0 && input.searched) lines.push("Aucun article correspondant n'a été trouvé dans le catalogue pour cette demande.");
  if (input.customerBudget !== null) amounts.push(input.customerBudget);
  lines.push(...input.businessLines);
  if (input.delivery) {
    lines.push(...input.delivery.lines);
    amounts.push(...input.delivery.allowedAmounts);
  }

  const joined = input.businessLines.join("\n");
  return {
    text: lines.join("\n"),
    allowedAmounts: amounts,
    allowedPhones: joined.match(/\+?\d[\d ().\-]{6,}\d/g) ?? [],
    allowedEmails: joined.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [],
    allowFree: input.delivery?.allowFree ?? false,
  };
}

type Bundle = { primary: AIProvider; fallback: AIProvider | null };

async function auditBestEffort(organizationId: string, action: string, afterState: Record<string, unknown>): Promise<void> {
  try {
    await getSupabaseServiceClient().from("audit_logs").insert({ organization_id: organizationId, action, entity_type: "assistant_reply", after_state: afterState });
  } catch (error) {
    console.warn(`[assistant-turn] audit ${action} non écrit (org ${organizationId}):`, error);
  }
}

/** Même logique de repli fournisseur que `generateAIReply` (audit du basculement compris). */
async function callWithFallback<T>(organizationId: string, bundle: Bundle, call: (provider: AIProvider) => Promise<T>): Promise<T> {
  try {
    return await call(bundle.primary);
  } catch (primaryError) {
    if (!bundle.fallback) throw primaryError;
    console.warn(`[AI fallback] org=${organizationId} provider=${bundle.primary.providerName} -> ${bundle.fallback.providerName}:`, primaryError);
    try {
      await getSupabaseServiceClient().from("audit_logs").insert({
        organization_id: organizationId,
        action: "AI_PROVIDER_FALLBACK",
        entity_type: "ai_config",
        after_state: { from: bundle.primary.providerName, to: bundle.fallback.providerName, error: primaryError instanceof Error ? primaryError.message : String(primaryError) },
      });
    } catch {
      /* l'audit ne doit jamais bloquer la réponse */
    }
    return call(bundle.fallback);
  }
}

async function understand(organizationId: string, bundle: Bundle, text: string, recentProducts: CatalogProductSummary[]): Promise<MessageUnderstanding | null> {
  try {
    const out = await callWithFallback(organizationId, bundle, (provider) =>
      provider.generateStructuredOutput<unknown>({
        systemPrompt: buildUnderstandingSystemPrompt(recentProducts.map((p) => p.name)),
        userMessage: wrapUntrustedCustomerText(text),
        outputSchemaDescription: UNDERSTANDING_SCHEMA_DESCRIPTION,
        maxTokens: 300,
        temperature: 0,
      }),
    );
    return parseUnderstanding(out.data, recentProducts.length);
  } catch (error) {
    // La compréhension est un plus : sans elle on continue avec le parseur déterministe.
    console.warn(`[assistant-turn] compréhension indisponible (org ${organizationId}):`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function hasConversationStarted(organizationId: string, conversationId: string | null): Promise<boolean> {
  if (!conversationId) return false;
  try {
    const { data } = await getSupabaseServiceClient()
      .from("messages")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .limit(1);
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

async function loadBusinessLines(organizationId: string): Promise<string[]> {
  const labels: Array<["hours" | "address" | "contact", string]> = [
    ["hours", "Horaires d'ouverture"],
    ["address", "Adresse"],
    ["contact", "Contact"],
  ];
  const results = await Promise.all(labels.map(([topic]) => resolveBusinessInfo(organizationId, topic).catch(() => null)));
  return results.flatMap((value, i) => (value ? [`${labels[i]?.[1] ?? ""} :\n${value}`] : []));
}

function result(partial: Partial<AssistantTurnResult> & Pick<AssistantTurnResult, "outcome">): AssistantTurnResult {
  return { replyText: null, handoffReason: null, imageUrl: null, productIds: [], aiInvoked: false, intent: null, ...partial };
}

export async function runAssistantTurn(params: AssistantTurnParams): Promise<AssistantTurnResult> {
  const { organizationId, parsed } = params;
  const library = params.library ?? DEFAULT_LIBRARY;
  const voice = params.voice ?? library.voice;
  const verifyReply = library.render("verify");
  const text = sanitizeCustomerText(params.message);

  // 1. Garde — avant tout appel au modèle, avant toute réservation de crédit.
  if (text.length === 0) return result({ outcome: "escalated", handoffReason: "requires_human_action" });
  const injection = detectPromptInjection(text);
  if (injection.flagged) {
    await auditBestEffort(organizationId, "ASSISTANT_INJECTION_BLOCKED", { signals: injection.signals });
    return result({ outcome: "blocked_injection", handoffReason: "requires_human_action" });
  }

  // 2. Disponibilité de l'IA vérifiée AVANT de réserver un crédit (même ordre que generateAIReply :
  //    une IA non activée ne doit jamais consommer de solde).
  const bundle = await getAIProvider(organizationId, "simple"); // réponse client = niveau simple (Mistral Small)
  const reservation = await consumeCredit(organizationId, routeTask("customer_reply").credits, "ai_customer_reply", { task: "customer_reply", tier: "simple" });
  if (!reservation.success) throw new QuotaExceededError("Crédits IA épuisés pour cette organisation.");

  let generated = false; // au moins un appel modèle a réussi → le crédit est réellement consommé
  try {
    // 3. Compréhension structurée.
    const understanding = await understand(organizationId, bundle, text, params.recentProducts);
    if (understanding) generated = true;
    const intent: UnderstandingIntent = understanding?.intent ?? "other";

    // Intentions qu'un agent vitrine n'a pas à traiter seul.
    if (intent === "complaint") return result({ outcome: "escalated", handoffReason: "complaint", aiInvoked: generated, intent });
    if (intent === "human_request") return result({ outcome: "escalated", handoffReason: "requires_human_action", aiInvoked: generated, intent });
    if (intent === "order_status") return result({ outcome: "verify", replyText: verifyReply, handoffReason: "requires_human_action", aiInvoked: generated, intent });
    // Livraison : le modèle ne reçoit que les règles RENSEIGNÉES par le commerçant (zones, frais, retrait…).
    // Sans règles, ou pour une question de paiement (moyens de paiement non modélisés), il ne les invente pas :
    // « je vérifie » + escalade.
    const deliveryQuestion = detectDeliveryQuestion(text);
    const deliveryRules = deliveryQuestion.any || intent === "delivery_payment" ? await loadDeliveryRules(organizationId) : EMPTY_DELIVERY_RULES;
    if (intent === "delivery_payment" && !(deliveryRules.configured && deliveryQuestion.any)) {
      return result({ outcome: "verify", replyText: verifyReply, handoffReason: "unknown_information", aiInvoked: generated, intent });
    }

    // 4. Faits depuis la base.
    const wantsBusinessInfo = intent === "business_info" || detectBusinessInfoTopic(text) !== null;
    const businessLines = wantsBusinessInfo ? await loadBusinessLines(organizationId) : [];
    if (intent === "business_info" && businessLines.length === 0) {
      return result({ outcome: "verify", replyText: verifyReply, handoffReason: "unknown_information", aiInvoked: generated, intent });
    }

    let products: AssistantProductHit[] = [];
    let relaxed = false;
    let searched = false;
    const referenced =
      (understanding?.referencedProductIndex ? params.recentProducts[understanding.referencedProductIndex - 1] : undefined) ??
      (parsed.budget !== null && params.recentProducts.filter((p) => p.unitPrice === parsed.budget).length === 1 ? params.recentProducts.find((p) => p.unitPrice === parsed.budget) : undefined);

    if (referenced) {
      products = [{ ...referenced, compareAtPrice: null, isPromo: false, score: 0 }];
    } else if (SEARCH_INTENTS.has(intent)) {
      const llmTerms = extractSearchTerms(understandingSearchText(understanding), 8, 3);
      const terms = [...new Set([...parsed.terms, ...llmTerms])].slice(0, MAX_QUERY_TERMS);
      if (terms.length > 0) {
        try {
          const outcome = await searchProducts(organizationId, { ...parsed, terms }, { limit: MAX_FACT_PRODUCTS });
          products = outcome.products;
          relaxed = outcome.relaxed;
          searched = true;
        } catch (error) {
          console.warn(`[assistant-turn] recherche indisponible (org ${organizationId}):`, error instanceof Error ? error.message : error);
        }
      }
    }

    const facts = buildFactsBlock({ products, searched, origin: params.origin, businessLines, customerBudget: parsed.budget, delivery: deliveryRules.configured && deliveryQuestion.any ? buildDeliveryFacts(deliveryRules) : undefined });
    const alreadyGreeted = await hasConversationStarted(organizationId, params.conversationId);

    const deterministicReply = (): string =>
      hasPriceFilter(parsed)
        ? formatProductSearchReply(products, { publicBaseUrl: params.origin, catalogUrl: params.catalogUrl, itemLabelPlural: params.context.itemLabelPlural, priceRequest: parsed, relaxed, library })
        : formatProductListReply(products, { publicBaseUrl: params.origin, catalogUrl: params.catalogUrl, itemLabelPlural: params.context.itemLabelPlural, library });
    const presented = { productIds: products.map((p) => p.id), imageUrl: products[0]?.imageUrl ?? null };

    // 5. Rédaction.
    let draft: string | null = null;
    try {
      const systemPrompt = await buildTenantAIContext(organizationId, params.recentProducts, {
        facts: facts.text,
        replyInEnglish: understanding?.language === "en",
        alreadyGreeted,
        voiceInstructions: formatVoiceForPrompt(voice),
      });
      const response = await callWithFallback(organizationId, bundle, (provider) =>
        provider.generateText({ systemPrompt, userMessage: wrapUntrustedCustomerText(text), maxTokens: 300, temperature: 0.4 }),
      );
      generated = true;
      draft = response.text.trim();
      // Tokens réels journalisés ; supplément de crédits si la réponse a dépassé le forfait de tokens.
      const extra = await chargeTokenSurcharge(organizationId, "customer_reply", response);
      await recordTokenUsage(organizationId, { task: "customer_reply", tier: "simple", response, creditsCharged: routeTask("customer_reply").credits + extra });
    } catch (draftError) {
      if (!generated) throw draftError; // rien n'a pu être généré : remboursé ci-dessous, puis ai_unavailable
      console.warn(`[assistant-turn] rédaction indisponible (org ${organizationId}):`, draftError instanceof Error ? draftError.message : draftError);
    }

    // 6. Contrôle qualité.
    if (draft !== null) {
      const replyFacts: ReplyFacts = {
        allowedAmounts: facts.allowedAmounts,
        allowedOrigins: [params.origin],
        allowedPhones: facts.allowedPhones,
        allowedEmails: facts.allowedEmails,
        allowFree: facts.allowFree,
        sector: params.context.sector,
        alreadyGreeted,
        protectedMarkers: ASSISTANT_PROTECTED_MARKERS,
        voice,
      };
      const verdict = checkReplyQuality(draft, replyFacts);
      if (verdict.ok) return result({ outcome: "llm_reply", replyText: draft, aiInvoked: true, intent, ...presented });
      await auditBestEffort(organizationId, "ASSISTANT_REPLY_REJECTED", { violations: verdict.violations, intent });
    }

    // Réponse écartée (ou rédaction indisponible) : jamais le texte du modèle.
    if (products.length > 0) return result({ outcome: "fallback_catalog", replyText: deterministicReply(), aiInvoked: true, intent, ...presented });
    return result({ outcome: "verify", replyText: verifyReply, handoffReason: "unknown_information", aiInvoked: true, intent });
  } catch (error) {
    // Aucune génération n'a abouti : le crédit réservé ne doit pas rester consommé.
    if (!generated) await releaseCredit(organizationId);
    throw error;
  }
}
