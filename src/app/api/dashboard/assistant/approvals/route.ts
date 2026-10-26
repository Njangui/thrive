import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { decideApprovalFromChat } from "@/application/services/assistant-chat-service";
import { errorResponse } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const base = { messageId: z.string().uuid(), pendingActionId: z.string().min(1).max(100) };
const bodySchema = z.discriminatedUnion("decision", [
  z.object({ ...base, decision: z.literal("approve"), pin: z.string().regex(/^\d{6,8}$/).optional(), linkToken: z.string().min(20).max(200).optional() }),
  z.object({ ...base, decision: z.literal("reject") }),
  z.object({ ...base, decision: z.literal("edit"), edits: z.record(z.string().max(60), z.string().max(500)) }),
]);

const STATUS: Record<string, number> = { not_found: 404, already_decided: 409, expired: 410, step_up_required: 403, step_up_failed: 403, invalid_edits: 400 };

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await requireDashboardActor();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    const result = await decideApprovalFromChat({ actor, ...parsed.data });
    if (result.ok) return NextResponse.json(result);
    return NextResponse.json(result, { status: STATUS[result.reason] ?? 400 });
  } catch (error) {
    return errorResponse(error, "approvals");
  }
}
