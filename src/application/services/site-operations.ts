import { z } from "zod";
import { randomUUID } from "node:crypto";
import { SECTOR_TEMPLATES, buildSectorTemplate } from "./site-sector-templates";
import {
  BLOCK_TYPES,
  BlockSchema,
  NavItemSchema,
  PageSchema,
  PageSeoSchema,
  SiteSnapshotSchema,
  ThemeSchema,
  type Block,
  type SiteSnapshot,
} from "@/domain/entities/site";

/**
 * Opérations d'édition du site (C4 : textes, ordre et visibilité des blocs,
 * thème, SEO de page, annonce, ajout/retrait de blocs et de pages, navigation). Fonctions PURES : elles
 * transforment un instantané en un autre et le revalident entièrement. Ni
 * l'éditeur manuel ni l'agent Site ne touchent au JSON autrement — l'agent
 * ne réécrit jamais de code, il émet des opérations (données).
 *
 * Atomicité : si UNE opération échoue, aucune n'est appliquée.
 */

export const MAX_OPERATIONS_PER_CALL = 50;

const Id = z.string().min(1).max(64);
/** Bloc à créer : le serveur attribue l'identifiant ; les propriétés sont revalidées par le schéma du type. */
const BlockInputSchema = z.object({ type: z.enum(BLOCK_TYPES), props: z.record(z.string(), z.unknown()).optional(), visible: z.boolean().optional() }).strict();
const MAX_BLOCKS_INPUT = 40;

export const SiteOperationSchema = z.discriminatedUnion("op", [
  /** Fusionne `props` dans le bloc ; une valeur `null` supprime la clé. */
  z.object({ op: z.literal("set_block_props"), pageId: Id, blockId: Id, props: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ op: z.literal("set_block_visible"), pageId: Id, blockId: Id, visible: z.boolean() }).strict(),
  /** `toIndex` : position finale (0 = en haut), bornée à la taille de la page. */
  z.object({ op: z.literal("move_block"), pageId: Id, blockId: Id, toIndex: z.number().int().min(0) }).strict(),
  z.object({ op: z.literal("set_theme"), theme: ThemeSchema.partial().strict() }).strict(),
  z.object({ op: z.literal("set_page_title"), pageId: Id, title: z.string().min(1).max(120) }).strict(),
  /** Fusionne les champs SEO ; `null` supprime un champ. */
  z.object({ op: z.literal("set_page_seo"), pageId: Id, seo: z.record(z.string(), z.unknown()) }).strict(),
  /**
   * Ajoute un bloc. Accueil : une section du moteur absente de la page (sinon la
   * réafficher). Page supplémentaire : `text` ou une section de données. Placé après
   * `afterBlockId`, ou en dernier.
   */
  z.object({ op: z.literal("add_block"), pageId: Id, blockType: z.enum(BLOCK_TYPES), afterBlockId: Id.optional(), props: z.record(z.string(), z.unknown()).optional() }).strict(),
  /** Retire un bloc d'une page supplémentaire. Sur l'accueil on MASQUE (rien ne se perd). */
  z.object({ op: z.literal("remove_block"), pageId: Id, blockId: Id }).strict(),
  /** Crée une page (`/slug`) ; `body` crée un premier bloc texte, `blocks` une page composée ; `inNavigation` l'ajoute au menu. */
  z.object({
    op: z.literal("add_page"), title: z.string().min(1).max(120), slug: z.string().min(1).max(60), body: z.string().max(5000).optional(),
    blocks: z.array(BlockInputSchema).max(MAX_BLOCKS_INPUT).optional(), inNavigation: z.boolean().optional(),
  }).strict(),
  /** Passe le site en mode libre (accueil et pages composés de blocs riches). Irréversible dans le brouillon : on revient en arrière par une version précédente. */
  z.object({ op: z.literal("set_mode"), mode: z.literal("free") }).strict(),
  /**
   * Applique un modèle de site libre par secteur (santé, éducation) : passe en mode libre, remplace l'accueil par la
   * composition du modèle, ajoute (ou remplace) ses pages d'information et leurs entrées de menu, et reprend la palette
   * du secteur si le thème n'a pas de couleurs propres. Textes génériques modifiables ; aucun chiffre inventé.
   */
  z.object({ op: z.literal("apply_sector_template"), template: z.enum(SECTOR_TEMPLATES) }).strict(),
  /** Remplace TOUS les blocs d'une page (composition complète en une opération). */
  z.object({ op: z.literal("replace_page_blocks"), pageId: Id, blocks: z.array(BlockInputSchema).max(MAX_BLOCKS_INPUT) }).strict(),
  /** Copie un bloc juste après lui (site libre ou page supplémentaire). */
  z.object({ op: z.literal("duplicate_block"), pageId: Id, blockId: Id }).strict(),
  z.object({ op: z.literal("set_page_slug"), pageId: Id, slug: z.string().min(1).max(60) }).strict(),
  z.object({ op: z.literal("remove_page"), pageId: Id }).strict(),
  /** Définit les entrées AJOUTÉES au menu du produit (max 8 ; le menu existant reste, « Contact » en dernier). */
  z.object({ op: z.literal("set_navigation"), items: z.array(NavItemSchema).max(8) }).strict(),
  z.object({ op: z.literal("set_announcement"), announcement: z.object({ text: z.string().max(200), enabled: z.boolean() }).strict().nullable() }).strict(),
]);
export type SiteOperation = z.infer<typeof SiteOperationSchema>;

