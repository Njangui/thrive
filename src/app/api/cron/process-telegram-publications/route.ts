import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { processScheduledTelegramPublications } from "@/application/services/telegram-publication-service";

// Une publication vidéo relit le fichier chez Zernio (jusqu'à 50 Mo) puis le
// téléverse chez Telegram : bien plus long que la limite par défaut d'une fonction.
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) return NextResponse.json(auth.body, { status: auth.status });

  try {
    const result = await processScheduledTelegramPublications();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/process-telegram-publications: échec:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "processing_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
