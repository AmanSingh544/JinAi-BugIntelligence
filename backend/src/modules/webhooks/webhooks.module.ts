import { Module } from '@nestjs/common';
import { GitHubWebhookController } from './github-webhook.controller';
import { GitHubWebhookService } from './github-webhook.service';
import { AutofixModule } from '../autofix/autofix.module';

@Module({
  imports: [AutofixModule],
  controllers: [GitHubWebhookController],
  providers: [GitHubWebhookService],
})
export class WebhooksModule {}
