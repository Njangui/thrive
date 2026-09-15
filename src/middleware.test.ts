import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/**
 * Repasse sécurité P0 (07/09/2026, section 8/9 de la mission) — test de
 * régression pour la faille corrigée dans middleware.ts : sur le domaine
 * racine, un `x-tenant-slug`/`x-tenant-custom-domain` forgé par le
 * client ne doit JAMAIS survivre jusqu'à `resolveRequestTenant()`.
 *
 * `NextResponse.next({ request: { headers } })` encode les headers de
 * requête modifiés sur la réponse avec le préfixe interne
 * `x-middleware-request-*` (mécanisme Next.js pour transmettre les
 * headers modifiés au serveur) — c'est ce que ce test lit, plutôt que
 * d'appeler resolveRequestTenant() lui-même (server-only, dépend de
 * next/headers — non appelable directement dans un test unitaire).
 */
function requestHeaderAfterMiddleware(request: NextRequest, name: string): string | null {
  const response = middleware(request);
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("middleware — résolution tenant par hostname", () => {
  const ROOT_DOMAIN = "localhost:3000";

  it("domaine racine + en-tête x-tenant-slug forgé par le client -> l'en-tête est supprimé, jamais transmis", () => {
    const request = new NextRequest("http://localhost:3000/", {
      headers: { host: ROOT_DOMAIN, "x-tenant-slug": "victime" },
    });

    expect(requestHeaderAfterMiddleware(request, "x-tenant-slug")).toBeNull();
  });

  it("domaine racine + en-tête x-tenant-custom-domain forgé -> supprimé", () => {
    const request = new NextRequest("http://localhost:3000/", {
      headers: { host: ROOT_DOMAIN, "x-tenant-custom-domain": "victime.com" },
    });

    expect(requestHeaderAfterMiddleware(request, "x-tenant-custom-domain")).toBeNull();
  });

  it("sous-domaine plateforme -> x-tenant-slug dérivé du VRAI hostname, jamais d'une valeur forgée", () => {
    const request = new NextRequest("http://tenant-legitime.localhost:3000/", {
      headers: { host: `tenant-legitime.${ROOT_DOMAIN}`, "x-tenant-slug": "victime" },
    });

    expect(requestHeaderAfterMiddleware(request, "x-tenant-slug")).toBe("tenant-legitime");
  });

  it("domaine custom -> x-tenant-custom-domain dérivé du VRAI hostname, jamais d'une valeur forgée", () => {
    const request = new NextRequest("http://boutique-cliente.com/", {
      headers: { host: "boutique-cliente.com", "x-tenant-custom-domain": "victime.com" },
    });

    expect(requestHeaderAfterMiddleware(request, "x-tenant-custom-domain")).toBe("boutique-cliente.com");
  });
});
