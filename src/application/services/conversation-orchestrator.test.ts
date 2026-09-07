import { describe, it, expect, vi, beforeEach } from "vitest";
import { routeMessage } from "./conversation-orchestrator";

vi.mock("./faq-resolver", () => ({
  matchFaq: vi.fn(),
}));
vi.mock("./ai-response-service", () => ({
  generateAIReply: vi.fn(),
}));
vi.mock("./catalog-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog-service")>();
  return {
    ...actual, // garde formatProductDiscoveryMessage (pur) réel
    getActiveProducts: vi.fn(),
    searchProductsByName: vi.fn(),
  };
});
vi.mock("./business-info-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./business-info-resolver")>();
  return {
    ...actual, // garde detectBusinessInfoTopic (pur) réel
    resolveBusinessInfo: vi.fn(),
  };
});
vi.mock("./conversation-memory-service", () => ({
  rememberMentionedProducts: vi.fn(),
  getRecentlyMentionedProducts: vi.fn(),
}));

import { matchFaq } from "./faq-resolver";
import { generateAIReply } from "./ai-response-service";
import { getActiveProducts, searchProductsByName } from "./catalog-service";
import { resolveBusinessInfo } from "./business-info-resolver";
import { rememberMentionedProducts, getRecentlyMentionedProducts } from "./conversation-memory-service";

const ORG_ID = "org_1";
const CONVERSATION_ID = "conv_1";

beforeEach(() => {
  vi.mocked(matchFaq).mockReset().mockResolvedValue(null);
  vi.mocked(generateAIReply).mockReset();
  vi.mocked(getActiveProducts).mockReset().mockResolvedValue([]);
  vi.mocked(searchProductsByName).mockReset().mockResolvedValue([]);
  vi.mocked(resolveBusinessInfo).mockReset().mockResolvedValue(null);
  vi.mocked(rememberMentionedProducts).mockReset().mockResolvedValue(undefined);
  vi.mocked(getRecentlyMentionedProducts).mockReset().mockResolvedValue([]);
});

describe("routeMessage — ordre de résolution (section 45 : règles avant IA)", () => {
  it("escalade directement sur une plainte/remboursement, sans jamais appeler l'IA", async () => {
    const result = await routeMessage(ORG_ID, CONVERSATION_ID, "Je veux un remboursement, c'est inadmissible");

    expect(result.intent).toBe("human_escalation");
    expect(result.aiInvoked).toBe(false);
    expect(result.handoffReason).toBe("refund_request");
    expect(generateAIReply).not.toHaveBeenCalled();
  });

  it("répond depuis la FAQ sans appeler l'IA quand une correspondance existe (section 18)", async () => {
    vi.mocked(matchFaq).mockResolvedValue({ question: "Livrez-vous ?", answer: "Oui, sous 48h à Douala." });

    const result = await routeMessage(ORG_ID, CONVERSATION_ID, "Vous livrez ?");

    expect(result.intent).toBe("faq");
    expect(result.replyText).toBe("Oui, sous 48h à Douala.");
    expect(result.aiInvoked).toBe(false);
    expect(generateAIReply).not.toHaveBeenCalled();
  });

  it("déclenche PRODUCT_DISCOVERY sur une demande générique de catalogue, sans IA (section 15)", async () => {
    vi.mocked(getActiveProducts).mockResolvedValue([
      { id: "p1", name: "Sneakers Air Max", slug: "sneakers-air-max", unitPrice: 35000, description: null, categoryName: null },
    ]);

    const result = await routeMessage(ORG_ID, CONVERSATION_ID, "Bonjour, montrez-moi vos produits");

    expect(result.intent).toBe("product_discovery");
    expect(result.replyText).toContain("Sneakers Air Max");
    expect(result.aiInvoked).toBe(false);
    expect(generateAIReply).not.toHaveBeenCalled();
  });

  it("déclenche PRODUCT_QUERY quand un mot du message correspond à un produit (section 17)", async () => {
    vi.mocked(searchProductsByName).mockImplementation(async (_org, word) =>
      word === "jean"
        ? [{ id: "p2", name: "Jean Slim", slug: "jean-slim", unitPrice: 18000, description: null, categoryName: null }]
        : [],
    );

    const result = await routeMessage(ORG_ID, CONVERSATION_ID, "Le jean est disponible ?");

    expect(result.intent).toBe("product_query");
    expect(result.replyText).toContain("Jean Slim");
    expect(generateAIReply).not.toHaveBeenCalled();
  });

  it("répond depuis les données business (horaires) sans IA (section 19)", async () => {
    vi.mocked(resolveBusinessInfo).mockResolvedValue("lundi : 9h-18h");

    const result = await routeMessage(ORG_ID, CONVERSATION_ID, "Vous êtes ouverts jusqu'à quelle heure ?");

    expect(result.intent).toBe("business_info");
    expect(result.replyText).toBe("lundi : 9h-18h");
    expect(generateAIReply).not.toHaveBeenCalled();
  });

  it("tombe sur l'IA seulement en dernier recours, quand rien d'autre ne répond (section 45)", async () => {
    vi.mocked(generateAIReply).mockResolvedValue({ text: "Ce modèle convient très bien pour la course.", provider: "mistral", model: "mistral-small-latest" });

    const result = await routeMessage(ORG_ID, CONVERSATION_ID, "Est-ce adapté pour courir tous les jours ?");

    expect(result.intent).toBe("ai");
    expect(result.aiInvoked).toBe(true);
    expect(result.replyText).toBe("Ce modèle convient très bien pour la course.");
    expect(generateAIReply).toHaveBeenCalledTimes(1);
  });

  it("escalade si l'IA est indisponible plutôt que de laisser la conversation sans réponse (section 46/67)", async () => {
    vi.mocked(generateAIReply).mockRejectedValue(new Error("AI non activée pour ce tenant"));

    const result = await routeMessage(ORG_ID, CONVERSATION_ID, "Une question complexe sans réponse structurée");

    expect(result.intent).toBe("ai");
    expect(result.replyText).toBeNull();
    expect(result.handoffReason).toBe("ai_unavailable");
  });
});

