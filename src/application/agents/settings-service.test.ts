import { describe, expect, it } from "vitest";
import { defaultAgentSettings, type AgentSettings, type AgentSettingsRepository } from "./settings";
import { buildSettingsView, parseSettingsForm, saveAssistantSettings, toJournalEntry, type ToolInfo } from "./settings-service";

const tools: ToolInfo[] = [
  { name: "orders.list", domain: "orders", description: "Liste les commandes.", risk: "read" },
  { name: "stock.restock", domain: "stock", description: "Ajoute du stock. Détail.", risk: "write_reversible" },
  { name: "conversations.reply", domain: "conversations", description: "Envoie un message au client.", risk: "write_reversible", confirmAlways: true },
  { name: "orders.refund", domain: "orders", description: "Rembourse une commande.", risk: "sensitive" },
];

function repo(initial?: AgentSettings) {
  let stored = initial ?? null;
  const calls: AgentSettings[] = [];
  const r: AgentSettingsRepository = { get: async () => stored, upsert: async (s) => { stored = s; calls.push(s); } };
  return { r, calls };
}

describe("réglages de l'assistant", () => {
  it("la vue ne liste que les actions qui modifient, groupées et triées", () => {
    const view = buildSettingsView({ ...defaultAgentSettings("t"), toolPolicies: { "stock.restock": { mode: "auto", autoMaxAmount: 1000 } } }, tools);
    expect(view.rows.map((r) => r.tool)).toEqual(["conversations.reply", "orders.refund", "stock.restock"]);
    expect(view.rows[0]!.alwaysAsk).toBe(true);
    expect(view.rows[2]).toMatchObject({ mode: "auto", autoMaxAmount: 1000, label: "Ajoute du stock" });
  });

  it("refuse l'automatique sur une action sensible, un profil ou un mode inconnu, un outil inconnu", () => {
    expect(() => parseSettingsForm({ profile: "prudent", tools: { "orders.refund": { mode: "auto" } } }, tools)).toThrow(/sensible/);
    expect(() => parseSettingsForm({ profile: "prudent", tools: { "conversations.reply": { mode: "auto" } } }, tools)).toThrow(/message client/);
    expect(() => parseSettingsForm({ profile: "root", tools: {} }, tools)).toThrow();
    expect(() => parseSettingsForm({ profile: "custom", tools: {} }, tools)).toThrow();
    expect(() => parseSettingsForm({ profile: "prudent", tools: { "stock.restock": { mode: "yolo" } } }, tools)).toThrow();
    expect(() => parseSettingsForm({ profile: "prudent", tools: { "x.y": { mode: "deny" } } }, tools)).toThrow();
    expect(() => parseSettingsForm({ profile: "prudent", tools: { "orders.list": { mode: "deny" } } }, tools)).toThrow();
    expect(() => parseSettingsForm({ profile: "prudent", tools: { "stock.restock": { mode: "auto", max: "-5" } } }, tools)).toThrow(/seuil/);
  });

  it("interprète seuil, interdiction et « suivre le profil »", () => {
    const parsed = parseSettingsForm({ profile: "balanced", tools: { "stock.restock": { mode: "auto", max: "25 000,5" }, "orders.refund": { mode: "deny" } } }, tools);
    expect(parsed).toEqual({ profile: "balanced", toolPolicies: { "stock.restock": { mode: "auto", autoMaxAmount: 25000.5 }, "orders.refund": { mode: "deny" } } });
    expect(parseSettingsForm({ profile: "prudent", tools: { "stock.restock": { mode: "" } } }, tools).toolPolicies).toEqual({});
  });

  it("seuls propriétaire et administrateur enregistrent", async () => {
    const { r, calls } = repo();
    const input = { profile: "balanced", tools: {} };
    await expect(saveAssistantSettings({ repo: r, tools }, { tenantId: "t", userId: "u", role: "manager" }, input)).rejects.toThrow(/Réservé/);
    expect(calls).toHaveLength(0);
    const saved = await saveAssistantSettings({ repo: r, tools }, { tenantId: "t", userId: "u", role: "admin" }, input);
    expect(saved.profile).toBe("balanced");
    expect(calls).toHaveLength(1);
  });

  it("journal : phrases lisibles, lectures et décisions internes masquées", () => {
    const base = { id: "1", createdAt: "2026-10-22T10:00:00Z", tool: "stock.restock", decision: null, reason: null, channel: "telegram", risk: "write_reversible" };
    const label = () => "Ajoute du stock";
    expect(toJournalEntry({ ...base, event: "executed" }, label)).toMatchObject({ label: "Fait : Ajoute du stock", tone: "ok", channel: "Telegram" });
    expect(toJournalEntry({ ...base, event: "approval_requested" }, label)?.tone).toBe("wait");
    expect(toJournalEntry({ ...base, event: "decision", decision: "deny" }, label)?.tone).toBe("stop");
    expect(toJournalEntry({ ...base, event: "decision", decision: "allow" }, label)).toBeNull();
    expect(toJournalEntry({ ...base, event: "executed", risk: "read" }, label)).toBeNull();
  });
});
