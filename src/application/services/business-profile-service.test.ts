import { describe, it, expect } from "vitest";
import { normalizePhoneNumber, validateBusinessProfileInput } from "./business-profile-service";

describe("normalizePhoneNumber", () => {
  it("retire espaces, points, tirets et parenthèses, conserve le + initial", () => {
    expect(normalizePhoneNumber("+237 6 55 12.34-56", "Téléphone")).toBe("+237655123456");
  });
  it("vide → null (champ optionnel)", () => {
    expect(normalizePhoneNumber("  ", "Téléphone")).toBeNull();
    expect(normalizePhoneNumber(undefined, "Téléphone")).toBeNull();
  });
  it("refuse trop court, lettres, ou trop long", () => {
    expect(() => normalizePhoneNumber("12345", "Téléphone")).toThrow(/Téléphone invalide/);
    expect(() => normalizePhoneNumber("abc12345678", "Numéro WhatsApp")).toThrow(/Numéro WhatsApp invalide/);
    expect(() => normalizePhoneNumber("1234567890123456", "Téléphone")).toThrow();
  });
});

describe("validateBusinessProfileInput", () => {
  it("normalise et ne garde que les jours renseignés", () => {
    const result = validateBusinessProfileInput({
      name: "  Boutique Fatou ",
      email: " Contact@Fatou.CM ",
      phone: "655 12 34 56",
      openingHours: { lundi: " 8h - 18h ", mardi: "", dimanche: "Fermé" },
    });
    expect(result.name).toBe("Boutique Fatou");
    expect(result.email).toBe("contact@fatou.cm");
    expect(result.phone).toBe("655123456");
    expect(result.opening_hours).toEqual({ lundi: "8h - 18h", dimanche: "Fermé" });
    expect(result.description).toBeNull();
    expect(result.address).toBeNull();
  });
  it("refuse un nom trop court, un email invalide, une description trop longue, des horaires trop longs", () => {
    expect(() => validateBusinessProfileInput({ name: "A" })).toThrow(/nom de l'entreprise/);
    expect(() => validateBusinessProfileInput({ name: "Fatou", email: "pas-un-email" })).toThrow(/email/i);
    expect(() => validateBusinessProfileInput({ name: "Fatou", description: "x".repeat(1001) })).toThrow(/description/);
    expect(() => validateBusinessProfileInput({ name: "Fatou", openingHours: { lundi: "x".repeat(41) } })).toThrow(/lundi/);
  });
});
