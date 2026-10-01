import { describe, it, expect, vi, beforeEach } from "vitest";
import { canBotPostIn, classifyTelegramChat, normalizeTelegramChatRef } from "./telegram-destination-service";

describe("classifyTelegramChat", () => {
  it("canal → channel ; groupe et supergroupe → group ; privé → refusé", () => {
    expect(classifyTelegramChat("channel")).toBe("channel");
    expect(classifyTelegramChat("group")).toBe("group");
    expect(classifyTelegramChat("supergroup")).toBe("group");
    expect(classifyTelegramChat("private")).toBeNull();
  });
});

describe("canBotPostIn", () => {
  it("canal : administrateur avec droit de publier, ou créateur — jamais simple membre", () => {
    expect(canBotPostIn("channel", "administrator", true)).toBe(true);
    expect(canBotPostIn("channel", "administrator", undefined)).toBe(true);
    expect(canBotPostIn("channel", "administrator", false)).toBe(false);
    expect(canBotPostIn("channel", "creator")).toBe(true);
    expect(canBotPostIn("channel", "member")).toBe(false);
  });
  it("groupe : membre, administrateur ou créateur — pas retiré/banni", () => {
    expect(canBotPostIn("group", "member")).toBe(true);
    expect(canBotPostIn("group", "administrator")).toBe(true);
    expect(canBotPostIn("group", "left")).toBe(false);
    expect(canBotPostIn("group", "kicked")).toBe(false);
  });
});

describe("normalizeTelegramChatRef", () => {
  it("accepte @nom, nom, lien t.me et identifiant numérique", () => {
    expect(normalizeTelegramChatRef("@ma_boutique")).toBe("@ma_boutique");
    expect(normalizeTelegramChatRef("ma_boutique")).toBe("@ma_boutique");
    expect(normalizeTelegramChatRef("https://t.me/ma_boutique/")).toBe("@ma_boutique");
    expect(normalizeTelegramChatRef("-1001234567890")).toBe("-1001234567890");
  });
  it("refuse vide, trop court ou caractères invalides", () => {
    expect(() => normalizeTelegramChatRef("  ")).toThrow();
    expect(() => normalizeTelegramChatRef("@ab")).toThrow(/invalide/);
    expect(() => normalizeTelegramChatRef("ma boutique")).toThrow(/invalide/);
  });
});

describe("migrateTelegramDestination — groupe converti en supergroupe (identifiant Telegram changé définitivement)", () => {
  const updateCalls: { payload: unknown; eqs: [string, unknown][] }[] = [];

  beforeEach(() => {
    vi.resetModules();
    updateCalls.length = 0;
  });

  async function loadWithMock(found: boolean) {
    vi.doMock("@/infrastructure/supabase/server-client", () => ({
      getSupabaseServiceClient: () => ({
        from: () => {
          const eqs: [string, unknown][] = [];
          const builder = {
            update: (payload: unknown) => {
              updateCalls.push({ payload, eqs });
              return builder;
            },
            eq: (column: string, value: unknown) => {
              eqs.push([column, value]);
              return builder;
            },
            select: () => builder,
            maybeSingle: () => Promise.resolve({ data: found ? { id: "dest-1" } : null, error: null }),
          };
          return builder;
        },
      }),
    }));
    return import("./telegram-destination-service");
  }

  it("met à jour chat_id vers le nouvel identifiant, remet la destination active", async () => {
    const { migrateTelegramDestination } = await loadWithMock(true);
    const migrated = await migrateTelegramDestination("org-1", "bot-1", -1001111, -1002222);
    expect(migrated).toBe(true);
    expect(updateCalls[0]?.payload).toMatchObject({ chat_id: "-1002222", chat_type: "group", status: "active", error_message: null });
    expect(updateCalls[0]?.eqs).toEqual([
      ["organization_id", "org-1"],
      ["bot_id", "bot-1"],
      ["chat_id", "-1001111"],
    ]);
  });

  it("aucune destination correspondante (jamais enregistrée) : ne lève pas, renvoie false", async () => {
    const { migrateTelegramDestination } = await loadWithMock(false);
    expect(await migrateTelegramDestination("org-1", "bot-1", -1001111, -1002222)).toBe(false);
  });
});
