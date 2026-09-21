import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Non-régression de l'audit sécurité du 20/09/2026 (voir
 * SECURITY_DEPENDENCY_AUDIT_2026-09-20.md, §4) : les trois Server Actions
 * PUBLIQUES qui écrivent via le client `service_role` (donc hors RLS) ne
 * doivent JAMAIS faire confiance à l'`organizationId` envoyé par le
 * navigateur — le tenant vient du hostname, résolu côté serveur.
 *
 * Scénario de l'audit (« Tester les Server Actions publiques avec un tenant A
 * et tenter de soumettre l'ID du tenant B ») : la requête arrive sur la
 * vitrine du tenant A, le formulaire/l'appel porte l'ID du tenant B.
 */

const mocks = vi.hoisted(() => ({
  resolveRequestTenant: vi.fn(),
  trackEvent: vi.fn(),
  checkRateLimit: vi.fn(),
  headerGet: vi.fn(),
  createAppointment: vi.fn(),
  notifyOrgAdmins: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/infrastructure/tenant/resolve-request-tenant", () => ({ resolveRequestTenant: mocks.resolveRequestTenant }));
vi.mock("@/application/services/analytics-service", () => ({ trackEvent: mocks.trackEvent }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: mocks.headerGet }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/application/services/appointment-service", () => ({ createAppointment: mocks.createAppointment }));
vi.mock("@/application/services/notification-service", () => ({ notifyOrgAdmins: mocks.notifyOrgAdmins }));

import { trackClickAction } from "./track-click-action";
import { trackProductClickAction } from "./track-product-click-action";
import { requestAppointmentAction } from "./landing-sections/booking-actions";

const TENANT_A = { organizationId: "org-A" };
const ORG_B = "org-B";
const PRODUCT_UUID = "3f8e2c1a-9b4d-4e6f-8a7b-1c2d3e4f5a6b";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveRequestTenant.mockResolvedValue(TENANT_A);
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.headerGet.mockImplementation((name: string) => (name === "x-forwarded-for" ? "203.0.113.7, 10.0.0.1" : null));
  mocks.createAppointment.mockResolvedValue({ appointmentId: "appt-1" });
  mocks.notifyOrgAdmins.mockResolvedValue(undefined);
});

describe("trackClickAction — l'organisation vient du hostname, jamais du navigateur", () => {
  it("écrit l'événement pour le tenant résolu, même si le navigateur envoie l'ID d'un autre tenant", async () => {
    await trackClickAction(ORG_B, "whatsapp");

    expect(mocks.trackEvent).toHaveBeenCalledTimes(1);
    expect(mocks.trackEvent).toHaveBeenCalledWith("org-A", "cta_click", "cta", undefined, { ctaId: "whatsapp" });
    expect(mocks.trackEvent).not.toHaveBeenCalledWith(ORG_B, expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it("aucun tenant résolu (domaine racine, hôte inconnu) -> aucune écriture", async () => {
    mocks.resolveRequestTenant.mockResolvedValue(null);
    await trackClickAction(ORG_B, "whatsapp");
    expect(mocks.trackEvent).not.toHaveBeenCalled();
  });

  it("rate limit `public_analytics` dépassé -> aucune écriture, limité par IP (1re adresse de x-forwarded-for)", async () => {
    mocks.checkRateLimit.mockResolvedValue(30);
    await trackClickAction(ORG_B, "whatsapp");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("public_analytics", "203.0.113.7");
    expect(mocks.trackEvent).not.toHaveBeenCalled();
  });

  it("ctaId vide ignoré ; ctaId trop long tronqué à 80 caractères", async () => {
    await trackClickAction(ORG_B, "");
    expect(mocks.trackEvent).not.toHaveBeenCalled();

    await trackClickAction(ORG_B, "x".repeat(200));
    expect(mocks.trackEvent).toHaveBeenCalledWith("org-A", "cta_click", "cta", undefined, { ctaId: "x".repeat(80) });
  });
});

describe("trackProductClickAction — même garantie, plus un identifiant produit strictement UUID", () => {
  it("écrit pour le tenant résolu, jamais pour l'ID fourni par le navigateur", async () => {
    await trackProductClickAction(ORG_B, PRODUCT_UUID);

    expect(mocks.trackEvent).toHaveBeenCalledTimes(1);
    expect(mocks.trackEvent).toHaveBeenCalledWith("org-A", "product_click", "product", PRODUCT_UUID);
  });

  it("identifiant produit qui n'est pas un UUID -> aucune écriture", async () => {
    await trackProductClickAction(ORG_B, "1' OR '1'='1");
    await trackProductClickAction(ORG_B, "");
    expect(mocks.trackEvent).not.toHaveBeenCalled();
  });

  it("aucun tenant résolu, ou rate limit dépassé -> aucune écriture", async () => {
    mocks.resolveRequestTenant.mockResolvedValueOnce(null);
    await trackProductClickAction(ORG_B, PRODUCT_UUID);

    mocks.checkRateLimit.mockResolvedValueOnce(12);
    await trackProductClickAction(ORG_B, PRODUCT_UUID);

    expect(mocks.trackEvent).not.toHaveBeenCalled();
  });
});

describe("requestAppointmentAction — le formulaire ne peut pas viser un autre tenant", () => {
  function bookingForm(overrides: Record<string, string> = {}): FormData {
    const form = new FormData();
    const fields: Record<string, string> = {
      organizationId: "org-A",
      returnTo: "/rendez-vous",
      date: "2099-01-15",
      time: "10:00",
      duration: "60",
      contactName: "Awa Ndiaye",
      contactPhone: "+237600000000",
      serviceLabel: "Coupe",
      ...overrides,
    };
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  }

  it("ID d'un AUTRE tenant dans le formulaire -> rejeté, rien n'est créé chez personne", async () => {
    await expect(requestAppointmentAction(bookingForm({ organizationId: ORG_B }))).rejects.toThrow(/NEXT_REDIRECT:.*bookingError=Requ%C3%AAte\+invalide/);

    expect(mocks.createAppointment).not.toHaveBeenCalled();
    expect(mocks.notifyOrgAdmins).not.toHaveBeenCalled();
  });

  it("aucun tenant résolu -> rejeté", async () => {
    mocks.resolveRequestTenant.mockResolvedValue(null);

    await expect(requestAppointmentAction(bookingForm())).rejects.toThrow(/NEXT_REDIRECT:.*bookingError=/);
    expect(mocks.createAppointment).not.toHaveBeenCalled();
  });

  it("ID correspondant au tenant résolu -> le rendez-vous est créé pour ce tenant", async () => {
    await expect(requestAppointmentAction(bookingForm())).rejects.toThrow(/NEXT_REDIRECT:\/rendez-vous\?bookingSuccess=/);

    expect(mocks.createAppointment).toHaveBeenCalledTimes(1);
    expect(mocks.createAppointment).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-A", contactFullName: "Awa Ndiaye" }));
    expect(mocks.notifyOrgAdmins).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-A", relatedEntityId: "appt-1" }));
  });

  it("formulaire SANS organizationId -> accepté, écrit pour le tenant résolu (jamais pour une valeur vide)", async () => {
    await expect(requestAppointmentAction(bookingForm({ organizationId: "" }))).rejects.toThrow(/bookingSuccess=/);

    expect(mocks.createAppointment).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-A" }));
  });
});
