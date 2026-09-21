import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { processPendingFirstComments } from "@/application/services/first-comment-service";

export const maxDuration = 60;

/** Lot O — premiers commentaires TikTok en attente de l'URL de la vidéo (fréquence conseillée : 5 à 10 min). */
export async function GET(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(auth.body, { status: auth.status });
  }
  try {
    const result = await processPendingFirstComments();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/process-first-comments: échec:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Erreur interne" }, { status: 500 });
  }
}
