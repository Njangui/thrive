import { describe, it, expect } from "vitest";
import { AppError, AuthenticationError, AuthorizationError, ValidationError, toClientErrorResponse } from "./errors";

describe("toClientErrorResponse", () => {
  it("expose le message et le status HTTP corrects pour une AppError connue", () => {
    const { status, body } = toClientErrorResponse(new ValidationError("Le nom est requis"));
    expect(status).toBe(400);
    expect(body.error).toBe("Le nom est requis");
  });

  it("mappe AuthenticationError sur 401", () => {
    const { status } = toClientErrorResponse(new AuthenticationError());
    expect(status).toBe(401);
  });

  it("mappe AuthorizationError sur 403", () => {
    const { status } = toClientErrorResponse(new AuthorizationError());
    expect(status).toBe(403);
  });

  it("ne révèle JAMAIS le message brut d'une erreur inattendue (section 48 : pas de détail interne exposé)", () => {
    const dbError = new Error("relation \"secret_internal_table\" does not exist, connection string: postgres://...");
    const { status, body } = toClientErrorResponse(dbError);

    expect(status).toBe(500);
    expect(body.error).not.toContain("secret_internal_table");
    expect(body.error).not.toContain("postgres://");
    expect(body.error).toBe("Erreur interne");
  });

  it("AppError reste une instance de Error (compatible avec les try/catch génériques)", () => {
    expect(new AppError("x", 400, "validation")).toBeInstanceOf(Error);
  });
});
