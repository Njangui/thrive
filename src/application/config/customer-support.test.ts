import { describe, expect, it } from "vitest";
import { SUPPORT_CONTACTS, supportWhatsAppUrl } from "./customer-support";

describe("service client WhatsApp", () => {
  it("expose exactement les deux numéros officiels", () => {
    expect(SUPPORT_CONTACTS.map((c) => c.digits)).toEqual(["237656106225", "237657380954"]);
  });
  it("format wa.me : chiffres seuls, sans + ni espaces", () => {
    for (const c of SUPPORT_CONTACTS) expect(c.digits).toMatch(/^\d{12}$/);
  });
  it("le numéro affiché correspond au numéro du lien", () => {
    for (const c of SUPPORT_CONTACTS) expect(c.display.replace(/\D/g, "")).toBe(c.digits);
  });
  it("lien wa.me avec message pré-rempli encodé (nom d'entreprise inclus)", () => {
    const url = supportWhatsAppUrl(SUPPORT_CONTACTS[0]!, "Chez Awa & Fils");
    expect(url.startsWith("https://wa.me/237656106225?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toContain("Chez Awa & Fils");
    expect(url).not.toContain("&F"); // le & du nom est bien encodé
  });
  it("sans nom d'entreprise : message générique", () => {
    expect(decodeURIComponent(supportWhatsAppUrl(SUPPORT_CONTACTS[1]!).split("text=")[1]!)).toContain("besoin d'aide");
  });
});
