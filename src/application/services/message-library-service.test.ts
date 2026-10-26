import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const db: { voice: Row | null; overrides: Row[]; upserts: Array<{ table: string; row: Row; opts: Row }>; deletes: Array<Record<string, unknown>>; failRead: boolean } = { voice: null, overrides: [], upserts: [], deletes: [], failRead: false };
const mockRequireMembership = vi.fn();

vi.mock("./auth-service", () => ({ requireMembership: (...a: unknown[]) => mockRequireMembership(...a) }));
vi.mock("@/infrastructure/supabase/server-client", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return chain;
        },
        maybeSingle: () => Promise.resolve(db.failRead ? { data: null, error: { message: "boom" } } : { data: table === "brand_voice_profiles" ? db.voice : null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(db.failRead ? { data: null, error: { message: "boom" } } : { data: table === "predefined_messages" ? db.overrides : [], error: null }),
        upsert: (row: Row, opts: Row) => {
          db.upserts.push({ table, row, opts });
          return Promise.resolve({ error: null });
        },
        delete: () => ({
          eq: (k: string, v: unknown) => {
            const f: Record<string, unknown> = { [k]: v };
            const c2: Record<string, unknown> = {
              eq: (k2: string, v2: unknown) => {
                f[k2] = v2;
                return c2;
              },
              then: (resolve: (v: unknown) => void) => {
                db.deletes.push(f);
                resolve({ error: null });
              },
            };
            return c2;
          },
        }),
      };
      return chain;
    },
  }),
}));

import { loadVoiceAndLibrary, saveBrandVoice, saveApprovedMessage, removeMessageOverride } from "./message-library-service";
import { DEFAULT_BRAND_VOICE } from "./brand-voice";
import { ValidationError, AuthorizationError } from "@/lib/errors";

beforeEach(() => {
  db.voice = null;
  db.overrides = [];
  db.upserts = [];
  db.deletes = [];
  db.failRead = false;
  mockRequireMembership.mockReset().mockResolvedValue({ userId: "user_1", organizationId: "org_1", role: "owner" });
});

describe("loadVoiceAndLibrary (lecture de l'assistant)", () => {
  it("sans profil ni surcharge : voix par défaut", async () => {
    const { voice, library } = await loadVoiceAndLibrary("org_1");
    expect(voice).toEqual(DEFAULT_BRAND_VOICE);
    expect(library.render("goodbye")).toBe("Merci pour votre message, à très bientôt ! 👋");
  });

  it("applique le profil et les surcharges approuvées", async () => {
    db.voice = { register: "tu", emoji_level: "none", local_expressions: [], avoid_expressions: [], example_messages: [], examples_consent: false };
    db.overrides = [{ key: "goodbye", register: "any", emoji_level: "any", body: "À la prochaine !", status: "approved" }];
    const { voice, library } = await loadVoiceAndLibrary("org_1");
    expect(voice.register).toBe("tu");
    expect(library.render("goodbye")).toBe("À la prochaine !");
  });

  it("ne lève jamais : erreur de lecture → voix par défaut", async () => {
    db.failRead = true;
    const { voice } = await loadVoiceAndLibrary("org_1");
    expect(voice).toEqual(DEFAULT_BRAND_VOICE);
  });

  it("n'utilise jamais un exemple de message sans consentement", async () => {
    db.voice = { register: "vous", emoji_level: "light", example_messages: ["Salut"], examples_consent: false };
    expect((await loadVoiceAndLibrary("org_1")).voice.exampleMessages).toEqual([]);
  });
});

describe("saveBrandVoice", () => {
  it("exige propriétaire ou administrateur du tenant", async () => {
    mockRequireMembership.mockRejectedValue(new AuthorizationError("rôle non autorisé"));
    await expect(saveBrandVoice("org_1", { register: "tu" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(mockRequireMembership).toHaveBeenCalledWith("org_1", ["owner", "admin"]);
    expect(db.upserts).toHaveLength(0);
  });

  it("refuse une saisie invalide sans rien écrire", async () => {
    await expect(saveBrandVoice("org_1", { register: "toi" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveBrandVoice("org_1", { exampleMessages: ["Salut"] })).rejects.toBeInstanceOf(ValidationError); // pas de consentement
    expect(db.upserts).toHaveLength(0);
  });

  it("enregistre pour CE tenant, avec la date du consentement", async () => {
    await saveBrandVoice("org_1", { register: "tu", emojiLevel: "rich", exampleMessages: ["Salut ! Appelle-moi au 699 12 34 56"], examplesConsent: true });
    const { row, opts } = db.upserts[0]!;
    expect(row).toMatchObject({ organization_id: "org_1", register: "tu", emoji_level: "rich", examples_consent: true, example_messages: ["Salut ! Appelle-moi au [numéro]"] });
    expect(typeof row.examples_consent_at).toBe("string");
    expect(opts).toEqual({ onConflict: "organization_id" });
  });

  it("conserve la date du premier consentement ; le retirer efface les exemples", async () => {
    db.voice = { examples_consent: true, examples_consent_at: "2026-01-01T00:00:00.000Z" };
    await saveBrandVoice("org_1", { exampleMessages: ["Salut"], examplesConsent: true });
    expect(db.upserts[0]!.row.examples_consent_at).toBe("2026-01-01T00:00:00.000Z");

    await saveBrandVoice("org_1", { examplesConsent: false });
    expect(db.upserts[1]!.row).toMatchObject({ examples_consent: false, examples_consent_at: null, example_messages: [] });
  });
});

describe("saveApprovedMessage / removeMessageOverride", () => {
  it("refuse un texte invalide (prix en dur, variable inconnue)", async () => {
    await expect(saveApprovedMessage("org_1", { key: "goodbye", body: "Promo à 5 000 FCFA" })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveApprovedMessage("org_1", { key: "goodbye", body: "Merci {prenom}" })).rejects.toBeInstanceOf(ValidationError);
    expect(db.upserts).toHaveLength(0);
  });

  it("enregistre approuvé, avec l'auteur et la date, pour CE tenant", async () => {
    await saveApprovedMessage("org_1", { key: "goodbye", register: "tu", body: "  À la prochaine !  " });
    const { row, opts } = db.upserts[0]!;
    expect(row).toMatchObject({ organization_id: "org_1", key: "goodbye", register: "tu", emoji_level: "any", body: "À la prochaine !", status: "approved", source: "owner", approved_by: "user_1" });
    expect(typeof row.approved_at).toBe("string");
    expect(opts).toEqual({ onConflict: "organization_id,key,register,emoji_level" });
  });

  it("suppression : filtrée par organisation, clé et ton ; réservée propriétaire / administrateur", async () => {
    await removeMessageOverride("org_1", { key: "goodbye" });
    expect(mockRequireMembership).toHaveBeenCalledWith("org_1", ["owner", "admin"]);
    expect(db.deletes[0]).toEqual({ organization_id: "org_1", key: "goodbye", register: "any", emoji_level: "any" });
  });
});
