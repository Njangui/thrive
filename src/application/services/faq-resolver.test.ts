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
