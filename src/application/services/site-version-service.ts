import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import {
  SiteSnapshotSchema,
  type SiteSnapshot,
  type SiteVersionSource,
  type SiteVersionStatus,
} from "@/domain/entities/site";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requireMembership } from "./auth-service";
import { resolveOrganizationSeo } from "@/lib/seo";
import { getLandingConfig } from "./landing-config-service";
import { buildDefaultSiteSnapshot } from "./site-default-tree";
import { applySiteOperations } from "./site-operations";
import { requireSiteEditor, requireSitePublisher } from "./site-permissions";
import { lintSiteSnapshot, type LintIssue, type LintResult } from "./site-seo-lint";

/**
 * Service des versions du site (C4). Chaque fonction publique vérifie
 * l'acteur ET le tenant (principe 5) : le client service-role contourne la
 * RLS, la barrière réelle est donc ici (`requireSiteEditor` /
 * `requireSitePublisher`). Pas encore branché au rendu de la vitrine.
 *
 * L'agent Site (C1) appellera ces mêmes fonctions : publier et restaurer
 * restent des actions `sensitive` confirmées par le moteur de règles.
 */

export interface SiteVersionSummary {
  id: string;
  versionNumber: number;
  status: SiteVersionStatus;
  source: SiteVersionSource;
  note: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface SiteVersion extends SiteVersionSummary {
  snapshot: SiteSnapshot;
}

/** Publication refusée par le garde-fou SEO : les erreurs critiques sont dans `issues`. */
export class SiteLintBlockedError extends ValidationError {
  constructor(public readonly issues: LintIssue[]) {
    super(`Publication bloquée : ${issues.map((i) => i.message).join(" ")}`);
  }
}

const SUMMARY_COLUMNS = "id, version_number, status, source, note, created_at, published_at";

type Row = Record<string, unknown>;

function toSummary(row: Row): SiteVersionSummary {
  return {
    id: row.id as string,
    versionNumber: row.version_number as number,
    status: row.status as SiteVersionStatus,
    source: row.source as SiteVersionSource,
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
    publishedAt: (row.published_at as string | null) ?? null,
  };
}

function toVersion(row: Row): SiteVersion {
  const parsed = SiteSnapshotSchema.safeParse(row.snapshot);
  if (!parsed.success) {
    // Jamais servir une version corrompue en silence.
    throw new Error(`Version ${String(row.id)} du site illisible (schéma invalide)`);
  }
  return { ...toSummary(row), snapshot: parsed.data };
}

async function selectOne(organizationId: string, status: SiteVersionStatus): Promise<SiteVersion | null> {
  const { data, error } = await getSupabaseServiceClient()
    .from("site_versions")
    .select(`${SUMMARY_COLUMNS}, snapshot`)
    .eq("organization_id", organizationId)
    .eq("status", status)
    .maybeSingle();
  if (error) throw new Error(`Lecture des versions du site impossible: ${error.message}`);
  return data ? toVersion(data as Row) : null;
}

async function audit(organizationId: string, actorUserId: string, action: string, versionId: string, after: Record<string, unknown>) {
  await getSupabaseServiceClient().from("audit_logs").insert({
    organization_id: organizationId,
    actor_user_id: actorUserId,
    action,
    entity_type: "site_version",
    entity_id: versionId,
    after_state: after,
  });
}

/** Version publiée vue par les visiteurs. Lecture publique (aucune auth) : à utiliser par le futur moteur de rendu uniquement. */
export async function getPublishedSite(organizationId: string): Promise<SiteVersion | null> {
  return selectOne(organizationId, "published");
}

/** Historique (50 dernières versions, sans le contenu). Tout membre du tenant. */
export async function listSiteVersions(organizationId: string): Promise<SiteVersionSummary[]> {
  await requireMembership(organizationId);
  const { data, error } = await getSupabaseServiceClient()
    .from("site_versions")
    .select(SUMMARY_COLUMNS)
    .eq("organization_id", organizationId)
    .order("version_number", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Lecture de l'historique du site impossible: ${error.message}`);
  return (data ?? []).map((row) => toSummary(row as Row));
}

/** Brouillon en cours (ou `null`). Tout membre du tenant peut le lire. */
export async function getSiteDraft(organizationId: string): Promise<SiteVersion | null> {
  await requireMembership(organizationId);
  return selectOne(organizationId, "draft");
}

/** Variantes SANS session (assistant sur Telegram/WhatsApp) : l'appelant a DÉJÀ vérifié l'acteur et ses droits (voir site-agent-service.ts). */
export const getSiteDraftCore = (organizationId: string) => selectOne(organizationId, "draft");
export const getPublishedSiteCore = (organizationId: string) => selectOne(organizationId, "published");
export async function listSiteVersionsCore(organizationId: string): Promise<SiteVersionSummary[]> {
  const { data, error } = await getSupabaseServiceClient().from("site_versions").select(SUMMARY_COLUMNS).eq("organization_id", organizationId).order("version_number", { ascending: false }).limit(50);
  if (error) throw new Error(`Lecture de l'historique du site impossible: ${error.message}`);
  return (data ?? []).map((row) => toSummary(row as Row));
}
export async function ensureDraftCore(organizationId: string, userId: string): Promise<SiteVersion> {
  return ensureDraft(organizationId, userId);
}
export async function discardDraftCore(organizationId: string, userId: string): Promise<void> {
  const { error } = await getSupabaseServiceClient().from("site_versions").delete().eq("organization_id", organizationId).eq("status", "draft");
  if (error) throw new Error(`Suppression du brouillon impossible: ${error.message}`);
  await audit(organizationId, userId, "SITE_DRAFT_DISCARDED", organizationId, {});
}

async function insertDraft(
  organizationId: string,
  userId: string,
  snapshot: SiteSnapshot,
  source: SiteVersionSource,
  extra: { restoredFrom?: string; note?: string } = {},
): Promise<SiteVersion> {
  const { data, error } = await getSupabaseServiceClient()
    .from("site_versions")
    .insert({
      organization_id: organizationId,
      status: "draft",
      snapshot,
      source,
      restored_from: extra.restoredFrom ?? null,
      note: extra.note ?? null,
      created_by: userId,
    })
    .select(`${SUMMARY_COLUMNS}, snapshot`)
    .single();
  if (error || !data) {
    // 23505 = un brouillon existe déjà (création concurrente) : on relit celui-là.
    if (error?.code === "23505") {
      const existing = await selectOne(organizationId, "draft");
      if (existing) return existing;
    }
    throw new Error(`Création du brouillon impossible: ${error?.message ?? "réponse vide"}`);
  }
  return toVersion(data as Row);
}

/** Brouillon existant, sinon copie de la version publiée, sinon arbre par défaut généré depuis la config actuelle du tenant. */
async function ensureDraft(organizationId: string, userId: string): Promise<SiteVersion> {
  const existing = await selectOne(organizationId, "draft");
  if (existing) return existing;

  const published = await selectOne(organizationId, "published");
  if (published) return insertDraft(organizationId, userId, published.snapshot, "manual");

  const { data: org, error } = await getSupabaseServiceClient()
    .from("organizations")
    .select("name, description, seo_title, seo_description, seo_og_image_url, banner_url, logo_url")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !org) throw new NotFoundError("Organisation introuvable");
  const config = await getLandingConfig(organizationId);
  const seo = resolveOrganizationSeo({
    name: org.name as string,
    description: (org.description as string | null) ?? null,
    seoTitle: (org.seo_title as string | null) ?? null,
    seoDescription: (org.seo_description as string | null) ?? null,
    seoOgImageUrl: (org.seo_og_image_url as string | null) ?? null,
    bannerUrl: (org.banner_url as string | null) ?? null,
    logoUrl: (org.logo_url as string | null) ?? null,
  });
  const snapshot = buildDefaultSiteSnapshot({
    ...config,
    organizationName: org.name as string,
    homeSeo: { title: seo.title, description: seo.description, ogImageUrl: seo.ogImageUrl },
  });
  const checked = SiteSnapshotSchema.safeParse(snapshot);
  if (!checked.success) throw new Error("L'arbre par défaut généré n'est pas valide (config existante incohérente)");
  return insertDraft(organizationId, userId, checked.data, "default_from_config");
}

export interface EditResult {
  version: SiteVersion;
  /** Liste lisible des changements appliqués (pour l'aperçu avant/après et l'audit). */
  changes: string[];
  lint: LintResult;
}

/**
 * Applique des opérations d'édition au brouillon (créé au besoin). Atomique :
 * une opération invalide ne change rien. `source: "agent"` trace l'origine.
 * Chaque modification est enregistrée dans l'historique fin (`site_revisions`) :
 * on peut revenir à n'importe quelle étape (voir `revertSiteDraft`).
 */
export async function editSiteDraft(
  organizationId: string,
  operations: unknown,
  options: { source?: Extract<SiteVersionSource, "manual" | "agent">; note?: string } = {},
): Promise<EditResult> {
  const membership = await requireSiteEditor(organizationId);
  return editDraftCore(organizationId, membership.userId, operations, options);
}

export async function editDraftCore(
  organizationId: string,
  userId: string,
  operations: unknown,
  options: { source?: Extract<SiteVersionSource, "manual" | "agent">; note?: string } = {},
): Promise<EditResult> {
  const draft = await ensureDraft(organizationId, userId);

  const result = applySiteOperations(draft.snapshot, operations);
  if (!result.ok) {
    const where = result.operationIndex === null ? "" : ` (opération ${result.operationIndex + 1})`;
    throw new ValidationError(`${result.error}${where}`);
  }

  // Point de départ : on garde l'état d'avant la toute première modification de ce brouillon.
  await ensureBaselineRevision(organizationId, draft, userId);

  // Origine du brouillon : le dernier éditeur (manuel ou agent) ; un brouillon généré par défaut devient « manual ».
  const nextSource: SiteVersionSource = options.source ?? (draft.source === "default_from_config" ? "manual" : draft.source);
  const { data, error } = await getSupabaseServiceClient()
    .from("site_versions")
    .update({ snapshot: result.snapshot, source: nextSource, note: options.note ?? draft.note })
    .eq("id", draft.id)
    .eq("organization_id", organizationId)
    .eq("status", "draft")
    .select(`${SUMMARY_COLUMNS}, snapshot`)
    .single();
  if (error || !data) throw new Error(`Enregistrement du brouillon impossible: ${error?.message ?? "brouillon introuvable"}`);

  const version = toVersion(data as Row);
  await recordRevision(organizationId, version.id, version.snapshot, nextSource === "agent" ? "agent" : "manual", result.changes.join(" · ") || "Aucun changement", userId);
  await audit(organizationId, userId, "SITE_DRAFT_EDITED", version.id, { changes: result.changes, source: nextSource });
  return { version, changes: result.changes, lint: lintSiteSnapshot(version.snapshot) };
}

/* ------------------------------------------------------------------ */
/* Historique fin du brouillon (site_revisions)                        */
/* ------------------------------------------------------------------ */

export const MAX_REVISIONS_PER_VERSION = 100;
export type SiteRevisionSource = "baseline" | "manual" | "agent" | "revert";
export interface SiteRevisionSummary { id: string; revisionNumber: number; source: SiteRevisionSource; summary: string; createdAt: string }

const REVISION_COLUMNS = "id, revision_number, source, summary, created_at";
const toRevisionSummary = (row: Row): SiteRevisionSummary => ({
  id: row.id as string,
  revisionNumber: row.revision_number as number,
  source: row.source as SiteRevisionSource,
  summary: row.summary as string,
  createdAt: row.created_at as string,
});

async function recordRevision(organizationId: string, versionId: string, snapshot: SiteSnapshot, source: SiteRevisionSource, summary: string, userId: string): Promise<void> {
  const db = getSupabaseServiceClient();
  const { error } = await db.from("site_revisions").insert({
    organization_id: organizationId, version_id: versionId, snapshot, source, summary: summary.slice(0, 2000), created_by: userId,
  });
  if (error) throw new Error(`Enregistrement dans l'historique impossible: ${error.message}`);
  // Élagage : on ne garde que les plus récentes.
  const { data: old } = await db
    .from("site_revisions")
    .select("id")
    .eq("version_id", versionId)
    .order("revision_number", { ascending: false })
    .range(MAX_REVISIONS_PER_VERSION, MAX_REVISIONS_PER_VERSION + 200);
  const ids = (old ?? []).map((r) => (r as Row).id as string);
  if (ids.length > 0) await db.from("site_revisions").delete().in("id", ids).eq("organization_id", organizationId);
}

async function ensureBaselineRevision(organizationId: string, draft: SiteVersion, userId: string): Promise<void> {
  const { count, error } = await getSupabaseServiceClient()
    .from("site_revisions")
    .select("id", { count: "exact", head: true })
    .eq("version_id", draft.id)
    .eq("organization_id", organizationId);
  if (error) throw new Error(`Lecture de l'historique impossible: ${error.message}`);
  if ((count ?? 0) === 0) await recordRevision(organizationId, draft.id, draft.snapshot, "baseline", "État avant la première modification", userId);
}

/** Étapes d'historique du brouillon en cours (la plus récente d'abord, sans le contenu). Tout membre du tenant. */
export async function listDraftRevisions(organizationId: string, limit = 30): Promise<SiteRevisionSummary[]> {
  await requireMembership(organizationId);
  return listDraftRevisionsCore(organizationId, limit);
}

export async function listDraftRevisionsCore(organizationId: string, limit = 30): Promise<SiteRevisionSummary[]> {
  const draft = await selectOne(organizationId, "draft");
  if (!draft) return [];
  const { data, error } = await getSupabaseServiceClient()
    .from("site_revisions")
    .select(REVISION_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("version_id", draft.id)
    .order("revision_number", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), MAX_REVISIONS_PER_VERSION));
  if (error) throw new Error(`Lecture de l'historique impossible: ${error.message}`);
  return (data ?? []).map((r) => toRevisionSummary(r as Row));
}

