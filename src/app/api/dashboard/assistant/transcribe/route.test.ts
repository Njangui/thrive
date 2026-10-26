import { beforeEach, describe, expect, it, vi } from "vitest";

const transcribeVoice = vi.fn();
const requireDashboardActor = vi.fn();
vi.mock("@/application/channels/dashboard-actor", () => ({ requireDashboardActor: () => requireDashboardActor() }));
vi.mock("@/application/services/voice-command-service", () => ({ transcribeVoice: (...a: unknown[]) => transcribeVoice(...a) }));

import { POST } from "./route";
import { AuthenticationError } from "@/lib/errors";

const actor = { userId: "u1", tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "employee", channel: "dashboard" };
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2]);
const req = (file?: File) => { const f = new FormData(); if (file) f.set("audio", file); return new Request("http://x/api", { method: "POST", body: f }); };

beforeEach(() => { transcribeVoice.mockReset(); requireDashboardActor.mockReset(); requireDashboardActor.mockResolvedValue(actor); });

describe("POST /api/dashboard/assistant/transcribe", () => {
  it("renvoie le texte transcrit ; l'acteur vient de la session, pas du client", async () => {
    transcribeVoice.mockResolvedValue({ ok: true, text: "annule la commande 12", language: "fr" });
    const res = await POST(req(new File([OGG], "vocal.ogg", { type: "audio/ogg" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "annule la commande 12", language: "fr" });
    expect(transcribeVoice).toHaveBeenCalledWith(expect.objectContaining({ actor, source: "dashboard" }));
  });
  it("sans session : refus, aucune transcription", async () => {
    requireDashboardActor.mockRejectedValue(new AuthenticationError("Accès refusé"));
    const res = await POST(req(new File([OGG], "v.ogg")));
    expect(res.status).toBeGreaterThanOrEqual(401); expect(res.status).toBeLessThanOrEqual(403);
    expect(transcribeVoice).not.toHaveBeenCalled();
  });
  it("fichier manquant : 400", async () => {
    expect((await POST(req())).status).toBe(400); expect(transcribeVoice).not.toHaveBeenCalled();
  });
  it("trop gros : 413 avant même de lire le fichier", async () => {
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "v.ogg");
    const res = await POST(req(big));
    expect(res.status).toBe(413); expect(transcribeVoice).not.toHaveBeenCalled();
  });
  it.each([["unavailable", 503], ["rate_limited", 429], ["bad_format", 415], ["secret_dictated", 422], ["failed", 502]] as const)("échec %s → HTTP %i, message sûr", async (reason, status) => {
    transcribeVoice.mockResolvedValue({ ok: false, reason, message: "Message pour l'utilisateur" });
    const res = await POST(req(new File([OGG], "v.ogg")));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: "Message pour l'utilisateur", reason });
  });
});
