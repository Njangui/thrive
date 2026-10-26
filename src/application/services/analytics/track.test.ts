import { describe, it, expect, vi, beforeEach } from "vitest";

const trackEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/application/services/analytics-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../analytics-service")>()),
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

import { buildVisitorId } from "../landing-analytics-service";
import { isWhatsAppCta, track, trackWhatsAppClick, visitorIdFor } from "./track";

const UA = "Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36";

beforeEach(() => trackEventMock.mockClear());

describe("track()", () => {
  it("délègue à trackEvent avec le type, l'entité et les métadonnées", async () => {
    await track("org-1", "product_view", { entityType: "product", entityId: "p1", metadata: { a: 1 } });
    expect(trackEventMock).toHaveBeenCalledWith("org-1", "product_view", "product", "p1", { a: 1 });
  });
});

describe("clic WhatsApp", () => {
  it("reconnaît les ctaId WhatsApp existants et ignore les autres", () => {
    for (const id of ["whatsapp_product", "home_product_whatsapp", "contact_page_whatsapp", "whatsapp_service_detail"]) expect(isWhatsAppCta(id)).toBe(true);
    for (const id of ["hero_primary", "retail_cta", "visit_primary"]) expect(isWhatsAppCta(id)).toBe(false);
  });

  it("enregistre un whatsapp_click avec l'empreinte anonyme, jamais l'IP", async () => {
    await trackWhatsAppClick("org-1", { ctaId: "whatsapp_product", ip: "41.202.1.9", userAgent: UA });
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    const [org, type, entityType, , metadata] = trackEventMock.mock.calls[0]!;
    expect(org).toBe("org-1");
    expect(type).toBe("whatsapp_click");
    expect(entityType).toBe("cta");
    expect(metadata.ctaId).toBe("whatsapp_product");
    expect(metadata.visitor).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(metadata)).not.toContain("41.202.1.9");
  });

  it("l'empreinte du clic = celle de l'entrée de session (même jour) : l'attribution est possible", () => {
    const now = new Date("2026-10-09T10:00:00Z");
    const entry = buildVisitorId(process.env.SUPABASE_SERVICE_ROLE_KEY!, "org-1", "41.202.1.9", UA, "2026-10-09");
    expect(visitorIdFor("org-1", "41.202.1.9", UA, now)).toBe(entry);
    expect(visitorIdFor("org-1", "41.202.1.9", UA, new Date("2026-10-10T10:00:00Z"))).not.toBe(entry);
    expect(visitorIdFor("org-2", "41.202.1.9", UA, now)).not.toBe(entry);
  });

  it("ignore un CTA non WhatsApp et les robots", async () => {
    await trackWhatsAppClick("org-1", { ctaId: "hero_primary", ip: "1.1.1.1", userAgent: UA });
    await trackWhatsAppClick("org-1", { ctaId: "whatsapp_product", ip: "1.1.1.1", userAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    expect(trackEventMock).not.toHaveBeenCalled();
  });
});
