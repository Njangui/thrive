import { NextResponse } from "next/server";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { uploadAssistantAttachment } from "@/application/services/assistant-attachment-service";
import { checkRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/errors";
import { errorResponse } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireDashboardActor();
    const retryAfter = await checkRateLimit("assistant_upload", actor.userId);
    if (retryAfter !== null) return NextResponse.json({ error: `Trop d'envois. Réessayez dans ${retryAfter} s.` }, { status: 429 });
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ValidationError("Fichier manquant");
    return NextResponse.json({ attachment: await uploadAssistantAttachment(actor, file) });
  } catch (error) {
    return errorResponse(error, "upload");
  }
}
