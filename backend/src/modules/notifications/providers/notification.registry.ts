import { Injectable } from '@nestjs/common';
import type { NotificationProvider } from './notification.interface';
import { SlackProvider } from './slack.provider';
import { EmailProvider } from './email.provider';
import { TeamsProvider } from './teams.provider';

@Injectable()
export class NotificationRegistry {
  private readonly providers: Map<string, NotificationProvider>;

  constructor(slack: SlackProvider, email: EmailProvider, teams: TeamsProvider) {
    this.providers = new Map<string, NotificationProvider>([
      [slack.id, slack],
      [email.id, email],
      [teams.id, teams],
    ]);
  }

  get(providerId: string): NotificationProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown notification provider: ${providerId}`);
    return provider;
  }

  list(): NotificationProvider[] {
    return Array.from(this.providers.values());
  }
}
