/**
 * Domaine « Administration de l'entreprise » (étape 4) : équipe, FAQ, fiche entreprise, alertes, abonnement et crédits (lecture).
 *
 * Règles :
 *  - accorder, changer ou retirer un accès (invitation, rôle, retrait) est SENSIBLE : validation + PIN, toujours ;
 *  - supprimer une FAQ est sensible (suppression de données) ;
 *  - ce que les clients voient (texte de FAQ, fiche entreprise) est `confirmAlways` : validé avant publication ;
 *  - l'abonnement, les paiements et le domaine ne se modifient PAS depuis le chat (lecture seule, le changement se fait dans le tableau de bord) ;
 *  - les jetons d'invitation ne sont jamais renvoyés au modèle ; les emails sont masqués dans les sorties.
 */
import { z } from "zod";
import type { Actor, Role, ToolCtx, ToolDef, ToolPreview } from "../contracts";
import { AgentError } from "../errors";
import type { DomainRegistrar } from "./index";

const uuid = z.string().uuid();
const short = (max: number) => z.string().trim().min(1).max(max);
const clip = (s: string | null | undefined, n: number): string | null => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);
const noAmount = async () => 0;

export const ADMIN_ROLES: readonly Role[] = ["owner", "admin"];
export const FAQ_ROLES: readonly Role[] = ["owner", "admin", "manager"];
export const ASSIGNABLE_ROLES = ["admin", "manager", "employee"] as const;
const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

export interface AdminServices {
  listMembers(org: string): Promise<{ userId: string; role: string; email: string | null; joinedAt: string }[]>;
  listInvitations(org: string): Promise<{ id: string; email: string; role: string; status: string; expiresAt: string }[]>;
  invite(org: string, email: string, role: string, actorUserId: string): Promise<{ invitationId: string; emailDelivered: boolean }>;
  revokeInvitation(org: string, id: string): Promise<void>;
  setRole(org: string, targetUserId: string, role: string, actor: { userId: string; role: Role }): Promise<void>;
  removeMember(org: string, targetUserId: string, actor: { userId: string; role: Role }): Promise<void>;
  listFaqs(org: string): Promise<{ id: string; question: string; answer: string; keywords: string[]; isActive: boolean }[]>;
  createFaq(org: string, i: { question: string; answer: string; keywords: string[] }): Promise<{ faqId: string; warnings?: string[] }>;
  updateFaq(org: string, id: string, i: { question?: string; answer?: string; keywords?: string[]; isActive?: boolean }): Promise<void>;
  deleteFaq(org: string, id: string): Promise<void>;
  getBusiness(org: string): Promise<{ name: string; description: string | null; phone: string | null; whatsappNumber: string | null; email: string | null; address: string | null; openingHours: Record<string, string> }>;
  updateBusiness(org: string, i: { name: string; description?: string; phone?: string; whatsappNumber?: string; email?: string; address?: string; openingHours?: Record<string, string> }): Promise<void>;
  getAlertSettings(org: string): Promise<AlertSettingsLike>;
  saveAlertSettings(org: string, s: AlertSettingsLike): Promise<void>;
  subscription(org: string): Promise<{ planName: string; status: string; usage: { label: string; used: number; limit: number }[] }>;
  credits(org: string): Promise<{ includedCredits: number; addonCredits: number; usedCredits: number; remainingCredits: number }>;
}

export interface AlertSettingsLike {
  triggers: Record<string, { enabled: boolean; threshold?: number }>;
  quietEnabled: boolean; quietStart: string; quietEnd: string; escalationDelayMinutes: number; fallbackMembershipId: string | null;
}

