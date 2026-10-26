import { redirect } from "next/navigation";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { canUseFeature } from "@/application/services/entitlements-service";
import { LANDING_SECTION_LABELS } from "@/application/config/landing-presets";
import { FONT_CHOICES, LANDING_SECTION_TYPES } from "@/domain/entities/landing";
import { FONT_CHOICE_LABELS } from "@/app/fonts";
import {
  discardSiteDraft,
  editSiteDraft,
  getSiteDraft,
  listSiteVersions,
  publishSiteDraft,
  restoreSiteVersion,
  revertSiteDraft,
  listDraftRevisions,
  getPublishedSite,
} from "@/application/services/site-version-service";
import { isPlatformTenant } from "@/application/services/platform-tenant";
import { bootstrapPlatformTenant } from "@/application/services/platform-tenant-bootstrap";
import { requireSiteEditor } from "@/application/services/site-permissions";
import { getSitePermissions } from "@/application/services/site-permissions";
import { DESCRIPTION_RANGE, TITLE_RANGE, lintSiteSnapshot } from "@/application/services/site-seo-lint";
import type { SiteOperation } from "@/application/services/site-operations";
import { MAX_PAGES, PAGE_BLOCK_TYPES, RICH_BLOCK_LABELS, isRichBlockType, type Block, type Page } from "@/domain/entities/site";
import { slugify } from "@/domain/entities/catalog";
import { AppError, NotFoundError, QuotaExceededError, ValidationError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";
import { ConfirmSubmitButton } from "./confirm-submit-button";

const BASE = "/dashboard/site/versions";
const INPUT = "w-full rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400";
const HOME = "page-home";

/** Mêmes conditions de plan que /dashboard/site : la personnalisation de la vitrine démarre à Starter. */
async function requireSiteCustomization(organizationId: string): Promise<void> {
  const entitlement = await canUseFeature(organizationId, "site_customization", 1);
  if (!entitlement.allowed) throw new QuotaExceededError("La personnalisation de la vitrine est disponible à partir de Starter.");
}

/**
 * Enveloppe commune des actions serveur : plan -> service (qui vérifie
 * l'acteur, le tenant et le droit) -> redirection avec message. Les droits
 * ne sont JAMAIS décidés ici : l'affichage des boutons n'est qu'un confort.
 */
async function perform(formData: FormData, work: (organizationId: string) => Promise<string>): Promise<never> {
  const organizationId = String(formData.get("organizationId") ?? "");
  let message: string;
  try {
    await requireSiteCustomization(organizationId);
    message = await work(organizationId);
  } catch (error) {
    if (!(error instanceof AppError)) console.error("Éditeur de versions du site: erreur inattendue:", error);
    const text = error instanceof AppError ? error.message : "Une erreur est survenue. Réessayez.";
    redirect(`${BASE}?error=${encodeURIComponent(text)}`);
  }
  redirect(`${BASE}?success=${encodeURIComponent(message)}`);
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const pageIdOf = (formData: FormData) => text(formData, "pageId") || HOME;
const field = (formData: FormData, name: string): string | null => text(formData, name) || null;

async function startDraftAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    await editSiteDraft(org, [], { source: "manual" });
    return "Brouillon prêt. Vos visiteurs ne voient rien tant que vous ne publiez pas.";
  });
}

async function toggleBlockAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const op: SiteOperation = { op: "set_block_visible", pageId: pageIdOf(formData), blockId: text(formData, "blockId"), visible: text(formData, "visible") === "true" };
    await editSiteDraft(org, [op], { source: "manual" });
    return "Section mise à jour dans le brouillon.";
  });
}

async function moveBlockAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const op: SiteOperation = { op: "move_block", pageId: pageIdOf(formData), blockId: text(formData, "blockId"), toIndex: Math.max(0, Number(text(formData, "toIndex")) || 0) };
    await editSiteDraft(org, [op], { source: "manual" });
    return "Section déplacée dans le brouillon.";
  });
}