/**
 * Remet le brouillon dans l'état d'une étape précédente. Rien n'est effacé : le retour est lui-même une nouvelle
 * étape d'historique (donc annulable), et le site publié n'est pas touché.
 */
export async function revertSiteDraft(organizationId: string, revisionId: string): Promise<{ version: SiteVersion; revisionNumber: number }> {
  const membership = await requireSiteEditor(organizationId);
  return revertDraftCore(organizationId, membership.userId, revisionId);
}

export async function revertDraftCore(organizationId: string, userId: string, revisionId: string): Promise<{ version: SiteVersion; revisionNumber: number }> {
  const draft = await selectOne(organizationId, "draft");
  if (!draft) throw new NotFoundError("Aucun brouillon à remettre en arrière");
  const { data, error } = await getSupabaseServiceClient()
    .from("site_revisions")
    .select(`${REVISION_COLUMNS}, snapshot`)
    .eq("id", revisionId)
    .eq("organization_id", organizationId) // jamais l'étape d'un autre tenant
    .eq("version_id", draft.id) // ni celle d'une autre version
    .maybeSingle();
  if (error) throw new Error(`Lecture de l'étape impossible: ${error.message}`);
  if (!data) throw new NotFoundError("Étape d'historique introuvable pour ce brouillon");
  const parsed = SiteSnapshotSchema.safeParse((data as Row).snapshot);
  if (!parsed.success) throw new Error("Cette étape de l'historique est illisible (schéma invalide)");
  const target = toRevisionSummary(data as Row);

  const { data: updated, error: updateError } = await getSupabaseServiceClient()
    .from("site_versions")
    .update({ snapshot: parsed.data })
    .eq("id", draft.id)
    .eq("organization_id", organizationId)
    .eq("status", "draft")
    .select(`${SUMMARY_COLUMNS}, snapshot`)
    .single();
  if (updateError || !updated) throw new Error(`Retour en arrière impossible: ${updateError?.message ?? "brouillon introuvable"}`);
  const version = toVersion(updated as Row);
  await recordRevision(organizationId, version.id, version.snapshot, "revert", `Retour à l'étape n°${target.revisionNumber} (${target.summary.slice(0, 120)})`, userId);
  await audit(organizationId, userId, "SITE_DRAFT_REVERTED", version.id, { toRevision: target.revisionNumber });
  return { version, revisionNumber: target.revisionNumber };
}

