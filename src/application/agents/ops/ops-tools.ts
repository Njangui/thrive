import { z } from "zod";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { normalizeExternalId } from "@/application/channels/channel-codes";
import { assertPermission, refundAboveThresholdAllowed, type OpsPermission } from "./role-matrix";
import type { RiskLevel, ToolCtx, ToolDef, ToolPreview } from "./ops-contract";
import type { OpsServices } from "./ops-services";

/**
 * Outils de l'agent Opérations (C2, étape 6) : enveloppes TYPÉES des services existants.
 *
 * Invariants (testés) :
 *  - le tenant et l'utilisateur viennent de l'ACTEUR (`ctx.actor`), jamais de l'entrée du modèle ;
 *  - chaque outil refuse un rôle non autorisé AVANT toute lecture/écriture (seconde barrière après
 *    le moteur de règles de C1) ;
 *  - le LLM ne calcule jamais : prix pris au catalogue, totaux calculés par le service, devise lue en base ;
 *  - texte client (notes de commande, nom) renvoyé comme DONNÉE non fiable, tronquée ;
 *  - téléphones masqués dans les sorties (minimisation : ces sorties partent vers le fournisseur d'IA) ;
 *  - `sensitive` = annulation de commande, remboursement et changement de prix : confirmation toujours exigée par C1,
 *    avec un aperçu rédigé par le code.
 */

// --- helpers ---------------------------------------------------------------------------------