/**
 * Champs texte éditables par type de bloc ; une zone vide retire la valeur. Seuls les
 * blocs dont la vitrine LIT des réglages ont un formulaire : les autres sections
 * affichent vos données (produits, FAQ, avis…) avec les intitulés de votre secteur.
 */
const BLOCK_FIELDS: Record<string, { name: string; label: string; max: number; multiline?: boolean }[]> = {
  hero: [
    { name: "title", label: "Titre principal", max: 120 },
    { name: "subtitle", label: "Sous-titre", max: 300 },
    { name: "ctaLabel", label: "Texte du bouton", max: 40 },
    { name: "ctaUrl", label: "Lien du bouton (ex. /produits)", max: 500 },
    { name: "mediaAlt", label: "Description de l'image (accessibilité et référencement)", max: 125 },
  ],
  text: [
    { name: "heading", label: "Titre (facultatif)", max: 120 },
    { name: "body", label: "Texte", max: 5000, multiline: true },
  ],
};
const ALL_FIELD_NAMES = ["title", "subtitle", "ctaLabel", "ctaUrl", "mediaAlt", "heading", "body"];

async function saveBlockAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const props: Record<string, unknown> = {};
    for (const name of ALL_FIELD_NAMES) {
      if (formData.has(`f_${name}`)) props[name] = field(formData, `f_${name}`);
    }
    const op: SiteOperation = { op: "set_block_props", pageId: pageIdOf(formData), blockId: text(formData, "blockId"), props };
    await editSiteDraft(org, [op], { source: "manual" });
    return "Textes enregistrés dans le brouillon.";
  });
}

async function removeBlockAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    await editSiteDraft(org, [{ op: "remove_block", pageId: pageIdOf(formData), blockId: text(formData, "blockId") }], { source: "manual" });
    return "Bloc retiré du brouillon.";
  });
}

async function addBlockAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const blockType = text(formData, "blockType");
    const op: SiteOperation = {
      op: "add_block",
      pageId: pageIdOf(formData),
      blockType: blockType as never, // le schéma de l'opération refuse tout type inconnu
      ...(blockType === "text" ? { props: { body: "Écrivez votre texte ici." } } : {}),
    };
    await editSiteDraft(org, [op], { source: "manual" });
    return "Bloc ajouté au brouillon.";
  });
}

async function createPageAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const title = text(formData, "title");
    const op: SiteOperation = {
      op: "add_page",
      title,
      slug: text(formData, "slug") || slugify(title),
      ...(text(formData, "body") ? { body: text(formData, "body") } : {}),
      inNavigation: formData.get("inNavigation") === "on",
    };
    await editSiteDraft(org, [op], { source: "manual" });
    return "Page créée dans le brouillon. Elle sera en ligne à la publication.";
  });
}

async function removePageAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    await editSiteDraft(org, [{ op: "remove_page", pageId: pageIdOf(formData) }], { source: "manual" });
    return "Page supprimée du brouillon.";
  });
}

async function toggleMenuAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const draft = await getSiteDraft(org);
    if (!draft) throw new ValidationError("Aucun brouillon en cours.");
    const pageId = pageIdOf(formData);
    const page = draft.snapshot.pages.find((p) => p.id === pageId);
    if (!page) throw new NotFoundError("Page introuvable.");
    const without = draft.snapshot.navigation.filter((n) => !(n.kind === "page" && n.pageId === pageId));
    const items = text(formData, "inMenu") === "true" ? [...without, { kind: "page" as const, label: page.title.slice(0, 30), pageId }] : without;
    await editSiteDraft(org, [{ op: "set_navigation", items }], { source: "manual" });
    return text(formData, "inMenu") === "true" ? "Page ajoutée au menu du brouillon." : "Page retirée du menu du brouillon.";
  });
}

async function saveThemeAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    // Case cochée = couleurs par défaut du secteur (null) ; sinon les deux couleurs choisies. Le schéma exige un hex strict.
    const useDefaults = formData.get("useDefaultColors") === "on";
    const op: SiteOperation = {
      op: "set_theme",
      theme: {
        brandColorPrimary: useDefaults ? null : text(formData, "brandColorPrimary"),
        brandColorSecondary: useDefaults ? null : text(formData, "brandColorSecondary"),
        fontChoice: text(formData, "fontChoice") as never,
        visualStyle: text(formData, "visualStyle") as never,
      },
    };
    await editSiteDraft(org, [op], { source: "manual" });
    return "Apparence enregistrée dans le brouillon.";
  });
}

