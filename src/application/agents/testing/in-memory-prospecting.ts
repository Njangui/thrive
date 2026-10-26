import type { Campaign, ProspectRow, ProspectingStore, TemplateStatusMap } from "@/application/services/prospecting-service";
import type { ImportedProspect } from "@/application/services/prospecting-core";

/** Magasin de prospection en mémoire (tests) : mêmes contrats que l'implémentation Supabase. */
export function makeProspectingStore() {
  const campaigns = new Map<string, Campaign>();
  const prospects: (ProspectRow & { org: string; lastReplyAt?: string })[] = [];
  const optOuts = new Set<string>();
  const templates: TemplateStatusMap = {};
  let n = 0;
  const store: ProspectingStore = {
    async createCampaign(org, _u, i) { const c: Campaign = { id: crypto.randomUUID(), organizationId: org, name: i.name, status: "draft", dailyCap: i.dailyCap, windowStartHour: i.windowStartHour, windowEndHour: i.windowEndHour, timezone: "Africa/Douala", maxFollowups: 1, followupDelayHours: 72, defaultCountryCode: i.defaultCountryCode, consentBasis: null, approvedFingerprint: null }; campaigns.set(c.id, c); return c; },
    async getCampaign(org, id) { const c = campaigns.get(id); return c && c.organizationId === org ? { ...c } : null; },
    async listCampaigns(org) { return [...campaigns.values()].filter((c) => c.organizationId === org).map((c) => ({ ...c })); },
    async listActiveCampaigns() { return [...campaigns.values()].filter((c) => c.status === "approved" || c.status === "running").map((c) => ({ ...c })); },
    async updateCampaign(_o, id, p) { const c = campaigns.get(id)!; if (p.status) c.status = p.status; if (p.consentBasis !== undefined) c.consentBasis = p.consentBasis; if (p.approvedFingerprint !== undefined) c.approvedFingerprint = p.approvedFingerprint; },
    async insertProspects(org, cid, list: ImportedProspect[]) { for (const p of list) if (!prospects.some((x) => x.campaignId === cid && x.phoneE164 === p.phoneE164)) prospects.push({ id: `p${++n}`, org, campaignId: cid, fullName: p.fullName, company: p.company, phoneE164: p.phoneE164, status: "queued", contactedAt: null, followupSentAt: null }); },
    async listPhones(cid) { return prospects.filter((p) => p.campaignId === cid).map((p) => p.phoneE164); },
    async countByStatus(cid) { const o: Record<string, number> = {}; for (const p of prospects.filter((x) => x.campaignId === cid)) o[p.status] = (o[p.status] ?? 0) + 1; return o; },
    async listOptOuts() { return new Set(optOuts); },
    async addOptOut(_o, phone) { optOuts.add(phone); },
    async queued(cid, limit) { return prospects.filter((p) => p.campaignId === cid && p.status === "queued").slice(0, limit); },
    async followupsDue(cid, before, limit) { return prospects.filter((p) => p.campaignId === cid && p.status === "contacted" && !p.followupSentAt && p.contactedAt! <= before).slice(0, limit); },
    async sample(cid, limit) { return prospects.filter((p) => p.campaignId === cid).slice(0, limit); },
    async markProspect(id, p) { const r = prospects.find((x) => x.id === id)!; if (p.status) r.status = p.status; if (p.contactedAt) r.contactedAt = p.contactedAt; if (p.followupSentAt) r.followupSentAt = p.followupSentAt; if (p.lastReplyAt) r.lastReplyAt = p.lastReplyAt; },
    async markPhoneOptedOut(_o, phone) { for (const p of prospects) if (p.phoneE164 === phone && p.status !== "converted") p.status = "opted_out"; },
    async activeProspectsByPhone(org, phone) { return prospects.filter((p) => p.org === org && p.phoneE164 === phone && ["queued", "contacted", "followed_up", "replied", "interested"].includes(p.status)); },
    async sentTimestampsSince(cid, since) { const out: string[] = []; for (const p of prospects.filter((x) => x.campaignId === cid)) { if (p.contactedAt && p.contactedAt >= since) out.push(p.contactedAt); if (p.followupSentAt && p.followupSentAt >= since) out.push(p.followupSentAt); } return out; },
    async templateStatuses() { return { ...templates }; },
    async upsertTemplate(_o, key, p) { templates[key] = p.status; },
  };
  return { store, campaigns, prospects, optOuts, templates };
}

