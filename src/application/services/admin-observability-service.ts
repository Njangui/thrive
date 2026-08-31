import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { countOrganizationRows } from "./plans-repository";

/**
 * Observabilité Super Admin (Lot H, Partie 3 — master prompt section 92,
 * gaps §60-61 de GAP_ANALYSIS_V2.md). Étend la console `/admin/*` du Lot C
 * sans toucher à `admin-organizations-service.ts` ni `admin-overview-service.ts`
 * (chacun garde son périmètre — voir ces fichiers). Réservé à
 * `requirePlatformAdmin()`, appelé par CHAQUE page qui utilise ce service
 * (jamais uniquement par le layout parent — même convention que le reste
 * de `/admin/*`).
 *
 * Hors scope explicite du cahier Lot H : alerting temps réel (Slack/email)
 * sur les erreurs — ce fichier reste un affichage passif de ce qui existe
 * déjà en base (`audit_logs`, comptages), rien de proactif.
 */

export interface AdminAuditLogEntry {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogFilters {
  action?: string;
  entityType?: string;
}

const DEFAULT_AUDIT_LOG_LIMIT = 100;

/**
 * Lecture de `audit_logs` tous tenants confondus (table déjà créée par
 * 0006_webhooks_and_audit.sql, déjà alimentée par
 * `admin-organizations-service.ts::writeAdminAuditLog`). Filtrage optionnel
 * par `action`/`entity_type` — reflète les query params de `/admin/logs`
 * (simple `<select>` + rechargement serveur, pas de librairie de filtre,
 * cohérent avec le reste de la console admin).
 */
export async function getRecentAuditLogs(
  limit = DEFAULT_AUDIT_LOG_LIMIT,
  filters: AuditLogFilters = {},
): Promise<AdminAuditLogEntry[]> {
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("audit_logs")
    .select("id, organization_id, actor_user_id, action, entity_type, entity_id, before_state, after_state, created_at, organizations(name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture audit_logs: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: (row as unknown as { organizations?: { name?: string } }).organizations?.name ?? null,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeState: row.before_state as Record<string, unknown> | null,
    afterState: row.after_state as Record<string, unknown> | null,
    createdAt: row.created_at,
  }));
}

// Échantillon volontairement simple pour peupler les <select> de filtre —
// même arbitrage documenté que `RECENT_ACTIVITY_SAMPLE_SIZE` dans
// admin-organizations-service.ts : suffisant "cohérent avec un seul tenant
// pilote" (docs/SECURITY.md), un vrai `SELECT DISTINCT` nécessiterait une
// fonction RPC dédiée pour ce volume, sur-ingénierie prématurée ici.
const FILTER_OPTIONS_SAMPLE_SIZE = 500;

export interface AuditLogFilterOptions {
  actions: string[];
  entityTypes: string[];
}

/** Valeurs distinctes déjà vues, pour peupler les `<select>` de `/admin/logs`. */
export async function listAuditLogFilterOptions(): Promise<AuditLogFilterOptions> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("action, entity_type")
    .order("created_at", { ascending: false })
    .limit(FILTER_OPTIONS_SAMPLE_SIZE);

  if (error) {
    console.warn("listAuditLogFilterOptions: lecture échouée:", error.message);
    return { actions: [], entityTypes: [] };
  }

  const rows = (data ?? []) as { action: string; entity_type: string | null }[];
  const actions = Array.from(new Set(rows.map((r) => r.action))).sort();
  const entityTypes = Array.from(
    new Set(rows.map((r) => r.entity_type).filter((v): v is string => Boolean(v))),
  ).sort();

  return { actions, entityTypes };
}

/**
 * Sérialise des entrées d'audit log en CSV (export depuis `/admin/logs`,
 * complète la console admin au-delà du strict minimum demandé — reste un
 * export passif, pas de l'alerting, donc ne franchit pas le "hors scope"
 * du cahier). Fonction PURE, testée en isolation. Échappe les guillemets
 * et encadre chaque champ pour rester valide si `action`/noms contiennent
 * une virgule ou un retour à la ligne (avant_state/after_state JSON peuvent
 * en contenir).
 */
export function formatAuditLogsAsCsv(logs: AdminAuditLogEntry[]): string {
  const escapeCsvField = (value: string): string => `"${value.replace(/"/g, '""')}"`;

  const header = ["Date", "Entreprise", "Action", "Type d'entité", "Id entité", "Acteur"].map(escapeCsvField);
  const rows = logs.map((log) =>
    [
      log.createdAt,
      log.organizationName ?? "",
      log.action,
      log.entityType ?? "",
      log.entityId ?? "",
      log.actorUserId ?? "",
    ].map((field) => escapeCsvField(String(field))),
  );

  return [header, ...rows].map((row) => row.join(",")).join("\r\n");
}

export interface OrganizationUsage {
  organizationId: string;
  productsCount: number;
  conversationsCount: number;
  whatsappGroupsCount: number;
}

/**
 * Étend ce que `admin-organizations-service.ts::listOrganizationsForAdmin`
 * affiche déjà (crédits IA, canaux connectés, dernière activité) avec des
 * compteurs d'usage bruts par entreprise. Réutilise
 * `countOrganizationRows()` (plans-repository.ts) plutôt que de dupliquer
 * sa logique de comptage — cette fonction gère déjà l'absence d'une table
 * (retourne 0 sans planter), ce qui couvre directement le cas
 * `whatsapp_groups` si le Lot F n'a pas encore été fusionné au moment où ce
 * lot est intégré séparément (voir `03_LOT_C_super_admin.md` original,
 * section "gérez l'absence gracieusement" — même principe déjà appliqué
 * par ce projet à `organization_subscriptions` avant le Lot B).
 */
export async function getPlatformUsageByOrganization(): Promise<OrganizationUsage[]> {
  const supabase = getSupabaseServiceClient();
  const { data: orgs, error } = await supabase.from("organizations").select("id");
  if (error) throw new Error(`Erreur lecture organizations: ${error.message}`);

  return Promise.all(
    (orgs ?? []).map(async (org) => {
      const [productsCount, conversationsCount, whatsappGroupsCount] = await Promise.all([
        countOrganizationRows("products", org.id),
        countOrganizationRows("conversations", org.id),
        countOrganizationRows("whatsapp_groups", org.id),
      ]);
      return { organizationId: org.id, productsCount, conversationsCount, whatsappGroupsCount };
    }),
  );
}
