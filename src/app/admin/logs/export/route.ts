import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/application/services/platform-admin-service";
import { getRecentAuditLogs, formatAuditLogsAsCsv } from "@/application/services/admin-observability-service";
import { AppError, toClientErrorResponse } from "@/lib/errors";

/**
 * Export CSV du journal d'activité (Lot H, Partie 3) — complète la console
 * admin au-delà du strict minimum demandé par le cahier, mais reste un
 * export PASSIF de données déjà affichées sur `/admin/logs` : ce n'est PAS
 * de l'alerting temps réel (explicitement hors scope du cahier), juste un
 * téléchargement à la demande. Même limite que `/admin/logs` (500 lignes
 * max) — un vrai export volumineux nécessiterait de la pagination
 * serveur/streaming, hors de portée d'un export ponctuel pour une poignée
 * de tenants pilotes (docs/SECURITY.md).
 */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin();

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || undefined;
    const entityType = searchParams.get("entityType") || undefined;

    const logs = await getRecentAuditLogs(500, { action, entityType });
    const csv = formatAuditLogsAsCsv(logs);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="journal-activite.csv"',
      },
    });
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("Export CSV audit_logs: erreur inattendue:", error);
    }
    const { status, body } = toClientErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
