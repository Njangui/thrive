import type { CreateSocialPostRequest, SocialAnalyticsEntry, SocialAnalyticsQuery, SocialComment, SocialDailyMetric, SocialPostResult, SocialPostStatus, SocialPublishingProvider, SocialAccountSummary } from "@/domain/ports/social-publishing-provider";

type Provider = { name: string; adapter: SocialPublishingProvider; platforms: Set<string> };

/**
 * Façade multi-canal : le domaine ne sait pas si une publication passe par
 * un service tiers, l'API native d'un réseau ou plusieurs adaptateurs.
 * Chaque connecteur peut donc être remplacé indépendamment sans réécrire
 * MarketingService ni les écrans marchands.
 */
export class CompositeSocialAdapter implements SocialPublishingProvider {
  readonly providerName = "platform";
  constructor(private readonly providers: Provider[]) {}

  private providerFor(platform: string) {
    const provider = this.providers.find((p) => p.platforms.has(platform));
    if (!provider) throw new Error(`Aucun connecteur actif pour ${platform}.`);
    return provider.adapter;
  }

  private encode(parts: Array<{ name: string; id: string }>) { return `multi:${Buffer.from(JSON.stringify(parts)).toString("base64url")}`; }
  private decode(id: string): Array<{ name: string; id: string }> {
    if (!id.startsWith("multi:")) return [{ name: "unknown", id }];
    return JSON.parse(Buffer.from(id.slice(6), "base64url").toString("utf8")) as Array<{ name: string; id: string }>;
  }

  private async dispatch(request: CreateSocialPostRequest, mode: "create" | "schedule" | "publish") {
    const groups = new Map<SocialPublishingProvider, SocialPostTargetLike[]>();
    for (const target of request.targets) {
      const adapter = this.providerFor(target.platform);
      const current = groups.get(adapter) ?? [];
      current.push(target);
      groups.set(adapter, current);
    }
    const results: Array<{ adapter: SocialPublishingProvider; result: SocialPostResult }> = [];
    for (const [adapter, targets] of groups) {
      const payload = { ...request, targets } as CreateSocialPostRequest;
      const result = mode === "create" ? await adapter.createPost(payload) : mode === "schedule" ? await adapter.schedulePost(payload as CreateSocialPostRequest & { scheduledFor: string }) : await adapter.publishPost(payload);
      results.push({ adapter, result });
    }
    return results;
  }

  async createPost(request: Omit<CreateSocialPostRequest, "scheduledFor" | "publishNow">): Promise<SocialPostResult> {
    const results = await this.dispatch({ ...request, targets: request.targets }, "create");
    return { providerPostId: results.length === 1 ? results[0]!.result.providerPostId : this.encode(results.map((x) => ({ name: x.adapter.providerName, id: x.result.providerPostId }))), status: results.every((x) => x.result.status === "published") ? "published" : "draft" };
  }
  async schedulePost(request: CreateSocialPostRequest & { scheduledFor: string }): Promise<SocialPostResult> {
    const results = await this.dispatch(request, "schedule");
    return { providerPostId: results.length === 1 ? results[0]!.result.providerPostId : this.encode(results.map((x) => ({ name: x.adapter.providerName, id: x.result.providerPostId }))), status: results.some((x) => x.result.status === "failed") ? "partial" : "scheduled" };
  }
  async publishPost(request: CreateSocialPostRequest): Promise<SocialPostResult> {
    const results = await this.dispatch(request, "publish");
    return { providerPostId: results.length === 1 ? results[0]!.result.providerPostId : this.encode(results.map((x) => ({ name: x.adapter.providerName, id: x.result.providerPostId }))), status: results.every((x) => x.result.status === "published") ? "published" : "partial" };
  }
  async getPostStatus(providerPostId: string): Promise<SocialPostStatus> {
    const decoded = this.decode(providerPostId);
    const statuses: SocialPostStatus[] = [];
    for (const item of decoded) {
      const adapter = this.providers.find((p) => p.adapter.providerName === item.name)?.adapter;
      if (adapter) statuses.push(await adapter.getPostStatus(item.id));
    }
    return { providerPostId, status: statuses.some((s) => s.status === "failed") ? "failed" : statuses.every((s) => s.status === "published") ? "published" : "partial", targets: statuses.flatMap((s) => s.targets) };
  }
  async cancelPost(providerPostId: string) { for (const item of this.decode(providerPostId)) { const adapter = this.providers.find((p) => p.adapter.providerName === item.name)?.adapter; if (adapter) await adapter.cancelPost(item.id); } }
  async getAnalytics(query: SocialAnalyticsQuery): Promise<SocialAnalyticsEntry[]> { const results = await Promise.all(this.providers.map((p) => p.adapter.getAnalytics(query))); return results.flat(); }
  async getDailyMetrics(fromDate: string, toDate: string): Promise<SocialDailyMetric[]> {
    const days = await Promise.all(this.providers.map((p) => p.adapter.getDailyMetrics(fromDate, toDate)));
    const merged = new Map<string, SocialDailyMetric>();
    for (const providerDays of days) for (const day of providerDays) {
      const current = merged.get(day.date) ?? { date: day.date, postCount: 0, platforms: {}, metrics: { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, follows: 0 } };
      current.postCount += day.postCount;
      for (const [key, value] of Object.entries(day.platforms)) current.platforms[key] = (current.platforms[key] ?? 0) + value;
      for (const key of Object.keys(current.metrics) as Array<keyof SocialDailyMetric["metrics"]>) current.metrics[key] += day.metrics[key] ?? 0;
      merged.set(day.date, current);
    }
    return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  async listAccounts(): Promise<SocialAccountSummary[]> { const all = await Promise.all(this.providers.map((p) => p.adapter.listAccounts())); return all.flat(); }
  async listComments(providerPostId: string, accountId: string): Promise<SocialComment[]> {
    for (const provider of this.providers) {
      const accounts = await provider.adapter.listAccounts();
      if (accounts.some((account) => account.accountId === accountId)) return provider.adapter.listComments(providerPostId, accountId);
    }
    return [];
  }
  async replyToComment(providerPostId: string, accountId: string, commentId: string, message: string) { const provider = this.providers.find((p) => p.adapter.providerName !== "youtube")?.adapter; if (!provider) throw new Error("Aucun connecteur de commentaires disponible."); return provider.replyToComment(providerPostId, accountId, commentId, message); }
  async hideComment(providerPostId: string, accountId: string, commentId: string) { const provider = this.providers.find((p) => p.adapter.providerName !== "youtube")?.adapter; if (!provider) throw new Error("Action indisponible."); return provider.hideComment(providerPostId, accountId, commentId); }
  async unhideComment(providerPostId: string, accountId: string, commentId: string) { const provider = this.providers.find((p) => p.adapter.providerName !== "youtube")?.adapter; if (!provider) throw new Error("Action indisponible."); return provider.unhideComment(providerPostId, accountId, commentId); }
}

type SocialPostTargetLike = { platform: string; accountId: string };