async function saveAnnouncementAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const message = text(formData, "announcementText");
    const op: SiteOperation = {
      op: "set_announcement",
      announcement: message ? { text: message, enabled: formData.get("announcementEnabled") === "on" } : null,
    };
    await editSiteDraft(org, [op], { source: "manual" });
    return "Barre d'annonce enregistrée dans le brouillon.";
  });
}

async function saveSeoAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const op: SiteOperation = {
      op: "set_page_seo",
      pageId: pageIdOf(formData),
      seo: { title: field(formData, "seoTitle"), description: field(formData, "seoDescription") },
    };
    await editSiteDraft(org, [op], { source: "manual" });
    return "Référencement enregistré dans le brouillon.";
  });
}

async function publishAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const result = await publishSiteDraft(org);
    const warn = result.warnings.length > 0 ? ` (${result.warnings.length} conseil(s) de référencement restent à traiter)` : "";
    return `Version ${result.versionNumber} publiée : vos visiteurs la voient maintenant${warn}.`;
  });
}

async function applyTemplateAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const template = text(formData, "template");
    await editSiteDraft(org, [{ op: "apply_sector_template", template: template as never }], { source: "manual" });
    return "Modèle appliqué au brouillon (site libre). Personnalisez-le puis publiez ; vous pouvez revenir en arrière dans « Étapes du brouillon ».";
  });
}

async function platformBootstrapAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    if (!isPlatformTenant(org)) throw new ValidationError("Cette action est réservée à l'entreprise Flexco.");
    const membership = await requireSiteEditor(org);
    const r = await bootstrapPlatformTenant(org, membership.userId);
    return `Contenu Flexco actualisé depuis les offres actuelles : ${r.faqCreated} FAQ créée(s), ${r.faqUpdated} mise(s) à jour, accueil recomposé dans le brouillon. Relisez l'aperçu puis publiez.`;
  });
}

async function revertAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    const result = await revertSiteDraft(org, text(formData, "revisionId"));
    return `Brouillon remis dans l'état de l'étape ${result.revisionNumber}. Le site publié n'a pas changé.`;
  });
}

async function discardAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    await discardSiteDraft(org);
    return "Brouillon abandonné. Le site publié n'a pas changé.";
  });
}

async function restoreAction(formData: FormData) {
  "use server";
  await perform(formData, async (org) => {
    await restoreSiteVersion(org, text(formData, "versionId"), { discardDraft: formData.get("discardDraft") === "on" });
    return "Brouillon créé à partir de l'ancienne version. Vérifiez-le puis publiez.";
  });
}

const STATUS_LABELS = { draft: "Brouillon", published: "Publiée", archived: "Archivée" } as const;
const SOURCE_LABELS = { default_from_config: "Site d'origine", manual: "Modification manuelle", agent: "Assistant", restore: "Restauration" } as const;
const STEP_LABELS = { baseline: "État de départ", manual: "Modification manuelle", agent: "Assistant", revert: "Retour en arrière" } as const;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—");

function blockLabel(block: Block): string {
  if (block.type === "text") return "Texte libre";
  return isRichBlockType(block.type) ? RICH_BLOCK_LABELS[block.type] : LANDING_SECTION_LABELS[block.type];
}


type IdInput = React.ReactElement;

