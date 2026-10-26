import { describe, expect, it, vi } from "vitest";
import { transcribeVoice, transcriptEcho, type VoiceDeps } from "./voice-command-service";
import { SpeechUnavailableError } from "@/domain/ports/speech-port";
import type { AgentActor } from "@/application/channels/actor";

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => null }));

const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]);
const actor = { userId: "user-1", tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", membershipId: "mem-1", role: "employee", extraPermissions: [], channel: "telegram" } as unknown as AgentActor;

function deps(over: Partial<VoiceDeps> = {}): VoiceDeps & { transcribe: ReturnType<typeof vi.fn>; onUsage: ReturnType<typeof vi.fn> } {
  const transcribe = vi.fn(async () => ({ text: "  Ajoute une dépense de 5000 FCFA  " }));
  const onUsage = vi.fn();
  return { speech: { transcribe }, rateLimit: async () => null, onUsage, ...over, transcribe } as never;
}

describe("transcribeVoice", () => {
  it("transcrit, normalise, envoie le tenant de l'ACTEUR et le MIME déduit des octets", async () => {
    const d = deps();
    const r = await transcribeVoice({ actor, source: "telegram", bytes: OGG, durationSec: 4 }, d);
    expect(r).toEqual({ ok: true, text: "Ajoute une dépense de 5000 FCFA", language: undefined });
    expect(d.transcribe).toHaveBeenCalledWith({ organizationId: actor.tenantId, audio: OGG, mimeType: "audio/ogg", durationSec: 4 });
  });
  it("n'enregistre que des métadonnées d'usage, jamais le texte", async () => {
    const d = deps();
    await transcribeVoice({ actor, source: "whatsapp", bytes: OGG }, d);
    const event = d.onUsage.mock.calls[0]![0];
    expect(event).toMatchObject({ organizationId: actor.tenantId, userId: "user-1", source: "whatsapp", bytes: OGG.byteLength, chars: 31 });
    expect(JSON.stringify(event)).not.toMatch(/dépense/);
  });
  it("audio invalide : aucun appel au fournisseur", async () => {
    const d = deps();
    expect(await transcribeVoice({ actor, source: "telegram", bytes: new Uint8Array([1, 2, 3]) }, d)).toMatchObject({ ok: false, reason: "bad_format" });
    expect(await transcribeVoice({ actor, source: "telegram", bytes: OGG, durationSec: 999 }, d)).toMatchObject({ ok: false, reason: "too_long" });
    expect(d.transcribe).not.toHaveBeenCalled();
  });
  it("limite de débit : aucun appel au fournisseur (coût)", async () => {
    const d = deps({ rateLimit: async () => 30 });
    expect(await transcribeVoice({ actor, source: "dashboard", bytes: OGG }, d)).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(d.transcribe).not.toHaveBeenCalled();
  });
  it("SpeechPort indisponible (C3 pas encore branché) : message clair", async () => {
    const d = deps(); d.transcribe.mockRejectedValue(new SpeechUnavailableError());
    expect(await transcribeVoice({ actor, source: "telegram", bytes: OGG }, d)).toMatchObject({ ok: false, reason: "unavailable" });
  });
  it("erreur du fournisseur : message générique, détail non exposé", async () => {
    const d = deps(); d.transcribe.mockRejectedValue(new Error("401 clé API sk-secret"));
    const r = await transcribeVoice({ actor, source: "telegram", bytes: OGG }, d);
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect(JSON.stringify(r)).not.toMatch(/sk-secret/);
  });
  it("silence : refus « rien compris »", async () => {
    const d = deps(); d.transcribe.mockResolvedValue({ text: "  \n " });
    expect(await transcribeVoice({ actor, source: "telegram", bytes: OGG }, d)).toMatchObject({ ok: false, reason: "empty" });
  });
  it("PIN dicté : jamais renvoyé à l'appelant", async () => {
    const d = deps(); d.transcribe.mockResolvedValue({ text: "un deux trois 1 2 3 4 5 6" });
    const r = await transcribeVoice({ actor, source: "telegram", bytes: OGG }, d);
    expect(r).toMatchObject({ ok: false, reason: "secret_dictated" });
    expect(JSON.stringify(r)).not.toMatch(/123456|1 2 3/);
  });
  it("un échec d'enregistrement d'usage n'empêche pas la commande", async () => {
    const d = deps(); d.onUsage.mockRejectedValue(new Error("registre en panne"));
    expect(await transcribeVoice({ actor, source: "telegram", bytes: OGG }, d)).toMatchObject({ ok: true });
  });
});

describe("écho", () => {
  it("montre ce qui a été compris, tronqué si très long", () => {
    expect(transcriptEcho("annule la commande 12")).toBe("🎤 J'ai compris : « annule la commande 12 »");
    expect(transcriptEcho("x".repeat(900))).toMatch(/…/);
  });
});
