import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { listPlans, type PlanSummary } from "./plans-repository";
import { buildPlatformFaqs, buildPlatformSiteBlocks, type PlatformFaq } from "./platform-tenant";
import { editDraftCore, getSiteDraftCore } from "./site-version-service";

/**
 * Installe (ou rafraîchit) le contenu du tenant Flexco : FAQ + brouillon de site libre. IDEMPOTENT : relancé, il met à
 * jour les FAQ par question (jamais de doublon) et recompose l'accueil du brouillon. Il ne PUBLIE jamais : le
 * propriétaire relit l'aperçu puis publie (action visible, annulable via l'historique des versions).
 */
export interface PlatformBootstrapDeps {
  loadPlans: () => Promise<PlanSummary[]>;
  listFaqQuestions: (organizationId: string) => Promise<Array<{ id: string; question: string }>>;
  insertFaq: (organizationId: string, faq: PlatformFaq) => Promise<void>;
  updateFaq: (organizationId: string, id: string, faq: PlatformFaq) => Promise<void>;
  composeHome: (organizationId: string, userId: string, blocks: { type: string; props: Record<string, unknown> }[]) => Promise<{ changes: string[] }>;
}

export interface PlatformBootstrapResult { faqCreated: number; faqUpdated: number; plansUsed: number; siteChanges: string[] }

export async function bootstrapPlatformTenant(organizationId: string, userId: string, deps: PlatformBootstrapDeps = defaultDeps()): Promise<PlatformBootstrapResult> {
  const plans = await deps.loadPlans();
  const faqs = buildPlatformFaqs(plans);
  const existing = await deps.listFaqQuestions(organizationId);
  const byQuestion = new Map(existing.map((f) => [f.question.trim().toLowerCase(), f.id]));
  let faqCreated = 0;
  let faqUpdated = 0;
  for (const faq of faqs) {
    const id = byQuestion.get(faq.question.trim().toLowerCase());
    if (id) { await deps.updateFaq(organizationId, id, faq); faqUpdated++; }
    else { await deps.insertFaq(organizationId, faq); faqCreated++; }
  }
  const { changes } = await deps.composeHome(organizationId, userId, buildPlatformSiteBlocks(plans, faqs));
  return { faqCreated, faqUpdated, plansUsed: plans.length, siteChanges: changes };
}

function defaultDeps(): PlatformBootstrapDeps {
  const db = () => getSupabaseServiceClient();
  return {
    loadPlans: listPlans,
    async listFaqQuestions(organizationId) {
      const { data, error } = await db().from("faqs").select("id, question").eq("organization_id", organizationId);
      if (error) throw new Error(`Lecture des FAQ impossible: ${error.message}`);
      return (data ?? []) as Array<{ id: string; question: string }>;
    },
    async insertFaq(organizationId, faq) {
      const { error } = await db().from("faqs").insert({ organization_id: organizationId, question: faq.question, answer: faq.answer, keywords: faq.keywords, is_active: true });
      if (error) throw new Error(`Création de la FAQ impossible: ${error.message}`);
    },
    async updateFaq(organizationId, id, faq) {
      const { error } = await db().from("faqs").update({ answer: faq.answer, keywords: faq.keywords, is_active: true }).eq("id", id).eq("organization_id", organizationId);
      if (error) throw new Error(`Mise à jour de la FAQ impossible: ${error.message}`);
    },
    async composeHome(organizationId, userId, blocks) {
      const draft = await getSiteDraftCore(organizationId);
      const homeId = draft?.snapshot.pages.find((p) => p.kind === "home")?.id;
      const operations: unknown[] = [{ op: "set_mode", mode: "free" }];
      if (homeId) operations.push({ op: "replace_page_blocks", pageId: homeId, blocks });
      const first = await editDraftCore(organizationId, userId, operations, { source: "agent", note: "Contenu Flexco généré depuis les offres actuelles" });
      if (homeId) return { changes: first.changes };
      const home = first.version.snapshot.pages.find((p) => p.kind === "home")!;
      const second = await editDraftCore(organizationId, userId, [{ op: "replace_page_blocks", pageId: home.id, blocks }], { source: "agent", note: "Contenu Flexco généré depuis les offres actuelles" });
      return { changes: [...first.changes, ...second.changes] };
    },
  };
}
