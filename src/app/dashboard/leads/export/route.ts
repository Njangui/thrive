import { NextResponse } from "next/server";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { listAllLeadsForExport } from "@/application/services/lead-service";
import { buildLeadsCsv } from "@/application/services/contact-identity";
import { AppError, toClientErrorResponse } from "@/lib/errors";

// Mêmes libellés que l'écran /dashboard/leads.
const STATUS_LABELS: Record<string, string> = {
  visitor: "Visiteur",
  lead: "Prospect",
  qualified: "Qualifié",
  opportunity: "Opportunité",
  customer: "Client",
  lost: "Perdu",
};

/**
 * Export CSV de TOUT le CRM de l'organisation courante (toutes les lignes,
 * pas seulement la page affichée). Mêmes rôles que l'écran Clients.
 * Le contenu vient d'un tiers (noms de prospects) : voir csvCell() pour la
 * neutralisation des formules.
 */
export async function GET() {
  try {
    const { organizationId } = await requireCurrentOrganization();
    await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);

    const { rows, truncated } = await listAllLeadsForExport(organizationId);
    const csv = buildLeadsCsv(rows, STATUS_LABELS);
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="crm-${stamp}.csv"`,
        "Cache-Control": "no-store",
        // Jamais un export tronqué en silence : l'en-tête le signale (limite de sécurité mémoire).
        ...(truncated ? { "X-Export-Truncated": "true" } : {}),
      },
    });
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("Export CSV CRM: erreur inattendue:", error);
    }
    const { status, body } = toClientErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