describe("routeMessage — mémoire conversationnelle courte (Lot D, section 21/24)", () => {
  it("mémorise les produits montrés lors d'un PRODUCT_DISCOVERY (3 max)", async () => {
    vi.mocked(getActiveProducts).mockResolvedValue([
      { id: "p1", name: "Sneakers Air Max", slug: "sneakers-air-max", unitPrice: 35000, description: null, categoryName: null },
      { id: "p2", name: "T-shirt Premium", slug: "t-shirt-premium", unitPrice: 12000, description: null, categoryName: null },
    ]);

    await routeMessage(ORG_ID, CONVERSATION_ID, "Montrez-moi vos produits");

    expect(rememberMentionedProducts).toHaveBeenCalledWith(ORG_ID, CONVERSATION_ID, ["p1", "p2"]);
  });

  it("mémorise les produits trouvés lors d'un PRODUCT_QUERY", async () => {
    vi.mocked(searchProductsByName).mockImplementation(async (_org, word) =>
      word === "jean"
        ? [{ id: "p2", name: "Jean Slim", slug: "jean-slim", unitPrice: 18000, description: null, categoryName: null }]
        : [],
    );

    await routeMessage(ORG_ID, CONVERSATION_ID, "Le jean est disponible ?");

    expect(rememberMentionedProducts).toHaveBeenCalledWith(ORG_ID, CONVERSATION_ID, ["p2"]);
  });

  it(
    "injecte les produits récemment mentionnés dans le contexte IA avant de tomber sur l'IA, " +
      "pour qu'une référence comme \"celle à 25 000\" soit compréhensible (section 21/24)",
    async () => {
      const rememberedProduct = {
        id: "p3",
        name: "Robe imprimée",
        slug: "robe-imprimee",
        unitPrice: 25000,
        description: null,
        categoryName: null,
      };
      vi.mocked(getRecentlyMentionedProducts).mockResolvedValue([rememberedProduct]);
      vi.mocked(generateAIReply).mockResolvedValue({
        text: "Oui, la robe imprimée à 25 000 FCFA est disponible.",
        provider: "mistral",
        model: "mistral-small-latest",
      });

      const result = await routeMessage(ORG_ID, CONVERSATION_ID, "Celle à 25 000 m'intéresse");

      expect(getRecentlyMentionedProducts).toHaveBeenCalledWith(ORG_ID, CONVERSATION_ID);
      // Le contexte "construit" pour l'IA doit bien porter le produit résolu
      // depuis la mémoire — formatRecentProductsForAIContext (testé en
      // isolation dans tenant-ai-context.test.ts) est la fonction pure qui
      // transforme ce tableau en texte injecté dans le system prompt.
      expect(generateAIReply).toHaveBeenCalledWith(ORG_ID, "Celle à 25 000 m'intéresse", [rememberedProduct]);
      expect(result.intent).toBe("ai");
    },
  );

  it("ne bloque pas la réponse si aucun produit n'a été mentionné récemment (mémoire vide)", async () => {
    vi.mocked(getRecentlyMentionedProducts).mockResolvedValue([]);
    vi.mocked(generateAIReply).mockResolvedValue({ text: "Bien sûr, je peux vous aider.", provider: "mistral", model: "mistral-small-latest" });

    const result = await routeMessage(ORG_ID, CONVERSATION_ID, "Une question complexe sans réponse structurée");

    expect(generateAIReply).toHaveBeenCalledWith(ORG_ID, "Une question complexe sans réponse structurée", []);
    expect(result.replyText).toBe("Bien sûr, je peux vous aider.");
  });
});