export type ApplyResult =
  | { ok: true; snapshot: SiteSnapshot; changes: string[] }
  | { ok: false; error: string; operationIndex: number | null };

function mergeWithNulls(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

function compactObject(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "données invalides";
  const path = issue.path.length > 0 ? ` (${issue.path.join(".")})` : "";
  return `${issue.message}${path}`;
}

export interface ApplyOptions {
  /** Générateur d'identifiants (injectable pour des tests déterministes). */
  newId?: () => string;
}

const defaultNewId = () => randomUUID().slice(0, 8);

export function applySiteOperations(input: SiteSnapshot, rawOperations: unknown, options: ApplyOptions = {}): ApplyResult {
  const newId = options.newId ?? defaultNewId;
  const parsedOps = z.array(SiteOperationSchema).max(MAX_OPERATIONS_PER_CALL).safeParse(rawOperations);
  if (!parsedOps.success) {
    return { ok: false, error: `Opération invalide : ${describeIssue(parsedOps.error)}`, operationIndex: null };
  }

  const draft: SiteSnapshot = structuredClone(input);
  const changes: string[] = [];

  for (const [index, operation] of parsedOps.data.entries()) {
    const fail = (error: string): ApplyResult => ({ ok: false, error, operationIndex: index });
    const page = "pageId" in operation ? draft.pages.find((p) => p.id === operation.pageId) : undefined;
    if ("pageId" in operation && !page) return fail(`Page introuvable : ${operation.pageId}`);

    let block: Block | undefined;
    if ("blockId" in operation && page) {
      block = page.blocks.find((b) => b.id === operation.blockId);
      if (!block) return fail(`Bloc introuvable : ${operation.blockId}`);
    }

    switch (operation.op) {
      case "set_block_props": {
        const merged = mergeWithNulls(block!.props as Record<string, unknown>, operation.props);
        const checked = BlockSchema.safeParse({ ...block, props: merged });
        if (!checked.success) return fail(`Propriétés invalides pour « ${block!.type} » : ${describeIssue(checked.error)}`);
        block!.props = checked.data.props as never;
        changes.push(`Bloc « ${block!.type} » : ${Object.keys(operation.props).join(", ")} modifié(s)`);
        break;
      }
      case "set_block_visible":
        if (block!.visible !== operation.visible) {
          block!.visible = operation.visible;
          changes.push(`Bloc « ${block!.type} » : ${operation.visible ? "affiché" : "masqué"}`);
        }
        break;
      case "move_block": {
        const from = page!.blocks.findIndex((b) => b.id === operation.blockId);
        const to = Math.min(operation.toIndex, page!.blocks.length - 1);
        if (from !== to) {
          const [moved] = page!.blocks.splice(from, 1);
          page!.blocks.splice(to, 0, moved!);
          changes.push(`Bloc « ${block!.type} » : déplacé de la position ${from + 1} à ${to + 1}`);
        }
        break;
      }
      case "set_theme":
        draft.theme = { ...draft.theme, ...operation.theme };
        changes.push(`Thème : ${Object.keys(operation.theme).join(", ")} modifié(s)`);
        break;
      case "set_page_title":
        page!.title = operation.title;
        changes.push(`Page « ${page!.id} » : titre changé`);
        break;
      case "set_page_seo": {
        const merged = mergeWithNulls(page!.seo as Record<string, unknown>, operation.seo);
        const checked = PageSeoSchema.safeParse(merged);
        if (!checked.success) return fail(`SEO invalide : ${describeIssue(checked.error)}`);
        page!.seo = checked.data;
        changes.push(`Page « ${page!.id} » : SEO (${Object.keys(operation.seo).join(", ")}) modifié`);
        break;
      }
      case "add_block": {
        const isHome = page!.kind === "home";
        const free = draft.mode === "free";
        if (isHome && !free && page!.blocks.some((b) => b.type === operation.blockType)) {
          return fail(`La section « ${operation.blockType} » est déjà sur l'accueil : affichez-la plutôt que d'en ajouter une autre.`);
        }
        const created = BlockSchema.safeParse({ id: isHome && !free ? `blk-${operation.blockType}` : `blk-${operation.blockType}-${newId()}`, type: operation.blockType, visible: true, props: operation.props ?? {} });
        if (!created.success) return fail(`Bloc « ${operation.blockType} » invalide : ${describeIssue(created.error)}`);
        const afterIndex = operation.afterBlockId ? page!.blocks.findIndex((b) => b.id === operation.afterBlockId) : page!.blocks.length - 1;
        if (operation.afterBlockId && afterIndex === -1) return fail(`Bloc introuvable : ${operation.afterBlockId}`);
        page!.blocks.splice(afterIndex + 1, 0, created.data);
        changes.push(`Page « ${page!.title} » : bloc « ${operation.blockType} » ajouté`);
        break;
      }
      case "remove_block":
        if (page!.kind === "home" && draft.mode !== "free") return fail("Sur l'accueil, masquez la section au lieu de la retirer.");
        page!.blocks = page!.blocks.filter((b) => b.id !== operation.blockId);
        changes.push(`Page « ${page!.title} » : bloc « ${block!.type} » retiré`);
        break;
      case "add_page": {
        const created = PageSchema.safeParse({
          id: `p-${newId()}`,
          kind: "page",
          slug: operation.slug,
          title: operation.title,
          seo: {},
          blocks: operation.blocks
            ? operation.blocks.map((b) => ({ id: `blk-${b.type}-${newId()}`, type: b.type, visible: b.visible ?? true, props: b.props ?? {} }))
            : operation.body ? [{ id: `blk-text-${newId()}`, type: "text", visible: true, props: { body: operation.body } }] : [],
        });
        if (!created.success) return fail(`Page invalide : ${describeIssue(created.error)}`);
        draft.pages.push(created.data);
        if (operation.inNavigation) draft.navigation.push({ kind: "page", label: operation.title.slice(0, 30), pageId: created.data.id });
        changes.push(`Page « ${operation.title} » créée (/${operation.slug})`);
        break;
      }
      case "remove_page":
        if (page!.kind === "home") return fail("La page d'accueil ne peut pas être supprimée.");
        draft.pages = draft.pages.filter((p) => p.id !== page!.id);
        draft.navigation = draft.navigation.filter((n) => !(n.kind === "page" && n.pageId === page!.id));
        changes.push(`Page « ${page!.title} » supprimée`);
        break;
      case "set_mode": {
        if (draft.mode === "free") break;
        const home = draft.pages.find((p) => p.kind === "home")!;
        const converted: Block[] = [];
        const dropped: string[] = [];
        for (const b of home.blocks) {
          if (b.type === "hero") {
            const h = b.props;
            const title = h.title?.trim() || home.title;
            converted.push({
              id: `blk-rich_hero-${newId()}`, type: "rich_hero", visible: b.visible,
              props: compactObject({
                title, subtitle: h.subtitle, mediaUrl: h.mediaUrl, mediaAlt: h.mediaAlt, layout: h.layout,
                primaryCta: h.ctaLabel && h.ctaUrl ? { label: h.ctaLabel, href: h.ctaUrl } : undefined,
                secondaryCta: h.secondaryCtaLabel && h.secondaryCtaUrl ? { label: h.secondaryCtaLabel, href: h.secondaryCtaUrl } : undefined,
              }) as never,
            });
          } else if (b.type === "cta" || b.type === "booking") {
            dropped.push(b.type);
          } else {
            converted.push({ ...b, id: `blk-${b.type}-${newId()}` } as Block);
          }
        }
        home.blocks = converted;
        draft.mode = "free";
        changes.push(`Site libre activé${dropped.length ? ` (sections du gabarit non reprises : ${dropped.join(", ")})` : ""}`);
        break;
      }
      case "apply_sector_template": {
        const home = draft.pages.find((p) => p.kind === "home")!;
        const content = buildSectorTemplate(operation.template, home.title);
        const toBlocks = (blocks: { type: string; props: Record<string, unknown> }[]) =>
          blocks.map((b) => ({ id: `blk-${b.type}-${newId()}`, type: b.type, visible: true, props: b.props })) as Block[];
        draft.mode = "free";
        home.blocks = toBlocks(content.home);
        for (const tpl of content.pages) {
          const existing = draft.pages.find((p) => p.kind === "page" && p.slug === tpl.slug);
          if (existing) {
            existing.blocks = toBlocks(tpl.blocks);
            continue;
          }
          const created = PageSchema.safeParse({ id: `p-${newId()}`, kind: "page", slug: tpl.slug, title: tpl.title, seo: {}, blocks: toBlocks(tpl.blocks) });
          if (!created.success) return fail(`Page du modèle invalide : ${describeIssue(created.error)}`);
          draft.pages.push(created.data);
          if (tpl.inNavigation) draft.navigation.push({ kind: "page", label: tpl.title.slice(0, 30), pageId: created.data.id });
        }
        if (draft.theme.brandColorPrimary === null && draft.theme.brandColorSecondary === null) {
          draft.theme = { ...draft.theme, brandColorPrimary: content.accent.primary, brandColorSecondary: content.accent.secondary };
        }
        changes.push(`Modèle « ${operation.template === "health" ? "Santé" : "Éducation"} » appliqué : accueil recomposé, ${content.pages.length} page(s) d'information`);
        break;
      }
      case "replace_page_blocks": {
        page!.blocks = operation.blocks.map((b) => ({ id: `blk-${b.type}-${newId()}`, type: b.type, visible: b.visible ?? true, props: b.props ?? {} })) as Block[];
        changes.push(`Page « ${page!.title} » : ${operation.blocks.length} bloc(s) composé(s)`);
        break;
      }
      case "duplicate_block": {
        if (page!.kind === "home" && draft.mode !== "free") return fail("Sur l'accueil d'un site par modèle, chaque section n'existe qu'une fois.");
        const index = page!.blocks.findIndex((b) => b.id === operation.blockId);
        page!.blocks.splice(index + 1, 0, { ...structuredClone(block!), id: `blk-${block!.type}-${newId()}` } as Block);
        changes.push(`Page « ${page!.title} » : bloc « ${block!.type} » dupliqué`);
        break;
      }
      case "set_page_slug":
        if (page!.kind === "home") return fail("L'accueil n'a pas d'adresse modifiable.");
        page!.slug = operation.slug;
        changes.push(`Page « ${page!.title} » : adresse changée en /${operation.slug}`);
        break;
      case "set_navigation":
        draft.navigation = operation.items;
        changes.push(`Menu : ${operation.items.length === 0 ? "aucune entrée ajoutée" : `${operation.items.length} entrée(s) ajoutée(s)`}`);
        break;
      case "set_announcement":
        draft.announcement = operation.announcement;
        changes.push(operation.announcement ? "Barre d'annonce modifiée" : "Barre d'annonce retirée");
        break;
    }
  }

  const finalCheck = SiteSnapshotSchema.safeParse(draft);
  if (!finalCheck.success) return { ok: false, error: `Le site résultant est invalide : ${describeIssue(finalCheck.error)}`, operationIndex: null };
  return { ok: true, snapshot: finalCheck.data, changes };
}
