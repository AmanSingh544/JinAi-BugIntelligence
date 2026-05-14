import { Injectable } from '@nestjs/common';
import type { NotificationProvider, BugNotificationPayload, JsonValue } from './notification.interface';
import { ProviderError, parseRetryAfter } from '../../integrations/providers/provider-error';

@Injectable()
export class SlackProvider implements NotificationProvider {
  readonly id = 'slack';
  readonly name = 'Slack';

  async validateCredentials(config: Record<string, JsonValue>): Promise<boolean> {
    const webhookUrl = config.webhook_url as string;
    if (!webhookUrl) return false;
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Bug Intelligence test message' }),
      });
      return res.ok || res.status === 400; // 400 means webhook works but invalid payload
    } catch {
      return false;
    }
  }

  async send(bug: BugNotificationPayload, config: Record<string, JsonValue>): Promise<{ messageId: string }> {
    const webhookUrl = config.webhook_url as string;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Bug detected: ${bug.summary}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `🐛 ${bug.severity.toUpperCase()}: ${bug.summary}` },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Severity:*\n${bug.severity}` },
              { type: 'mrkdwn', text: `*Error:*\n${bug.errorMessage}` },
            ],
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Root Cause:*\n${bug.rootCause}` },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `<${bug.url}|View in Dashboard>` },
          },
        ],
      }),
    });

    if (!res.ok) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      throw new ProviderError({
        providerId: this.id,
        message: `Slack notification failed: ${res.status}`,
        statusCode: res.status,
        retryAfterSeconds: retryAfter,
      });
    }

    return { messageId: `slack-${Date.now()}` };
  }
}
