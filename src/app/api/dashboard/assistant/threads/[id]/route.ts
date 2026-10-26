import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { archiveThread, getThreadMessages } from "@/application/services/assistant-chat-service";
import { getStorageProvider } from "@/infrastructure/providers/registry";
import { errorResponse } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
    const actor = await requireDashboardActor();
    const storage = await getStorageProvider(actor.tenantId);
    const messages = await getThreadMessages(actor, id, { db: (await import("@/infrastructure/supabase/server-client")).getSupabaseServiceClient(), resolveUrl: (org, path) => storage.getUrl(org, path) });
    return NextResponse.json({ messages });
  } catch (error) { return errorResponse(error, "thread"); }
}
export async function DELETE(_req: Request, { params }: Ctx): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Conversation introuvable" }, { status: 404 });
    await archiveThread(await requireDashboardActor(), id);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error, "thread"); }
}
