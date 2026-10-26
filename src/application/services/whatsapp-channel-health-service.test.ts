import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import { applyAccountEvent, buildDiagnostics, getChannelDiagnostics, recordDeliveryFailure } from "./whatsapp-channel-health-service";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => ({}) }));

const NOW = Date.parse("2026-10-09T12:00:00Z");
const ORG = "org-1";
const base = { health: null, failures24h: [], badTemplates: [], nowMs: NOW };

describe("buildDiagnostics (pur)", () => {
  it("rien à signaler", () => expect(buildDiagnostics(base)).toEqual([]));
  it("moyen de paiement : PRÉSOMPTION affichée comme telle", () => {
    const d = buildDiagnostics({ ...base, failures24h: [{ probable_cause: "payment" }] });
    expect(d[0]).toMatchObject({ code: "payment_probable", severity: "error" });
    expect(d[0]!.message).toMatch(/probablement/); expect(d[0]!.message).toMatch(/à confirmer/);
  });
  it("échecs ordinaires : seuil de 3", () => {
    expect(buildDiagnostics({ ...base, failures24h: [{ probable_cause: "other" }, { probable_cause: "window" }] })).toEqual([]);
    expect(buildDiagnostics({ ...base, failures24h: Array(3).fill({ probable_cause: "other" }) })[0]).toMatchObject({ code: "delivery_failures", severity: "warning" });
  });
  it("compte restreint, qualité rouge, alerte critique récente (< 7 j) seulement, modèles refusés ; erreurs d'abord", () => {
    const d = buildDiagnostics({ ...base,
      health: { account_status: "restricted", restrictions: "RESTRICTED_BIZ_INITIATED_MESSAGING", quality_rating: "RED", last_alert_severity: "CRITICAL", last_alert_description: "Compte à risque", last_alert_at: "2026-10-08T00:00:00Z" },
      badTemplates: [{ label: "Alerte", status: "REJECTED" }] });
    expect(d.map((x) => x.code)).toEqual(["account_restricted", "meta_alert", "quality_red", "template_rejected"]);
    expect(buildDiagnostics({ ...base, health: { last_alert_severity: "CRITICAL", last_alert_at: "2026-09-01T00:00:00Z" } })).toEqual([]);
  });
});

describe("persistance", () => {
  it("échec de livraison enregistré et classé", async () => {
    const db = new FakeDb(); const c = db as unknown as SupabaseClient;
    await recordDeliveryFailure(c, { organizationId: ORG, externalMessageId: "m1", errorMessage: "(#131042) payment issue" });
    await recordDeliveryFailure(c, { organizationId: "org-2", errorMessage: "131042" });
    expect(db.rows("whatsapp_delivery_failures")[0]).toMatchObject({ organization_id: ORG, probable_cause: "payment" });
    // FakeDb horodate à partir du 01/01/2026 (1 s par écriture).
    expect((await getChannelDiagnostics(ORG, c, Date.parse("2026-01-01T01:00:00Z"))).map((x) => x.code)).toEqual(["payment_probable"]);
  });
  it("événements account.* : restriction, qualité, alerte ; événement inconnu refusé", async () => {
    const db = new FakeDb(); const c = db as unknown as SupabaseClient; const t = "2026-10-09T12:00:00.000Z";
    expect(await applyAccountEvent(c, ORG, { event: "whatsapp.account.status_updated", status: { status: "restricted", restrictions: [{ type: "RESTRICTED_BIZ_INITIATED_MESSAGING" }] } }, t)).toBe(true);
    expect(await applyAccountEvent(c, ORG, { event: "whatsapp.account.quality_updated", quality: { qualityRating: "RED" } }, t)).toBe(true);
    expect(await applyAccountEvent(c, ORG, { event: "whatsapp.account.alert_received", alert: { severity: "CRITICAL", description: "x" } }, t)).toBe(true);
    expect(db.rows("whatsapp_channel_health")).toHaveLength(1);
    expect(db.rows("whatsapp_channel_health")[0]).toMatchObject({ account_status: "restricted", restrictions: "RESTRICTED_BIZ_INITIATED_MESSAGING", quality_rating: "RED", last_alert_severity: "CRITICAL" });
    expect(await applyAccountEvent(c, ORG, { event: "whatsapp.autre" }, t)).toBe(false);
    expect(await applyAccountEvent(c, ORG, { event: "whatsapp.account.status_updated", status: { status: "active" } }, t)).toBe(true);
    expect(db.rows("whatsapp_channel_health")[0]!.account_status).toBe("active");
  });
});
