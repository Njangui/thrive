import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { ZernioClient } from "@/infrastructure/providers/messaging/zernio/client";
import { buildCreateComponents, templateByKey, TEMPLATE_CATALOG, type TemplateKey, type TemplateStatus } from "@/application/channels/whatsapp-templates";
import { notifyOrgAdmins } from "./notification-service";
import { applyProspectingTemplateStatus, defaultProspectingDeps } from "./prospecting-service";

/**
 * Création et suivi d'approbation des modèles WhatsApp du back-office (alerte, demande de
 * validation, bilan du jour). Un modèle n'est utilisable hors fenêtre de 24 h qu'une fois
 * APPROVED par Meta. Le statut est tenu à jour par le webhook `whatsapp.template.status_updated`
 * et par `syncTemplates` (bouton « Actualiser »).
 *
 * DONNÉES ENVOYÉES : le texte de chaque modèle (fixe, sans donnée client) part vers Zernio puis
 * Meta pour revue. Les VALEURS des variables (titre/texte d'alerte) ne partent qu'à l'envoi.
 */

export interface TemplateDeps {
  db: SupabaseClient;
  client: Pick<ZernioClient, "createWhatsAppTemplate" | "listWhatsAppTemplates">;
  notifyAdmins: typeof notifyOrgAdmins;
}
export const defaultTemplateDeps = (): TemplateDeps => ({ db: getSupabaseServiceClient(), client: new ZernioClient(), notifyAdmins: notifyOrgAdmins });

const STATUSES: ReadonlySet<string> = new Set(["PENDING", "APPROVED", "REJECTED", "IN_APPEAL", "PAUSED", "DISABLED", "PENDING_DELETION"]);
const normalizeStatus = (raw: unknown): TemplateStatus => { const s = String(raw ?? "").toUpperCase(); return STATUSES.has(s) ? (s as TemplateStatus) : "PENDING"; };
const BAD: ReadonlySet<string> = new Set(["REJECTED", "PAUSED", "DISABLED"]);

/** Compte WhatsApp (Zernio) portant les modèles : le numéro principal connecté de l'entreprise. */
export async function getTemplateAccountId(db: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data, error } = await db.from("whatsapp_accounts").select("account_id, is_primary").eq("organization_id", organizationId).eq("status", "connected").order("is_primary", { ascending: false }).limit(1);
  if (error) throw new Error(`Modèles WhatsApp: lecture du compte impossible: ${error.message}`);
  return ((data ?? [])[0] as { account_id: string } | undefined)?.account_id ?? null;
}

export interface TemplateView { key: TemplateKey; label: string; name: string; status: TemplateStatus; reason: string | null }

export async function getTemplateStatuses(organizationId: string, db: SupabaseClient = getSupabaseServiceClient()): Promise<TemplateView[]> {
  const { data, error } = await db.from("whatsapp_templates").select("template_key, status, reason").eq("organization_id", organizationId);
  if (error) throw new Error(`Modèles WhatsApp: lecture impossible: ${error.message}`);
  const rows = new Map(((data ?? []) as { template_key: string; status: TemplateStatus; reason: string | null }[]).map((r) => [r.template_key, r]));
  return TEMPLATE_CATALOG.map((t) => ({ key: t.key, label: t.label, name: t.name, status: rows.get(t.key)?.status ?? "NOT_SUBMITTED", reason: rows.get(t.key)?.reason ?? null }));
}

async function upsertRow(deps: TemplateDeps, organizationId: string, key: TemplateKey, patch: Record<string, unknown>): Promise<void> {
  const def = templateByKey(key)!;
  const { error } = await deps.db.from("whatsapp_templates").upsert({ organization_id: organizationId, template_key: key, name: def.name, language: def.language, category: def.category, ...patch }, { onConflict: "organization_id,template_key" });
  if (error) throw new Error(`Modèles WhatsApp: enregistrement impossible: ${error.message}`);
}

export type EnsureResult = { ok: true; submitted: TemplateKey[]; failed: { key: TemplateKey; message: string }[] } | { ok: false; reason: "no_account" };