function SeoForm({ page, canEdit, idInput }: { page: Page; canEdit: boolean; idInput: IdInput }) {
  return (
    <form action={saveSeoAction} className="mt-3 flex flex-col gap-3">
      {idInput}
      <input type="hidden" name="pageId" value={page.id} />
      <label className="text-sm font-medium">
        Titre (recommandé : {TITLE_RANGE.min}–{TITLE_RANGE.max} caractères — actuellement {(page.seo.title ?? page.title).length})
        <input name="seoTitle" defaultValue={page.seo.title ?? ""} maxLength={120} className={`${INPUT} mt-1`} disabled={!canEdit} />
      </label>
      <label className="text-sm font-medium">
        Description (recommandé : {DESCRIPTION_RANGE.min}–{DESCRIPTION_RANGE.max} caractères — actuellement {(page.seo.description ?? "").length})
        <textarea name="seoDescription" defaultValue={page.seo.description ?? ""} maxLength={320} rows={3} className={`${INPUT} mt-1`} disabled={!canEdit} />
      </label>
      {canEdit && <SubmitButton className="adm-btn-secondary self-start">Enregistrer le référencement</SubmitButton>}
    </form>
  );
}

function BlockCard({ block, index, page, canEdit, idInput, free = false }: { block: Block; index: number; page: Page; canEdit: boolean; idInput: IdInput; free?: boolean }) {
  const props = block.props as Record<string, unknown>;
  const fields = BLOCK_FIELDS[block.type];
  const isHome = page.kind === "home";
  const common = (
    <>
      {idInput}
      <input type="hidden" name="pageId" value={page.id} />
      <input type="hidden" name="blockId" value={block.id} />
    </>
  );
  return (
    <article className={`flexco-info-panel ${block.visible ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-navy-900">
          {index + 1}. {blockLabel(block)} {!block.visible && <span className="text-xs font-normal text-slate-500">(masquée)</span>}
        </p>
        {canEdit && (
          <div className="flex gap-2">
            <form action={moveBlockAction}>{common}<input type="hidden" name="toIndex" value={index - 1} /><button type="submit" className="adm-btn-secondary" disabled={index === 0} aria-label="Monter">↑</button></form>
            <form action={moveBlockAction}>{common}<input type="hidden" name="toIndex" value={index + 1} /><button type="submit" className="adm-btn-secondary" disabled={index === page.blocks.length - 1} aria-label="Descendre">↓</button></form>
            <form action={toggleBlockAction}>{common}<input type="hidden" name="visible" value={String(!block.visible)} /><button type="submit" className="adm-btn-secondary">{block.visible ? "Masquer" : "Afficher"}</button></form>
            {(!isHome || free) && (
              <form action={removeBlockAction}>{common}<ConfirmSubmitButton message="Retirer ce bloc de la page ?">Retirer</ConfirmSubmitButton></form>
            )}
          </div>
        )}
      </div>
      {!fields && <p className="mt-2 text-xs text-slate-500">{isRichBlockType(block.type) ? "Ce bloc se compose avec l'assistant (dans le chat) : demandez-lui de le modifier. Ici vous pouvez le déplacer, le masquer ou le retirer." : "Cette section affiche vos données (catalogue, FAQ, avis…) avec les intitulés de votre secteur."}</p>}
      {fields && canEdit && (
        <form action={saveBlockAction} className="mt-3 flex flex-col gap-2">
          {common}
          {fields.map((f) => (
            <label key={f.name} className="text-xs font-medium text-slate-600">
              {f.label}
              {f.multiline ? (
                <textarea name={`f_${f.name}`} defaultValue={String(props[f.name] ?? "")} maxLength={f.max} rows={5} className={`${INPUT} mt-1`} />
              ) : (
                <input name={`f_${f.name}`} defaultValue={String(props[f.name] ?? "")} maxLength={f.max} className={`${INPUT} mt-1`} />
              )}
            </label>
          ))}
          <SubmitButton className="adm-btn-secondary self-start">Enregistrer cette section</SubmitButton>
        </form>
      )}
    </article>
  );
}

export default async function SiteVersionsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const customization = await canUseFeature(organizationId, "site_customization", 1);
  if (!customization.allowed) {
    return (
      <div className="flexco-page">
        <p className="flexco-eyebrow">Ma vitrine</p>
        <h1 className="mt-2 font-jakarta text-2xl font-extrabold">Versions du site</h1>
        <p className="mt-2 text-sm text-slate-500">La personnalisation complète est disponible à partir de Starter.</p>
        <a href="/dashboard/subscription" className="adm-btn-primary mt-4 inline-flex">Voir Starter</a>
      </div>
    );
  }

  const [permissions, draft, published, versions] = await Promise.all([
    getSitePermissions(organizationId),
    getSiteDraft(organizationId),
    getPublishedSite(organizationId),
    listSiteVersions(organizationId),
  ]);

  const home = draft?.snapshot.pages.find((p) => p.kind === "home");
  const extraPages = draft?.snapshot.pages.filter((p) => p.kind === "page") ?? [];
  const homeTypes = new Set(home?.blocks.map((b) => b.type) ?? []);
  const missingHomeSections = LANDING_SECTION_TYPES.filter((type) => !homeTypes.has(type));
  const lint = draft ? lintSiteSnapshot(draft.snapshot) : null;
  const idInput = <input type="hidden" name="organizationId" value={organizationId} />;
  const isFree = draft?.snapshot.mode === "free";
  const steps = draft ? await listDraftRevisions(organizationId, 30) : [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flexco-eyebrow">Ma vitrine</p>
          <h1 className="mt-1 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Versions du site</h1>
          <p className="mt-1 text-sm text-slate-500">
            Travaillez sur un brouillon, vérifiez le référencement, puis publiez. Vos visiteurs ne voient jamais le brouillon.
          </p>
        </div>
        <div className="flex gap-2">
          {draft && <a href="/dashboard/site/versions/preview" target="_blank" rel="noreferrer" className="adm-btn-secondary">Voir l&apos;aperçu</a>}
          <a href="/dashboard/site" className="adm-btn-secondary">← Réglages classiques</a>
        </div>
      </div>

      {error && <p className="adm-alert-danger">{error}</p>}
      {success && <p className="adm-alert-success">{success}</p>}

      <section className="flexco-info-panel">
        <p className="font-semibold text-navy-900">
          {published ? `Version ${published.versionNumber} publiée le ${fmt(published.publishedAt)}` : "Aucune version publiée : votre site utilise les réglages classiques."}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {draft ? `Un brouillon est en cours (version ${draft.versionNumber}).` : "Aucun brouillon en cours."}
        </p>
        {!draft && permissions.canEdit && (
          <form action={startDraftAction} className="mt-3">
            {idInput}
            <SubmitButton className="adm-btn-primary">Créer un brouillon à partir de mon site actuel</SubmitButton>
          </form>
        )}
        {!permissions.canEdit && <p className="mt-2 text-sm text-amber-800">Vous pouvez consulter les versions mais pas les modifier.</p>}
      </section>

      {draft && home && lint && (
        <>
          <section className="flexco-info-panel">
            <h2 className="font-semibold text-navy-900">Contrôle avant publication</h2>
            {lint.issues.length === 0 && <p className="mt-2 text-sm text-emerald-700">Tout est en ordre.</p>}
            {lint.errors.length > 0 && (
              <div className="adm-alert-danger mt-2">
                <p className="font-semibold">À corriger pour pouvoir publier :</p>
                <ul className="mt-1 list-disc pl-5 text-sm">{lint.errors.map((i, n) => <li key={n}>{i.message}</li>)}</ul>
              </div>
            )}
            {lint.warnings.length > 0 && (
              <div className="adm-alert-warning mt-2">
                <p className="font-semibold">Conseils (ne bloquent pas la publication) :</p>
                <ul className="mt-1 list-disc pl-5 text-sm">{lint.warnings.map((i, n) => <li key={n}>{i.message}</li>)}</ul>
              </div>
            )}
          </section>

          {permissions.canEdit && !isFree && (
            <section className="flexco-info-panel">
              <h2 className="font-semibold text-navy-900">Modèles de site complets</h2>
              <p className="mt-1 text-xs text-slate-500">Recompose votre accueil et ajoute une page d&apos;information (site libre). Aucun chiffre ni avis n&apos;est inventé ; tout reste modifiable, avec retour en arrière possible.</p>
              <form action={applyTemplateAction} className="mt-3 flex flex-wrap items-end gap-2">
                {idInput}
                <label className="text-xs font-medium text-slate-600">
                  Modèle
                  <select name="template" className={`${INPUT} mt-1`}>
                    <option value="health">Santé &amp; médecine</option>
                    <option value="education">Éducation &amp; formation</option>
                  </select>
                </label>
                <ConfirmSubmitButton message="Remplacer l'accueil du brouillon par ce modèle ? Vous pourrez revenir à l'étape précédente.">Appliquer au brouillon</ConfirmSubmitButton>
              </form>
            </section>
          )}

          {permissions.canEdit && isPlatformTenant(organizationId) && (
            <section className="flexco-info-panel">
              <h2 className="font-semibold text-navy-900">Contenu Flexco (offres actuelles)</h2>
              <p className="mt-1 text-xs text-slate-500">Génère la FAQ et l&apos;accueil de Flexco à partir des offres lues dans la base. Rien n&apos;est publié : relisez le brouillon, puis publiez.</p>
              <form action={platformBootstrapAction} className="mt-3">
                {idInput}
                <ConfirmSubmitButton message="Recomposer l'accueil du brouillon et actualiser la FAQ de Flexco ?">Actualiser depuis les offres</ConfirmSubmitButton>
              </form>
              <a href="/dashboard/prospection" className="adm-btn-secondary mt-3 inline-flex">Prospection WhatsApp</a>
            </section>
          )}

          <section className="flexco-info-panel">
            <h2 className="font-semibold text-navy-900">Référencement de la page d&apos;accueil</h2>
            <SeoForm page={home} canEdit={permissions.canEdit} idInput={idInput} />
          </section>

          <section className="flexco-info-panel">
            <h2 className="font-semibold text-navy-900">Apparence</h2>
            <form action={saveThemeAction} className="mt-3 flex flex-col gap-3">
              {idInput}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="useDefaultColors" defaultChecked={draft.snapshot.theme.brandColorPrimary === null && draft.snapshot.theme.brandColorSecondary === null} disabled={!permissions.canEdit} />
                Utiliser les couleurs par défaut de mon secteur
              </label>
              <div className="flex gap-6">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span>Couleur principale</span>
                  <input type="color" name="brandColorPrimary" defaultValue={draft.snapshot.theme.brandColorPrimary ?? "#7c3aed"} disabled={!permissions.canEdit} className="h-10 w-16 rounded-xl border border-navy-900/10" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span>Couleur secondaire</span>
                  <input type="color" name="brandColorSecondary" defaultValue={draft.snapshot.theme.brandColorSecondary ?? "#f59e0b"} disabled={!permissions.canEdit} className="h-10 w-16 rounded-xl border border-navy-900/10" />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Police
                  <select name="fontChoice" defaultValue={draft.snapshot.theme.fontChoice} disabled={!permissions.canEdit} className={`${INPUT} mt-1`}>
                    {FONT_CHOICES.map((choice) => <option key={choice} value={choice}>{FONT_CHOICE_LABELS[choice]}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Ambiance visuelle
                  <select name="visualStyle" defaultValue={draft.snapshot.theme.visualStyle} disabled={!permissions.canEdit} className={`${INPUT} mt-1`}>
                    <option value="soft">Douce</option>
                    <option value="clean">Épurée</option>
                    <option value="bold">Impactante</option>
                  </select>
                </label>
              </div>
              {permissions.canEdit && <SubmitButton className="adm-btn-secondary self-start">Enregistrer l&apos;apparence</SubmitButton>}
            </form>
          </section>

          <section className="flexco-info-panel">
            <h2 className="font-semibold text-navy-900">Barre d&apos;annonce</h2>
            <form action={saveAnnouncementAction} className="mt-3 flex flex-col gap-3">
              {idInput}
              <label className="text-sm font-medium">
                Message (laisser vide pour retirer la barre)
                <input name="announcementText" defaultValue={draft.snapshot.announcement?.text ?? ""} maxLength={200} className={`${INPUT} mt-1`} disabled={!permissions.canEdit} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="announcementEnabled" defaultChecked={draft.snapshot.announcement?.enabled ?? true} disabled={!permissions.canEdit} />
                Afficher la barre sur le site
              </label>
              {permissions.canEdit && <SubmitButton className="adm-btn-secondary self-start">Enregistrer l&apos;annonce</SubmitButton>}
            </form>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-semibold text-navy-900">Sections de la page d&apos;accueil</h2>
            {home.blocks.map((block, index) => (
              <BlockCard key={block.id} block={block} index={index} page={home} canEdit={permissions.canEdit} idInput={idInput} free={isFree} />
            ))}
            {permissions.canEdit && !isFree && missingHomeSections.length > 0 && (
              <form action={addBlockAction} className="flexco-info-panel flex flex-wrap items-end gap-2">
                {idInput}
                <input type="hidden" name="pageId" value={home.id} />
                <label className="text-xs font-medium text-slate-600">
                  Ajouter une section à l&apos;accueil
                  <select name="blockType" className={`${INPUT} mt-1`}>
                    {missingHomeSections.map((type) => <option key={type} value={type}>{LANDING_SECTION_LABELS[type]}</option>)}
                  </select>
                </label>
                <SubmitButton className="adm-btn-secondary">Ajouter</SubmitButton>
              </form>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-semibold text-navy-900">Pages supplémentaires</h2>
            <p className="text-xs text-slate-500">Chaque page a son adresse (ex. /notre-histoire), son référencement et son propre contenu. Elles ne sont en ligne qu&apos;à la publication.</p>
            {extraPages.map((page) => {
              const inMenu = draft.snapshot.navigation.some((n) => n.kind === "page" && n.pageId === page.id);
              const usedTypes = new Set(page.blocks.map((b) => b.type));
              return (
                <article key={page.id} className="flexco-info-panel flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-navy-900">
                      {page.title} <span className="text-xs font-normal text-slate-500">/{page.slug}</span>{" "}
                      <a href={`/dashboard/site/versions/preview?page=${encodeURIComponent(page.slug)}`} target="_blank" rel="noreferrer" className="text-xs font-normal text-violet-700 underline">Aperçu</a>
                    </p>
                    {permissions.canEdit && (
                      <div className="flex gap-2">
                        <form action={toggleMenuAction}>
                          {idInput}<input type="hidden" name="pageId" value={page.id} /><input type="hidden" name="inMenu" value={String(!inMenu)} />
                          <button type="submit" className="adm-btn-secondary">{inMenu ? "Retirer du menu" : "Ajouter au menu"}</button>
                        </form>
                        <form action={removePageAction}>
                          {idInput}<input type="hidden" name="pageId" value={page.id} />
                          <ConfirmSubmitButton message={`Supprimer la page « ${page.title} » du brouillon ?`}>Supprimer la page</ConfirmSubmitButton>
                        </form>
                      </div>
                    )}
                  </div>
                  <SeoForm page={page} canEdit={permissions.canEdit} idInput={idInput} />
                  {page.blocks.map((block, index) => (
                    <BlockCard key={block.id} block={block} index={index} page={page} canEdit={permissions.canEdit} idInput={idInput} free={isFree} />
                  ))}
                  {permissions.canEdit && (
                    <form action={addBlockAction} className="flex flex-wrap items-end gap-2">
                      {idInput}
                      <input type="hidden" name="pageId" value={page.id} />
                      <label className="text-xs font-medium text-slate-600">
                        Ajouter un bloc
                        <select name="blockType" className={`${INPUT} mt-1`}>
                          {PAGE_BLOCK_TYPES.filter((t) => t === "text" || !usedTypes.has(t)).map((type) => (
                            <option key={type} value={type}>{type === "text" ? "Texte libre" : LANDING_SECTION_LABELS[type as keyof typeof LANDING_SECTION_LABELS]}</option>
                          ))}
                        </select>
                      </label>
                      <SubmitButton className="adm-btn-secondary">Ajouter</SubmitButton>
                    </form>
                  )}
                </article>
              );
            })}
            {permissions.canEdit && extraPages.length < MAX_PAGES - 1 && (
              <form action={createPageAction} className="flexco-info-panel flex flex-col gap-2">
                {idInput}
                <p className="text-sm font-medium">Créer une page</p>
                <input name="title" required maxLength={120} placeholder="Titre (ex. Notre histoire)" className={INPUT} />
                <input name="slug" maxLength={60} placeholder="Adresse (facultatif — ex. notre-histoire)" pattern="[a-z0-9]+(-[a-z0-9]+)*" className={INPUT} />
                <textarea name="body" maxLength={5000} rows={4} placeholder="Premier texte de la page (facultatif)" className={INPUT} />
                <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="inNavigation" /> Afficher dans le menu</label>
                <SubmitButton className="adm-btn-secondary self-start">Créer la page</SubmitButton>
              </form>
            )}
          </section>

          <section className="flexco-info-panel flex flex-wrap items-center gap-3">
            {permissions.canPublish ? (
              <form action={publishAction}>
                {idInput}
                <ConfirmSubmitButton className="adm-btn-primary" message="Publier ce brouillon ? Vos visiteurs verront ces changements immédiatement.">
                  Publier le brouillon
                </ConfirmSubmitButton>
              </form>
            ) : (
              <p className="text-sm text-slate-500">Seuls le propriétaire, les administrateurs et les personnes à qui le propriétaire a accordé ce droit peuvent publier.</p>
            )}
            {permissions.canEdit && (
              <form action={discardAction}>
                {idInput}
                <ConfirmSubmitButton message="Abandonner le brouillon ? Vos modifications non publiées seront perdues (le site publié ne change pas).">Abandonner le brouillon</ConfirmSubmitButton>
              </form>
            )}
          </section>
        </>
      )}

      {draft && (
        <section className="flexco-info-panel">
          <h2 className="font-semibold text-navy-900">Étapes du brouillon{isFree ? " (site libre)" : ""}</h2>
          <p className="mt-1 text-xs text-slate-500">Chaque modification, manuelle ou faite par l&apos;assistant, est enregistrée. Vous pouvez remettre le brouillon dans l&apos;état d&apos;une étape ; le retour est lui-même une étape. Le site publié n&apos;est pas touché.</p>
          <ul className="mt-3 divide-y divide-navy-900/10">
            {steps.map((st) => (
              <li key={st.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><strong>Étape {st.revisionNumber}</strong> · {STEP_LABELS[st.source]} · {fmt(st.createdAt)}<br /><span className="text-xs text-slate-500">{st.summary.slice(0, 200)}</span></span>
                {permissions.canEdit && st.revisionNumber !== steps[0]?.revisionNumber && (
                  <form action={revertAction}>
                    {idInput}<input type="hidden" name="revisionId" value={st.id} />
                    <ConfirmSubmitButton message={`Remettre le brouillon dans l'état de l'étape ${st.revisionNumber} ?`}>Revenir à cette étape</ConfirmSubmitButton>
                  </form>
                )}
              </li>
            ))}
            {steps.length === 0 && <li className="py-2 text-sm text-slate-500">Aucune modification enregistrée pour ce brouillon.</li>}
          </ul>
        </section>
      )}

      <section className="flexco-info-panel">
        <h2 className="font-semibold text-navy-900">Historique</h2>
        <ul className="mt-3 divide-y divide-navy-900/10">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <strong>Version {v.versionNumber}</strong> · {STATUS_LABELS[v.status]} · {SOURCE_LABELS[v.source]} · {fmt(v.publishedAt ?? v.createdAt)}
              </span>
              {permissions.canPublish && v.status === "archived" && (
                <form action={restoreAction} className="flex items-center gap-2">
                  {idInput}
                  <input type="hidden" name="versionId" value={v.id} />
                  {draft && (
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input type="checkbox" name="discardDraft" /> Abandonner mon brouillon actuel
                    </label>
                  )}
                  <ConfirmSubmitButton message={`Créer un brouillon à partir de la version ${v.versionNumber} ? Rien n'est publié tant que vous ne publiez pas.`}>Restaurer</ConfirmSubmitButton>
                </form>
              )}
            </li>
          ))}
          {versions.length === 0 && <li className="py-2 text-sm text-slate-500">Aucune version pour le moment.</li>}
        </ul>
      </section>
    </div>
  );
}
