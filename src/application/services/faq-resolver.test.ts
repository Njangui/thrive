import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({ from: mockFrom }),
}));

import { matchFaq, listFaqs, createFaq, updateFaq, deleteFaq } from "./faq-resolver";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("matchFaq — priorité absolue sur l'IA (section 18/29)", () => {
  it("trouve une FAQ dont un mot-clé apparaît dans le message, insensible à la casse/accents", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () =>
            Promise.resolve({
              data: [{ id: "f1", question: "Livrez-vous ?", answer: "Oui, sous 48h.", keywords: ["livraison", "livrer"] }],
              error: null,
            }),
        }),
      }),
    });

    const result = await matchFaq("org-1", "Bonjour, question sur la livraison");
    expect(result?.answer).toBe("Oui, sous 48h.");
  });

  it("ne retourne rien si aucun mot-clé ne correspond", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: [{ id: "f1", question: "Q", answer: "A", keywords: ["remboursement"] }], error: null }),
        }),
      }),
    });

    const result = await matchFaq("org-1", "Bonjour, avez-vous des chaussures ?");
    expect(result).toBeNull();
  });
});

describe("createFaq — critère d'acceptation Lot 3 : jamais une FAQ fonctionnellement invisible du router", () => {
  it("rejette une FAQ sans mot-clé (jamais détectable par matchFaq)", async () => {
    await expect(
      createFaq({ organizationId: "org-1", question: "Q ?", answer: "R.", keywords: [] }),
    ).rejects.toThrow(/mot-clé/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejette une question ou réponse vide", async () => {
    await expect(createFaq({ organizationId: "org-1", question: "  ", answer: "R.", keywords: ["x"] })).rejects.toThrow();
    await expect(createFaq({ organizationId: "org-1", question: "Q ?", answer: " ", keywords: ["x"] })).rejects.toThrow();
  });

  it("crée la FAQ avec is_active=true par défaut", async () => {
    let insertedPayload: Record<string, unknown> | null = null;
    mockFrom.mockReturnValue({
      insert: (payload: Record<string, unknown>) => {
        insertedPayload = payload;
        return { select: () => ({ single: () => Promise.resolve({ data: { id: "f1" }, error: null }) }) };
      },
    });

    const result = await createFaq({ organizationId: "org-1", question: "Livrez-vous ?", answer: "Oui.", keywords: ["livraison"] });
    expect(result).toEqual({ faqId: "f1" });
    expect((insertedPayload as unknown as { is_active: boolean }).is_active).toBe(true);
  });
});

describe("updateFaq / deleteFaq — critère IDOR", () => {
  it("updateFaq lève NotFoundError si aucune ligne affectée (mauvais org ou id inexistant)", async () => {
    mockFrom.mockReturnValue({
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null, count: 0 }) }) }),
    });

    await expect(updateFaq("org-1", "f1", { isActive: false })).rejects.toThrow();
  });

  it("deleteFaq lève NotFoundError si aucune ligne affectée", async () => {
    mockFrom.mockReturnValue({
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null, count: 0 }) }) }),
    });

    await expect(deleteFaq("org-1", "f1")).rejects.toThrow();
  });
});

describe("listFaqs", () => {
  it("mappe keywords manquant (NULL en base) vers un tableau vide, jamais undefined", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [{ id: "f1", question: "Q", answer: "A", keywords: null, is_active: true }],
              error: null,
            }),
        }),
      }),
    });

    const result = await listFaqs("org-1");
    expect(result[0]!.keywords).toEqual([]);
  });
});

function mockFaqRows(rows: Array<{ question: string; answer: string; keywords: string[] }>) {
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: rows, error: null }) }) }),
  });
}