/** Soumet à Meta (via Zernio) les modèles manquants. Idempotent : un modèle déjà soumis n'est pas recréé. */
export async function ensureTemplates(organizationId: string, deps: TemplateDeps = defaultTemplateDeps(), nowIso: string = new Date().toISOString()): Promise<EnsureResult> {
  const accountId = await getTemplateAccountId(deps.db, organizationId);
  if (!accountId) return { ok: false, reason: "no_account" };
  const current = new Map((await getTemplateStatuses(organizationId, deps.db)).map((t) => [t.key, t.status]));
  const submitted: TemplateKey[] = []; const failed: { key: TemplateKey; message: string }[] = [];
  for (const def of TEMPLATE_CATALOG) {
    if (current.get(def.key) !== "NOT_SUBMITTED") continue;
    try {
      const created = await deps.client.createWhatsAppTemplate({ accountId, name: def.name, category: def.category, language: def.language, components: buildCreateComponents(def) });
      await upsertRow(deps, organizationId, def.key, { status: normalizeStatus(created.status), provider_template_id: created.id ?? null, reason: null, submitted_at: nowIso });
      submitted.push(def.key);
    } catch (e) {
      const message = (e instanceof Error ? e.message : "erreur").slice(0, 300);
      await upsertRow(deps, organizationId, def.key, { status: "NOT_SUBMITTED", reason: message });
      failed.push({ key: def.key, message });
    }
  }
  return { ok: true, submitted, failed };
}

/** Relit l'état réel chez Zernio/Meta et le reporte (rattrape un webhook manqué ou un modèle créé ailleurs). */
export async function syncTemplates(organizationId: string, deps: TemplateDeps = defaultTemplateDeps()): Promise<{ ok: boolean; updated: number }> {
  const accountId = await getTemplateAccountId(deps.db, organizationId);
  if (!accountId) return { ok: false, updated: 0 };
  const remote = await deps.client.listWhatsAppTemplates(accountId);
  let updated = 0;
  for (const def of TEMPLATE_CATALOG) {
    const r = remote.find((t) => t.name === def.name && (!t.language || t.language === def.language));
    if (!r) continue;
    await upsertRow(deps, organizationId, def.key, { status: normalizeStatus(r.status), provider_template_id: r.id ?? null });
    updated += 1;
  }
  return { ok: true, updated };
}

/**
 * Événement `whatsapp.template.status_updated` (CONFIRMÉ : `template.status`, `template.reason`).
 * Le nom/identifiant du modèle dans le payload n'est pas confirmé : s'il manque, on resynchronise
 * plutôt que de deviner. Un modèle refusé/suspendu notifie les propriétaires.
 */
export async function applyTemplateStatusEvent(organizationId: string, event: { name?: string; id?: string; status?: string; reason?: string }, deps: TemplateDeps = defaultTemplateDeps()): Promise<"updated" | "synced" | "ignored"> {
  const def = TEMPLATE_CATALOG.find((t) => t.name === event.name);
  // Modèles de prospection (Flexco sur Flexco) : suivis dans leur propre table.
  if (!def && event.name && (await applyProspectingTemplateStatus(organizationId, event, defaultProspectingDeps()).catch(() => false))) return "updated";
  if (!def && !event.id) { const r = await syncTemplates(organizationId, deps).catch(() => ({ ok: false, updated: 0 })); return r.ok ? "synced" : "ignored"; }
  let key = def?.key;
  if (!key && event.id) {
    const { data } = await deps.db.from("whatsapp_templates").select("template_key").eq("organization_id", organizationId).eq("provider_template_id", event.id).maybeSingle();
    key = (data as { template_key: TemplateKey } | null)?.template_key;
  }
  if (!key) return "ignored"; // modèle étranger à Flexco
  const status = normalizeStatus(event.status);
  const reason = event.reason && event.reason !== "NONE" ? event.reason.slice(0, 500) : null;
  await upsertRow(deps, organizationId, key, { status, reason });
  if (BAD.has(status)) {
    await deps.notifyAdmins({ organizationId, title: "Modèle WhatsApp à corriger", body: `Le modèle « ${templateByKey(key)!.label} » est ${status === "REJECTED" ? "refusé" : "suspendu"} par Meta${reason ? ` : ${reason}` : ""}. Les messages hors fenêtre de 24 h ne partiront pas.`, relatedEntityType: "provider_connection", priority: "important" });
  }
  return "updated";
}