const uuid = z.string().uuid();
const money = z.number().positive().max(1_000_000_000).refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "2 décimales maximum");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");
type RefundInput = { orderId: string; amount?: number; full?: boolean; reason: string };
const short = (max: number) => z.string().trim().min(1).max(max);

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  return d.length < 6 ? "***" : `+${d.slice(0, 3)}…${d.slice(-2)}`;
}
const clip = (s: string | null | undefined, n: number): string | null => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);
const fmt = (n: number, currency: string) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n)} ${currency}`;

function assertDateInRange(date: string | undefined, now: Date): string | undefined {
  if (!date) return undefined;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new ValidationError("Date invalide.");
  if (t > now.getTime() + 86_400_000) throw new ValidationError("La date ne peut pas être dans le futur.");
  if (t < now.getTime() - 366 * 86_400_000) throw new ValidationError("La date ne peut pas remonter à plus d'un an.");
  return date;
}

function define<I, O>(def: Omit<ToolDef<I, O>, "run" | "domain"> & { permission: OpsPermission; risk: RiskLevel; run: (ctx: ToolCtx, input: I) => Promise<O> }): ToolDef<I, O> {
  const domain = def.name.split(".")[0]!;
  return {
    ...def, domain,
    // La permission est vérifiée ICI, avant le corps de l'outil : impossible de l'oublier dans un outil.
    run: async (ctx, input) => { assertPermission(ctx.actor, def.permission); return def.run(ctx, input); },
    ...(def.preview ? { preview: async (ctx: ToolCtx, input: I): Promise<ToolPreview> => { assertPermission(ctx.actor, def.permission); return def.preview!(ctx, input); } } : {}),
  };
}

// --- fabrique ----------------------------------------------------------------------------------

export function buildOpsTools(s: OpsServices): ToolDef<never, unknown>[] {
  /**
   * Remboursement : tout est calculé ICI (jamais par le modèle) — montant du « remboursement complet »,
   * reste remboursable, seuil. L'appel SQL re-contrôle statut et plafond sous verrou (dernière barrière).
   */
  async function resolveRefund(ctx: ToolCtx, i: { orderId: string; amount?: number; full?: boolean }) {
    const org = ctx.actor.tenantId;
    const o = await s.getOrder(org, i.orderId); // 404 si la commande n'est pas de CE tenant
    if (o.status !== "completed") throw new ValidationError(o.status === "cancelled" ? "Cette commande est annulée : il n'y a rien à rembourser." : "Seule une commande terminée peut être remboursée (une commande en attente s'annule).");
    const refunded = await s.refundedTotal(org, i.orderId);
    const remaining = Math.round((o.totalAmount - refunded) * 100) / 100;
    if (remaining <= 0) throw new ValidationError("Cette commande est déjà entièrement remboursée.");
    const amount = i.full === true ? remaining : (i.amount as number);
    if (amount > remaining) throw new ValidationError(`Montant trop élevé : il reste ${fmt(remaining, o.currency)} remboursable sur cette commande.`);
    const threshold = await s.refundThreshold(org);
    const overThreshold = threshold !== undefined && amount > threshold;
    if (overThreshold && !refundAboveThresholdAllowed(ctx.actor)) {
      throw new AuthorizationError("Ce remboursement dépasse le seuil fixé par le propriétaire : il doit être validé par le propriétaire ou un administrateur.");
    }
    return { amount, orderTotal: o.totalAmount, refunded, currency: o.currency, contactName: o.contactName, threshold, overThreshold };
  }

  const tools: ToolDef<any, unknown>[] = [ // eslint-disable-line @typescript-eslint/no-explicit-any -- registre hétérogène (entrées typées par outil)
    // ---------- LECTURE ----------
    define({
      name: "orders.list", description: "Liste les commandes récentes (filtre statut optionnel). Renvoie identifiant, statut, total, date, client.",
      input: z.object({ status: z.enum(["pending", "confirmed", "completed", "cancelled"]).optional(), limit: z.number().int().min(1).max(20).default(10) }),
      risk: "read", permission: "orders.read",
      run: async (ctx, i: { status?: "pending" | "confirmed" | "completed" | "cancelled"; limit: number }) => {
        const r = await s.listOrders(ctx.actor.tenantId, { status: i.status, page: 1, pageSize: i.limit });
        return { total: r.totalCount, orders: r.orders.map((o) => ({ id: o.id, status: o.status, total: o.totalAmount, currency: o.currency, date: o.createdAt, customer: clip(o.contactName, 60), phone: maskPhone(o.contactPhone) })) };
      },
    }),
    define({
      name: "orders.get", description: "Détail d'une commande : articles, total, statut, client.",
      input: z.object({ orderId: uuid }), risk: "read", permission: "orders.read",
      run: async (ctx, i: { orderId: string }) => {
        const o = await s.getOrder(ctx.actor.tenantId, i.orderId);
        return { id: o.id, status: o.status, total: o.totalAmount, currency: o.currency, date: o.createdAt, customer: clip(o.contactName, 60), phone: maskPhone(o.contactPhone),
          customerNoteUntrusted: clip(o.notes, 300), items: o.items.map((it) => ({ label: clip(it.label, 80), unitPrice: it.unitPrice, quantity: it.quantity })) };
      },
    }),
    define({
      name: "contacts.find", description: "Cherche un client par nom ou téléphone (2 caractères minimum). Renvoie l'identifiant à utiliser pour créer une commande.",
      input: z.object({ query: short(60), limit: z.number().int().min(1).max(10).default(5) }), risk: "read", permission: "contacts.read",
      run: async (ctx, i: { query: string; limit: number }) => ({ contacts: (await s.findContacts(ctx.actor.tenantId, i.query, i.limit)).map((c) => ({ id: c.id, name: clip(c.fullName, 60), phone: maskPhone(c.phoneE164) })) }),
    }),
    define({
      name: "products.find", description: "Cherche des produits ACTIFS par nom. Renvoie identifiant, nom et prix catalogue.",
      input: z.object({ query: short(60), limit: z.number().int().min(1).max(10).default(5) }), risk: "read", permission: "products.read",
      run: async (ctx, i: { query: string; limit: number }) => ({ products: (await s.findProducts(ctx.actor.tenantId, i.query, i.limit)).map((p) => ({ id: p.id, name: p.name, unitPrice: p.unitPrice })) }),
    }),
    define({
      name: "stock.get", description: "Stock actuel, statut et prix d'un produit.",
      input: z.object({ productId: uuid }), risk: "read", permission: "products.read",
      run: async (ctx, i: { productId: string }) => { const p = await s.getProduct(ctx.actor.tenantId, i.productId); return { id: p.id, name: p.name, status: p.status, currentStock: p.currentStock, unitPrice: p.unitPrice }; },
    }),
    define({
      name: "stock.low", description: "Produits dont le stock est au niveau d'alerte ou en dessous (seuil d'alerte renseigné).",
      input: z.object({ limit: z.number().int().min(1).max(30).default(15) }), risk: "read", permission: "products.read",
      run: async (ctx, i: { limit: number }) => ({ products: await s.lowStock(ctx.actor.tenantId, i.limit) }),
    }),
    define({
      name: "appointments.list", description: "Liste les rendez-vous (à venir par défaut). Filtres : statut, plage de dates.",
      input: z.object({ status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]).optional(), from: day.optional(), to: day.optional(), limit: z.number().int().min(1).max(30).default(15) }),
      risk: "read", permission: "appointments.read",
      run: async (ctx, i: { status?: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show"; from?: string; to?: string; limit: number }) => {
        const from = i.from ? Date.parse(`${i.from}T00:00:00Z`) : ctx.now().getTime() - 3_600_000;
        const to = i.to ? Date.parse(`${i.to}T23:59:59Z`) : Infinity;
        const rows = (await s.listAppointments(ctx.actor.tenantId)).filter((a) => (!i.status || a.status === i.status) && Date.parse(a.startAt) >= from && Date.parse(a.startAt) <= to).slice(0, i.limit);
        return { appointments: rows.map((a) => ({ id: a.id, customer: clip(a.contactName, 60), phone: maskPhone(a.contactPhone), service: clip(a.serviceLabel, 80), startAt: a.startAt, endAt: a.endAt, status: a.status })) };
      },
    }),
    define({
      name: "finance.recent", description: "Derniers revenus et dépenses enregistrés.",
      input: z.object({ limit: z.number().int().min(1).max(20).default(10) }), risk: "read", permission: "finance.read",
      run: async (ctx, i: { limit: number }) => ({ currency: await s.currency(ctx.actor.tenantId), entries: (await s.recentFinance(ctx.actor.tenantId, i.limit)).map((e) => ({ type: e.type, amount: e.amount, label: clip(e.label, 80), date: e.date })) }),
    }),
    define({
      name: "finance.overview", description: "Synthèse financière des 30 derniers jours, calculée par le système (chiffre d'affaires, marge, dépenses, créances).",
      input: z.object({}), risk: "read", permission: "finance.read",
      run: async (ctx) => {
        const o = await s.financialOverview(ctx.actor.tenantId);
        return { currency: o.currency, revenue30d: o.revenue30d, cashCollected30d: o.cashCollected30d, grossProfit30d: o.grossProfit30d, grossMarginPct: o.grossMarginPct, operatingExpenses30d: o.operatingExpenses30d, netProfit30d: o.netProfit30d, receivablesOpen: o.receivablesOpen, receivablesOverdue: o.receivablesOverdue };
      },
    }),

    // ---------- ÉCRITURE RÉVERSIBLE ----------
    define({
      name: "orders.create",
      description: "Crée une commande (statut « en attente ») pour un client existant. Donnez uniquement produit + quantité : le prix est lu au catalogue et le total est calculé par le système.",
      input: z.object({ contactId: uuid, items: z.array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(1000) })).min(1).max(20), notes: z.string().trim().max(500).optional() }),
      risk: "write_reversible", permission: "orders.write",
      // Total calculé au catalogue (prix lus en base, jamais fournis par le modèle) ; produit introuvable => montant inconnu => validation.
      amountOf: async (ctx, i: { contactId: string; items: { productId: string; quantity: number }[]; notes?: string }) => {
        const merged = new Map<string, number>();
        for (const it of i.items) merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.quantity);
        let total = 0;
        for (const [productId, quantity] of merged) total += (await s.getProduct(ctx.actor.tenantId, productId)).unitPrice * quantity;
        return total;
      },
      run: async (ctx, i: { contactId: string; items: { productId: string; quantity: number }[]; notes?: string }) => {
        const org = ctx.actor.tenantId;
        if (!(await s.getContact(org, i.contactId))) throw new ValidationError("Client introuvable dans cette entreprise.");
        const merged = new Map<string, number>();
        for (const it of i.items) merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.quantity);
        const lines: { productId: string; label: string; unitPrice: number; quantity: number }[] = []; const warnings: string[] = [];
        for (const [productId, quantity] of merged) {
          const p = await s.getProduct(org, productId); // introuvable => NotFoundError (jamais un produit d'une autre entreprise)
          if (p.status !== "active") throw new ValidationError(`Le produit « ${p.name} » n'est pas disponible à la vente (statut : ${p.status}).`);
          if (p.currentStock < quantity) warnings.push(`Stock de « ${p.name} » : ${p.currentStock} en stock pour ${quantity} demandé(s).`);
          lines.push({ productId, label: p.name, unitPrice: p.unitPrice, quantity });
        }
        const r = await s.createOrder({ organizationId: org, contactId: i.contactId, items: lines, notes: i.notes });
        return { orderId: r.orderId, total: r.total, currency: await s.currency(org), status: "pending", warnings };
      },
    }),
    define({
      name: "orders.complete", description: "Marque une commande comme terminée : décrémente le stock et enregistre le revenu (idempotent).",
      input: z.object({ orderId: uuid }), risk: "write_reversible", permission: "orders.write",
      run: async (ctx, i: { orderId: string }) => {
        const before = await s.getOrder(ctx.actor.tenantId, i.orderId);
        if (before.status === "cancelled") throw new ValidationError("Cette commande est annulée : elle ne peut pas être terminée.");
        await s.completeOrder(ctx.actor.tenantId, i.orderId, ctx.actor.userId);
        return { orderId: i.orderId, status: "completed", alreadyCompleted: before.status === "completed" };
      },
    }),
    define({
      name: "stock.restock", description: "Ajoute des unités au stock d'un produit (réapprovisionnement).",
      input: z.object({ productId: uuid, quantity: z.number().int().min(1).max(100_000) }), risk: "write_reversible", permission: "stock.write",
      run: async (ctx, i: { productId: string; quantity: number }) => {
        await s.restock(ctx.actor.tenantId, i.productId, i.quantity, ctx.actor.userId);
        const p = await s.getProduct(ctx.actor.tenantId, i.productId);
        return { id: p.id, name: p.name, currentStock: p.currentStock, status: p.status };
      },
    }),
    define({
      name: "stock.remove", description: "Retire des unités du stock (casse, perte, usage interne). Une vente passe par orders.complete, pas par cet outil.",
      input: z.object({ productId: uuid, quantity: z.number().int().min(1).max(100_000), reason: short(200) }), risk: "write_reversible", permission: "stock.write",
      run: async (ctx, i: { productId: string; quantity: number; reason: string }) => {
        await s.decrement(ctx.actor.tenantId, i.productId, i.quantity, i.reason, ctx.actor.userId);
        const p = await s.getProduct(ctx.actor.tenantId, i.productId);
        return { id: p.id, name: p.name, currentStock: p.currentStock, status: p.status };
      },
    }),
    define({
      name: "appointments.create", description: "Crée un rendez-vous (client identifié par son téléphone s'il est donné).",
      input: z.object({ customerName: short(80), customerPhone: z.string().trim().max(24).optional(), service: short(120), startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }), notes: z.string().trim().max(500).optional() }),
      risk: "write_reversible", permission: "appointments.write",
      run: async (ctx, i: { customerName: string; customerPhone?: string; service: string; startAt: string; endAt: string; notes?: string }) => {
        const phone = i.customerPhone ? normalizeExternalId("whatsapp", i.customerPhone) : undefined;
        if (i.customerPhone && !phone) throw new ValidationError("Numéro de téléphone invalide (format international attendu).");
        const r = await s.createAppointment({ organizationId: ctx.actor.tenantId, contactFullName: i.customerName, contactPhone: phone ?? undefined, serviceLabel: i.service, startAt: i.startAt, endAt: i.endAt, notes: i.notes });
        return { appointmentId: r.appointmentId, status: "scheduled" };
      },
    }),
    define({
      name: "appointments.setStatus", description: "Change le statut d'un rendez-vous (confirmé, terminé, annulé, absent).",
      input: z.object({ appointmentId: uuid, status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]) }), risk: "write_reversible", permission: "appointments.write",
      run: async (ctx, i: { appointmentId: string; status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show" }) => { await s.setAppointmentStatus(i.appointmentId, ctx.actor.tenantId, i.status); return { appointmentId: i.appointmentId, status: i.status }; },
    }),
    define({
      name: "expenses.create", description: "Enregistre une dépense dans la comptabilité (aucun argent n'est déplacé). Les dépenses publicitaires/média passent par les outils de croissance, pas par celui-ci.",
      input: z.object({ amount: money, category: short(60).optional(), description: short(200).optional(), supplier: short(80).optional(), date: day.optional(), expenseClass: z.enum(["cost_of_revenue", "operating", "tax"]).optional() }),
      risk: "write_reversible", permission: "finance.write",
      amountOf: async (_ctx, i: { amount: number }) => i.amount,
      run: async (ctx, i: { amount: number; category?: string; description?: string; supplier?: string; date?: string; expenseClass?: "cost_of_revenue" | "operating" | "tax" }) => {
        const date = assertDateInRange(i.date, ctx.now());
        const r = await s.createExpense({ organizationId: ctx.actor.tenantId, amount: i.amount, categoryName: i.category, description: i.description, supplier: i.supplier, date, actorUserId: ctx.actor.userId, expenseClass: i.expenseClass });
        return { expenseId: r.expenseId, amount: i.amount, currency: await s.currency(ctx.actor.tenantId), date: date ?? ctx.now().toISOString().slice(0, 10) };
      },
    }),
    define({
      name: "revenues.create", description: "Enregistre un revenu manuel (vente sans commande, ex. encaissement comptoir). N'utilisez PAS cet outil pour une commande : orders.complete enregistre déjà son revenu.",
      input: z.object({ amount: money, category: short(60).optional(), note: short(200).optional(), date: day.optional() }), risk: "write_reversible", permission: "finance.write",
      amountOf: async (_ctx, i: { amount: number }) => i.amount,
      run: async (ctx, i: { amount: number; category?: string; note?: string; date?: string }) => {
        const date = assertDateInRange(i.date, ctx.now());
        const r = await s.createRevenue({ organizationId: ctx.actor.tenantId, amount: i.amount, category: i.category, note: i.note, date, actorUserId: ctx.actor.userId });
        return { revenueId: r.revenueId, amount: i.amount, currency: await s.currency(ctx.actor.tenantId), date: date ?? ctx.now().toISOString().slice(0, 10) };
      },
    }),

    // ---------- SENSIBLE (toujours confirmé) ----------
    define({
      name: "orders.cancel", description: "Annule une commande non terminée. Irréversible : une confirmation du propriétaire est toujours demandée.",
      input: z.object({ orderId: uuid }), risk: "sensitive", permission: "orders.cancel",
      preview: async (ctx, i: { orderId: string }) => {
        const o = await s.getOrder(ctx.actor.tenantId, i.orderId);
        return { title: "Annuler une commande", summary: `Commande de ${clip(o.contactName, 60) ?? "client inconnu"} — ${fmt(o.totalAmount, o.currency)}`, details: [{ label: "Statut actuel", value: o.status }, { label: "Total", value: fmt(o.totalAmount, o.currency) }, { label: "Articles", value: o.items.map((it) => `${it.quantity} × ${clip(it.label, 40)}`).join(", ") || "—" }] };
      },
      run: async (ctx, i: { orderId: string }) => {
        const o = await s.getOrder(ctx.actor.tenantId, i.orderId);
        if (o.status === "completed") throw new ValidationError("Cette commande est déjà terminée : elle ne peut plus être annulée.");
        if (o.status === "cancelled") return { orderId: i.orderId, status: "cancelled", alreadyCancelled: true };
        await s.cancelOrder(ctx.actor.tenantId, i.orderId);
        return { orderId: i.orderId, status: "cancelled", alreadyCancelled: false };
      },
    }),
    define({
      name: "orders.refund", description: "Enregistre le remboursement d'une commande terminée (total ou partiel). Flexco n'envoie pas l'argent : le commerçant rembourse le client lui-même, puis valide. Une confirmation avec PIN est toujours demandée ; au-dessus du seuil du propriétaire, seuls le propriétaire ou un administrateur peuvent le valider.",
      input: z.object({ orderId: uuid, amount: money.optional(), full: z.boolean().optional(), reason: z.string().trim().min(3).max(300) })
        .refine((v) => (v.amount === undefined) !== (v.full !== true), { message: "Indiquez soit un montant, soit le remboursement complet (full), pas les deux." }),
      risk: "sensitive", permission: "orders.refund",
      preview: async (ctx, i: RefundInput) => {
        const r = await resolveRefund(ctx, i);
        return { title: "Rembourser une commande", summary: `${fmt(r.amount, r.currency)} sur la commande de ${clip(r.contactName, 60) ?? "client inconnu"}`, details: [
          { label: "Total de la commande", value: fmt(r.orderTotal, r.currency) }, { label: "Déjà remboursé", value: fmt(r.refunded, r.currency) },
          { label: "Ce remboursement", value: fmt(r.amount, r.currency) }, { label: "Reste remboursable ensuite", value: fmt(r.orderTotal - r.refunded - r.amount, r.currency) },
          { label: "Motif", value: clip(i.reason, 200) ?? "—" },
          { label: "Important", value: "Flexco n'envoie pas l'argent : remboursez le client vous-même, puis validez." },
          ...(r.overThreshold ? [{ label: "Attention", value: `Au-dessus du seuil de ${fmt(r.threshold!, r.currency)} fixé par le propriétaire.` }] : []) ] };
      },
      run: async (ctx, i: RefundInput) => {
        const r = await resolveRefund(ctx, i);
        const done = await s.recordRefund({ organizationId: ctx.actor.tenantId, orderId: i.orderId, amount: r.amount, reason: i.reason, actorUserId: ctx.actor.userId, actorMembershipId: ctx.actor.membershipId });
        await s.alertRefund({ organizationId: ctx.actor.tenantId, orderId: i.orderId, refundId: done.refundId, amount: r.amount, currency: done.currency });
        return { refundId: done.refundId, orderId: i.orderId, amount: r.amount, currency: done.currency, refundedTotal: done.refundedTotal, remaining: done.remaining, overThreshold: r.overThreshold };
      },
    }),
    define({
      name: "products.setPrice", description: "Change le prix de vente d'un produit. Une confirmation du propriétaire est toujours demandée. Si le nouveau prix est supérieur ou égal au prix barré, la promotion est retirée.",
      input: z.object({ productId: uuid, newUnitPrice: money }), risk: "sensitive", permission: "products.price",
      preview: async (ctx, i: { productId: string; newUnitPrice: number }) => {
        const p = await s.getProduct(ctx.actor.tenantId, i.productId); const cur = await s.currency(ctx.actor.tenantId);
        const promoLost = p.compareAtPrice !== null && i.newUnitPrice >= p.compareAtPrice;
        return { title: "Changer un prix", summary: `${p.name} : ${fmt(p.unitPrice, cur)} → ${fmt(i.newUnitPrice, cur)}`, details: [{ label: "Produit", value: p.name }, { label: "Prix actuel", value: fmt(p.unitPrice, cur) }, { label: "Nouveau prix", value: fmt(i.newUnitPrice, cur) }, ...(promoLost ? [{ label: "Attention", value: "La promotion en cours sera retirée." }] : [])] };
      },
      run: async (ctx, i: { productId: string; newUnitPrice: number }) => {
        const org = ctx.actor.tenantId;
        const p = await s.getProduct(org, i.productId);
        // Lecture + réécriture COMPLÈTE : `updateProduct` écrase description/catégorie si on les omet.
        await s.updateProduct(i.productId, org, {
          name: p.name, description: p.description ?? undefined, categoryId: p.categoryId ?? "", unitPrice: i.newUnitPrice,
          compareAtPrice: p.compareAtPrice, promotionEndsAt: p.promotionEndsAt,
        });
        return { id: p.id, name: p.name, oldPrice: p.unitPrice, newPrice: i.newUnitPrice, currency: await s.currency(org), promotionRemoved: p.compareAtPrice !== null && i.newUnitPrice >= p.compareAtPrice };
      },
    }),
  ];
  return tools as unknown as ToolDef<never, unknown>[];
}
