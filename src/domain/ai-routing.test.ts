import { describe, expect, it } from "vitest";
import { routeTask, tokenSurchargeCredits, TASK_POLICY } from "./ai-routing";

describe("routeTask", () => {
  it("tâches simples → niveau simple, 1 crédit", () => {
    expect(routeTask("customer_reply")).toEqual({ tier: "simple", credits: 1 });
    expect(routeTask("comment_draft").tier).toBe("simple");
  });
  it("analyses et rapports → niveau complexe, plus de crédits", () => {
    expect(routeTask("analysis")).toEqual({ tier: "complex", credits: 3 });
    expect(routeTask("report").credits).toBe(5);
  });
  it("une tâche simple avec une très grosse entrée passe en complexe", () => {
    expect(routeTask("customer_reply", { inputChars: 20_000 })).toEqual({ tier: "complex", credits: 2 });
    expect(routeTask("customer_reply", { inputChars: 500 }).tier).toBe("simple");
  });
  it("tout crédit de base est un entier positif", () => {
    for (const p of Object.values(TASK_POLICY)) expect(Number.isInteger(p.credits) && p.credits > 0).toBe(true);
  });
});

describe("tokenSurchargeCredits", () => {
  it("0 dans le forfait, puis 1 crédit par tranche, plafonné", () => {
    expect(tokenSurchargeCredits(0)).toBe(0);
    expect(tokenSurchargeCredits(4000)).toBe(0);
    expect(tokenSurchargeCredits(4001)).toBe(1);
    expect(tokenSurchargeCredits(12_000)).toBe(2);
    expect(tokenSurchargeCredits(1_000_000)).toBe(5);
    expect(tokenSurchargeCredits(Number.NaN)).toBe(0);
  });
});
