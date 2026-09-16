import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { processDueFollowUps } from "@/application/services/follow-up-service";

export async function GET(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(auth.body, { status: auth.status });
  }
  try {
    const result = await processDueFollowUps();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/process-follow-ups: échec:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Erreur interne" }, { status: 500 });
  }
}