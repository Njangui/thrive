import { describe, it, expect } from "vitest";
import { hashPin, needsRehash, verifyPinHash } from "./pin-hasher";

describe("pin-hasher (scrypt)", () => {
  it("valide le bon PIN et refuse le mauvais", async () => {
    const hash = await hashPin("493817");
    expect(await verifyPinHash("493817", hash)).toBe(true);
    expect(await verifyPinHash("493818", hash)).toBe(false);
  });

  it("ne contient jamais le PIN et utilise un sel aléatoire", async () => {
    const [a, b] = await Promise.all([hashPin("493817"), hashPin("493817")]);
    expect(a).not.toContain("493817");
    expect(a).not.toBe(b);
  });

  it("le poivre change le résultat : un hachage poivré ne vérifie pas sans le même poivre", async () => {
    const hash = await hashPin("493817", "pepper-secret-123456");
    expect(await verifyPinHash("493817", hash, "pepper-secret-123456")).toBe(true);
    expect(await verifyPinHash("493817", hash)).toBe(false);
    expect(await verifyPinHash("493817", hash, "autre-poivre-123456")).toBe(false);
  });

  it("refuse sans lever une valeur stockée malformée", async () => {
    expect(await verifyPinHash("493817", "n'importe quoi")).toBe(false);
    expect(await verifyPinHash("493817", "scrypt$x$8$1$AAAA$AAAA")).toBe(false);
    expect(await verifyPinHash("493817", "scrypt$32768$8$1$AAAA$")).toBe(false);
  });

  it("needsRehash détecte des paramètres plus faibles que la cible", async () => {
    expect(needsRehash(await hashPin("493817"))).toBe(false);
    expect(needsRehash("scrypt$1024$8$1$AAAA$AAAA")).toBe(true);
  });
});