/** Contrôle SEO du brouillon sans le publier. */
export async function lintSiteDraft(organizationId: string): Promise<LintResult> {
  await requireSiteEditor(organizationId);
  const draft = await selectOne(organizationId, "draft");
  if (!draft) throw new NotFoundError("Aucun brouillon à contrôler");
  return lintSiteSnapshot(draft.snapshot);
}

/** Abandonne le brouillon en cours (la version publiée n'est pas touchée). */
export async function discardSiteDraft(organizationId: string): Promise<void> {
  const membership = await requireSiteEditor(organizationId);
  const { error } = await getSupabaseServiceClient()
    .from("site_versions")
    .delete()
    .eq("organization_id", organizationId)
    .eq("status", "draft");
  if (error) throw new Error(`Suppression du brouillon impossible: ${error.message}`);
  await audit(organizationId, membership.userId, "SITE_DRAFT_DISCARDED", organizationId, {});
}

/**
 * Publie le brouillon. ACTION SENSIBLE : l'appelant (route, agent) doit avoir
 * obtenu la confirmation. Bloquée par les erreurs critiques du garde-fou SEO
 * (les avertissements sont renvoyés mais ne bloquent pas).
 */
export async function publishSiteDraft(organizationId: string): Promise<{ versionNumber: number; warnings: LintIssue[] }> {
  const membership = await requireSitePublisher(organizationId);
  return publishDraftCore(organizationId, membership.userId);
}

