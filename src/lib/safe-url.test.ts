import { describe, it, expect } from "vitest";
import { isSafePublicUrl, toSafeHref } from "./safe-url";

describe("isSafePublicUrl", () => {
  it("accepte http/https", () => {
    expect(isSafePublicUrl("https://wa.me/237600000000")).toBe(true);
    expect(isSafePublicUrl("http://example.com")).toBe(true);
  });

  it("accepte mailto/tel/whatsapp", () => {
    expect(isSafePublicUrl("mailto:contact@example.com")).toBe(true);
    expect(isSafePublicUrl("tel:+237600000000")).toBe(true);
    expect(isSafePublicUrl("whatsapp://send?phone=237600000000")).toBe(true);
  });

  it("accepte un chemin interne", () => {
    expect(isSafePublicUrl("/contact")).toBe(true);
    expect(isSafePublicUrl("/produits?tri=prix")).toBe(true);
  });

  it("accepte une ancre interne", () => {
    expect(isSafePublicUrl("#booking")).toBe(true);
  });

  // --- Le coeur de la protection : ce que ce module existe pour bloquer ---

  it("refuse javascript: (XSS stocké via un champ cta_url/social_links)", () => {
    expect(isSafePublicUrl("javascript:alert(1)")).toBe(false);
    expect(isSafePublicUrl("JavaScript:alert(document.cookie)")).toBe(false);
    // Espaces/tabulations/retours à la ligne insérés pour contourner un
    // filtre naïf par préfixe — `new URL()` les normalise, le protocole
    // résolu reste "javascript:".
    expect(isSafePublicUrl("java\tscript:alert(1)")).toBe(false);
  });

  it("refuse data: (déguisement d'une image/HTML exécutable)", () => {
    expect(isSafePublicUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("refuse vbscript: et blob:", () => {
    expect(isSafePublicUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafePublicUrl("blob:https://example.com/uuid")).toBe(false);
  });

  it("refuse une URL protocol-relative (//evil.example) déguisée en chemin interne", () => {
    expect(isSafePublicUrl("//evil.example/phish")).toBe(false);
  });

  it("refuse une chaîne vide ou uniquement des espaces", () => {
    expect(isSafePublicUrl("")).toBe(false);
    expect(isSafePublicUrl("   ")).toBe(false);
  });

  it("refuse un texte qui n'est ni un chemin, ni une ancre, ni une URL analysable", () => {
    expect(isSafePublicUrl("not a url at all")).toBe(false);
  });
});

describe("toSafeHref", () => {
  it("retourne l'URL nettoyée (espaces en bordure retirés) quand elle est sûre", () => {
    expect(toSafeHref("  https://example.com  ")).toBe("https://example.com");
  });

  it("retourne null plutôt que de lever, pour une URL dangereuse déjà en base", () => {
    expect(toSafeHref("javascript:alert(1)")).toBeNull();
  });

  it("retourne null pour null/undefined/vide sans lever d'exception", () => {
    expect(toSafeHref(null)).toBeNull();
    expect(toSafeHref(undefined)).toBeNull();
    expect(toSafeHref("")).toBeNull();
  });
});