export function defaultAdminServices(): AdminServices {
  const team = () => import("@/application/services/team-service");
  const faq = () => import("@/application/services/faq-resolver");
  const biz = () => import("@/application/services/business-profile-service");
  const alerts = () => import("@/application/services/alert-service");
  return {
    listMembers: async (o) => (await team()).listMembers(o),
    listInvitations: async (o) => (await team()).listPendingInvitations(o),
    invite: async (o, e, r, u) => { const x = await (await team()).inviteMember(o, e, r as never, u); return { invitationId: x.invitationId, emailDelivered: x.emailDelivered }; },
    revokeInvitation: async (o, id) => (await team()).revokeInvitation(o, id),
    setRole: async (o, t, r, a) => (await team()).updateMemberRole(o, t, r as never, { userId: a.userId, organizationId: o, role: a.role }),
    removeMember: async (o, t, a) => (await team()).removeMember(o, t, { userId: a.userId, organizationId: o, role: a.role }),
    listFaqs: async (o) => (await faq()).listFaqs(o),
    createFaq: async (o, i) => (await faq()).createFaq({ organizationId: o, ...i }),
    updateFaq: async (o, id, i) => (await faq()).updateFaq(o, id, i),
    deleteFaq: async (o, id) => (await faq()).deleteFaq(o, id),
    getBusiness: async (o) => (await biz()).getBusinessProfile(o),
    updateBusiness: async (o, i) => (await biz()).updateBusinessProfile(o, i),
    getAlertSettings: async (o) => {
      const { getSupabaseServiceClient } = await import("@/infrastructure/supabase/server-client");
      return (await alerts()).loadAlertSettings(getSupabaseServiceClient(), o);
    },
    saveAlertSettings: async (o, s) => { await (await alerts()).saveAlertSettings(o, s); },
    subscription: async (o) => {
      const r = await (await import("@/application/services/subscription-service")).getSubscriptionOverview(o);
      return { planName: r.planName, status: String(r.status), usage: r.usage.filter((u) => u.mode === "cumulative").map((u) => ({ label: u.label, used: u.result.used, limit: u.result.limit })) };
    },
    credits: async (o) => (await import("@/application/services/ai-credits-service")).getCreditStatus(o),
  };
}

type Ctx = { actor: Actor };
type AnyTool = ToolDef<any, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any -- registre hétérogène

function requireHuman(actor: Actor): void {
  if (actor.channel === "customer") throw new AgentError("actor_required", "Un client ne peut pas utiliser les outils de gestion");
}