export async function publishDraftCore(organizationId: string, userId: string): Promise<{ versionNumber: number; warnings: LintIssue[] }> {
  const draft = await selectOne(organizationId, "draft");
  if (!draft) throw new NotFoundError("Aucun brouillon à publier");

  const lint = lintSiteSnapshot(draft.snapshot);
  if (!lint.canPublish) throw new SiteLintBlockedError(lint.errors);

  const { error } = await getSupabaseServiceClient().rpc("publish_site_version", {
    p_organization_id: organizationId,
    p_version_id: draft.id,
    p_user_id: userId,
  });
  if (error) throw new Error(`Publication impossible: ${error.message}`);

  await audit(organizationId, userId, "SITE_PUBLISHED", draft.id, { versionNumber: draft.versionNumber, warnings: lint.warnings.length });
  return { versionNumber: draft.versionNumber, warnings: lint.warnings };
}

/**
 * Restaure une ancienne version : crée un NOUVEAU brouillon à partir de son
 * contenu (l'historique n'est jamais réécrit). Ne publie pas : la publication
 * reste une étape confirmée. Un brouillon en cours n'est écrasé que si
 * `discardDraft` est demandé explicitement.
 */
export async function restoreSiteVersion(
  organizationId: string,
  versionId: string,
  options: { discardDraft?: boolean } = {},
): Promise<SiteVersion> {
  const membership = await requireSitePublisher(organizationId);
  return restoreVersionCore(organizationId, membership.userId, versionId, options);
}

