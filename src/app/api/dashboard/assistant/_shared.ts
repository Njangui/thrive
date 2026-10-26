import { NextResponse } from "next/server";
import { toClientErrorResponse } from "@/lib/errors";

/** Réponse d'erreur uniforme : détail réel dans les logs, message sûr au client. */
export function errorResponse(error: unknown, scope: string): NextResponse {
  const mapped = toClientErrorResponse(error);
  if (mapped.status >= 500) console.error(`[api/assistant/${scope}]`, error);
  return NextResponse.json(mapped.body, { status: mapped.status });
}
