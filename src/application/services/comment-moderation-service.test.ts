import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "./__fixtures__/fake-supabase";

const fake = vi.hoisted(() => ({ current: null as unknown }));
const mockRequireMembership = vi.fn();
const mockFindOrCreateOpenLead = vi.fn();

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: () => fake.current }));
vi.mock("./auth-service", () => ({ requireMembership: (...a: unknown[]) => mockRequireMembership(...a) }));
vi.mock("./lead-service", () => ({ findOrCreateOpenLead: (...a: unknown[]) => mockFindOrCreateOpenLead(...a) }));

import { loadCommentSettings, saveCommentSettings, findPostProduct, createLeadFromComment, socialContactKey } from "./comment-moderation-service";
import { DEFAULT_COMMENT_SETTINGS, FAIL_SAFE_COMMENT_SETTINGS } from "./comment-assistant";
import { ValidationError, AuthorizationError } from "@/lib/errors";

const ORG = "org_1";
let db: ReturnType<typeof createFakeSupabase>;
const client = () => db.client;
const DAY = 86_400_000;

beforeEach(() => {
  db = createFakeSupabase({ comment_assistant_settings: [], social_posts: [], products: [], contacts: [] });
  fake.current = client();
  mockRequireMembership.mockReset().mockResolvedValue({ userId: "user_1", organizationId: ORG, role: "owner" });
  mockFindOrCreateOpenLead.mockReset().mockResolvedValue({ id: "lead_1", status: "lead" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("réglages", () => {
  it("rien de réglé : défauts (utiles, n'engagent personne)", async () => {
    expect(await loadCommentSettings(ORG)).toEqual(DEFAULT_COMMENT_SETTINGS);
    expect(DEFAULT_COMMENT_SETTINGS).toMatchObject({ createLeads: false, hideSpam: false, complaintPublicAck: false, replyToPraise: false });
  });

  it("lecture des réglages du commerçant, de CETTE entreprise seulement", async () => {
    db.tables.comment_assistant_settings!.push({ organization_id: ORG, create_leads: true, hide_spam: true }, { organization_id: "org_2", create_leads: false, hide_spam: false, reply_to_praise: true });
    expect(await loadCommentSettings(ORG)).toMatchObject({ createLeads: true, hideSpam: true, replyToPraise: false, usePostProduct: true });
  });

  it("lecture en échec : réglages de repli (aucun comportement nouveau), jamais d'exception", async () => {
    db.state.failTables.add("comment_assistant_settings");
    expect(await loadCommentSettings(ORG)).toEqual(FAIL_SAFE_COMMENT_SETTINGS);
  });

  it("enregistrement réservé propriétaire / administrateur, valeurs conservées d'un appel à l'autre", async () => {
    await saveCommentSettings(ORG, { createLeads: true });
    await saveCommentSettings(ORG, { hideSpam: true });
    expect(mockRequireMembership).toHaveBeenCalledWith(ORG, ["owner", "admin"]);
    expect(db.tables.comment_assistant_settings).toHaveLength(1);
    expect(db.tables.comment_assistant_settings![0]).toMatchObject({ organization_id: ORG, create_leads: true, hide_spam: true });
  });

  it("refuse un réglage inconnu ou non booléen, sans rien écrire", async () => {
    await expect(saveCommentSettings(ORG, { pirate: true } as never)).rejects.toBeInstanceOf(ValidationError);
    await expect(saveCommentSettings(ORG, { createLeads: "oui" } as never)).rejects.toBeInstanceOf(ValidationError);
    expect(db.tables.comment_assistant_settings).toHaveLength(0);
    mockRequireMembership.mockRejectedValue(new AuthorizationError("non"));
    await expect(saveCommentSettings(ORG, { createLeads: true })).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("findPostProduct — produit retrouvé via la publication", () => {
  const post = (over: Record<string, unknown> = {}) => ({ id: "sp1", organization_id: ORG, provider_post_id: "post-1", product_id: "p1", ...over });
  const product = (over: Record<string, unknown> = {}) => ({ id: "p1", organization_id: ORG, name: "Sac cuir", slug: "sac-cuir", unit_price: "15000", compare_at_price: null, promotion_ends_at: null, status: "active", ...over });

  it("renvoie le produit actif de la publication, prix lus en base", async () => {
    db.tables.social_posts!.push(post());
    db.tables.products!.push(product());
    expect(await findPostProduct(ORG, "post-1")).toEqual({ id: "p1", name: "Sac cuir", slug: "sac-cuir", unitPrice: 15000, compareAtPrice: null, isPromo: false });
  });

  it("promotion : prix barré seulement si elle est en cours", async () => {
    db.tables.social_posts!.push(post());
    db.tables.products!.push(product({ compare_at_price: 20000, promotion_ends_at: new Date(Date.now() + DAY).toISOString() }));
    expect(await findPostProduct(ORG, "post-1")).toMatchObject({ compareAtPrice: 20000, isPromo: true });
    db.tables.products![0]!.promotion_ends_at = new Date(Date.now() - DAY).toISOString();
    expect(await findPostProduct(ORG, "post-1")).toMatchObject({ isPromo: false });
    db.tables.products![0]!.promotion_ends_at = null;
    db.tables.products![0]!.compare_at_price = 10000; // prix barré inférieur au prix : pas une promotion
    expect(await findPostProduct(ORG, "post-1")).toMatchObject({ isPromo: false });
  });

  it("produit inactif, supprimé ou publication sans produit : null (on laisse l'orchestrateur répondre)", async () => {
    db.tables.social_posts!.push(post());
    db.tables.products!.push(product({ status: "archived" }));
    expect(await findPostProduct(ORG, "post-1")).toBeNull();
    db.tables.products!.length = 0;
    expect(await findPostProduct(ORG, "post-1")).toBeNull();
    db.tables.social_posts![0]!.product_id = null;
    expect(await findPostProduct(ORG, "post-1")).toBeNull();
    expect(await findPostProduct(ORG, "inconnue")).toBeNull();
  });

  it("ISOLATION : publication ou produit d'une autre entreprise ignorés", async () => {
    db.tables.social_posts!.push(post({ organization_id: "org_2" }));
    db.tables.products!.push(product());
    expect(await findPostProduct(ORG, "post-1")).toBeNull();
    db.tables.social_posts!.length = 0;
    db.tables.social_posts!.push(post());
    db.tables.products![0]!.organization_id = "org_2";
    expect(await findPostProduct(ORG, "post-1")).toBeNull();
  });

  it("ne lève jamais", async () => {
    db.state.failTables.add("social_posts");
    await expect(findPostProduct(ORG, "post-1")).resolves.toBeNull();
  });
});

describe("createLeadFromComment — prospect issu d'une intention d'achat", () => {
  const input = { platform: "facebook", accountId: "acc-1", authorExternalId: "user-9", authorName: "Awa K." };

  it("crée un contact MINIMAL (nom public + clé de plateforme, ni texte ni numéro) puis le lead", async () => {
    expect(await createLeadFromComment(ORG, input)).toBe("lead_1");
    expect(db.tables.contacts).toHaveLength(1);
    expect(db.tables.contacts![0]!).toMatchObject({ organization_id: ORG, full_name: "Awa K.", source_channel: "facebook_comment", metadata: { social_key: "facebook:acc-1:user-9", platform: "facebook", account_id: "acc-1" } });
    expect(Object.keys(db.tables.contacts![0]!).sort()).toEqual(["created_at", "full_name", "id", "metadata", "organization_id", "source_channel"]);
    expect(mockFindOrCreateOpenLead).toHaveBeenCalledWith(ORG, db.tables.contacts![0]!.id, "comment_facebook");
  });

  it("le même commentateur ne crée jamais deux contacts (le lead ouvert est réutilisé)", async () => {
    await createLeadFromComment(ORG, input);
    await createLeadFromComment(ORG, input);
    expect(db.tables.contacts).toHaveLength(1);
    expect(mockFindOrCreateOpenLead).toHaveBeenCalledTimes(2);
  });

  it("course : si un autre commentaire a créé le contact entre-temps, on le retrouve au lieu d'échouer", async () => {
    db.state.failNextInsert.set("contacts", () => db.tables.contacts!.push({ id: "c_race", organization_id: ORG, metadata: { social_key: "facebook:acc-1:user-9" } }));
    expect(await createLeadFromComment(ORG, input)).toBe("lead_1");
    expect(mockFindOrCreateOpenLead).toHaveBeenCalledWith(ORG, "c_race", "comment_facebook");
  });

  it("ISOLATION : un commentateur d'une autre entreprise n'est pas réutilisé", async () => {
    db.tables.contacts!.push({ id: "c_other", organization_id: "org_2", metadata: { social_key: "facebook:acc-1:user-9" } });
    await createLeadFromComment(ORG, input);
    expect(mockFindOrCreateOpenLead.mock.calls[0]![1]).not.toBe("c_other");
  });

  it("auteur inconnu (ni identifiant ni nom) : aucun prospect", async () => {
    expect(await createLeadFromComment(ORG, { platform: "facebook", accountId: "acc-1" })).toBeNull();
    expect(db.tables.contacts).toHaveLength(0);
  });

  it("clé : identifiant de plateforme de préférence ; sinon le nom public normalisé", () => {
    expect(socialContactKey(input)).toBe("facebook:acc-1:user-9");
    expect(socialContactKey({ platform: "tiktok", accountId: "a", authorName: "Élodie Mbarga" })).toBe("tiktok:a:name:elodie-mbarga");
    expect(socialContactKey({ platform: "tiktok", accountId: "a", authorName: "  " })).toBeNull();
  });

  it("ne lève jamais (erreur du lead ou de la base)", async () => {
    mockFindOrCreateOpenLead.mockRejectedValue(new Error("boom"));
    await expect(createLeadFromComment(ORG, input)).resolves.toBeNull();
    db.state.failTables.add("contacts");
    await expect(createLeadFromComment(ORG, input)).resolves.toBeNull();
  });
});