export async function restoreVersionCore(
  organizationId: string,
  userId: string,
  versionId: string,
  options: { discardDraft?: boolean } = {},
): Promise<SiteVersion> {
  const { data, error } = await getSupabaseServiceClient()
    .from("site_versions")
    .select(`${SUMMARY_COLUMNS}, snapshot`)
    .eq("id", versionId)
    .eq("organization_id", organizationId) // jamais une version d'un autre tenant
    .maybeSingle();
  if (error) throw new Error(`Lecture de la version impossible: ${error.message}`);
  if (!data) throw new NotFoundError("Version introuvable");
  const source = toVersion(data as Row);

  const currentDraft = await selectOne(organizationId, "draft");
  if (currentDraft) {
    if (!options.discardDraft) {
      throw new ValidationError("Un brouillon est en cours. Confirmez son abandon pour restaurer cette version.");
    }
    const { error: deleteError } = await getSupabaseServiceClient()
      .from("site_versions")
      .delete()
      .eq("id", currentDraft.id)
      .eq("organization_id", organizationId)
      .eq("status", "draft");
    if (deleteError) throw new Error(`Abandon du brouillon impossible: ${deleteError.message}`);
  }

  const restored = await insertDraft(organizationId, userId, source.snapshot, "restore", {
    restoredFrom: source.id,
    note: `Restauration de la version ${source.versionNumber}`,
  });
  await audit(organizationId, userId, "SITE_VERSION_RESTORED", restored.id, { fromVersion: source.versionNumber });
  return restored;
}
