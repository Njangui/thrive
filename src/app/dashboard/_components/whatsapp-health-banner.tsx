import Link from "next/link";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getChannelDiagnostics } from "@/application/services/whatsapp-channel-health-service";

/**
 * Bandeau de diagnostic du canal WhatsApp (C2 étape 5) : échecs de livraison, restriction du compte,
 * modèles refusés, moyen de paiement Meta probablement manquant (présomption). Réservé aux
 * propriétaires/admins ; invisible quand tout va bien ; ne casse jamais le dashboard.
 */
async function loadIssues(organizationId: string, userId: string) {
  try {
    const db = getSupabaseServiceClient();
    const { data } = await db.from("memberships").select("role").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
    const role = (data as { role?: string } | null)?.role;
    if (role !== "owner" && role !== "admin") return [];
    return await getChannelDiagnostics(organizationId, db);
  } catch (e) {
    console.warn("[whatsapp-health-banner] diagnostic indisponible:", e instanceof Error ? e.message : e);
    return [];
  }
}

export async function WhatsAppHealthBanner({ organizationId, userId }: { organizationId: string; userId: string }) {
  const issues = await loadIssues(organizationId, userId);
  if (issues.length === 0) return null;
  const hasError = issues.some((i) => i.severity === "error");
  return (
    <div role="alert" className={`border-b px-4 py-2.5 text-sm sm:px-6 ${hasError ? "border-red-600/20 bg-red-50 text-red-900" : "border-amber-600/20 bg-amber-50 text-amber-900"}`}>
      <span className="font-semibold">WhatsApp — à vérifier</span>
      <ul className="mt-1 list-disc pl-5">{issues.slice(0, 3).map((i) => <li key={i.code}>{i.message}</li>)}</ul>
      <Link href="/dashboard/security/whatsapp" className="mt-1 inline-block font-medium underline underline-offset-2">Voir le détail</Link>
    </div>
  );
}