describe("matchFaq — tolérance aux variantes (correctif sept. 2026 : FAQ configurée mais jamais déclenchée)", () => {
  const livraison = [{ question: "Livrez-vous à domicile ?", answer: "LIVRAISON", keywords: ["livraison"] }];

  it("un client écrivant « livrez » déclenche le mot-clé « livraison » (même radical)", async () => {
    mockFaqRows(livraison);
    expect((await matchFaq("org-1", "Bonjour, vous livrez à Douala ?"))?.answer).toBe("LIVRAISON");
  });

  it("« livre » (l'objet) ne déclenche PAS une FAQ « livraison » (faux positif évité)", async () => {
    mockFaqRows(livraison);
    expect(await matchFaq("org-1", "Avez-vous ce livre en stock ?")).toBeNull();
  });

  it("un mot-clé vide ou fait d'espaces ne matche jamais tout", async () => {
    mockFaqRows([{ question: "Q", answer: "A", keywords: ["", " "] }]);
    expect(await matchFaq("org-1", "bonjour")).toBeNull();
  });

  it("un mot-clé de 2 lettres ne se retrouve pas dans un autre mot (« ci » / « merci »)", async () => {
    mockFaqRows([{ question: "Q", answer: "A", keywords: ["ci"] }]);
    expect(await matchFaq("org-1", "merci beaucoup")).toBeNull();
  });

  it("un mot-clé en plusieurs mots exige tous ses mots significatifs", async () => {
    mockFaqRows([{ question: "Q", answer: "PAY", keywords: ["mode de paiement"] }]);
    expect((await matchFaq("org-1", "quels sont vos modes de paiement ?"))?.answer).toBe("PAY");
    expect(await matchFaq("org-1", "quel est le mode de livraison ?")).toBeNull();
  });

  it("à défaut de mot-clé, la question de la FAQ sert de filet de sécurité", async () => {
    mockFaqRows([{ question: "Acceptez-vous le paiement par Mobile Money ?", answer: "MM", keywords: ["momo"] }]);
    expect((await matchFaq("org-1", "est-ce que le paiement mobile money est accepté"))?.answer).toBe("MM");
  });

  it("plusieurs FAQ candidates : celle qui a le plus de mots-clés touchés l'emporte", async () => {
    mockFaqRows([
      { question: "A", answer: "A1", keywords: ["prix"] },
      { question: "B", answer: "B2", keywords: ["prix", "livraison"] },
    ]);
    expect((await matchFaq("org-1", "quel est le prix de la livraison ?"))?.answer).toBe("B2");
  });
});

describe("FAQ qui apprend (C3 étape 4b) — identifiant, variables, date de revue", () => {
  it("matchFaq renvoie l'identifiant de la FAQ (nécessaire pour compter ses usages)", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ id: "f42", question: "Livrez-vous ?", answer: "Oui.", keywords: ["livraison"] }], error: null }) }) }),
    });
    const result = await matchFaq("org-1", "Question sur la livraison");
    expect(result?.id).toBe("f42");
  });

  it("matchFaq renvoie l'identifiant aussi quand c'est la question qui sert de filet de sécurité", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ id: "f7", question: "Quels sont vos horaires d'ouverture ?", answer: "9h-18h", keywords: [] }], error: null }) }) }),
    });
    const result = await matchFaq("org-1", "Quels sont vos horaires d'ouverture ?");
    expect(result?.id).toBe("f7");
  });

  it("createFaq refuse une variable inconnue (le client verrait « {xyz} ») sans rien écrire", async () => {
    await expect(createFaq({ organizationId: "org-1", question: "Q ?", answer: "Voir {prix_du_jour}", keywords: ["x"] })).rejects.toThrow(/variable/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("createFaq accepte les variables connues et fixe une date de relecture dans 90 jours", async () => {
    let payload: Record<string, unknown> = {};
    mockFrom.mockReturnValue({
      insert: (p: Record<string, unknown>) => {
        payload = p;
        return { select: () => ({ single: () => Promise.resolve({ data: { id: "f1" }, error: null }) }) };
      },
    });
    const result = await createFaq({ organizationId: "org-1", question: "Horaires ?", answer: "Ouvert : {hours} — {price:sac-cuir}", keywords: ["horaires"] });
    expect(result).toEqual({ faqId: "f1" });
    expect(payload.review_at).toBe(new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10));
  });

  it("createFaq avertit (sans bloquer) quand un montant est écrit en dur", async () => {
    mockFrom.mockReturnValue({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "f1" }, error: null }) }) }) });
    const result = await createFaq({ organizationId: "org-1", question: "Livraison ?", answer: "La livraison coûte 1 500 FCFA.", keywords: ["livraison"] });
    expect(result.faqId).toBe("f1");
    expect(result.warnings).toHaveLength(1);
  });

  it("updateFaq refuse une variable inconnue et repousse la relecture quand la réponse change", async () => {
    await expect(updateFaq("org-1", "f1", { answer: "Voir {nimporte}" })).rejects.toThrow(/variable/);

    let patch: Record<string, unknown> = {};
    mockFrom.mockReturnValue({
      update: (p: Record<string, unknown>) => {
        patch = p;
        return { eq: () => ({ eq: () => Promise.resolve({ error: null, count: 1 }) }) };
      },
    });
    await updateFaq("org-1", "f1", { answer: "Nouvelle réponse {hours}" });
    expect(patch.review_at).toBe(new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10));
  });
});
