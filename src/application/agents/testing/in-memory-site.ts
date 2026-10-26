import { randomUUID } from "node:crypto";
import { applySiteOperations } from "@/application/services/site-operations";
import { buildDefaultSiteSnapshot } from "@/application/services/site-default-tree";
import { lintSiteSnapshot } from "@/application/services/site-seo-lint";
import { canEditSiteDraft, hasSitePublishRight } from "@/application/services/site-permissions";
import type { SiteSnapshot } from "@/domain/entities/site";
import { AgentError } from "../errors";
import type { SiteActorRef, SiteServices } from "../domains/site";

/** Service « Site » en mémoire pour les tests : même logique métier (opérations, contrôle SEO, droits, historique), sans base. */
export function createInMemorySite() {
  const initial = (): SiteSnapshot => buildDefaultSiteSnapshot({
    sections: [{ type: "hero", enabled: true, order: 0 }, { type: "products", enabled: true, order: 1 }, { type: "faq", enabled: true, order: 2 }],
    brandColorPrimary: null, brandColorSecondary: null, fontChoice: "modern", visualStyle: "soft", heroTitle: "Chez Mado", heroSubtitle: "Cuisine maison", ctaLabel: null, ctaUrl: null,
    secondaryCtaLabel: null, heroLayout: null, heroMediaUrl: null, announcement: null, announcementEnabled: true, highlights: null, organizationName: "Chez Mado",
    homeSeo: { title: "Chez Mado — cuisine camerounaise à Douala", description: "Plats maison préparés chaque jour à Douala : ndolé, poulet DG, poisson braisé. Commandez en ligne et faites-vous livrer rapidement." },
  });
  const state = {
    draft: null as SiteSnapshot | null,
    published: null as SiteSnapshot | null,
    publishedNumber: 0,
    versions: [] as { id: string; versionNumber: number; status: string; source: string; snapshot: SiteSnapshot; note: string | null; createdAt: string }[],
    steps: [] as { id: string; stepNumber: number; source: string; summary: string; snapshot: SiteSnapshot; createdAt: string }[],
    calls: [] as string[],
  };
  const now = () => new Date().toISOString();
  const map = (a: SiteActorRef) => ({ publish_site: a.extraPermissions.includes("publish_site") });
  const needEdit = (a: SiteActorRef) => { if (!canEditSiteDraft(a.role, map(a))) throw new AgentError("actor_required", "Vous n'avez pas le droit de modifier le site."); };
  const needPublish = (a: SiteActorRef) => { if (!hasSitePublishRight(a.role, map(a))) throw new AgentError("actor_required", "Vous n'avez pas le droit de publier le site."); };
  const current = () => state.draft ?? state.published;
  const lintOf = (s: SiteSnapshot) => { const r = lintSiteSnapshot(s); return { errors: r.errors.map((i) => i.message), warnings: r.warnings.map((i) => i.message) }; };
  const addStep = (source: string, summary: string) => {
    if (state.steps.length === 0 && source !== "baseline") state.steps.push({ id: randomUUID(), stepNumber: 1, source: "baseline", summary: "État avant la première modification", snapshot: structuredClone(state.draft!), createdAt: now() });
    state.steps.push({ id: randomUUID(), stepNumber: state.steps.length + 1, source, summary, snapshot: structuredClone(state.draft!), createdAt: now() });
  };

  const svc: SiteServices = {
    async overview() {
      const cur = current();
      return {
        mode: cur?.mode ?? "template", hasDraft: Boolean(state.draft), draftVersion: state.draft ? 1 : null, publishedVersion: state.published ? state.publishedNumber : null,
        basedOn: state.draft ? "draft" : state.published ? "published" : null,
        pages: (cur?.pages ?? []).map((p) => ({ id: p.id, title: p.title, slug: p.slug, kind: p.kind, blocks: p.blocks.length })),
        theme: cur?.theme ?? null, navigation: cur?.navigation ?? [], lint: state.draft ? lintOf(state.draft) : null,
      };
    },
    async getPage(_a, pageId) { const cur = current(); const page = cur?.pages.find((p) => p.id === pageId); return page ? { from: state.draft ? "draft" : "published", page } : null; },
    async dryRun(_a, operations) {
      const cur = current();
      if (!cur) return { ok: true, changes: ["Un brouillon sera créé"], based: false };
      const r = applySiteOperations(cur, operations);
      return r.ok ? { ok: true, changes: r.changes, based: true } : { ok: false, error: r.error };
    },
    async edit(a, operations, note) {
      state.calls.push("edit");
      needEdit(a);
      const base = state.draft ?? structuredClone(state.published ?? initial());
      const r = applySiteOperations(base, operations);
      if (!r.ok) throw new AgentError("invalid_input", r.error);
      state.draft = base;
      addStep("agent", r.changes.join(" · "));
      state.draft = r.snapshot;
      state.steps.at(-1)!.snapshot = structuredClone(r.snapshot);
      void note;
      return { changes: r.changes, lint: lintOf(r.snapshot) };
    },
    async lint() { return state.draft ? lintOf(state.draft) : null; },
    async history(_a, limit) {
      return {
        versions: state.versions.slice(0, limit).map((v) => ({ id: v.id, versionNumber: v.versionNumber, status: v.status, source: v.source, note: v.note, createdAt: v.createdAt })),
        steps: [...state.steps].reverse().slice(0, limit).map((s) => ({ id: s.id, stepNumber: s.stepNumber, source: s.source, summary: s.summary, createdAt: s.createdAt })),
      };
    },
    async revert(a, revisionId) {
      state.calls.push("revert");
      needEdit(a);
      const step = state.steps.find((s) => s.id === revisionId);
      if (!state.draft || !step) throw new AgentError("invalid_input", "Étape d'historique introuvable pour ce brouillon");
      state.draft = structuredClone(step.snapshot);
      addStep("revert", `Retour à l'étape n°${step.stepNumber}`);
      return { toStep: step.stepNumber };
    },
    async discard(a) { state.calls.push("discard"); needEdit(a); state.draft = null; state.steps = []; },
    async publish(a) {
      state.calls.push("publish");
      needPublish(a);
      if (!state.draft) throw new AgentError("invalid_input", "Aucun brouillon à publier");
      const lint = lintSiteSnapshot(state.draft);
      if (!lint.canPublish) throw new AgentError("invalid_input", `Publication bloquée : ${lint.errors.map((i) => i.message).join(" ")}`);
      state.versions.forEach((v) => { if (v.status === "published") v.status = "archived"; });
      state.publishedNumber += 1;
      state.versions.unshift({ id: randomUUID(), versionNumber: state.publishedNumber, status: "published", source: "agent", snapshot: structuredClone(state.draft), note: null, createdAt: now() });
      state.published = state.draft; state.draft = null;
      return { versionNumber: state.publishedNumber, warnings: lint.warnings.map((i) => i.message) };
    },
    async restore(a, versionId, discardDraft) {
      state.calls.push("restore");
      needPublish(a);
      const v = state.versions.find((x) => x.id === versionId);
      if (!v) throw new AgentError("invalid_input", "Version introuvable");
      if (state.draft && !discardDraft) throw new AgentError("invalid_input", "Un brouillon est en cours. Confirmez son abandon pour restaurer cette version.");
      state.draft = structuredClone(v.snapshot); state.steps = [];
      return { draftVersion: state.publishedNumber + 1 };
    },
    async images() { return [{ url: "https://img.example.com/plat.jpg", label: "Poulet DG" }]; },
    async publishPreview() {
      if (!state.draft) return null;
      const l = lintOf(state.draft);
      return { draftVersion: 1, publishedVersion: state.published ? state.publishedNumber : null, pagesDraft: state.draft.pages.length, changedSince: [], warnings: l.warnings, errors: l.errors };
    },
  };
  return { svc, state };
}
