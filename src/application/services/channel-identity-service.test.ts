import { describe, it, expect, beforeEach } from "vitest";
import { FakeDb } from "../../../tests/helpers/fake-supabase";
import {
  consumeChannelLinkCode,
  generateChannelLinkCode,
  listChannelIdentities,
  resolveActor,
  revokeChannelIdentity,
  revokeOwnChannelIdentities,
} from "./channel-identity-service";
import { hashSecret } from "@/application/channels/channel-codes";
import type { SupabaseClient } from "@supabase/supabase-js";

const ORG_A = "org-a";
const ORG_B = "org-b";
let db: FakeDb;
const client = () => db as unknown as SupabaseClient;

function identity(overrides: Record<string, unknown> = {}) {
  return {
    id: "idn-1",
    organization_id: ORG_A,
    membership_id: "mem-1",
    user_id: "user-1",
    channel: "telegram",
    external_id: "555",
    status: "active",
    memberships: { role: "manager", extra_permissions: { manage_ai: true, nope: false } },
    organizations: { status: "active", name: "Boutique A" },
    ...overrides,
  };
}

beforeEach(() => {
  db = new FakeDb();
  db.seed("memberships", [
    { id: "mem-1", organization_id: ORG_A, user_id: "user-1", role: "manager" },
    { id: "mem-2", organization_id: ORG_A, user_id: "user-2", role: "employee" },
    { id: "mem-3", organization_id: ORG_A, user_id: "user-3", role: "admin" },
  ]);
});

describe("generateChannelLinkCode", () => {
  it("stocke uniquement le hachage du code, jamais le clair, avec expiration à 10 min", async () => {
    const now = Date.parse("2026-10-07T10:00:00Z");
    const res = await generateChannelLinkCode({ organizationId: ORG_A, userId: "user-1", channel: "telegram" }, client(), () => now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stored = db.rows("channel_link_codes")[0]!;
    expect(stored.code_hash).toBe(hashSecret(res.code));
    expect(JSON.stringify(stored)).not.toContain(res.code);
    expect(stored.membership_id).toBe("mem-1");
    expect(new Date(res.expiresAt).getTime() - now).toBe(10 * 60 * 1000);
  });

  it("n'autorise qu'un code actif : le précédent non consommé est supprimé", async () => {
    await generateChannelLinkCode({ organizationId: ORG_A, userId: "user-1", channel: "telegram" }, client());
    await generateChannelLinkCode({ organizationId: ORG_A, userId: "user-1", channel: "telegram" }, client());
    expect(db.rows("channel_link_codes")).toHaveLength(1);
  });

  it("limite à 5 générations par heure et par canal", async () => {
    const stamp = new Date().toISOString();
    db.seed(
      "channel_link_codes",
      Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, membership_id: "mem-1", channel: "telegram", created_at: stamp, consumed_at: "x" })),
    );
    const res = await generateChannelLinkCode({ organizationId: ORG_A, userId: "user-1", channel: "telegram" }, client());
    expect(res).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("refuse un utilisateur qui n'est pas membre du tenant", async () => {
    const res = await generateChannelLinkCode({ organizationId: ORG_B, userId: "user-1", channel: "telegram" }, client());
    expect(res).toEqual({ ok: false, reason: "membership_not_found" });
    expect(db.rows("channel_link_codes")).toHaveLength(0);
  });
});