export function buildAdminTools(s: AdminServices): { tool: AnyTool; roles: readonly Role[] }[] {
  const org = (ctx: Ctx) => ctx.actor.tenantId;
  const def = <I, O>(roles: readonly Role[], d: Omit<ToolDef<I, O>, "domain">) => ({
    roles,
    tool: { ...d, domain: d.name.split(".")[0]!, run: async (ctx: ToolCtx, input: I) => { requireHuman(ctx.actor); return d.run(ctx, input); } } as unknown as AnyTool,
  });
  const notSelf = (ctx: Ctx, target: string) => {
    if (target === ctx.actor.userId) throw new AgentError("invalid_input", "Vous ne pouvez pas modifier votre propre accès depuis le chat.");
  };
  const memberLabel = async (ctx: Ctx, userId: string) => (await s.listMembers(org(ctx))).find((m) => m.userId === userId);

  return [
    // ---------- ÉQUIPE ----------
    def(ADMIN_ROLES, {
      name: "team.list", description: "Liste les membres de l'équipe (rôle, email masqué) et les invitations en attente.",
      input: z.object({}), risk: "read", permission: "team.read",
      run: async (ctx) => {
        const [members, invitations] = await Promise.all([s.listMembers(org(ctx)), s.listInvitations(org(ctx))]);
        return {
          members: members.map((m) => ({ userId: m.userId, role: m.role, email: maskEmail(m.email), joinedAt: m.joinedAt })),
          invitations: invitations.filter((i) => i.status === "pending").map((i) => ({ id: i.id, email: maskEmail(i.email), role: i.role, expiresAt: i.expiresAt })),
        };
      },
    }),
    def(ADMIN_ROLES, {
      name: "team.invite", description: "Invite quelqu'un dans l'équipe par email avec un rôle (admin, manager, employee). Donne un accès à l'entreprise : validation + PIN toujours.",
      input: z.object({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(ASSIGNABLE_ROLES) }),
      risk: "sensitive", permission: "team.write",
      preview: async (_ctx: Ctx, i: { email: string; role: string }): Promise<ToolPreview> => ({ title: "Inviter un membre", summary: `${i.email} comme ${i.role}`, details: [{ label: "Email", value: i.email }, { label: "Rôle", value: i.role }] }),
      run: async (ctx, i: { email: string; role: string }) => {
        const r = await s.invite(org(ctx), i.email, i.role, ctx.actor.userId);
        return { invitationId: r.invitationId, emailDelivered: r.emailDelivered, note: r.emailDelivered ? undefined : "Email non transmis : le lien d'invitation est visible dans Équipe, sur le tableau de bord." };
      },
    }),
    def(ADMIN_ROLES, {
      name: "team.revokeInvitation", description: "Annule une invitation en attente.",
      input: z.object({ invitationId: uuid }), risk: "write_reversible", permission: "team.write", amountOf: noAmount,
      run: async (ctx, i: { invitationId: string }) => { await s.revokeInvitation(org(ctx), i.invitationId); return { revoked: true }; },
    }),
    def(ADMIN_ROLES, {
      name: "team.setRole", description: "Change le rôle d'un membre (admin, manager, employee). Modifie des droits : validation + PIN toujours. Pas sur soi-même.",
      input: z.object({ userId: uuid, role: z.enum(ASSIGNABLE_ROLES) }), risk: "sensitive", permission: "team.write",
      preview: async (ctx: Ctx, i: { userId: string; role: string }): Promise<ToolPreview> => {
        const m = await memberLabel(ctx, i.userId);
        return { title: "Changer un rôle", summary: `${m?.email ?? "Membre"} : ${m?.role ?? "?"} → ${i.role}`, details: [{ label: "Membre", value: m?.email ?? i.userId }, { label: "Rôle actuel", value: m?.role ?? "inconnu" }, { label: "Nouveau rôle", value: i.role }] };
      },
      run: async (ctx, i: { userId: string; role: string }) => {
        notSelf(ctx, i.userId);
        await s.setRole(org(ctx), i.userId, i.role, { userId: ctx.actor.userId, role: ctx.actor.role });
        return { userId: i.userId, role: i.role };
      },
    }),
    def(ADMIN_ROLES, {
      name: "team.remove", description: "Retire un membre de l'équipe. Retire un accès : validation + PIN toujours. Pas sur soi-même.",
      input: z.object({ userId: uuid }), risk: "sensitive", permission: "team.write",
      preview: async (ctx: Ctx, i: { userId: string }): Promise<ToolPreview> => {
        const m = await memberLabel(ctx, i.userId);
        return { title: "Retirer un membre", summary: `${m?.email ?? "Membre"} (${m?.role ?? "?"}) perdra l'accès`, details: [{ label: "Membre", value: m?.email ?? i.userId }, { label: "Rôle", value: m?.role ?? "inconnu" }] };
      },
      run: async (ctx, i: { userId: string }) => { notSelf(ctx, i.userId); await s.removeMember(org(ctx), i.userId, { userId: ctx.actor.userId, role: ctx.actor.role }); return { removed: true }; },
    }),

    // ---------- FAQ ----------
    def(FAQ_ROLES, {
      name: "faq.list", description: "Liste les questions fréquentes (question, réponse, mots-clés, active ou non).",
      input: z.object({}), risk: "read", permission: "faq.read",
      run: async (ctx) => ({ faqs: (await s.listFaqs(org(ctx))).map((f) => ({ id: f.id, question: clip(f.question, 200), answer: clip(f.answer, 400), keywords: f.keywords, active: f.isActive })) }),
    }),
    def(FAQ_ROLES, {
      name: "faq.create", description: "Crée une question fréquente que l'assistant client utilisera pour répondre. Au moins un mot-clé. Les clients verront cette réponse : validation toujours.",
      input: z.object({ question: short(300), answer: short(1500), keywords: z.array(short(40)).min(1).max(15) }),
      risk: "write_reversible", permission: "faq.write", confirmAlways: true,
      preview: async (_c: Ctx, i: { question: string; answer: string; keywords: string[] }): Promise<ToolPreview> => ({ title: "Ajouter une FAQ", summary: `« ${clip(i.question, 100)} »`, details: [{ label: "Question", value: i.question }, { label: "Réponse", value: i.answer }, { label: "Mots-clés", value: i.keywords.join(", ") }] }),
      run: async (ctx, i: { question: string; answer: string; keywords: string[] }) => s.createFaq(org(ctx), i),
    }),
    def(FAQ_ROLES, {
      name: "faq.update", description: "Modifie le texte, la question ou les mots-clés d'une FAQ. Les clients verront la réponse : validation toujours.",
      input: z.object({ faqId: uuid, question: short(300).optional(), answer: short(1500).optional(), keywords: z.array(short(40)).min(1).max(15).optional() }).refine((v) => v.question !== undefined || v.answer !== undefined || v.keywords !== undefined, "Rien à modifier"),
      risk: "write_reversible", permission: "faq.write", confirmAlways: true,
      preview: async (ctx: Ctx, i: { faqId: string; question?: string; answer?: string; keywords?: string[] }): Promise<ToolPreview> => {
        const cur = (await s.listFaqs(org(ctx))).find((f) => f.id === i.faqId);
        return { title: "Modifier une FAQ", summary: `« ${clip(cur?.question ?? "FAQ", 100)} »`, details: [...(i.question ? [{ label: "Nouvelle question", value: i.question }] : []), ...(i.answer ? [{ label: "Ancienne réponse", value: clip(cur?.answer, 300) ?? "" }, { label: "Nouvelle réponse", value: i.answer }] : []), ...(i.keywords ? [{ label: "Mots-clés", value: i.keywords.join(", ") }] : [])] };
      },
      run: async (ctx, { faqId, ...rest }: { faqId: string; question?: string; answer?: string; keywords?: string[] }) => { await s.updateFaq(org(ctx), faqId, rest); return { updated: true }; },
    }),
    def(FAQ_ROLES, {
      name: "faq.setActive", description: "Active ou désactive une FAQ sans la supprimer.",
      input: z.object({ faqId: uuid, active: z.boolean() }), risk: "write_reversible", permission: "faq.write", amountOf: noAmount,
      run: async (ctx, i: { faqId: string; active: boolean }) => { await s.updateFaq(org(ctx), i.faqId, { isActive: i.active }); return { active: i.active }; },
    }),
    def(FAQ_ROLES, {
      name: "faq.delete", description: "Supprime définitivement une FAQ. Irréversible : validation + PIN toujours (préférer faq.setActive).",
      input: z.object({ faqId: uuid }), risk: "sensitive", permission: "faq.write",
      preview: async (ctx: Ctx, i: { faqId: string }): Promise<ToolPreview> => {
        const cur = (await s.listFaqs(org(ctx))).find((f) => f.id === i.faqId);
        return { title: "Supprimer une FAQ", summary: `« ${clip(cur?.question ?? "FAQ introuvable", 120)} »`, details: [{ label: "Question", value: cur?.question ?? "" }, { label: "Réponse", value: clip(cur?.answer, 300) ?? "" }] };
      },
      run: async (ctx, i: { faqId: string }) => { await s.deleteFaq(org(ctx), i.faqId); return { deleted: true }; },
    }),

    // ---------- FICHE ENTREPRISE ----------
    def(ADMIN_ROLES, {
      name: "business.get", description: "Lit la fiche de l'entreprise : nom, description, téléphones, email, adresse, horaires.",
      input: z.object({}), risk: "read", permission: "business.read",
      run: async (ctx) => s.getBusiness(org(ctx)),
    }),
    def(ADMIN_ROLES, {
      name: "business.update", description: "Modifie des champs de la fiche entreprise (seuls les champs donnés changent). Visible des clients : validation toujours. Horaires : un texte par jour.",
      input: z.object({
        name: short(80).optional(), description: z.string().trim().max(1000).optional(), phone: z.string().trim().max(30).optional(), whatsappNumber: z.string().trim().max(30).optional(),
        email: z.string().trim().email().max(200).optional(), address: z.string().trim().max(300).optional(), openingHours: z.partialRecord(z.enum(DAYS), z.string().trim().max(40)).optional(),
      }).refine((v) => Object.values(v).some((x) => x !== undefined), "Rien à modifier"),
      risk: "write_reversible", permission: "business.write", confirmAlways: true,
      preview: async (ctx: Ctx, i: Record<string, unknown>): Promise<ToolPreview> => {
        const cur = (await s.getBusiness(org(ctx))) as unknown as Record<string, unknown>;
        const label: Record<string, string> = { name: "Nom", description: "Description", phone: "Téléphone", whatsappNumber: "WhatsApp", email: "Email", address: "Adresse", openingHours: "Horaires" };
        const show = (v: unknown) => (v && typeof v === "object" ? JSON.stringify(v) : String(v ?? "(vide)"));
        const changed = Object.keys(i).filter((k) => i[k] !== undefined);
        return { title: "Modifier la fiche entreprise", summary: changed.map((k) => label[k] ?? k).join(", "), details: changed.map((k) => ({ label: label[k] ?? k, value: `${show(cur[k])} → ${show(i[k])}` })) };
      },
      run: async (ctx, i: Record<string, unknown>) => {
        const cur = await s.getBusiness(org(ctx));
        // updateBusinessProfile réécrit TOUT : on fusionne avec l'existant pour ne rien effacer.
        await s.updateBusiness(org(ctx), {
          name: (i.name as string | undefined) ?? cur.name, description: (i.description as string | undefined) ?? cur.description ?? undefined, phone: (i.phone as string | undefined) ?? cur.phone ?? undefined,
          whatsappNumber: (i.whatsappNumber as string | undefined) ?? cur.whatsappNumber ?? undefined, email: (i.email as string | undefined) ?? cur.email ?? undefined, address: (i.address as string | undefined) ?? cur.address ?? undefined,
          openingHours: { ...cur.openingHours, ...((i.openingHours as Record<string, string> | undefined) ?? {}) },
        });
        return { updated: Object.keys(i).filter((k) => i[k] !== undefined) };
      },
    }),

    // ---------- ALERTES ----------
    def(ADMIN_ROLES, {
      name: "alerts.get", description: "Lit les réglages d'alertes : déclencheurs, heures calmes, délai de relance.",
      input: z.object({}), risk: "read", permission: "alerts.read",
      run: async (ctx) => s.getAlertSettings(org(ctx)),
    }),
    def(ADMIN_ROLES, {
      name: "alerts.update", description: "Modifie les alertes : activer/désactiver un déclencheur (avec seuil éventuel), heures calmes, délai de relance en minutes. Seuls les champs donnés changent.",
      input: z.object({
        trigger: z.object({ key: short(60), enabled: z.boolean(), threshold: z.number().positive().finite().optional() }).optional(),
        quietEnabled: z.boolean().optional(), quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        escalationDelayMinutes: z.number().int().min(1).max(1440).optional(),
      }).refine((v) => Object.values(v).some((x) => x !== undefined), "Rien à modifier"),
      risk: "write_reversible", permission: "alerts.write", amountOf: noAmount,
      run: async (ctx, i: { trigger?: { key: string; enabled: boolean; threshold?: number }; quietEnabled?: boolean; quietStart?: string; quietEnd?: string; escalationDelayMinutes?: number }) => {
        const cur = await s.getAlertSettings(org(ctx));
        const next: AlertSettingsLike = {
          ...cur,
          triggers: i.trigger ? { ...cur.triggers, [i.trigger.key]: { enabled: i.trigger.enabled, ...(i.trigger.threshold !== undefined ? { threshold: i.trigger.threshold } : {}) } } : cur.triggers,
          quietEnabled: i.quietEnabled ?? cur.quietEnabled, quietStart: i.quietStart ?? cur.quietStart, quietEnd: i.quietEnd ?? cur.quietEnd,
          escalationDelayMinutes: i.escalationDelayMinutes ?? cur.escalationDelayMinutes,
        };
        await s.saveAlertSettings(org(ctx), next); // le service valide (déclencheur inconnu, heures identiques…)
        return { updated: true };
      },
    }),

    // ---------- ABONNEMENT ET CRÉDITS (lecture seule) ----------
    def(ADMIN_ROLES, {
      name: "subscription.status", description: "Lit l'offre actuelle, son statut et l'usage des quotas. Lecture seule : changer d'offre ou payer se fait dans le tableau de bord.",
      input: z.object({}), risk: "read", permission: "billing.read",
      run: async (ctx) => s.subscription(org(ctx)),
    }),
    def(ADMIN_ROLES, {
      name: "credits.status", description: "Lit le solde de crédits IA (inclus, achetés, utilisés, restants ; -1 = illimité).",
      input: z.object({}), risk: "read", permission: "billing.read",
      run: async (ctx) => s.credits(org(ctx)),
    }),
  ];
}

export function createAdminRegistrar(services: () => AdminServices = defaultAdminServices): DomainRegistrar {
  return ({ kernel }) => {
    for (const { tool, roles } of buildAdminTools(services())) kernel.registerTool(tool, { roles });
  };
}
