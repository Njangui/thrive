import { z } from "zod";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { streamAssistantTurn, MAX_MESSAGE_CHARS } from "@/application/services/assistant-chat-service";
import { isOwnAttachmentPath } from "@/application/services/assistant-attachment-service";
import { errorResponse } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const attachmentSchema = z.object({
  kind: z.enum(["image", "audio", "document"]),
  path: z.string().min(1).max(300),
  name: z.string().min(1).max(120),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().positive().max(4 * 1024 * 1024),
});
const bodySchema = z.object({
  threadId: z.string().uuid(),
  text: z.string().max(MAX_MESSAGE_CHARS + 1000).default(""),
  clientMessageId: z.string().uuid().optional(),
  attachments: z.array(attachmentSchema).max(3).default([]),
});

/** Flux NDJSON : une trame JSON par ligne (compatible fetch + ReadableStream, y compris mobile). */
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireDashboardActor();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Requête invalide" }, { status: 400 });
    const { threadId, text, clientMessageId, attachments } = parsed.data;
    // Un chemin de pièce jointe ne vient JAMAIS du client tel quel : il doit désigner un fichier de CE tenant.
    if (attachments.some((a) => !isOwnAttachmentPath(actor.tenantId, a.path))) return Response.json({ error: "Pièce jointe invalide" }, { status: 400 });

    const encoder = new TextEncoder();
    const generator = streamAssistantTurn({ actor, threadId, text, attachments, clientMessageId, signal: request.signal });
    // Première trame lue AVANT d'ouvrir le flux : les erreurs de validation/accès deviennent de vrais statuts HTTP.
    const first = await generator.next();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!first.done) controller.enqueue(encoder.encode(`${JSON.stringify(first.value)}\n`));
          if (!first.done) for await (const frame of generator) controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        } catch (error) {
          console.error("[api/assistant/stream] flux interrompu:", error);
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", code: "internal", message: "Une erreur est survenue." })}\n`));
        } finally {
          controller.close();
        }
      },
      async cancel() { await generator.return(undefined); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return errorResponse(error, "stream");
  }
}
