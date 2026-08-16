import { Injectable, Logger } from '@nestjs/common';
import type { Severity } from '@urbivue/shared';

/**
 * Notification fan-out. Channels are enabled by environment:
 *  - log:      always on
 *  - webhook:  ALERT_WEBHOOK_URL (generic JSON POST — Slack/Discord/hooks)
 *  - telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 * All sends are fire-and-forget; a failing channel never breaks the caller.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  notify(severity: Severity, title: string, context: Record<string, unknown> = {}): void {
    this.logger.warn(`[${severity.toUpperCase()}] ${title}`);

    const payload = { source: 'urbivue', severity, title, ...context };

    const webhook = process.env.ALERT_WEBHOOK_URL;
    if (webhook) {
      fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch((err) => this.logger.warn(`Webhook notification failed: ${err}`));
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      const icon = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟠' : '🔵';
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `${icon} ${title}` }),
      }).catch((err) => this.logger.warn(`Telegram notification failed: ${err}`));
    }
  }
}
