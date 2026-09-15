import type { NotificationProvider, NotificationRequest } from "@/domain/ports/notification-provider";

/**
 * Repli quand aucun canal de notification admin n'est configuré
 * (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID` absents) — même
 * philosophie que `ConsoleLogEmailAdapter`
 * (infrastructure/providers/email/console-log/adapter.ts) : un
 * déploiement qui n'a pas encore configuré ce canal continue de
 * fonctionner, la notification est simplement loguée plutôt que perdue
 * silencieusement ou bloquante.
 */
export class ConsoleLogNotificationAdapter implements NotificationProvider {
  readonly providerName = "console_log";

  async send(request: NotificationRequest): Promise<{ delivered: boolean }> {
    console.info(`[notification:console_log] ${request.title} — ${request.body}`);
    return { delivered: true };
  }
}
