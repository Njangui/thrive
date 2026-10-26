/**
 * Hygiène (P4) : clôture des runs bloqués et purge de rétention. Les durées de
 * rétention sont des PARAMÈTRES (décision produit/juridique en attente, loi
 * 2024/017) : sans valeur fournie, rien n'est purgé. Le journal d'audit n'est
 * jamais purgé ici.
 */
export interface MaintenanceRepository {
  closeStuckRuns(olderThanSeconds: number): Promise<number>;
  purgeRuns(before: Date): Promise<number>;
  purgeEvents(before: Date): Promise<number>;
  /** Mémoire d'entreprise : entrées archivées depuis plus longtemps que `before` et entrées expirées. */
  purgeMemory(before: Date): Promise<number>;
}

export interface MaintenancePolicy {
  stuckRunAfterSeconds: number;
  runRetentionDays?: number;
  eventRetentionDays?: number;
  memoryArchiveRetentionDays?: number;
}

export async function runMaintenance(repo: MaintenanceRepository, policy: MaintenancePolicy, now: () => Date = () => new Date()) {
  const day = 86_400_000;
  const report = { stuckClosed: 0, runsPurged: 0, eventsPurged: 0, memoryPurged: 0 };
  report.stuckClosed = await repo.closeStuckRuns(Math.max(60, Math.floor(policy.stuckRunAfterSeconds)));
  if (policy.runRetentionDays && policy.runRetentionDays >= 1) {
    report.runsPurged = await repo.purgeRuns(new Date(now().getTime() - policy.runRetentionDays * day));
  }
  if (policy.eventRetentionDays && policy.eventRetentionDays >= 1) {
    report.eventsPurged = await repo.purgeEvents(new Date(now().getTime() - policy.eventRetentionDays * day));
  }
  if (policy.memoryArchiveRetentionDays && policy.memoryArchiveRetentionDays >= 2) {
    report.memoryPurged = await repo.purgeMemory(new Date(now().getTime() - policy.memoryArchiveRetentionDays * day));
  }
  return report;
}
