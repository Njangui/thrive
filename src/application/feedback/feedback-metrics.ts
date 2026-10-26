/** Indicateurs de qualité par agent et version de prompt, calculés sur les retours de l'organisation elle-même. */
export interface FeedbackRow { agentName: string; promptVersion: string; rating: number; reasonCode: string | null }

export interface AgentQuality {
  agentName: string;
  promptVersion: string;
  total: number;
  positive: number;
  satisfaction: number;
  topReasons: Array<{ reason: string; count: number }>;
}

export function computeAgentQuality(rows: FeedbackRow[]): AgentQuality[] {
  const groups = new Map<string, FeedbackRow[]>();
  for (const r of rows) {
    const key = `${r.agentName}\u0000${r.promptVersion}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.values()]
    .map((g) => {
      const first = g[0] as FeedbackRow;
      const reasons = new Map<string, number>();
      for (const r of g) if (r.rating === -1 && r.reasonCode) reasons.set(r.reasonCode, (reasons.get(r.reasonCode) ?? 0) + 1);
      const positive = g.filter((r) => r.rating === 1).length;
      return {
        agentName: first.agentName, promptVersion: first.promptVersion, total: g.length, positive,
        satisfaction: Math.round((positive / g.length) * 1000) / 1000,
        topReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)).slice(0, 3),
      };
    })
    .sort((a, b) => a.agentName.localeCompare(b.agentName) || a.promptVersion.localeCompare(b.promptVersion));
}
