import { NextResponse } from "next/server";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { createThread, listThreads } from "@/application/services/assistant-chat-service";
import { errorResponse } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try { return NextResponse.json({ threads: await listThreads(await requireDashboardActor()) }); }
  catch (error) { return errorResponse(error, "threads"); }
}
export async function POST(): Promise<NextResponse> {
  try { return NextResponse.json({ thread: await createThread(await requireDashboardActor()) }, { status: 201 }); }
  catch (error) { return errorResponse(error, "threads"); }
}
