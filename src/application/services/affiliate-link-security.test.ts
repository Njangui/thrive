import { describe, expect, it } from "vitest";
import {
  generateReferralCode,
  hashForFraudDetection,
  signReferralToken,
  verifyReferralToken,
  type ReferralTokenPayload,
} from "./affiliate-link-security";

const basePayload: ReferralTokenPayload = {
  linkId: "11111111-1111-1111-1111-111111111111",
  affiliateId: "22222222-2222-2222-2222-222222222222",
  clickId: "33333333-3333-3333-3333-333333333333",
  exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
};

describe("signReferralToken / verifyReferralToken", () => {
  it("un jeton signé se vérifie et renvoie le payload d'origine", () => {
    const token = signReferralToken(basePayload);
    expect(verifyReferralToken(token)).toEqual(basePayload);
  });

  it("renvoie null pour un jeton absent", () => {
    expect(verifyReferralToken(null)).toBeNull();
    expect(verifyReferralToken(undefined)).toBeNull();
    expect(verifyReferralToken("")).toBeNull();
  });

  it("renvoie null si la signature a été altérée", () => {
    const token = signReferralToken(basePayload);
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifyReferralToken(tampered)).toBeNull();
  });

  it("renvoie null si le payload encodé a été modifié (signature ne correspond plus)", () => {
    const token = signReferralToken(basePayload);
    const [, signature] = [token.slice(0, token.lastIndexOf(".")), token.slice(token.lastIndexOf(".") + 1)];
    const forgedPayload = Buffer.from(JSON.stringify({ ...basePayload, affiliateId: "attacker" })).toString(
      "base64url",
    );
    expect(verifyReferralToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("renvoie null pour un jeton expiré", () => {
    const expired = signReferralToken({ ...basePayload, exp: Math.floor(Date.now() / 1000) - 10 });
    expect(verifyReferralToken(expired)).toBeNull();
  });

  it("renvoie null pour un jeton malformé (pas de séparateur)", () => {
    expect(verifyReferralToken("not-a-valid-token")).toBeNull();
  });
});

describe("hashForFraudDetection", () => {
  it("est déterministe pour une même valeur", () => {
    expect(hashForFraudDetection("1.2.3.4")).toBe(hashForFraudDetection("1.2.3.4"));
  });

  it("ne renvoie jamais la valeur en clair", () => {
    const hash = hashForFraudDetection("203.0.113.42");
    expect(hash).not.toContain("203.0.113.42");
    expect(hash).toMatch(/^[a-f0-9]{64}$/); // hex SHA-256
  });

  it("des valeurs différentes produisent des hachages différents", () => {
    expect(hashForFraudDetection("1.2.3.4")).not.toBe(hashForFraudDetection("1.2.3.5"));
  });
});

describe("generateReferralCode", () => {
  it("génère un code de la longueur attendue, sans caractères ambigus", () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(8);
    expect(code).not.toMatch(/[0O1lI]/);
  });

  it("génère des codes différents à chaque appel (pas de graine figée)", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateReferralCode()));
    expect(codes.size).toBe(50);
  });
});
