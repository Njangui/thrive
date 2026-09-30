import { describe, expect, it } from "vitest";
import { buildLeadsCsv, contactReference, csvCell, resolveContactIdentity, type LeadExportRow } from "./contact-identity";

describe("contactReference", () => {
  it("dérive une référence courte et stable de l'UUID", () => {
    expect(contactReference("3f9a1c2b-1111-4222-8333-444455556666")).toBe("CT-3F9A1C2B");
    expect(contactReference("3f9a1c2b-1111-4222-8333-444455556666")).toBe(contactReference("3f9a1c2b-1111-4222-8333-444455556666"));
  });

  it("deux contacts homonymes ont des références différentes", () => {
    expect(contactReference("aaaaaaaa-0000-4000-8000-000000000001")).not.toBe(contactReference("bbbbbbbb-0000-4000-8000-000000000002"));
  });

  it("absence d'identifiant : tiret, jamais une fausse référence", () => {
    expect(contactReference(null)).toBe("—");
  });
});

describe("resolveContactIdentity", () => {
  it("WhatsApp : le numéro fait office d'identifiant", () => {
    expect(resolveContactIdentity({ phone: "+237690000000", sourceChannel: "whatsapp" })).toEqual({ platform: "whatsapp", platformId: "+237690000000" });
  });

  it("autres plateformes : sépare « plateforme:identifiant »", () => {
    expect(resolveContactIdentity({ externalChannelId: "facebook:1234567890" })).toEqual({ platform: "facebook", platformId: "1234567890" });
    expect(resolveContactIdentity({ externalChannelId: "telegram:99" })).toEqual({ platform: "telegram", platformId: "99" });
  });

  it("l'identifiant peut lui-même contenir des deux-points", () => {
    expect(resolveContactIdentity({ externalChannelId: "instagram:a:b" })).toEqual({ platform: "instagram", platformId: "a:b" });
  });

  it("aucune donnée : rien d'inventé", () => {
    expect(resolveContactIdentity({})).toEqual({ platform: null, platformId: null });
  });
});

describe("csvCell — protection contre l'injection de formule", () => {
  it("échappe les guillemets", () => {
    expect(csvCell('Jean "JP" Dupont')).toBe('"Jean ""JP"" Dupont"');
  });

  it.each(["=HYPERLINK(\"http://x\")", "+237", "-1", "@cmd"])("neutralise %s", (value) => {
    expect(csvCell(value).startsWith(`"'`)).toBe(true);
  });

  it("null/undefined → cellule vide", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("buildLeadsCsv", () => {
  const row = (over: Partial<LeadExportRow> = {}): LeadExportRow => ({
    contactId: "3f9a1c2b-1111-4222-8333-444455556666",
    contactName: "Awa",
    platform: "whatsapp",
    platformId: "+237690000000",
    phone: "+237690000000",
    email: null,
    status: "qualified",
    source: "whatsapp",
    intent: null,
    score: 42,
    budgetEstimate: null,
    notes: "Veut une visite; samedi",
    lastContactAt: null,
    nextFollowUpAt: null,
    createdAt: "2026-09-25T10:00:00Z",
    ...over,
  });

  it("commence par le BOM UTF-8 et une ligne d'en-tête, séparateur « ; »", () => {
    const csv = buildLeadsCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Référence";"Nom";"Plateforme"');
  });

  it("une ligne par prospect, avec toutes les lignes exportées", () => {
    const csv = buildLeadsCsv([row(), row({ contactId: "bbbbbbbb-0000-4000-8000-000000000002", contactName: "Awa", platform: "facebook", platformId: "777", phone: null })], { qualified: "Qualifié" });
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3); // en-tête + 2
    expect(lines[1]).toContain('"CT-3F9A1C2B";"Awa";"whatsapp"');
    expect(lines[1]).toContain('"Qualifié"');
    expect(lines[2]).toContain('"CT-BBBBBBBB";"Awa";"facebook";"777"');
  });

  it("un « ; » ou un retour à la ligne dans une note ne casse pas les colonnes", () => {
    const csv = buildLeadsCsv([row({ notes: "ligne1\nligne2; suite" })]);
    expect(csv).toContain('"ligne1\nligne2; suite"');
  });

  it("un nom malveillant est neutralisé", () => {
    const csv = buildLeadsCsv([row({ contactName: "=1+1" })]);
    expect(csv).toContain(`"'=1+1"`);
  });
});
