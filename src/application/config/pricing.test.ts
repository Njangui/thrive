import { describe, it, expect } from "vitest";
import { applyDbLimits, PRICING_FEATURES } from "./pricing";

const find = (features: ReturnType<typeof applyDbLimits>, key: string) => features.find((f) => f.key === key)!;

describe("applyDbLimits — la page tarifs lit les quotas dans plan_entitlements", () => {
  const limits = {
    free: { ai_credits: 0, catalog_products: 100, whatsapp: 0, whatsapp_groups: 0, video_retention_days: 7 },
    starter: { ai_credits: 150, catalog_products: 1000, whatsapp: 1, whatsapp_groups: 3, whatsapp_groups_dedicated_bonus: 2, broadcast_contacts: 50 },
    pro: { ai_credits: -1, whatsapp: 3, whatsapp_groups: 6, whatsapp_groups_dedicated_bonus: 4 },
  };
  const out = applyDbLimits(PRICING_FEATURES, limits);

  it("remplace les chiffres statiques par ceux de la base", () => {
    expect(find(out, "ai").values).toMatchObject({ free: "0", starter: "150", pro: "Illimité" });
    expect(find(out, "catalog").values).toMatchObject({ free: "100 produits max", starter: "1000 produits max" });
    expect(find(out, "video_retention").values.free).toBe("7 jours");
  });
  it("0 = non inclus ; bonus numéro dédié affiché", () => {
    expect(find(out, "whatsapp").values).toMatchObject({ free: false, starter: "1", pro: "3" });
    expect(find(out, "whatsapp_groups").values).toMatchObject({ free: false, starter: "3 (+2 avec numéro dédié)", pro: "6 (+4 avec numéro dédié)" });
    expect(find(out, "broadcast").values.starter).toBe("50 contacts / campagne");
  });
  it("limite absente de la base : garde le texte statique ; lignes non numériques inchangées", () => {
    expect(find(out, "team").values).toEqual(find(PRICING_FEATURES, "team").values);
    expect(find(out, "custom_domain")).toEqual(find(PRICING_FEATURES, "custom_domain"));
  });
  it("sans aucune donnée : tout reste identique au texte statique", () => {
    expect(applyDbLimits(PRICING_FEATURES, {})).toEqual(PRICING_FEATURES);
  });
});
