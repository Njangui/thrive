import type {
  CreateSocialPostRequest,
  SocialAccountSummary,
  SocialAnalyticsEntry,
  SocialAnalyticsQuery,
  SocialComment,
  SocialDailyMetric,
  SocialPostResult,
  SocialPostStatus,
  SocialPublishingProvider,
} from "@/domain/ports/social-publishing-provider";

interface YouTubeAccountAdapter {
  account: SocialAccountSummary;
  adapter: SocialPublishingProvider;
}

const MULTI_PREFIX = "ytm:";

/**
 * Lot O — plusieurs chaînes YouTube par organisation (Starter 3, Pro 10).
 * Une publication qui cible N chaînes est ventilée par `accountId` vers
 * l'adaptateur de CHAQUE chaîne (un jeton OAuth par chaîne). L'identifiant
 * renvoyé reste l'identifiant vidéo brut quand une seule chaîne est
 * ciblée (rétrocompatible avec les publications déjà enregistrées) et
 * devient un identifiant composite `ytm:<base64url>` sinon.
 */
export class YouTubeMultiAccountAdapter implements SocialPublishingProvider {
  readonly providerName = "youtube";
  constructor(private readonly accounts: YouTubeAccountAdapter[]) {}

  private adapterFor(accountId: string): SocialPublishingProvider {
    const entry = this.accounts.find((item) => item.account.accountId === accountId);
    if (!entry) throw new Error("Cette chaîne YouTube n'est pas connectée.");
    return entry.adapter;
  }

  private async dispatch(request: CreateSocialPostRequest, mode: "create" | "schedule" | "publish"): Promise<SocialPostResult> {
    const byAccount = new Map<string, typeof request.targets>();
    for (const target of request.targets) {
      byAccount.set(target.accountId, [...(byAccount.get(target.accountId) ?? []), target]);
    }
    const parts: Array<{ a: string; id: string; status: string }> = [];
    for (const [accountId, targets] of byAccount) {
      const adapter = this.adapterFor(accountId);
      const payload = { ...request, targets };
      const result =
        mode === "create"
          ? await adapter.createPost(payload)
          : mode === "schedule"
            ? await adapter.schedulePost(payload as CreateSocialPostRequest & { scheduledFor: string })
            : await adapter.publishPost(payload);
      parts.push({ a: accountId, id: result.providerPostId, status: result.status });
    }
    if (parts.length === 1) return { providerPostId: parts[0]!.id, status: parts[0]!.status };
    const status = parts.every((p) => p.status === parts[0]!.status) ? parts[0]!.status : "partial";
    return { providerPostId: `${MULTI_PREFIX}${Buffer.from(JSON.stringify(parts.map(({ a, id }) => ({ a, id })))).toString("base64url")}`, status };
  }

  private decode(providerPostId: string): Array<{ a?: string; id: string }> {
    if (!providerPostId.startsWith(MULTI_PREFIX)) return [{ id: providerPostId }];
    return JSON.parse(Buffer.from(providerPostId.slice(MULTI_PREFIX.length), "base64url").toString("utf8")) as Array<{ a: string; id: string }>;
  }

  /** Vidéo brute (une seule chaîne ciblée) : la chaîne d'origine est inconnue → on essaie chaque compte. */
  private async firstSuccessful<T>(item: { a?: string; id: string }, run: (adapter: SocialPublishingProvider, id: string) => Promise<T>): Promise<T> {
    if (item.a) return run(this.adapterFor(item.a), item.id);
    let lastError: unknown = new Error("Aucune chaîne YouTube connectée.");
    for (const entry of this.accounts) {
      try {
        return await run(entry.adapter, item.id);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  createPost(request: Omit<CreateSocialPostRequest, "scheduledFor" | "publishNow">): Promise<SocialPostResult> {
    return this.dispatch(request as CreateSocialPostRequest, "create");
  }
  schedulePost(request: CreateSocialPostRequest & { scheduledFor: string }): Promise<SocialPostResult> {
    return this.dispatch(request, "schedule");
  }
  publishPost(request: CreateSocialPostRequest): Promise<SocialPostResult> {
    return this.dispatch(request, "publish");
  }

  async getPostStatus(providerPostId: string): Promise<SocialPostStatus> {
    const items = this.decode(providerPostId);
    const statuses: SocialPostStatus[] = [];
    for (const item of items) statuses.push(await this.firstSuccessful(item, (adapter, id) => adapter.getPostStatus(id)));
    if (statuses.length === 1) return { ...statuses[0]!, providerPostId };
    return {
      providerPostId,
      status: statuses.some((s) => s.status === "failed") ? "failed" : statuses.every((s) => s.status === "published") ? "published" : "partial",
      targets: statuses.flatMap((s) => s.targets),
    };
  }

  async cancelPost(providerPostId: string): Promise<void> {
    for (const item of this.decode(providerPostId)) await this.firstSuccessful(item, (adapter, id) => adapter.cancelPost(id));
  }

  async getAnalytics(query: SocialAnalyticsQuery): Promise<SocialAnalyticsEntry[]> {
    return (await Promise.all(this.accounts.map((entry) => entry.adapter.getAnalytics(query)))).flat();
  }

  async getDailyMetrics(fromDate: string, toDate: string): Promise<SocialDailyMetric[]> {
    const merged = new Map<string, SocialDailyMetric>();
    for (const entry of this.accounts) {
      for (const day of await entry.adapter.getDailyMetrics(fromDate, toDate)) {
        const current = merged.get(day.date) ?? { date: day.date, postCount: 0, platforms: {}, metrics: { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, follows: 0 } };
        current.postCount += day.postCount;
        for (const [key, value] of Object.entries(day.platforms)) current.platforms[key] = (current.platforms[key] ?? 0) + value;
        for (const key of Object.keys(current.metrics) as Array<keyof SocialDailyMetric["metrics"]>) current.metrics[key] += day.metrics[key] ?? 0;
        merged.set(day.date, current);
      }
    }
    return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async listAccounts(): Promise<SocialAccountSummary[]> {
    return this.accounts.map((entry) => entry.account);
  }
  async listComments(): Promise<SocialComment[]> {
    return [];
  }
  async replyToComment(): Promise<void> {
    throw new Error("La gestion des commentaires YouTube sera ajoutée au module social dédié.");
  }
  async hideComment(): Promise<void> {
    throw new Error("Action non disponible pour YouTube dans cette version.");
  }
  async unhideComment(): Promise<void> {
    throw new Error("Action non disponible pour YouTube dans cette version.");
  }
}
