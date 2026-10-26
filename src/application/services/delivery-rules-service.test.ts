import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "./__fixtures__/fake-supabase";

const fake = vi.hoisted(() => ({ current: null as unknown }));
const mockRequireMembership = vi.fn();
vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => fake.current }));
vi.mock("./auth-service", () => ({ requireMembership: (...a: unknown[]) => mockRequireMembership(...a) }));

import { loadDeliveryRules, listDeliveryZones, saveDeliveryZone, removeDeliveryZone, saveDeliverySettings } from "./delivery-rules-service";
import { EMPTY_DELIVERY_RULES } from "./delivery-rules";
import { ValidationError, NotFoundError, AuthorizationError } from "@/lib/errors";

const ORG = "org_1";
let db: ReturnType<typeof createFakeSupabase>;
const zoneRow = (over: Record<string, unknown> = {}) => ({ id: `z_${Math.random()}`, organization_id: ORG, name: "Douala", slug: "douala", aliases: [], fee_amount: "1500", is_free: false, free_above_amount: null, eta_text: "24 à 48 h", is_active: true, ...over });

beforeEach(() => {
  db = createFakeSupabase({ delivery_zones: [], delivery_settings: [] });
  fake.current = db.client;
  mockRequireMembership.mockReset().mockResolvedValue({ userId: "user_1", organizationId: ORG, role: "owner" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("loadDeliveryRules (lecture de l'assistant)", () => {
  it("rien renseigné : règles vides, non configurées", async () => {
    expect(await loadDeliveryRules(ORG)).toEqual(EMPTY_DELIVERY_RULES);
  });

  it("zones ACTIVES de CETTE entreprise, triées par nom, montants convertis en nombres", async () => {
    db.tables.delivery_zones!.push(zoneRow({ name: "Yaoundé", slug: "yaounde", fee_amount: "2000" }), zoneRow(), zoneRow({ name: "Kribi", slug: "kribi", is_active: false }), zoneRow({ organization_id: "org_2", name: "Garoua", slug: "garoua" }));
    const rules = await loadDeliveryRules(ORG);
    expect(rules.configured).toBe(true);
    expect(rules.zones.map((z) => z.name)).toEqual(["Douala", "Yaoundé"]);
    expect(rules.zones[0]).toMatchObject({ slug: "douala", feeAmount: 1500, isFree: false, freeAboveAmount: null, etaText: "24 à 48 h" });
  });

  it("retrait et paiement à la livraison : null = non renseigné, vrai/faux conservés", async () => {
    db.tables.delivery_settings!.push({ organization_id: ORG, pickup_available: true, pickup_note: "Akwa", accepts_cash_on_delivery: null });
    const { settings, configured } = await loadDeliveryRules(ORG);
    expect(settings).toEqual({ pickupAvailable: true, pickupNote: "Akwa", acceptsCashOnDelivery: null });
    expect(configured).toBe(true);
  });

  it("ISOLATION : les réglages d'une autre entreprise ne sont jamais lus", async () => {
    db.tables.delivery_settings!.push({ organization_id: "org_2", pickup_available: true, accepts_cash_on_delivery: true });
    expect((await loadDeliveryRules(ORG)).configured).toBe(false);
  });

  it("ne lève jamais : lecture en échec → règles vides (« je vérifie », comportement d'avant)", async () => {
    db.state.failTables.add("delivery_zones");
    expect(await loadDeliveryRules(ORG)).toEqual(EMPTY_DELIVERY_RULES);
  });
});

describe("saveDeliveryZone", () => {
  it("réservé propriétaire / administrateur", async () => {
    mockRequireMembership.mockRejectedValue(new AuthorizationError("non"));
    await expect(saveDeliveryZone(ORG, { name: "Douala" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(mockRequireMembership).toHaveBeenCalledWith(ORG, ["owner", "admin"]);
    expect(db.tables.delivery_zones).toHaveLength(0);
  });

  it("refuse une saisie invalide sans rien écrire", async () => {
    await expect(saveDeliveryZone(ORG, { name: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveDeliveryZone(ORG, { name: "Douala", feeAmount: -5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveDeliveryZone(ORG, { name: "Douala", isFree: true, feeAmount: 500 })).rejects.toBeInstanceOf(ValidationError);
    expect(db.tables.delivery_zones).toHaveLength(0);
  });

  it("enregistre pour CETTE entreprise, identifiée par le nom normalisé (mise à jour, pas de doublon)", async () => {
    await saveDeliveryZone(ORG, { name: "Yaoundé", aliases: ["Yde"], feeAmount: 2000, etaText: "48 h" });
    await saveDeliveryZone(ORG, { name: "yaounde", feeAmount: 2500 });
    expect(db.tables.delivery_zones).toHaveLength(1);
    expect(db.tables.delivery_zones![0]).toMatchObject({ organization_id: ORG, slug: "yaounde", fee_amount: 2500, is_free: false, is_active: true });
  });

  it("zone gratuite : aucun frais enregistré", async () => {
    await saveDeliveryZone(ORG, { name: "Akwa", isFree: true });
    expect(db.tables.delivery_zones![0]).toMatchObject({ is_free: true, fee_amount: null });
  });
});

describe("removeDeliveryZone / listDeliveryZones", () => {
  it("supprime la zone de CETTE entreprise ; introuvable → NotFoundError", async () => {
    db.tables.delivery_zones!.push(zoneRow(), zoneRow({ organization_id: "org_2" }));
    await removeDeliveryZone(ORG, "douala");
    expect(db.tables.delivery_zones).toHaveLength(1);
    expect(db.tables.delivery_zones![0]!.organization_id).toBe("org_2");
    await expect(removeDeliveryZone(ORG, "douala")).rejects.toBeInstanceOf(NotFoundError);
    expect(mockRequireMembership).toHaveBeenCalledWith(ORG, ["owner", "admin"]);
  });

  it("l'écran du commerçant voit aussi les zones inactives", async () => {
    db.tables.delivery_zones!.push(zoneRow(), zoneRow({ name: "Kribi", slug: "kribi", is_active: false }));
    const zones = await listDeliveryZones(ORG);
    expect(zones.map((z) => [z.slug, z.isActive])).toEqual([["douala", true], ["kribi", false]]);
  });
});

describe("saveDeliverySettings", () => {
  it("enregistre les valeurs indiquées, conserve les autres ; null = « non renseigné »", async () => {
    await saveDeliverySettings(ORG, { pickupAvailable: true, pickupNote: "  Du lundi au samedi  " });
    await saveDeliverySettings(ORG, { acceptsCashOnDelivery: false });
    expect(db.tables.delivery_settings).toHaveLength(1);
    expect(db.tables.delivery_settings![0]).toMatchObject({ organization_id: ORG, pickup_available: true, pickup_note: "Du lundi au samedi", accepts_cash_on_delivery: false });
    const settings = await saveDeliverySettings(ORG, { pickupAvailable: null });
    expect(settings.pickupAvailable).toBeNull();
  });

  it("refuse une valeur qui n'est ni booléenne ni nulle, et une note trop longue", async () => {
    await expect(saveDeliverySettings(ORG, { pickupAvailable: "oui" as never })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveDeliverySettings(ORG, { acceptsCashOnDelivery: 1 as never })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveDeliverySettings(ORG, { pickupNote: "x".repeat(201) })).rejects.toBeInstanceOf(ValidationError);
    expect(db.tables.delivery_settings).toHaveLength(0);
  });

  it("réservé propriétaire / administrateur", async () => {
    mockRequireMembership.mockRejectedValue(new AuthorizationError("non"));
    await expect(saveDeliverySettings(ORG, { pickupAvailable: true })).rejects.toBeInstanceOf(AuthorizationError);
  });
});
