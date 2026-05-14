import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { NotificationProvider, BugNotificationPayload, JsonValue } from './notification.interface';
import { ProviderError } from '../../integrations/providers/provider-error';

@Injectable()
export class EmailProvider implements NotificationProvider {
  readonly id = 'email';
  readonly name = 'Email';

  async validateCredentials(config: Record<string, JsonValue>): Promise<boolean> {
    const smtpHost = config.smtp_host as string;
    const smtpPort = config.smtp_port as number;
    const smtpUser = config.smtp_user as string;
    const smtpPass = config.smtp_pass as string;
    if (!smtpHost || !smtpUser || !smtpPass) return false;

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort ?? 587,
        secure: (smtpPort ?? 587) === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.verify();
      return true;
    } catch {
      return false;
    }
  }

  async send(bug: BugNotificationPayload, config: Record<string, JsonValue>): Promise<{ messageId: string }> {
    const smtpHost = config.smtp_host as string;
    const smtpPort = config.smtp_port as number;
    const smtpUser = config.smtp_user as string;
    const smtpPass = config.smtp_pass as string;
    const from = config.from as string;
    const to = config.to as string;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort ?? 587,
      secure: (smtpPort ?? 587) === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    const html = `
      <h2>Bug Detected: ${bug.summary}</h2>
      <p><strong>Severity:</strong> ${bug.severity}</p>
      <p><strong>Error:</strong> ${bug.errorMessage}</p>
      <p><strong>Root Cause:</strong> ${bug.rootCause}</p>
      <p><a href="${bug.url}">View in Dashboard</a></p>
    `;

    try {
      const info = await transporter.sendMail({
        from: from ?? smtpUser,
        to,
        subject: `[${bug.severity.toUpperCase()}] ${bug.summary}`,
        html,
      });
      return { messageId: info.messageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown email error';
      throw new ProviderError({
        providerId: this.id,
        message: `Email send failed: ${message}`,
        statusCode: 0,
      });
    }
  }
}
