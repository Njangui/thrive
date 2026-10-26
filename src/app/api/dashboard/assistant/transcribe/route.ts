import { NextResponse } from "next/server";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { transcribeVoice } from "@/application/services/voice-command-service";
import { MAX_VOICE_BYTES } from "@/application/voice/voice-policy";
import { ValidationError } from "@/lib/errors";
import { errorResponse } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS_BY_REASON = { unavailable: 503, rate_limited: 429, failed: 502, secret_dictated: 422, empty: 422, too_large: 413, too_long: 413, bad_format: 415, empty_audio: 422 } as const;

/**
 * Dictée dans le chat du dashboard : le vocal est transcrit puis le TEXTE revient dans la zone
 * de saisie, où l'utilisateur le relit et le corrige avant envoi. Rien n'est enregistré ici
 * (ni audio, ni texte) ; l'envoi suit le chemin normal du chat.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireDashboardActor();
    const form = await request.formData().catch(() => null);
    const file = form?.get("audio");
    if (!(file instanceof File)) throw new ValidationError("Fichier audio manquant");
    if (file.size > MAX_VOICE_BYTES) return NextResponse.json({ error: "Ce vocal est trop volumineux.", reason: "too_large" }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await transcribeVoice({ actor, source: "dashboard", bytes });
    if (result.ok) return NextResponse.json({ text: result.text, language: result.language ?? null });
    return NextResponse.json({ error: result.message, reason: result.reason }, { status: STATUS_BY_REASON[result.reason] });
  } catch (error) {
    return errorResponse(error, "transcribe");
  }
}