describe("consumeChannelLinkCode", () => {
  it("envoie le hachage du code NORMALISÉ et l'identifiant normalisé à la fonction SQL", async () => {
    db.rpcHandlers.consume_channel_link_code = () => ({
      data: { id: "idn-9", organization_id: ORG_A, membership_id: "mem-1" },
      error: null,
    });
    const res = await consumeChannelLinkCode({ code: "ab12-cd34 ef", channel: "telegram", externalId: 777 }, client());
    expect(res).toEqual({ ok: true, identityId: "idn-9", organizationId: ORG_A, membershipId: "mem-1" });
    expect(db.rpcCalls[0]!.args).toMatchObject({ p_code_hash: hashSecret("AB12CD34EF"), p_channel: "telegram", p_external_id: "777" });
  });

  it.each([
    ["CODE_INVALID", "invalid_code"],
    ["CODE_CONSUMED", "code_consumed"],
    ["CODE_EXPIRED", "code_expired"],
    ["IDENTITY_ALREADY_LINKED", "identity_already_linked"],
  ])("traduit l'exception SQL %s en %s", async (sqlMessage, reason) => {
    db.rpcHandlers.consume_channel_link_code = () => ({ data: null, error: { message: sqlMessage } });
    expect(await consumeChannelLinkCode({ code: "AB12CD34EF", channel: "telegram", externalId: 1 }, client())).toEqual({ ok: false, reason });
  });

  it("n'appelle jamais la base pour un code ou un identifiant mal formé", async () => {
    expect(await consumeChannelLinkCode({ code: "nope", channel: "telegram", externalId: 1 }, client())).toEqual({ ok: false, reason: "invalid_code" });
    expect(await consumeChannelLinkCode({ code: "AB12CD34EF", channel: "telegram", externalId: "@x" }, client())).toEqual({
      ok: false,
      reason: "invalid_identifier",
    });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("propage une erreur SQL inattendue au lieu de l'avaler", async () => {
    db.rpcHandlers.consume_channel_link_code = () => ({ data: null, error: { message: "connexion perdue" } });
    await expect(consumeChannelLinkCode({ code: "AB12CD34EF", channel: "telegram", externalId: 1 }, client())).rejects.toThrow(/connexion perdue/);
  });
});

describe("resolveActor", () => {
  it("résout l'acteur avec rôle, tenant et permissions normalisées", async () => {
    db.seed("channel_identities", [identity()]);
    const res = await resolveActor({ channel: "telegram", externalId: 555 }, client());
    expect(res).toMatchObject({
      kind: "resolved",
      identityId: "idn-1",
      actor: { userId: "user-1", tenantId: ORG_A, membershipId: "mem-1", role: "manager", extraPermissions: ["manage_ai"], channel: "telegram" },
    });
  });

  it("ne résout JAMAIS une identité révoquée ni en attente de vérification", async () => {
    db.seed("channel_identities", [identity({ status: "revoked" }), identity({ id: "idn-2", external_id: "556", status: "pending" })]);
    expect(await resolveActor({ channel: "telegram", externalId: 555 }, client())).toEqual({ kind: "unknown" });
    expect(await resolveActor({ channel: "telegram", externalId: 556 }, client())).toEqual({ kind: "unknown" });
  });

  it("ne confond pas les canaux : un id Telegram n'est pas un numéro WhatsApp", async () => {
    db.seed("channel_identities", [identity()]);
    expect(await resolveActor({ channel: "whatsapp", externalId: "+237690123456" }, client())).toEqual({ kind: "unknown" });
  });

  it("refuse tout pilotage quand le tenant est suspendu ou résilié", async () => {
    db.seed("channel_identities", [identity({ organizations: { status: "suspended", name: "X" } })]);
    expect(await resolveActor({ channel: "telegram", externalId: 555 }, client())).toEqual({ kind: "tenant_inactive" });
  });

  it("signale l'ambiguïté quand l'identité est liée à plusieurs tenants, et lève l'ambiguïté avec organizationId", async () => {
    db.seed("channel_identities", [
      identity(),
      identity({ id: "idn-2", organization_id: ORG_B, membership_id: "mem-b", organizations: { status: "active", name: "Salon B" } }),
    ]);
    const ambiguous = await resolveActor({ channel: "telegram", externalId: 555 }, client());
    expect(ambiguous.kind).toBe("ambiguous");
    if (ambiguous.kind === "ambiguous") expect(ambiguous.organizations.map((o) => o.organizationId).sort()).toEqual([ORG_A, ORG_B]);

    const chosen = await resolveActor({ channel: "telegram", externalId: 555, organizationId: ORG_B }, client());
    expect(chosen).toMatchObject({ kind: "resolved", actor: { tenantId: ORG_B } });
  });

  it("ignore un tenant suspendu quand un autre tenant est utilisable", async () => {
    db.seed("channel_identities", [
      identity({ organizations: { status: "cancelled", name: "Ancien" } }),
      identity({ id: "idn-2", organization_id: ORG_B, organizations: { status: "active", name: "B" } }),
    ]);
    expect(await resolveActor({ channel: "telegram", externalId: 555 }, client())).toMatchObject({ kind: "resolved", actor: { tenantId: ORG_B } });
  });

  it("un identifiant invalide est inconnu sans requête", async () => {
    expect(await resolveActor({ channel: "whatsapp", externalId: "pas-un-numero" }, client())).toEqual({ kind: "unknown" });
  });
});

describe("révocation", () => {
  beforeEach(() => {
    db.rpcHandlers.revoke_channel_identity = (args) => {
      const row = db.rows("channel_identities").find((r) => r.id === args.p_identity_id && r.organization_id === args.p_organization_id);
      if (!row || row.status === "revoked") return { data: false, error: null };
      row.status = "revoked";
      return { data: true, error: null };
    };
    db.seed("channel_identities", [identity({ user_id: "user-2", membership_id: "mem-2", id: "idn-emp" })]);
  });

  it("un employé ne peut pas révoquer l'identité d'un collègue", async () => {
    const res = await revokeChannelIdentity({ organizationId: ORG_A, identityId: "idn-emp", callerUserId: "user-1" }, client());
    expect(res).toEqual({ ok: false, reason: "forbidden" });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("un membre révoque sa propre identité", async () => {
    expect(await revokeChannelIdentity({ organizationId: ORG_A, identityId: "idn-emp", callerUserId: "user-2" }, client())).toEqual({ ok: true });
  });

  it("owner/admin révoque l'identité d'un membre de son tenant", async () => {
    expect(await revokeChannelIdentity({ organizationId: ORG_A, identityId: "idn-emp", callerUserId: "user-3" }, client())).toEqual({ ok: true });
  });

  it("un admin d'un AUTRE tenant ne peut pas révoquer (identité introuvable pour lui)", async () => {
    db.seed("memberships", [{ id: "mem-x", organization_id: ORG_B, user_id: "user-x", role: "owner" }]);
    expect(await revokeChannelIdentity({ organizationId: ORG_B, identityId: "idn-emp", callerUserId: "user-x" }, client())).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(db.rows("channel_identities")[0]!.status).toBe("active");
  });

  it("révoquer deux fois est idempotent côté résultat (not_found la seconde fois)", async () => {
    await revokeChannelIdentity({ organizationId: ORG_A, identityId: "idn-emp", callerUserId: "user-2" }, client());
    expect(await revokeChannelIdentity({ organizationId: ORG_A, identityId: "idn-emp", callerUserId: "user-2" }, client())).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("/deconnecter révoque l'identité de l'expéditeur dans TOUS les tenants où elle est liée, et seulement la sienne", async () => {
    db.tables.channel_identities = [];
    db.seed("channel_identities", [
      identity({ id: "idn-a", organization_id: ORG_A, external_id: "555", user_id: "user-1" }),
      identity({ id: "idn-b", organization_id: ORG_B, external_id: "555", user_id: "user-1" }),
      identity({ id: "idn-autre", organization_id: ORG_A, external_id: "999", user_id: "user-2" }),
    ]);
    expect(await revokeOwnChannelIdentities({ channel: "telegram", externalId: 555 }, client())).toBe(2);
    const status = Object.fromEntries(db.rows("channel_identities").map((r) => [r.id as string, r.status]));
    expect(status).toEqual({ "idn-a": "revoked", "idn-b": "revoked", "idn-autre": "active" });
  });
});

describe("listChannelIdentities", () => {
  beforeEach(() => {
    db.seed("channel_identities", [
      { id: "i1", organization_id: ORG_A, user_id: "user-1", channel: "telegram", external_id: "555", status: "active", display_label: "@marc", linked_at: "2026-10-01", last_seen_at: null },
      { id: "i2", organization_id: ORG_A, user_id: "user-2", channel: "telegram", external_id: "666", status: "active", display_label: "@awa", linked_at: "2026-10-02", last_seen_at: null },
      { id: "i3", organization_id: ORG_B, user_id: "user-9", channel: "telegram", external_id: "777", status: "active", display_label: "@autre", linked_at: "2026-10-03", last_seen_at: null },
      { id: "i4", organization_id: ORG_A, user_id: "user-2", channel: "whatsapp", external_id: "+237600000000", status: "revoked", display_label: null, linked_at: "2026-09-01", last_seen_at: null },
    ]);
    db.seed("profiles", [{ id: "user-2", full_name: "Awa N." }]);
  });
  it("un membre simple ne voit que ses propres identités", async () => {
    const list = await listChannelIdentities({ tenantId: ORG_A, userId: "user-2", role: "employee" }, client());
    expect(list.map((i) => i.id)).toEqual(["i2"]);
  });
  it("owner/admin voit tout son tenant (jamais un autre), avec le nom des autres membres", async () => {
    const list = await listChannelIdentities({ tenantId: ORG_A, userId: "user-1", role: "owner" }, client());
    expect(list.map((i) => i.id).sort()).toEqual(["i1", "i2"]);
    expect(list.find((i) => i.id === "i2")).toMatchObject({ mine: false, memberName: "Awa N." });
    expect(list.find((i) => i.id === "i1")).toMatchObject({ mine: true, memberName: null });
  });
  it("n'expose jamais l'identifiant externe ni les identités révoquées", async () => {
    const list = await listChannelIdentities({ tenantId: ORG_A, userId: "user-1", role: "admin" }, client());
    expect(JSON.stringify(list)).not.toMatch(/555|666|\+2376/);
    expect(list.some((i) => i.id === "i4")).toBe(false);
  });
});
