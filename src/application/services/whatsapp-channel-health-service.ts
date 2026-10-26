import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { classifyFailure } from "@/application/channels/whatsapp-templates";

/**
 * Diagnostic du canal WhatsApp : échecs de livraison, restriction/qualité du compte, alertes Meta,
 * modèles refusés. Alimente la bannière du dashboard. Aucune donnée client stockée : seulement le
 * texte d'erreur tronqué (500 car.) et un identifiant de message.
 *
 * À CONFIRMER (contrainte plateforme n° 11) : l'absence de moyen de paiement chez Meta n'a pas
 * d'événement dédié chez Zernio. On la PRÉSUME à partir du texte d'erreur (code Meta 131042) et on
 * l'affiche comme présomption, jamais comme certitude.
 */

export type DiagnosticSeverity = "error" | "warning";
export interface Diagnostic { code: string; severity: DiagnosticSeverity; message: string }

export async function recordDeliveryFailure(db: SupabaseClient, input: { organizationId: string; externalMessageId?: string; errorMessage?: string }): Promise<void> {
  const { error } = await db.from("whatsapp_delivery_failures").insert({
    organization_id: input.organizationId, external_message_id: input.externalMessageId ?? null,
    error_message: input.errorMessage?.slice(0, 500) ?? null, probable_cause: classifyFailure(input.errorMessage),
  });
  if (error) console.warn("[whatsapp-health] échec de livraison non enregistré:", error.message);
}

const str = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);

/** Événements `whatsapp.account.*` (noms et champs CONFIRMÉS par docs.zernio.com/webhooks/whatsapp). */
export async function applyAccountEvent(db: SupabaseClient, organizationId: string, raw: Record<string, unknown>, nowIso: string): Promise<boolean> {
  const event = String(raw.event ?? "");
  const patch: Record<string, unknown> = { organization_id: organizationId, updated_at: nowIso };
  if (event === "whatsapp.account.status_updated") {
    const s = obj(raw.status);
    patch.account_status = s?.status === "restricted" ? "restricted" : "active";
    const r = s?.restrictions;
    patch.restrictions = Array.isArray(r) ? r.map((x) => str(obj(x)?.type ?? obj(x)?.restriction ?? x, 80)).filter(Boolean).join(", ").slice(0, 500) || null : str(s?.metaEvent);
  } else if (event === "whatsapp.account.quality_updated") {
    const q = String(obj(raw.quality)?.qualityRating ?? "");
    patch.quality_rating = ["GREEN", "YELLOW", "RED"].includes(q) ? q : null;
  } else if (event === "whatsapp.account.alert_received") {
    const a = obj(raw.alert);
    const sev = String(a?.severity ?? "");
    patch.last_alert_severity = ["CRITICAL", "WARNING", "INFORMATIONAL"].includes(sev) ? sev : null;
    patch.last_alert_description = str(a?.description) ?? str(a?.type);
    patch.last_alert_at = nowIso;
  } else return false;
  const { error } = await db.from("whatsapp_channel_health").upsert(patch, { onConflict: "organization_id" });
  if (error) throw new Error(`Santé WhatsApp: enregistrement impossible: ${error.message}`);
  return true;
}

export interface HealthInput {
  health: { account_status?: string; restrictions?: string | null; quality_rating?: string | null; last_alert_severity?: string | null; last_alert_description?: string | null; last_alert_at?: string | null } | null;
  failures24h: { probable_cause: string }[];
  badTemplates: { label: string; status: string }[];
  nowMs: number;
}

/** Pure : transforme l'état en diagnostics ordonnés (erreurs d'abord). */
export function buildDiagnostics(i: HealthInput): Diagnostic[] {
  const out: Diagnostic[] = [];
  const h = i.health;
  if (h?.account_status === "restricted") out.push({ code: "account_restricted", severity: "error", message: `Meta a restreint votre compte WhatsApp Business${h.restrictions ? ` (${h.restrictions})` : ""}. Certains envois peuvent être bloqués : consultez le Gestionnaire d'entreprise Meta.` });
  if (i.failures24h.some((f) => f.probable_cause === "payment")) out.push({ code: "payment_probable", severity: "error", message: "Des messages ont été refusés : il manque probablement un moyen de paiement sur votre compte WhatsApp Business (présomption, à confirmer dans le Gestionnaire d'entreprise Meta)." });
  const other = i.failures24h.filter((f) => f.probable_cause !== "payment");
  if (other.length >= 3) out.push({ code: "delivery_failures", severity: "warning", message: `${other.length} messages WhatsApp n'ont pas pu être délivrés ces dernières 24 h. Vérifiez la connexion du numéro.` });
  if (h?.quality_rating === "RED") out.push({ code: "quality_red", severity: "warning", message: "La qualité de votre numéro WhatsApp est basse : Meta peut limiter vos envois." });
  const ageOk = h?.last_alert_at && i.nowMs - Date.parse(h.last_alert_at) < 7 * 86_400_000;
  if (h?.last_alert_severity === "CRITICAL" && ageOk) out.push({ code: "meta_alert", severity: "error", message: `Alerte Meta : ${h.last_alert_description ?? "voir le Gestionnaire d'entreprise"}.` });
  for (const t of i.badTemplates) out.push({ code: `template_${t.status.toLowerCase()}`, severity: "warning", message: `Le modèle WhatsApp « ${t.label} » est ${t.status === "REJECTED" ? "refusé" : "suspendu"} : les messages hors fenêtre de 24 h ne partiront pas.` });
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

export async function getChannelDiagnostics(organizationId: string, db: SupabaseClient = getSupabaseServiceClient(), nowMs: number = Date.now()): Promise<Diagnostic[]> {
  const since = new Date(nowMs - 86_400_000).toISOString();
  const [h, f, t] = await Promise.all([
    db.from("whatsapp_channel_health").select("account_status, restrictions, quality_rating, last_alert_severity, last_alert_description, last_alert_at").eq("organization_id", organizationId).maybeSingle(),
    db.from("whatsapp_delivery_failures").select("probable_cause").eq("organization_id", organizationId).gte("created_at", since),
    db.from("whatsapp_templates").select("template_key, status").eq("organization_id", organizationId).in("status", ["REJECTED", "PAUSED", "DISABLED"]),
  ]);
  if (h.error || f.error || t.error) return []; // un diagnostic ne doit jamais casser le dashboard
  const labels: Record<string, string> = { alert: "Alerte", approval_request: "Demande de validation", daily_summary: "Bilan du jour" };
  return buildDiagnostics({
    health: h.data as HealthInput["health"], failures24h: (f.data ?? []) as { probable_cause: string }[], nowMs,
    badTemplates: ((t.data ?? []) as { template_key: string; status: string }[]).map((r) => ({ label: labels[r.template_key] ?? r.template_key, status: r.status })),
  });
}
