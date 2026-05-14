import { Injectable } from '@nestjs/common';
import type { NotificationProvider, BugNotificationPayload, JsonValue } from './notification.interface';
import { ProviderError, parseRetryAfter } from '../../integrations/providers/provider-error';

@Injectable()
export class TeamsProvider implements NotificationProvider {
  readonly id = 'teams';
  readonly name = 'Microsoft Teams';

  async validateCredentials(config: Record<string, JsonValue>): Promise<boolean> {
    const webhookUrl = config.webhook_url as string;
    if (!webhookUrl) return false;

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          '@context': 'https://schema.org/extensions',
          summary: 'Bug Intelligence Test',
          themeColor: '0078D7',
          sections: [
            {
              activityTitle: 'Bug Intelligence',
              activitySubtitle: 'Test connection',
              text: 'This is a test message from Bug Intelligence.',
            },
          ],
        }),
      });
      return res.ok || res.status === 400;
    } catch {
      return false;
    }
  }

  async send(bug: BugNotificationPayload, config: Record<string, JsonValue>): Promise<{ messageId: string }> {
    const webhookUrl = config.webhook_url as string;

    const severityColor: Record<string, string> = {
      low: '0078D7',
      medium: 'FFC107',
      high: 'FF5722',
      critical: 'D32F2F',
    };

    const card = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: `Bug detected: ${bug.summary}`,
      themeColor: severityColor[bug.severity] ?? '0078D7',
      sections: [
        {
          activityTitle: `🐛 ${bug.severity.toUpperCase()}: ${bug.summary}`,
          activitySubtitle: `Error: ${bug.errorMessage}`,
          facts: [
            { name: 'Severity', value: bug.severity },
            { name: 'Root Cause', value: bug.rootCause },
          ],
          markdown: true,
        },
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'View in Dashboard',
          targets: [
            { os: 'default', uri: bug.url },
          ],
        },
      ],
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });

    if (!res.ok) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      throw new ProviderError({
        providerId: this.id,
        message: `Teams notification failed: ${res.status}`,
        statusCode: res.status,
        retryAfterSeconds: retryAfter,
      });
    }

    return { messageId: `teams-${Date.now()}` };
  }
}
